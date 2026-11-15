// Board Game Wall — vanilla JS, no dependencies.
// Data comes from /catalog.json (built from the Excel file by scripts/build-catalog.mjs).

const NS = 'http://www.w3.org/2000/svg';
const MACROS = ['Kids', 'Party', 'Skill & Reflexes', 'Bluff & Deduction', 'Strategy', 'Adventure & Fantasy'];

// Knob scales. `values` are the thresholds used by the filter (null = no filter).
const SCALES = {
  dur: { title: 'DURATION', hint: 'I have … minutes', labels: ['Any', '15′', '30′', '60′', '90′'], values: [null, 15, 30, 60, 90], endL: 'Any', endR: '90′' },
  ply: { title: 'PLAYERS', hint: 'We are … players', labels: ['Any', '1', '2', '3', '4', '5', '6', '7', '8+'], values: [null, 1, 2, 3, 4, 5, 6, 7, 8], endL: 'Any', endR: '8+' },
  eff: { title: 'EFFORT', hint: 'In the mood for … games', labels: ['Any', 'Light', 'Easy', 'Medium', 'Demanding'], values: [null, 1, 2, 3, 4], endL: 'Any', endR: 'Demanding' },
  cat: { title: 'CATEGORY', hint: "I'm looking for … games", labels: ['All', ...MACROS], values: [null, ...MACROS], endL: 'All', endR: 'Adventure' },
};

const ICONS = {
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.3c3 .3 5 2.4 5 5.7"/>',
  star: '<polygon points="12,2.8 14.8,8.9 21.4,9.5 16.4,13.9 17.9,20.4 12,17 6.1,20.4 7.6,13.9 2.6,9.5 9.2,8.9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  age: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  book: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H19v14H6a2 2 0 0 0-2 2z"/><path d="M4 20a2 2 0 0 1 2-2h13"/>',
  note: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  close: '<path d="M5 5l14 14M19 5L5 19"/>',
};

// ---------- tiny DOM helpers ----------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

function svg(tag, attrs, inner) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  if (inner) el.innerHTML = inner; // only constant or numeric markup is passed here, never catalog text
  return el;
}

function icon(name, size = 20, stroke = 2) {
  return svg('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, ICONS[name]);
}

const $ = (sel) => document.querySelector(sel);
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------- state ----------

const state = { dur: 0, ply: 0, eff: 0, cat: 0, q: '' };
const knobs = {};
let games = [];
let glossary = { mechanics: {}, categories: {} };
const byId = new Map();

const els = {
  app: $('#app'), head: $('#mHead'), panel: $('#panel'), wall: $('#wall'), grid: $('#grid'), empty: $('#empty'),
  knobs: $('#knobs'), search: $('#search'), summary: $('#summary'), overlay: $('#overlay'),
  counts: document.querySelectorAll('[data-count]'),
};

const effBand = (c) => (c < 1.5 ? 1 : c < 2 ? 2 : c < 2.5 ? 3 : 4);

function matches(g) {
  if (state.dur && g.playingTime.max > SCALES.dur.values[state.dur]) return false;
  if (state.ply) {
    const n = SCALES.ply.values[state.ply];
    if (n === 8 ? g.players.max < 8 : n < g.players.min || n > g.players.max) return false;
  }
  if (state.eff && effBand(g.complexity) !== state.eff) return false;
  if (state.cat && !g.macroCategories.includes(SCALES.cat.values[state.cat])) return false;
  if (state.q && !g._hay.includes(norm(state.q))) return false;
  return true;
}

function summaryText() {
  const parts = [];
  if (state.dur) parts.push(`≤${SCALES.dur.labels[state.dur]}`);
  if (state.ply) parts.push(state.ply === 1 ? '1 PLAYER' : `${SCALES.ply.labels[state.ply]} PLAYERS`);
  if (state.eff) parts.push(SCALES.eff.labels[state.eff].toUpperCase());
  if (state.cat) parts.push(SCALES.cat.labels[state.cat].toUpperCase());
  if (state.q) parts.push(`“${state.q.toUpperCase()}”`);
  return parts.length ? parts.join(' · ') : 'ALL GAMES';
}

function applyFilters() {
  let count = 0;
  for (const g of games) {
    const ok = matches(g);
    g._tile.hidden = !ok;
    if (ok) count++;
  }
  els.counts.forEach((e) => { e.textContent = count; });
  els.summary.textContent = summaryText();
  els.empty.hidden = count > 0 || !games.length;
}

// ---------- knobs ----------

function arcPath(cx, cy, r, a0, a1) {
  const p = (a) => [cx + r * Math.cos(((a - 90) * Math.PI) / 180), cy + r * Math.sin(((a - 90) * Math.PI) / 180)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

function makeKnob(key) {
  const sc = SCALES[key];
  const n = sc.labels.length;
  const A0 = -135;
  const angleOf = (i) => A0 + (270 * i) / (n - 1);

  const arcBg = svg('path', { class: 'arc-bg', d: arcPath(60, 60, 48, A0, 135) });
  const arcOn = svg('path', { class: 'arc-on', d: '' });
  const ticks = [];
  const g = svg('svg', { viewBox: '0 0 120 120', 'aria-hidden': 'true' });
  g.append(arcBg, arcOn);
  for (let i = 0; i < n; i++) {
    const rad = ((angleOf(i) - 90) * Math.PI) / 180;
    const t = svg('line', {
      class: 'tick', x1: (60 + 54 * Math.cos(rad)).toFixed(1), y1: (60 + 54 * Math.sin(rad)).toFixed(1),
      x2: (60 + 58 * Math.cos(rad)).toFixed(1), y2: (60 + 58 * Math.sin(rad)).toFixed(1),
    });
    ticks.push(t);
    g.append(t);
  }

  const ind = h('span', { class: 'dial-ind' });
  const dial = h('div', { class: 'dial', role: 'slider', tabindex: '0', 'aria-labelledby': `k-${key}`, 'aria-valuemin': '0', 'aria-valuemax': String(n - 1) },
    g, h('span', { class: 'dial-body' }, h('span', { class: 'dial-cap' }), ind),
    h('span', { class: 'dial-end l' }, sc.endL), h('span', { class: 'dial-end r' }, sc.endR));
  const val = h('div', { class: 'lcd knob-val' });
  const root = h('div', { class: 'knob' }, h('div', { class: 'knob-title', id: `k-${key}` }, sc.title), dial, val, h('div', { class: 'knob-hint' }, sc.hint));

  function paint() {
    const idx = state[key];
    const a = angleOf(idx);
    ind.style.setProperty('--rot', `${a}deg`);
    arcOn.setAttribute('d', idx > 0 ? arcPath(60, 60, 48, A0, a) : '');
    ticks.forEach((t, i) => t.classList.toggle('on', i <= idx));
    dial.setAttribute('aria-valuenow', String(idx));
    dial.setAttribute('aria-valuetext', sc.labels[idx]);
    val.textContent = sc.labels[idx];
  }

  function set(i) {
    const idx = Math.max(0, Math.min(n - 1, i));
    if (idx === state[key]) return;
    state[key] = idx;
    paint();
    applyFilters();
  }

  // click = next step (wraps), drag = point to the angle, keyboard = arrows / Home / End
  let drag = null;
  const idxFromPointer = (e) => {
    const r = dial.getBoundingClientRect();
    let ang = (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI + 90;
    if (ang > 180) ang -= 360;
    ang = Math.abs(ang) > 135 ? (ang > 0 ? 135 : -135) : ang;
    return Math.round(((ang + 135) / 270) * (n - 1));
  };
  dial.addEventListener('pointerdown', (e) => {
    dial.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, moved: false };
  });
  dial.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) drag.moved = true;
    if (drag.moved) set(idxFromPointer(e));
  });
  dial.addEventListener('pointerup', () => {
    if (drag && !drag.moved) set(state[key] + 1 >= n ? 0 : state[key] + 1);
    drag = null;
  });
  dial.addEventListener('pointercancel', () => { drag = null; });
  dial.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowUp') set(state[key] + 1);
    else if (k === 'ArrowLeft' || k === 'ArrowDown') set(state[key] - 1);
    else if (k === 'Home') set(0);
    else if (k === 'End') set(n - 1);
    else if (k === 'Enter' || k === ' ') set(state[key] + 1 >= n ? 0 : state[key] + 1);
    else return;
    e.preventDefault();
  });

  paint();
  return { root, paint };
}

function resetFilters() {
  Object.assign(state, { dur: 0, ply: 0, eff: 0, cat: 0, q: '' });
  els.search.value = '';
  Object.values(knobs).forEach((k) => k.paint());
  applyFilters();
  els.wall.scrollTop = 0;
}

// ---------- mobile filter sheet ----------

const desktopMq = window.matchMedia('(min-width: 900px)');
let sheetOpener = null;

function openSheet() {
  sheetOpener = document.activeElement;
  els.panel.classList.add('open');
  els.head.inert = true;
  els.wall.inert = true;
  $('#closeFilters').focus();
}

function closeSheet() {
  if (!els.panel.classList.contains('open')) return;
  els.panel.classList.remove('open');
  els.head.inert = false;
  els.wall.inert = false;
  if (sheetOpener && !desktopMq.matches) sheetOpener.focus();
}

// ---------- game card ----------

const wideMq = window.matchMedia('(min-width: 1100px)');
let current = null;
let openedByNav = false;
let lastFocus = null;

const durFrac = (m) => (m <= 15 ? 0.2 : m <= 30 ? 0.4 : m <= 60 ? 0.6 : m <= 90 ? 0.8 : 1);

function triangleSvg(fr, label) {
  const cx = 165;
  const R = 179;
  const cy = 14 + R;
  const angs = [-90, 30, 150]; // effort (top), score (bottom right), duration (bottom left)
  const pt = (i, f) => [cx + R * f * Math.cos((angs[i] * Math.PI) / 180), cy + R * f * Math.sin((angs[i] * Math.PI) / 180)];
  const poly = (f, dx = 0, dy = 0) => [0, 1, 2].map((i) => { const [x, y] = pt(i, typeof f === 'number' ? f : f[i]); return `${(x + dx).toFixed(1)},${(y + dy).toFixed(1)}`; }).join(' ');
  let inner = '<defs><pattern id="ht" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="3.5" cy="3.5" r="1.8" fill="#A94814"/></pattern></defs>';
  for (let k = 1; k <= 4; k++) inner += `<polygon points="${poly(k / 5)}" fill="none" stroke="#8F7B58" stroke-width="2" stroke-dasharray="5 5"/>`;
  inner += `<polygon points="${poly(1)}" fill="none" stroke="#3A2A1E" stroke-width="3.5" stroke-linejoin="round"/>`;
  for (let i = 0; i < 3; i++) inner += `<line x1="${cx}" y1="${cy}" x2="${pt(i, 1)[0].toFixed(1)}" y2="${pt(i, 1)[1].toFixed(1)}" stroke="#3A2A1E" stroke-width="2"/>`;
  inner += `<polygon points="${poly(fr, 6, 7)}" fill="#3A2A1E" stroke="#3A2A1E" stroke-width="4" stroke-linejoin="round"/>`;
  inner += `<polygon points="${poly(fr)}" fill="#E8861C" stroke="#3A2A1E" stroke-width="4.5" stroke-linejoin="round"/>`;
  inner += `<polygon points="${poly(fr)}" fill="url(#ht)" stroke="none"/>`;
  for (let i = 0; i < 3; i++) inner += `<circle cx="${pt(i, fr[i])[0].toFixed(1)}" cy="${pt(i, fr[i])[1].toFixed(1)}" r="8" fill="#F4E7C9" stroke="#3A2A1E" stroke-width="3.5"/>`;
  return svg('svg', { viewBox: '0 0 330 296', role: 'img', 'aria-label': label }, inner);
}

function stat(label, value, ref, est, top) {
  return h('div', { class: top ? 'stat top' : 'stat' }, h('span', { class: 'stat-l' }, label),
    h('div', { class: 'lcd stat-v' }, h('span', null, (est ? '≈' : '') + value), ref ? h('span', { class: 'ref' }, ref) : null));
}

function chartEl(g) {
  const est = (k) => g.estimated.includes(k);
  const dur = `${g.playingTime.text}′`;
  const label = `Game stats: effort ${g.complexity.toFixed(2)} of 5, score ${g.score.toFixed(2)} of 10, duration ${g.playingTime.text} minutes`;
  const fr = [g.complexity / 5, g.score / 10, durFrac(g.playingTime.max)];
  return h('div', { class: 'chart' },
    h('span', { class: 'chart-ribbon' }, 'GAME STATS'),
    h('div', { class: 'chart-tri' }, stat('EFFORT', g.complexity.toFixed(2), '/5', est('complexity'), true), triangleSvg(fr, label)),
    h('div', { class: 'chart-base' }, stat('DURATION', dur, null, est('playingTime')), stat('SCORE', g.score.toFixed(2), '/10', est('score'))));
}

function dataGrid(g) {
  const est = (k) => g.estimated.includes(k);
  const cell = (ic, label, value, key) => h('div', { class: 'cell' }, h('span', { class: 'cell-ic' }, icon(ic)),
    h('div', null, h('div', { class: 'cell-l' }, label),
      h('div', { class: 'cell-v' }, est(key) ? h('span', { class: 'est', title: 'Estimated value' }, '≈') : null, value)));
  return h('div', { class: 'data' },
    cell('users', 'PLAYERS', g.players.text, 'players'), cell('star', 'BEST PLAYERS', g.bestPlayers, 'bestPlayers'),
    cell('clock', 'DURATION', `${g.playingTime.text}′`, 'playingTime'), cell('age', 'AGE', g.age.text, 'age'));
}

function linkCol(kind, g) {
  if (kind === 'rulebook') {
    const rb = g.rulebook;
    if (!rb.url) return null;
    const cap = [rb.kind, rb.source].filter(Boolean).join(' · ');
    return h('div', { class: 'link-col' },
      h('a', { class: 'keycap wide', href: rb.url, target: '_blank', rel: 'noopener noreferrer' }, icon('book'), 'Rulebook', rb.language ? h('span', { class: 'tag' }, rb.language) : null),
      cap ? h('div', { class: 'link-cap' }, cap) : null);
  }
  return h('div', { class: 'link-col' },
    h('a', { class: 'keycap wide', href: g.music.url, target: '_blank', rel: 'noopener noreferrer' }, icon('note'), 'Music Board'),
    g.music.status ? h('div', { class: 'link-cap' }, g.music.status) : null);
}

function creditsEl(g) {
  const parts = [];
  if (g.designer) parts.push(`Designer: ${g.designer}`);
  if (g.artist) parts.push(`Artist: ${g.artist}`);
  if (g.publisher) parts.push(`Publisher: ${g.publisher}`);
  const box = h('div', { class: 'credits' }, parts.join(' · '));
  if (g.bgg.url) box.append(parts.length ? ' · ' : '', h('a', { href: g.bgg.url, target: '_blank', rel: 'noopener noreferrer' }, 'Source: BoardGameGeek'));
  return box;
}

function placeTip(pill) {
  const tip = pill.querySelector('.tip');
  tip.style.setProperty('--tx', '0px');
  const r = tip.getBoundingClientRect();
  if (!r.width) return;
  let tx = 0;
  if (r.right > innerWidth - 8) tx = -(r.right - (innerWidth - 8));
  if (r.left + tx < 8) tx = 8 - r.left;
  tip.style.setProperty('--tx', `${tx}px`);
}

function pillGroup(title, kind, terms, defs) {
  if (!terms.length) return null;
  const list = h('div', { class: 'pill-list' }, terms.map((t) => {
    const id = `tip-${kind}-${t.replace(/\W+/g, '-')}`;
    const pill = h('span', { class: 'pill' },
      h('button', { type: 'button', class: `pill-btn ${kind}`, 'aria-describedby': id }, t),
      h('span', { class: 'tip', role: 'tooltip', id }, defs[t] || ''));
    pill.addEventListener('mouseenter', () => placeTip(pill));
    pill.addEventListener('focusin', () => placeTip(pill));
    pill.querySelector('button').addEventListener('click', () => {
      if (!window.matchMedia('(hover: none)').matches) return; // hover devices show the tip on hover/focus
      const was = pill.classList.contains('open');
      els.overlay.querySelectorAll('.pill.open').forEach((p) => p.classList.remove('open'));
      if (!was) { pill.classList.add('open'); placeTip(pill); }
    });
    return pill;
  }));
  return h('div', null, h('div', { class: 'group-head' }, h('span', { class: 'label' }, title), h('span', { class: 'lcd' }, terms.length), h('span', { class: 'rule' })), list);
}

function pillsEl(g) {
  return h('div', { class: 'pills' }, pillGroup('CATEGORY', 'cat', g.categories, glossary.categories), pillGroup('MECHANICS', 'mech', g.mechanics, glossary.mechanics));
}

function coverEl(g) {
  return h('div', { class: 'cover' }, h('img', { src: g.cover, alt: `Cover of ${g.title}`, decoding: 'async' }));
}

function titleRow(g) {
  return h('div', { class: 'title-row' }, h('h2', { id: 'cardTitle' }, g.title), g.year ? h('span', { class: 'year' }, String(g.year)) : null);
}

function closeBtn(extra) {
  return h('button', { type: 'button', class: `keycap icon-btn ${extra || ''}`, 'aria-label': 'Close', onclick: closeGame }, icon('close', 22, 2.5));
}

function buildWide(g) {
  const left = h('div', { class: 'col-left' }, coverEl(g), linkCol('rulebook', g), linkCol('music', g));
  const mid = h('div', { class: 'col-mid' }, titleRow(g), h('p', { class: 'desc' }, g.description), dataGrid(g), creditsEl(g));
  const right = h('div', { class: 'col-chart' }, chartEl(g));
  return h('section', { class: 'card card--wide' }, closeBtn('card-close-abs'),
    h('div', { class: 'card-top' }, left, mid, right), h('div', { class: 'card-pills' }, pillsEl(g)));
}

function buildNarrow(g) {
  return h('section', { class: 'card card--narrow' },
    h('div', { class: 'card-head' }, h('span', { class: 'label' }, 'GAME CARD'), closeBtn()),
    coverEl(g), titleRow(g), h('p', { class: 'desc' }, g.description), dataGrid(g),
    h('div', { class: 'links' }, linkCol('rulebook', g), linkCol('music', g)),
    chartEl(g), h('div', { class: 'card-pills' }, pillsEl(g)), creditsEl(g));
}

function renderCard() {
  const g = current;
  els.overlay.replaceChildren(wideMq.matches ? buildWide(g) : buildNarrow(g));
  els.overlay.scrollTop = 0;
  const inner = els.overlay.firstElementChild;
  inner.setAttribute('role', 'dialog');
  inner.setAttribute('aria-modal', 'true');
  inner.setAttribute('aria-labelledby', 'cardTitle');
  els.overlay.querySelector('button').focus({ preventScroll: true });
}

function showCard(g) {
  if (!current) lastFocus = document.activeElement;
  current = g;
  els.overlay.hidden = false;
  els.app.inert = true;
  document.title = `${g.title} · Board Game Wall`;
  renderCard();
}

function hideCard() {
  if (!current) return;
  current = null;
  openedByNav = false;
  els.overlay.hidden = true;
  els.overlay.replaceChildren();
  els.app.inert = false;
  document.title = 'Board Game Wall';
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
}

function openGame(id) {
  openedByNav = true;
  location.hash = `#game-${id}`;
}

function closeGame() {
  if (openedByNav) history.back();
  else {
    history.replaceState(null, '', location.pathname + location.search);
    hideCard();
  }
}

function route() {
  const m = location.hash.match(/^#game-(\d+)$/);
  const g = m && byId.get(Number(m[1]));
  if (g) showCard(g);
  else hideCard();
}

// ---------- init ----------

function makeTile(g) {
  const label = g.type === 'expansion' ? `${g.title}, expansion` : g.title;
  const tile = h('button', { type: 'button', class: 'tile', 'aria-label': label, onclick: () => openGame(g.id) },
    h('img', { src: g.thumb, alt: '', loading: 'lazy', decoding: 'async' }),
    g.type === 'expansion' ? h('span', { class: 'badge' }, 'EXPANSION') : null);
  return tile;
}

async function init() {
  for (const key of ['dur', 'ply', 'eff', 'cat']) {
    knobs[key] = makeKnob(key);
    els.knobs.append(knobs[key].root);
  }
  $('#openFilters').addEventListener('click', openSheet);
  $('#closeFilters').addEventListener('click', closeSheet);
  $('#showGames').addEventListener('click', closeSheet);
  $('#panic').addEventListener('click', resetFilters);
  els.search.addEventListener('input', () => { state.q = els.search.value.trim(); applyFilters(); });
  desktopMq.addEventListener('change', () => { if (desktopMq.matches) closeSheet(); });
  wideMq.addEventListener('change', () => { if (current) renderCard(); });
  els.overlay.addEventListener('click', (e) => {
    if (e.target === els.overlay) closeGame();
    else if (!e.target.closest('.pill')) els.overlay.querySelectorAll('.pill.open').forEach((p) => p.classList.remove('open'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const open = current && els.overlay.querySelectorAll('.pill.open');
      if (open && open.length) open.forEach((p) => p.classList.remove('open'));
      else if (current) closeGame();
      else closeSheet();
    } else if (e.key === 'Tab' && current) {
      const f = [...els.overlay.querySelectorAll('a[href], button')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { f[f.length - 1].focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { f[0].focus(); e.preventDefault(); }
    }
  });
  window.addEventListener('hashchange', route);

  try {
    const res = await fetch('/catalog.json');
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    games = data.games;
    glossary = data.glossary;
  } catch {
    els.empty.hidden = false;
    els.empty.replaceChildren('Could not load the catalog.', h('br'), h('span', null, 'Please reload the page.'));
    return;
  }
  for (const g of games) {
    byId.set(g.id, g);
    g._hay = norm([g.title, g.bgg.name, g.designer, g.publisher, g.description, ...g.mechanics, ...g.categories].filter(Boolean).join(' '));
    g._tile = makeTile(g);
  }
  els.grid.replaceChildren(...games.map((g) => g._tile));
  applyFilters();
  route();
}

init();
