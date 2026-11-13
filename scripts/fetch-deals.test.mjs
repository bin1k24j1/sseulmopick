// node --test scripts/fetch-deals.test.mjs   (네트워크·.env를 쓰지 않는 검사만)
import test from 'node:test';
import assert from 'node:assert/strict';
import { getKeys, authorization, mapItem, merge } from './fetch-deals.mjs';

test('키가 비어 있으면 null (안내만 하고 끝나는 경로)', () => {
  assert.equal(getKeys({}), null);
  assert.equal(getKeys({ COUPANG_ACCESS_KEY: 'a', COUPANG_SECRET_KEY: '  ' }), null);
  assert.deepEqual(getKeys({ COUPANG_ACCESS_KEY: 'a', COUPANG_SECRET_KEY: 's' }), { accessKey: 'a', secretKey: 's', subId: '' });
});

test('서명 헤더 형식', () => {
  const h = authorization({ accessKey: 'AK', secretKey: 'SK' }, 'GET', '/v2/x', 'limit=10', new Date('2026-11-13T12:34:56Z'));
  assert.match(h, /^CEA algorithm=HmacSHA256, access-key=AK, signed-date=261113T123456Z, signature=[0-9a-f]{64}$/);
  assert.ok(!h.includes('SK'), '비밀 키가 헤더에 그대로 들어가면 안 됨');
});

const T = '2026-11-13T21:00:00+09:00';

test('정가·할인 정보가 없으면 딜로 만들지 않는다', () => {
  assert.equal(mapItem({ productId: 1, productName: 'x', productPrice: 9900, productUrl: 'https://link' }, '주방', T), null);
  assert.equal(mapItem({ productId: 1, productName: 'x', productPrice: 9900, originalPrice: 9900, productUrl: 'https://link' }, '주방', T), null);
});

test('정가가 있으면 할인율을 계산하고 꺼진 상태로 만든다', () => {
  const d = mapItem({ productId: 7, productName: '주걱', productPrice: '9,900', originalPrice: 15900, productUrl: 'https://link', productImage: 'https://img' }, '주방', T);
  assert.equal(d.discountRate, 38);
  assert.equal(d.salePrice, 9900);
  assert.equal(d.active, false);
  assert.equal(d.productId, '7');
  assert.equal(d.checkedAt, T);
});

test('같은 상품은 가격만 갱신, 새 상품은 다음 번호로 추가, 직접 넣은 딜은 그대로', () => {
  const manual = { id: 3, name: '직접 넣은 딜', active: true };
  const api = { id: 5, productId: '7', name: '내가 고친 이름', salePrice: 12000, active: true };
  const { deals, added, updated } = merge([manual, api], [
    { productId: '7', name: 'API 이름', salePrice: 9900, originalPrice: 15900, discountRate: 38, checkedAt: T, link: 'https://new' },
    { productId: '8', name: '새 상품', salePrice: 5000, originalPrice: 8000, discountRate: 38, checkedAt: T, link: 'https://l', active: false },
  ]);
  assert.deepEqual(deals[0], manual);
  assert.equal(deals[1].salePrice, 9900);
  assert.equal(deals[1].name, '내가 고친 이름'); // 운영자가 고친 이름·켜짐 상태는 유지
  assert.equal(deals[1].active, true);
  assert.equal(added[0].id, 6);
  assert.equal(updated.length, 1);
});
