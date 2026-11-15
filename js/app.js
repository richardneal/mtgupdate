import {
  TYPES, FILTER_GROUPS, REGIONS, EMPTY_FILTERS,
  regionOf, countryName, flag, todayISO, status, dateRange, weekdayRange,
  monthKey, monthLabel, countdown, resolveLink, formatLabel, filterEvents,
  sortEvents, filtersFromParams, filtersToParams, toICS, matchesLoc,
} from './core.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
};
const icon = (paths) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths;
  return svg;
};
const ICONS = {
  info: '<path d="M7 17 17 7M9 7h8v8"/>',
  play: '<path d="M7 5v14l11-7Z"/>',
  cal: '<path d="M7 2v3M17 2v3M3.5 9h17M5 4.5h14A1.5 1.5 0 0 1 20.5 6v13A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5ZM12 12v5M9.5 14.5h5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
};
// Links an event may carry, in the order they are shown.
const LINKS = [
  ['stream', 'Watch', 'play'],
  ['coverage', 'Coverage', 'info'],
  ['results', 'Results', 'list'],
  ['decklists', 'Decklists', 'list'],
  ['info', 'Info', 'info'],
];

let data;
let filters = { ...EMPTY_FILTERS };
const today = todayISO();

// ---- Theme ---------------------------------------------------------------

function initTheme() {
  const media = matchMedia('(prefers-color-scheme: dark)');
  $('#theme').addEventListener('click', () => {
    const current = document.documentElement.dataset.theme || (media.matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      if ((next === 'dark') === media.matches) localStorage.removeItem('theme');
      else localStorage.setItem('theme', next);
    } catch { /* storage unavailable: the choice lasts for this page only */ }
  });
}

// ---- Filters -------------------------------------------------------------

function buildTypeChips() {
  const box = $('#types');
  const all = el('button', { class: 'chip all', type: 'button', 'data-type': '' }, 'All events');
  box.append(all);
  for (const [g, group] of Object.entries(FILTER_GROUPS)) {
    if (!data.events.some((e) => group.types.includes(e.type))) continue;
    box.append(el('button', { class: `chip t-${group.color}`, type: 'button', 'data-type': g },
      el('span', { class: 'swatch', 'aria-hidden': 'true' }), group.label));
  }
  box.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    const t = chip.dataset.type;
    if (!t) filters.types = [];
    else if (filters.types.includes(t)) filters.types = filters.types.filter((x) => x !== t);
    else filters.types = [...filters.types, t];
    update();
  });
}

function buildLocations() {
  const select = $('#loc');
  // Count against everything but the location itself, so the menu shows what each choice would give.
  const pool = filterEvents(data.events, { ...filters, loc: '' }, { today });
  const keep = select.value;
  select.replaceChildren(el('option', { value: '' }, `Anywhere (${pool.length})`));

  const byRegion = new Map();
  for (const e of data.events) {
    const r = regionOf(e.country);
    if (!byRegion.has(r)) byRegion.set(r, new Set());
    byRegion.get(r).add(e.country);
  }
  for (const r of Object.keys(REGIONS)) {
    if (!byRegion.has(r)) continue;
    const n = pool.filter((e) => matchesLoc(e, r)).length;
    select.append(el('option', { value: r }, `${REGIONS[r]} (${n})`));
    const countries = [...byRegion.get(r)].sort((a, b) => countryName(a).localeCompare(countryName(b)));
    for (const c of countries) {
      const nc = pool.filter((e) => e.country === c).length;
      select.append(el('option', { value: c }, `   ${flag(c)} ${countryName(c)} (${nc})`));
    }
  }
  select.value = keep;
}

function syncControls() {
  for (const chip of document.querySelectorAll('#types .chip')) {
    const t = chip.dataset.type;
    chip.setAttribute('aria-pressed', String(t ? filters.types.includes(t) : !filters.types.length));
  }
  buildLocations();
  const loc = $('#loc');
  loc.value = filters.loc;
  if (loc.value !== filters.loc) { filters.loc = ''; loc.value = ''; }
  loc.classList.toggle('set', !!filters.loc);
  if ($('#q').value !== filters.q) $('#q').value = filters.q;
  $('#past').checked = filters.past;
  $('#reset').hidden = !(filters.types.length || filters.loc || filters.q.trim());
}

function writeURL() {
  const p = filtersToParams(filters).toString();
  const url = `${location.pathname}${p ? `?${p}` : ''}${location.hash}`;
  history.replaceState(null, '', url);
}

// ---- Rendering -----------------------------------------------------------

function eventLinks(e, s) {
  const out = [];
  for (const [key, label, ic] of LINKS) {
    const url = resolveLink(data, e.links?.[key]);
    if (!url) continue;
    if (key === 'stream' && s === 'past') continue;
    out.push(el('a', {
      class: `act${key === 'stream' && s === 'live' ? ' live' : ''}`,
      href: url, target: '_blank', rel: 'noopener',
    }, icon(ICONS[ic]), label));
  }
  if (s !== 'past') {
    out.push(el('button', {
      class: 'act', type: 'button', title: 'Add to your calendar (.ics)',
      onclick: () => downloadICS([e], `${e.id}.ics`),
    }, icon(ICONS.cal), 'Calendar'));
  }
  return out;
}

function renderEvent(e) {
  const s = status(e, today);
  const meta = [
    e.organizer,
    e.venue,
    e.prize,
    e.feeds && `Qualifies for ${e.feeds}`,
    e.notes && !e.venue && !e.prize ? e.notes : null,
  ].filter(Boolean);

  return el('li', {
    class: `event t-${e.type} is-${s}`, id: e.id,
  },
  el('div', { class: 'when' },
    el('span', { class: 'date' }, dateRange(e.start, e.end)),
    el('span', { class: 'dow' }, weekdayRange(e.start, e.end))),
  el('div', { class: 'what' },
    el('div', { class: 'kicker' },
      el('span', { class: 'badge' }, TYPES[e.type].short),
      el('span', { class: 'fmt' }, formatLabel(e))),
    el('h3', {}, el('a', { href: `#${e.id}` }, e.name)),
    meta.length ? el('p', { class: 'meta' }, meta.map((m) => el('span', {}, m))) : null),
  el('div', { class: 'where' },
    el('span', { class: 'flag', 'aria-hidden': 'true' }, flag(e.country)),
    el('span', { class: 'place' },
      el('span', { class: 'city' }, e.city),
      el('span', { class: 'country' }, countryName(e.country)))),
  el('div', { class: 'side' },
    el('span', { class: 'countdown' },
      s === 'live' ? el('span', { class: 'live-dot', 'aria-hidden': 'true' }) : null,
      countdown(e, today)),
    el('div', { class: 'actions' }, eventLinks(e, s))));
}

function render() {
  const list = $('#list');
  const shown = sortEvents(filterEvents(data.events, filters, { today }));
  const upcoming = shown.filter((e) => status(e, today) !== 'past').length;

  const count = $('#count');
  count.replaceChildren(
    el('strong', {}, String(shown.length)),
    shown.length === 1 ? ' event' : ' events',
    filters.past && upcoming !== shown.length ? ` (${upcoming} still to come)` : '',
  );

  if (!shown.length) {
    list.replaceChildren(el('div', { class: 'empty' },
      el('p', {}, 'No events match these filters.'),
      el('button', { class: 'btn', type: 'button', onclick: reset }, 'Clear filters')));
    return;
  }

  const months = new Map();
  for (const e of shown) {
    const k = monthKey(e.start);
    if (!months.has(k)) months.set(k, []);
    months.get(k).push(e);
  }
  list.replaceChildren(...[...months].map(([k, events]) =>
    el('section', { class: 'month', 'aria-label': monthLabel(k) },
      el('h2', {}, monthLabel(k), el('span', { class: 'n' }, String(events.length))),
      el('ol', {}, events.map(renderEvent)))));
}

function update({ url = true } = {}) {
  syncControls();
  render();
  if (url) writeURL();
}

function reset() {
  filters = { ...EMPTY_FILTERS, past: filters.past };
  update();
}

// ---- Calendar ------------------------------------------------------------

function downloadICS(events, filename) {
  const blob = new Blob([toICS(data, events)], { type: 'text/calendar' });
  const a = el('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- Links to one event --------------------------------------------------

function showTarget() {
  const id = decodeURIComponent(location.hash.slice(1));
  const e = id && data.events.find((x) => x.id === id);
  if (!e) return;
  let changed = false;
  if (status(e, today) === 'past' && !filters.past) { filters.past = true; changed = true; }
  if (!filterEvents([e], filters, { today }).length) { filters = { ...EMPTY_FILTERS, past: filters.past }; changed = true; }
  if (changed) update();
  const node = document.getElementById(id);
  if (!node) return;
  node.scrollIntoView({ block: 'center' });
  node.classList.remove('is-target');
  void node.offsetWidth;
  node.classList.add('is-target');
}

// ---- Start ---------------------------------------------------------------

async function main() {
  initTheme();
  try {
    const res = await fetch('data/events.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch {
    $('#list').replaceChildren(el('p', { class: 'empty' }, 'Couldn’t load the schedule. Try reloading the page.'));
    return;
  }

  $('#updated').textContent = data.updated;
  $('#updated').setAttribute('datetime', data.updated);

  filters = filtersFromParams(new URLSearchParams(location.search));
  buildTypeChips();

  $('#loc').addEventListener('change', (ev) => { filters.loc = ev.target.value; update(); });
  $('#past').addEventListener('change', (ev) => { filters.past = ev.target.checked; update(); });
  $('#reset').addEventListener('click', reset);
  let t;
  $('#q').addEventListener('input', (ev) => {
    filters.q = ev.target.value;
    clearTimeout(t);
    t = setTimeout(() => update(), 120);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === '/' && !ev.metaKey && !ev.ctrlKey && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) {
      ev.preventDefault();
      $('#q').focus();
    }
  });

  // Keep month headings stuck just under the filter bar.
  const bar = $('.filters');
  new ResizeObserver(() => {
    const sticky = getComputedStyle(bar).position === 'sticky';
    document.documentElement.style.setProperty('--filters-h', sticky ? `${bar.offsetHeight}px` : '0px');
  }).observe(bar);

  update({ url: false });
  showTarget();
  addEventListener('hashchange', showTarget);
}

main();
