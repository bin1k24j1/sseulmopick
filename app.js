// 쓸모픽 링크 페이지: products.json을 읽어 카드·대가성 문구·SNS를 그린다.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = { products: [], platforms: {}, cat: '전체', num: '' };

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 제휴 링크는 http(s)만 허용 (javascript: 등 차단)
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

const SNS = { instagram: '인스타그램', youtube: '유튜브', tiktok: '틱톡' };

// 카드마다 ±1도 안쪽의 손맛. id로 정해서 다시 그려도 같은 기울기
const tilt = (id) => (((Number(id) * 5) % 9) - 4) * 0.22; // 1→+0.22, 2→-0.66, 3→+0.44 … 이웃 카드끼리 엇갈림

function card(p, i, tag = 'li', cls = '') {
  const plat = state.platforms[p.platform] || { label: p.platform };
  const link = safeUrl(p.link);
  const shorts = safeUrl(p.shortsUrl);
  return `
  <${tag} class="card ${cls}" data-id="${esc(p.id)}" style="--tilt:${tilt(p.id).toFixed(2)}deg">
    <div class="card__media">
      ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" width="480" height="480" loading="${i < 4 ? 'eager' : 'lazy'}" decoding="async">` : ''}
      <span class="sticker" aria-label="${esc(p.id)}번 상품"><span aria-hidden="true">#</span>${esc(p.id)}</span>
      ${p.example ? '<span class="badge">예시</span>' : ''}
    </div>
    <div class="card__body">
      <p class="card__meta"><span>${esc(p.category)}</span><span>${esc(p.price)}</span></p>
      <h3 class="card__name">${esc(p.name)}</h3>
      <dl class="memo">
        <div class="memo__row memo__row--pro"><dt>좋은 점</dt><dd>${esc(p.pros)}</dd></div>
        <div class="memo__row memo__row--con"><dt>아쉬운 점</dt><dd>${esc(p.cons)}</dd></div>
      </dl>
      <div class="card__actions">
        ${link ? `<a class="buy" href="${esc(link)}" target="_blank" rel="sponsored noopener">${esc(plat.label)}에서 보기<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5h8v8M15 5L5 15"/></svg></a>` : ''}
        ${shorts ? `<a class="watch" href="${esc(shorts)}" target="_blank" rel="noopener">영상 다시 보기</a>` : ''}
      </div>
    </div>
  </${tag}>`;
}

function render() {
  const { products, cat, num } = state;
  const shown = num
    ? products.filter((p) => String(p.id) === num)
    : products.filter((p) => cat === '전체' || p.category === cat);

  // 기본 화면(전체, 검색 없음)에서만 크게: featured: true 상품(여럿이면 최신 것), 없으면 가장 최근 상품
  const pick = !num && cat === '전체' ? (shown.find((p) => p.featured === true) || shown[0]) : null;
  const rest = pick ? shown.filter((p) => p !== pick) : shown;

  $('[data-pick]').hidden = !pick;
  $('[data-pick-label]').textContent = pick?.featured === true ? '쓸모픽 추천' : '새로 올라온 쓸모';
  $('[data-pick-card]').innerHTML = pick ? card(pick, 0, 'article', 'card--pick') : '';
  $('[data-list]').innerHTML = rest.map((p, i) => card(p, i + 1)).join('');
  $('[data-empty]').hidden = shown.length > 0;
  if (!shown.length) {
    $('[data-empty-title]').textContent = num ? `#${num}번 상품을 못 찾았어요` : `${cat} 상품은 아직 없어요`;
    $('[data-empty-text]').textContent = num ? '영상 속 번호를 한 번 더 확인해 주세요.' : '새 영상이 올라오면 여기에 바로 추가할게요.';
  }
  $('[data-status]').textContent = num
    ? (shown.length ? `#${num}번 상품이에요` : '')
    : pick ? (rest.length ? `다른 쓸모템 ${rest.length}개 · 최신순` : '') : `${cat} ${shown.length}개 · 최신순`;
  $$('[data-chips] .chip').forEach((b) => b.setAttribute('aria-pressed', String(!num && b.dataset.cat === cat)));
  $('[data-clear]').hidden = !num;
  if (num && shown.length) $('[data-list] .card')?.classList.add('is-hit');
  movePill();
  $$('.card').forEach(reveal);
}

// 칩 선택: 검은 알약이 선택한 칩으로 미끄러진다
function movePill() {
  const pill = $('.chips__pill');
  const on = $('[data-chips] .chip[aria-pressed="true"]');
  pill.style.opacity = on ? '1' : '0';
  if (!on) return;
  pill.style.width = `${on.offsetWidth}px`;
  pill.style.transform = `translateX(${on.offsetLeft}px)`;
}

// 스크롤로 들어올 때 한 번만 살짝 떠오르며 등장 (동작 줄이기 설정이면 생략)
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const io = !calm && 'IntersectionObserver' in window && new IntersectionObserver((entries) => {
  entries.filter((e) => e.isIntersecting).forEach((e, i) => {
    const el = e.target;
    io.unobserve(el);
    el.style.setProperty('--d', `${Math.min(i, 3) * 60}ms`);
    el.classList.add('is-in');
    el.addEventListener('transitionend', () => {
      el.classList.remove('reveal', 'is-in');
      el.style.removeProperty('--d');
    }, { once: true });
  });
}, { rootMargin: '0px 0px -6% 0px', threshold: 0.12 });

function reveal(el) {
  if (!io) return;
  el.classList.add('reveal');
  io.observe(el);
}

function renderStatic(data) {
  // 실제로 쓰인 플랫폼의 대가성 문구만, 상단·하단 두 곳에
  const used = [...new Set(state.products.map((p) => p.platform))];
  const lines = used.map((k) => state.platforms[k]?.disclosure).filter(Boolean);
  $$('[data-disclosure]').forEach((el) => {
    el.innerHTML = lines.map((t) => `<p>${esc(t)}</p>`).join('');
    el.hidden = !lines.length;
  });

  const sns = data.sns || {};
  const entries = Object.entries(SNS);
  $('[data-sns]').innerHTML = entries.map(([k, label]) => {
    const u = safeUrl(sns[k]);
    return u
      ? `<a href="${esc(u)}" target="_blank" rel="noopener">${label}</a>`
      : `<span class="sns__soon" aria-label="${label} 준비 중">${label}</span>`;
  }).join('') + (entries.some(([k]) => !safeUrl(sns[k])) ? '<span class="sns__note">곧 열어요</span>' : '');

  // CC 라이선스 표기: 원본(저작자) · 라이선스 원문 링크 · 변경 사실
  const credits = state.products.filter((p) => p.credit && safeUrl(p.credit.url));
  const lic = (c) => (safeUrl(c.licenseUrl)
    ? `<a href="${esc(c.licenseUrl)}" target="_blank" rel="noopener license">${esc(c.license)}</a>`
    : esc(c.license || ''));
  $('[data-credits]').innerHTML = credits.length
    ? '사진: ' + credits.map(({ credit: c }) => `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.by)}</a> (${lic(c)})`).join(' · ')
      + ' — 위키미디어 공용, 크기·형식 변경'
    : '';
}

function setNum(raw) {
  state.num = String(raw).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (state.num) state.cat = '전체';
  render();
}

async function init() {
  let data;
  try {
    const res = await fetch('products.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch (e) {
    $('[data-status]').textContent = '상품 목록을 불러오지 못했어요. 잠시 후 새로고침해 주세요.';
    return;
  }
  state.platforms = data.platforms || {};
  state.products = (data.products || []).slice().sort((a, b) =>
    String(b.addedDate).localeCompare(String(a.addedDate)) || Number(b.id) - Number(a.id));
  renderStatic(data);

  // 머리말이 화면 밖으로 나가면 고정된 검색줄에 경계선
  new IntersectionObserver(([e]) => $('.tools').classList.toggle('is-stuck', !e.isIntersecting)).observe($('.top'));

  addEventListener('resize', movePill);
  document.fonts?.ready.then(movePill);

  const input = $('#q');
  // 쇼츠 설명란에서 .../#12 로 바로 열 수 있게
  const fromHash = location.hash.replace(/\D/g, '');
  if (fromHash) { input.value = fromHash; setNum(fromHash); } else render();
  // 첫 배치는 애니메이션 없이, 그 뒤 선택부터 미끄러지게
  requestAnimationFrame(() => $('.chips').classList.add('is-ready'));

  addEventListener('hashchange', () => { const n = location.hash.replace(/\D/g, ''); if (n) { input.value = n; setNum(n); } });
  input.addEventListener('input', () => setNum(input.value));
  $('[data-search]').addEventListener('submit', (e) => { e.preventDefault(); input.blur(); });
  $('[data-clear]').addEventListener('click', () => { input.value = ''; setNum(''); input.focus(); });
  $('[data-chips]').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    input.value = '';
    state.num = '';
    state.cat = b.dataset.cat;
    render();
  });
  $('[data-reset]').addEventListener('click', () => { input.value = ''; state.num = ''; state.cat = '전체'; render(); });
}

init();
