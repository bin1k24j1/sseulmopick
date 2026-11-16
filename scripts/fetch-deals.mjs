#!/usr/bin/env node
// 쿠팡 파트너스 공식 Open API → deals.json
//   node scripts/fetch-deals.mjs           미리보기만 (deals.json을 바꾸지 않음)
//   node scripts/fetch-deals.mjs --write   deals.json에 반영 (먼저 output/backups/에 백업)
//   node scripts/fetch-deals.mjs --dump    API 원본 응답을 output/api-raw/에 저장 (응답 항목 이름 확인용)
//
// 원칙
// - 공식 API(api-gateway.coupang.com)만 호출한다. 쿠팡 웹페이지는 절대 요청하지 않는다(크롤링 금지).
// - API 키는 .env에서만 읽고, 키 값은 화면·파일·로그 어디에도 남기지 않는다.
// - 키가 없으면 안내만 하고 끝낸다.
// - 새로 가져온 딜은 active: false 로 넣는다. 운영자가 영상 번호·가격을 확인하고 켠다.
// - 같은 상품(productId)을 다시 가져오면 가격과 확인 시각만 갱신한다.
//
// ⚠ 승인 전이라 실제 응답으로 검증하지 못했다. 승인 후 첫 실행은 --dump로 원본을 보고
//   mapItem()의 항목 이름(originalPrice 등)과 CATEGORY_IDS가 맞는지 확인할 것.

import { createHmac } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'https://api-gateway.coupang.com';
const BASE = '/v2/providers/affiliate_open_api/apis/openapi/products';
const NO_KEY_MESSAGE = 'API 키가 없습니다. deals.json을 직접 수정하세요';

// 쓸모픽 카테고리 → 쿠팡 카테고리 베스트 ID.
// 확인 필요: 승인 후 파트너스 API 문서의 카테고리 표와 대조할 것.
export const CATEGORY_IDS = {
  주방: 1013,   // 주방용품
  수납: 1015,   // 홈인테리어
  '청소·세탁': 1014,   // 생활용품
  책상: 1021,   // 문구/오피스
};
const PER_CATEGORY = 10;
const BANNED = ['써보니', '써본', '강력 추천', '역대급', '최저가'];

// ── 키 ────────────────────────────────────────
// .env를 process.env로 읽어 들일 뿐, 파일 내용을 출력하지 않는다
function loadDotEnv() {
  try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* .env 없음: 아래에서 안내 */ }
}
export function getKeys(env) {
  const accessKey = (env.COUPANG_ACCESS_KEY || '').trim();
  const secretKey = (env.COUPANG_SECRET_KEY || '').trim();
  if (!accessKey || !secretKey) return null;
  return { accessKey, secretKey, subId: (env.COUPANG_SUB_ID || '').trim() };
}

// ── 서명 (쿠팡 Open API HMAC 방식) ───────────────
// signed-date: yyMMdd'T'HHmmss'Z' (UTC), 서명 대상: 시각 + 메서드 + 경로 + 쿼리(물음표 없이)
export function authorization({ accessKey, secretKey }, method, pathname, query, date = new Date()) {
  const signedDate = `${date.toISOString().slice(2, 19).replace(/[-:]/g, '')}Z`;
  const signature = createHmac('sha256', secretKey).update(signedDate + method + pathname + query).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${signedDate}, signature=${signature}`;
}

async function callApi(keys, pathname, params) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${HOST}${pathname}${query ? `?${query}` : ''}`, {
    headers: { Authorization: authorization(keys, 'GET', pathname, query), 'Content-Type': 'application/json;charset=UTF-8' },
  });
  const body = await res.json().catch(() => ({}));
  // 오류 메시지에 키가 섞이지 않도록 상태 코드와 응답 코드만 보여준다
  if (!res.ok || (body.rCode && body.rCode !== '0')) {
    throw new Error(`API 요청 실패 (${pathname.split('/').slice(-2).join('/')}): HTTP ${res.status}${body.rCode ? `, rCode ${body.rCode}` : ''}${body.rMessage ? `, ${body.rMessage}` : ''}`);
  }
  return body;
}

// ── 응답 → 딜 ─────────────────────────────────
const num = (v) => (v === undefined || v === null || v === '' ? NaN : Number(String(v).replace(/[^0-9.]/g, '')));
const nowKst = (d = new Date()) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 19) + '+09:00';

// 확인 필요: 승인 후 --dump로 실제 항목 이름을 보고 맞출 것
export function mapItem(item, category, checkedAt) {
  const salePrice = num(item.productPrice ?? item.salePrice);
  const originalPrice = num(item.originalPrice ?? item.basePrice ?? item.productOriginalPrice);
  let discountRate = num(item.discountRate);
  if (!Number.isFinite(discountRate) && originalPrice > 0 && salePrice > 0) {
    discountRate = Math.round((1 - salePrice / originalPrice) * 100);
  }
  // 정가·판매가·할인율 셋 중 하나라도 확인이 안 되면 딜로 만들지 않는다 (지어내지 않기)
  if (!(salePrice > 0 && originalPrice > salePrice && discountRate > 0) || !item.productId || !item.productUrl) return null;
  return {
    id: null, // 영상 번호는 운영자가 정한다. 반영할 때 임시 번호를 붙인다
    name: String(item.productName || '').trim(),
    category,
    originalPrice,
    salePrice,
    discountRate,
    checkedAt,
    link: item.productUrl,
    platform: 'coupang',
    image: item.productImage || '',
    imageCredit: null,
    active: false,
    source: 'coupang-api',
    productId: String(item.productId),
  };
}

// 기존 딜과 합치기: 같은 productId는 가격·시각만 갱신, 새 상품은 꺼진 상태로 추가
export function merge(existing, fetched) {
  const deals = existing.map((d) => ({ ...d }));
  const byPid = new Map(deals.filter((d) => d.productId).map((d) => [String(d.productId), d]));
  let nextId = Math.max(0, ...deals.map((d) => Number(d.id) || 0)) + 1;
  const added = [];
  const updated = [];
  for (const f of fetched) {
    const old = byPid.get(f.productId);
    if (old) {
      Object.assign(old, { originalPrice: f.originalPrice, salePrice: f.salePrice, discountRate: f.discountRate, checkedAt: f.checkedAt, link: f.link });
      updated.push(old);
    } else {
      const d = { ...f, id: nextId++ };
      deals.push(d);
      byPid.set(d.productId, d);
      added.push(d);
    }
  }
  return { deals, added, updated };
}

// ── 실행 ─────────────────────────────────────
async function main() {
  const argv = new Set(process.argv.slice(2));
  loadDotEnv();
  const keys = getKeys(process.env);
  if (!keys) {
    console.log(NO_KEY_MESSAGE);
    return;
  }

  const imageSize = '512x512';
  const common = { imageSize, ...(keys.subId ? { subId: keys.subId } : {}) };
  const checkedAt = nowKst();
  const raw = {};
  const fetched = [];
  let skipped = 0;

  // 골드박스: 쓸모픽 카테고리를 알 수 없어 비워 둔다 (운영자가 켤 때 정한다)
  raw.goldbox = await callApi(keys, `${BASE}/goldbox`, common);
  for (const item of raw.goldbox.data || []) {
    const d = mapItem(item, '', checkedAt);
    d ? fetched.push(d) : skipped++;
  }
  for (const [category, id] of Object.entries(CATEGORY_IDS)) {
    raw[category] = await callApi(keys, `${BASE}/bestcategories/${id}`, { ...common, limit: PER_CATEGORY });
    for (const item of raw[category].data || []) {
      const d = mapItem(item, category, checkedAt);
      d ? fetched.push(d) : skipped++;
    }
  }
  // 골드박스와 카테고리 베스트에 같은 상품이 있으면 카테고리가 정해진 쪽을 남긴다
  // (카테고리 없는 것을 앞에 두면 Map에서 뒤에 오는 카테고리 있는 쪽이 덮어쓴다)
  const unique = [...new Map(fetched
    .sort((a, b) => Number(Boolean(a.category)) - Number(Boolean(b.category)))
    .map((d) => [d.productId, d])).values()];

  if (argv.has('--dump')) {
    const dir = path.join(ROOT, 'output', 'api-raw');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${checkedAt.slice(0, 19).replace(/:/g, '')}.json`);
    await writeFile(file, JSON.stringify(raw, null, 2), 'utf8');
    console.log(`원본 응답: ${path.relative(ROOT, file)}`);
  }

  const dealsPath = path.join(ROOT, 'deals.json');
  const data = JSON.parse(await readFile(dealsPath, 'utf8'));
  const { deals, added, updated } = merge(data.deals || [], unique);

  console.log(`가져온 상품 ${unique.length}개 (정가·할인 정보가 없어 건너뜀 ${skipped}개)`);
  console.log(`새 딜 ${added.length}개 (꺼진 상태로 추가), 가격 갱신 ${updated.length}개`);
  for (const d of added.slice(0, 15)) console.log(`  + #${d.id} [${d.category || '카테고리 미정'}] ${d.name} ${d.discountRate}% ${d.salePrice.toLocaleString('ko-KR')}원`);
  const flagged = added.filter((d) => BANNED.some((w) => d.name.includes(w)));
  if (flagged.length) console.log(`! 상품 이름에 금지 표현이 있는 딜 ${flagged.length}개: 켜기 전에 이름을 고쳐 주세요 (#${flagged.map((d) => d.id).join(', #')})`);

  if (!argv.has('--write')) {
    console.log('\n미리보기만 했어요. deals.json에 반영하려면 --write를 붙여 실행하세요.');
    return;
  }
  const backupDir = path.join(ROOT, 'output', 'backups');
  await mkdir(backupDir, { recursive: true });
  const backup = path.join(backupDir, `deals-${checkedAt.slice(0, 19).replace(/:/g, '')}.json`);
  await writeFile(backup, JSON.stringify(data, null, 2), 'utf8');
  await writeFile(dealsPath, `${JSON.stringify({ ...data, deals }, null, 2)}\n`, 'utf8');
  console.log(`\ndeals.json에 반영했어요. 이전 파일은 ${path.relative(ROOT, backup)}에 백업했어요.`);
  console.log('새 딜은 active: false 입니다. 영상 번호(id)·카테고리·가격을 확인한 뒤 true로 바꿔 주세요.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });
}
