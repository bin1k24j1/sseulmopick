#!/usr/bin/env node
// 쓸모픽 쇼츠 대본 생성기
//   node scripts/make-script.mjs                 deals.json → output/<오늘 날짜>/script.txt, captions.srt
//   node scripts/make-script.mjs --allow-example 예시(가짜 가격) 딜도 사용 (화면 확인용, 실제 영상 금지)
//   node scripts/make-script.mjs --force         같은 날짜 결과물이 있으면 덮어쓰기
//
// 규칙
// - active이고, 가격 확인 후 48시간이 지나지 않은 딜 중 할인율 높은 순으로 최대 3개
// - 구조: 훅(가격 기준 시각 포함) → 딜 3개(번호·상품·할인율·가격) → "번호는 프로필 링크에서" → 대가성 문구
// - 내레이션(script.txt)과 자막(captions.srt)은 같은 문장 배열에서 만들고, 저장 전에 글자 단위로 대조한다
// - 길이 15~20초: 읽는 속도로 각 줄 시간을 잡고, 짧으면 20초 안에서 늘리고 길면 경고한다

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const ALLOW_EXAMPLE = args.has('--allow-example');
const FORCE = args.has('--force');

const STALE_MS = 48 * 60 * 60 * 1000;
const MIN_SEC = 15;
const MAX_SEC = 20;
const SYLLABLES_PER_SEC = 6.5; // 쇼츠 내레이션의 빠른 말 속도 기준
// PRODUCT.md 금지 표현 + 근거 없는 "최저가"
const BANNED = ['써보니', '써본', '써 보니', '강력 추천', '역대급', '최저가', '후기', '리뷰'];
const DISCLOSURE = {
  coupang: '쿠팡 파트너스 활동으로 수수료를 받을 수 있어요',
  naver: '네이버 쇼핑 커넥트 활동으로 수수료를 받을 수 있어요',
};

const fail = (msg) => { console.error(`✖ ${msg}`); process.exit(1); };
const warn = (msg) => console.warn(`! ${msg}`);

// ── 한국 시간 다루기 ─────────────────────────────
const KST_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function kst(ms) {
  const p = Object.fromEntries(KST_PARTS.formatToParts(ms).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, month: Number(p.month), day: Number(p.day), hour: Number(p.hour), minute: Number(p.minute) };
}
const dayDiff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

// "오늘 밤 9시", "어제 아침 9시 30분", "11월 10일 오후 3시"
export function spokenTime(checkedMs, nowMs) {
  const t = kst(checkedMs);
  const n = kst(nowMs);
  const diff = dayDiff(n.date, t.date);
  const day = diff === 0 ? '오늘' : diff === 1 ? '어제' : `${t.month}월 ${t.day}일`;
  const h = t.hour;
  const part = h < 6 ? '새벽' : h < 11 ? '아침' : h < 13 ? '낮' : h < 18 ? '오후' : h < 21 ? '저녁' : '밤';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${day} ${part} ${h12}시${t.minute ? ` ${t.minute}분` : ''}`;
}

// ── 대본 문장 ─────────────────────────────────
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
const rateOf = (d) => (Number.isFinite(d.discountRate) ? d.discountRate
  : d.originalPrice > 0 ? Math.round((1 - d.salePrice / d.originalPrice) * 100) : 0);

export function buildLines(picks, nowMs) {
  const oldest = Math.min(...picks.map((d) => Date.parse(d.checkedAt)));
  const lines = [
    // 고정 문장은 짧게: 20초 중 상품 이름에 쓸 시간을 남긴다
    `${spokenTime(oldest, nowMs)} 기준, 자취템 할인 ${picks.length}개.`,
    ...picks.map((d) => `${d.id}번 ${d.name}, ${rateOf(d)}% 할인 ${won(d.salePrice)}.`),
    '번호는 프로필 링크에서.',
  ];
  const platforms = [...new Set(picks.map((d) => d.platform))];
  for (const p of platforms) {
    if (!DISCLOSURE[p]) fail(`플랫폼 "${p}"의 대가성 문구가 없어요. scripts/make-script.mjs의 DISCLOSURE에 추가하세요.`);
    lines.push(DISCLOSURE[p]);
  }
  return lines;
}

// 읽는 데 걸리는 음절 수(대략): 숫자는 소리 내 읽을 때 길어지고, %는 "퍼센트"
function syllables(line) {
  let n = 0;
  for (const ch of line) {
    if (/[가-힣]/.test(ch)) n += 1;
    else if (/[0-9]/.test(ch)) n += 1.3;
    else if (ch === '%') n += 3;
    else if (/[A-Za-z]/.test(ch)) n += 0.6;
  }
  return n;
}

export function timeLines(lines) {
  const natural = lines.map((l) => syllables(l) / SYLLABLES_PER_SEC + 0.25); // 줄 사이 숨 0.25초
  const total = natural.reduce((a, b) => a + b, 0);
  const target = Math.min(Math.max(total, MIN_SEC), MAX_SEC);
  const scale = total < MIN_SEC ? target / total : 1; // 짧으면 늘리고, 길면 그대로 두고 경고
  let t = 0;
  const cues = natural.map((d, i) => {
    const start = t;
    t += d * scale;
    return { i: i + 1, start, end: t, text: lines[i] };
  });
  return { cues, natural: total, final: t };
}

const stamp = (sec) => {
  const ms = Math.round(sec * 1000);
  const pad = (v, w = 2) => String(v).padStart(w, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};
export const toSrt = (cues) => cues.map((c) => `${c.i}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n');
export const toScript = (lines) => `${lines.join('\n')}\n`;

// 자막 파일을 다시 읽어 문장만 뽑는다 (저장 전 대조용)
const srtTexts = (srt) => srt.trim().split(/\n\n+/).map((block) => block.split('\n').slice(2).join('\n'));

// ── 실행 ─────────────────────────────────────
async function main() {
  const now = Date.now();
  let data;
  try {
    data = JSON.parse(await readFile(path.join(ROOT, 'deals.json'), 'utf8'));
  } catch (e) {
    fail(`deals.json을 읽지 못했어요: ${e.message}`);
  }

  const all = (data.deals || []).filter((d) => d.active !== false);
  const fresh = all.filter((d) => now - Date.parse(d.checkedAt) <= STALE_MS); // 시각이 없거나 48시간 지난 딜은 제외
  const skippedStale = all.length - fresh.length;
  const usable = fresh.filter((d) => ALLOW_EXAMPLE || !d.example);
  const skippedExample = fresh.length - usable.length;

  const picks = usable
    .filter((d) => Number.isFinite(d.salePrice) && d.name)
    .sort((a, b) => rateOf(b) - rateOf(a) || Date.parse(b.checkedAt) - Date.parse(a.checkedAt))
    .slice(0, 3);

  if (skippedStale) warn(`가격 확인 후 48시간이 지난 딜 ${skippedStale}개는 뺐어요.`);
  if (skippedExample) warn(`예시(가짜 가격) 딜 ${skippedExample}개는 뺐어요. 화면 확인용으로 쓰려면 --allow-example`);
  if (!picks.length) fail('대본에 넣을 딜이 없어요. deals.json에 active이고 48시간 안에 가격을 확인한 딜을 넣어 주세요.');
  if (picks.length < 3) warn(`쓸 수 있는 딜이 ${picks.length}개뿐이라 ${picks.length}개로 만들었어요.`);
  if (picks.some((d) => d.example)) warn('예시(가짜 가격) 딜이 들어갔어요. 이 대본은 실제 영상에 쓰지 마세요.');

  const times = picks.map((d) => Date.parse(d.checkedAt));
  if (Math.max(...times) - Math.min(...times) > 3 * 60 * 60 * 1000) {
    warn('딜마다 가격 확인 시각이 3시간 넘게 달라요. 대본에는 가장 이른 시각을 넣었어요. 같은 시각에 다시 확인하는 걸 권해요.');
  }

  const lines = buildLines(picks, now);
  const { cues, natural, final } = timeLines(lines);
  if (natural > MAX_SEC) warn(`읽는 데 약 ${natural.toFixed(1)}초 걸려서 20초를 넘어요. 상품 이름을 줄여 주세요.`);

  const bad = BANNED.filter((w) => lines.some((l) => l.includes(w)));
  if (bad.length) fail(`금지 표현이 들어갔어요: ${bad.join(', ')} — deals.json의 상품 이름을 확인하세요.`);

  const script = toScript(lines);
  const srt = toSrt(cues);
  // 내레이션과 자막이 글자 하나까지 같은지 확인
  const a = script.trimEnd().split('\n');
  const b = srtTexts(srt);
  if (a.length !== b.length || a.some((l, i) => l !== b[i])) fail('내부 오류: 내레이션과 자막 문장이 달라요. 저장하지 않았어요.');

  const dir = path.join(ROOT, 'output', kst(now).date);
  const files = { 'script.txt': script, 'captions.srt': srt };
  if (!FORCE) {
    for (const f of Object.keys(files)) {
      const exists = await access(path.join(dir, f)).then(() => true, () => false);
      if (exists) fail(`${path.relative(ROOT, path.join(dir, f))}이(가) 이미 있어요. 덮어쓰려면 --force를 붙여 주세요.`);
    }
  }
  await mkdir(dir, { recursive: true });
  for (const [f, body] of Object.entries(files)) await writeFile(path.join(dir, f), body, 'utf8');

  console.log(`✔ ${path.relative(ROOT, dir)}/script.txt, captions.srt (약 ${final.toFixed(1)}초, ${lines.length}줄)\n`);
  console.log(script);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
