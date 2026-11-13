// node --test scripts/make-script.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spokenTime, buildLines, timeLines, toSrt, toScript } from './make-script.mjs';

const NOW = Date.parse('2026-11-13T21:30:00+09:00');

test('기준 시각을 한국 시간으로 말한다', () => {
  assert.equal(spokenTime(Date.parse('2026-11-13T21:00:00+09:00'), NOW), '오늘 밤 9시');
  assert.equal(spokenTime(Date.parse('2026-11-13T09:30:00+09:00'), NOW), '오늘 아침 9시 30분');
  assert.equal(spokenTime(Date.parse('2026-11-12T15:00:00+09:00'), NOW), '어제 오후 3시');
  assert.equal(spokenTime(Date.parse('2026-11-10T00:00:00+09:00'), NOW), '11월 10일 새벽 12시');
  assert.equal(spokenTime(Date.parse('2026-11-13T12:00:00+09:00'), NOW), '오늘 낮 12시');
});

const deals = [
  { id: 3, name: '실리콘 주걱', salePrice: 9900, discountRate: 38, checkedAt: '2026-11-13T21:00:00+09:00', platform: 'coupang' },
  { id: 2, name: '서랍 정리함', salePrice: 19900, discountRate: 31, checkedAt: '2026-11-13T21:00:00+09:00', platform: 'coupang' },
  { id: 7, name: '먼지 클리너', salePrice: 8900, originalPrice: 12000, checkedAt: '2026-11-13T21:00:00+09:00', platform: 'coupang' },
];

test('구조: 훅 → 딜 3개 → 번호 안내 → 대가성 문구', () => {
  const lines = buildLines(deals, NOW);
  assert.equal(lines.length, 6);
  assert.match(lines[0], /^오늘 밤 9시 기준/);
  assert.equal(lines[1], '3번 실리콘 주걱, 38% 할인 9,900원.');
  assert.equal(lines[3], '7번 먼지 클리너, 26% 할인 8,900원.'); // 할인율 없으면 계산
  assert.equal(lines[4], '번호는 프로필 링크에서.');
  assert.equal(lines.at(-1), '쿠팡 파트너스 활동으로 수수료를 받을 수 있어요');
});

test('길이 15~20초, 자막과 대본 문장이 같다', () => {
  const lines = buildLines(deals, NOW);
  const { cues, final } = timeLines(lines);
  assert.ok(final >= 15 && final <= 20, `길이 ${final}`);
  const srt = toSrt(cues);
  const fromSrt = srt.trim().split(/\n\n+/).map((b) => b.split('\n').slice(2).join('\n'));
  assert.deepEqual(fromSrt, toScript(lines).trimEnd().split('\n'));
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:\d\d,\d{3}\n/);
});
