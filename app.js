// 쓸모픽 핫딜 페이지: deals.json을 읽어 딜 카드·대가성 문구·SNS를 그린다.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = { deals: [], platforms: {}, cat: '전체', num: '' };

const STALE_MS = 48 * 60 * 60 * 1000; // 가격 확인 후 48시간이 지나면 지난 딜
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
const checkedMs = (d) => Date.parse(d.checkedAt); // 시각이 없거나 잘못되면 NaN
// 확인 시각을 모르는 딜도 지난 딜로 본다 (기준 없는 가격을 최신처럼 보이지 않게)
const isStale = (d) => !(Date.now() - checkedMs(d) <= STALE_MS);
// 할인율: 적힌 값이 우선, 없으면 정가·판매가로 계산
const rateOf = (d) => (Number.isFinite(d.discountRate) ? d.discountRate
  : d.originalPrice > 0 ? Math.round((1 - d.salePrice / d.originalPrice) * 100) : 0);

// "11월 13일 21시 기준 가격" — 방문자 위치와 상관없이 한국 시간으로
const KST = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
function checkedLabel(d) {
  const t = checkedMs(d);
  if (Number.isNaN(t)) return '가격 확인 시각 없음';
  const p = Object.fromEntries(KST.formatToParts(t).map((x) => [x.type, x.value]));
  return `${p.month}월 ${p.day}일 ${Number(p.hour)}시${p.minute !== '00' ? ` ${Number(p.minute)}분` : ''} 기준 가격`;
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 제휴 링크는 http(s)만 허용 (javascript: 등 차단)
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

const SNS = { instagram: '인스타그램', youtube: '유튜브', tiktok: '틱톡' };

// 카드마다 ±1도 안쪽의 손맛. id로 정해서 다시 그려도 같은 기울기
const tilt = (id) => (((Number(id) * 5) % 9) - 4) * 0.22; // 1→+0.22, 2→-0.66, 3→+0.44 … 이웃 카드끼리 엇갈림

function card(d, i, tag = 'li', cls = '') {
  const plat = state.platforms[d.platform] || { label: d.platform };
  const link = safeUrl(d.link);
  const stale = isStale(d);
  const rate = rateOf(d);
  const iso = Number.isNaN(checkedMs(d)) ? '' : new Date(checkedMs(d)).toISOString();
  return `
  <${tag} class="card ${cls}${stale ? ' is-stale' : ''}" data-id="${esc(d.id)}" style="--tilt:${tilt(d.id).toFixed(2)}deg">
    <div class="card__media">
      ${d.image ? `<img src="${esc(d.image)}" alt="${esc(d.name)}" width="480" height="480" loading="${i < 4 ? 'eager' : 'lazy'}" decoding="async">` : ''}
      <span class="sticker" aria-label="${esc(d.id)}번 딜"><span aria-hidden="true">#</span>${esc(d.id)}</span>
      <span class="badges">
        ${stale ? '<span class="badge badge--stale">지난 딜</span>' : ''}
        ${d.example ? '<span class="badge">예시</span>' : ''}
      </span>
    </div>
    <div class="card__body">
      <p class="card__meta"><span>${esc(d.category)}</span></p>
      <h3 class="card__name">${esc(d.name)}</h3>
      <div class="deal">
        <p class="deal__row">
          <strong class="deal__rate">${esc(rate)}<small>%</small></strong>
          <span class="deal__prices">
            <span class="deal__sale"><span class="sr-only">판매가 </span>${won(d.salePrice)}</span>
            <del class="deal__orig"><span class="sr-only">정가 </span>${won(d.originalPrice)}</del>
          </span>
        </p>
        <p class="deal__time"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M10 6v4.2l2.8 1.8"/></svg><time${iso ? ` datetime="${iso}"` : ''}>${checkedLabel(d)}</time></p>
        ${d.example ? '<p class="deal__fake">예시용 가짜 가격이에요. 실제 판매 가격이 아니에요.</p>' : ''}
      </div>
      <div class="card__actions">
        ${link ? `<a class="buy" href="${esc(link)}" target="_blank" rel="sponsored noopener">${esc(plat.label)}에서 ${stale ? '지금 가격 확인' : '보기'}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5h8v8M15 5L5 15"/></svg></a>` : ''}
        <p class="card__notice">가격과 재고는 수시로 바뀌어요. 구매 전 ${esc(plat.label)}에서 꼭 확인하세요</p>
      </div>
    </div>
  </${tag}>`;
}

function render() {
  const { deals, cat, num } = state;
  const shown = num
    ? deals.filter((d) => String(d.id) === num)
    : deals.filter((d) => cat === '전체' || d.category === cat);
  const fresh = shown.filter((d) => !isStale(d));
  const stale = shown.filter(isStale); // 지난 딜은 항상 목록 아래로

  // 기본 화면(전체, 검색 없음)에서만 크게: 지나지 않은 딜 중 할인율이 가장 큰 것
  const pick = !num && cat === '전체' && fresh.length
    ? fresh.reduce((a, b) => (rateOf(b) > rateOf(a) ? b : a)) : null;
  const rest = fresh.filter((d) => d !== pick);

  $('[data-pick]').hidden = !pick;
  $('[data-pick-card]').innerHTML = pick ? card(pick, 0, 'article', 'card--pick') : '';
  $('[data-list]').innerHTML = rest.map((d, i) => card(d, i + 1)).join('');
  $('[data-stale]').hidden = !stale.length;
  $('[data-stale-list]').innerHTML = stale.map((d, i) => card(d, rest.length + i + 1)).join('');
  $('[data-empty]').hidden = shown.length > 0;
  if (!shown.length) {
    $('[data-empty-title]').textContent = num ? `#${num}번 딜을 못 찾았어요` : `${cat} 딜은 아직 없어요`;
    $('[data-empty-text]').textContent = num ? '영상 속 번호를 한 번 더 확인해 주세요.' : '새 딜이 올라오면 여기에 바로 추가할게요.';
  }
  $('[data-status]').textContent = num
    ? (shown.length ? `#${num}번 딜이에요${stale.length ? ' · 지난 딜' : ''}` : '')
    : pick ? (rest.length ? `다른 딜 ${rest.length}개 · 가격 확인 최신순` : '')
      : (fresh.length ? `${cat} 딜 ${fresh.length}개 · 가격 확인 최신순` : '');
  $$('[data-chips] .chip').forEach((b) => b.setAttribute('aria-pressed', String(!num && b.dataset.cat === cat)));
  $('[data-clear]').hidden = !num;
  if (num && shown.length) $('main .list .card')?.classList.add('is-hit');
  movePill();
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

function renderStatic(data) {
  // 실제로 쓰인 플랫폼의 대가성 문구만, 상단·하단 두 곳에
  const used = [...new Set(state.deals.map((d) => d.platform))];
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
  const credits = state.deals.filter((d) => d.imageCredit && safeUrl(d.imageCredit.url));
  const lic = (c) => (safeUrl(c.licenseUrl)
    ? `<a href="${esc(c.licenseUrl)}" target="_blank" rel="noopener license">${esc(c.license)}</a>`
    : esc(c.license || ''));
  $('[data-credits]').innerHTML = credits.length
    ? '사진: ' + credits.map(({ imageCredit: c }) => `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.by)}</a> (${lic(c)})`).join(' · ')
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
    const res = await fetch('deals.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch (e) {
    $('[data-status]').textContent = '딜 목록을 불러오지 못했어요. 잠시 후 새로고침해 주세요.';
    return;
  }
  state.platforms = data.platforms || {};
  // active: false 딜은 숨김. 가격 확인이 최근인 순서, 같으면 영상 번호 큰 순서
  state.deals = (data.deals || []).filter((d) => d.active !== false).sort((a, b) =>
    (checkedMs(b) || 0) - (checkedMs(a) || 0) || Number(b.id) - Number(a.id));
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
