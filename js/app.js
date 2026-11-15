import {
  TYPES, FILTER_GROUPS, REGIONS, EMPTY_FILTERS,
  regionOf, countryName, flag, todayISO, status, dateRange, weekdayRange,
  monthKey, monthLabel, countdown, resolveLink, formatLabel, filterEvents,
  sortEvents, filtersFromParams, filtersToParams, toICS, matchesLoc, isWeekend,
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
// Links an event may carry, in the order they are shown.
const LINKS = [
  ['stream', 'Watch live'],
  ['coverage', 'Coverage'],
  ['results', 'Results'],
  ['decklists', 'Decklists'],
  ['event', 'Event page'],
  ['info', 'Info'],
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
  for (const [key, label] of LINKS) {
    const url = resolveLink(data, e.links?.[key]);
    if (!url) continue;
    if (key === 'stream' && s === 'past') continue;
    out.push(el('a', {
      class: `act${key === 'stream' && s === 'live' ? ' live' : ''}`,
      href: url, target: '_blank', rel: 'noopener',
    }, label));
  }
  if (s !== 'past') {
    out.push(el('button', {
      class: 'act', type: 'button', title: 'Download this event as an .ics file',
      onclick: () => downloadICS([e], `${e.id}.ics`),
    }, 'Add to calendar'));
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The big numbers in the date column: "9–10" within a month, "30 – 1" across two.
function dayBlock(e) {
  const [, m1, d1] = e.start.split('-').map(Number);
  const [, m2, d2] = e.end.split('-').map(Number);
  const days = e.start === e.end ? `${d1}` : `${d1}–${d2}`;
  return el('time', { class: 'when', datetime: e.start, 'aria-label': `${dateRange(e.start, e.end)}, ${weekdayRange(e.start, e.end)}` },
    el('span', { class: 'days' }, days),
    // Most events run Friday to Sunday, so the weekdays only show when one doesn't.
    m1 !== m2 ? el('span', { class: 'dow' }, `${MONTHS[m1 - 1]} ${d1} – ${MONTHS[m2 - 1]} ${d2}`)
      : isWeekend(e) ? null : el('span', { class: 'dow' }, weekdayRange(e.start, e.end)));
}

function renderEvent(e) {
  const s = status(e, today);
  const meta = [
    e.organizer && `Hosted by ${e.organizer}`,
    e.venue,
    e.prize,
    e.feeds && `Qualifies for ${e.feeds}`,
    e.notes && !e.venue && !e.prize ? e.notes : null,
  ].filter(Boolean);

  return el('li', { class: `event t-${e.type} is-${s}`, id: e.id },
    dayBlock(e),
    el('div', { class: 'what' },
      el('p', { class: 'fmt' }, formatLabel(e)),
      el('h3', {}, el('a', { href: `#${e.id}` }, e.name)),
      meta.length ? el('p', { class: 'meta' }, meta.map((m) => el('span', {}, m))) : null),
    el('p', { class: 'where' },
      el('span', { class: 'city' }, el('span', { class: 'flag', 'aria-hidden': 'true' }, flag(e.country)), e.city),
      el('span', { class: 'country' }, countryName(e.country))),
    el('div', { class: 'side' },
      el('p', { class: 'countdown' },
        s === 'live' ? el('span', { class: 'live-dot', 'aria-hidden': 'true' }) : null,
        countdown(e, today)),
      el('p', { class: 'actions' }, eventLinks(e, s))));
}

function render() {
  const list = $('#list');
  const shown = sortEvents(filterEvents(data.events, filters, { today }));
  const upcoming = shown.filter((e) => status(e, today) !== 'past').length;

  $('#count').replaceChildren(
    el('strong', {}, String(shown.length)),
    shown.length === 1 ? ' event' : ' events',
    !filters.past || upcoming === shown.length ? '' : upcoming ? `, ${upcoming} still to come` : ', all completed',
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
  list.replaceChildren(...[...months].map(([k, events]) => {
    const [month, year] = monthLabel(k).split(' ');
    return el('section', { class: 'month', 'aria-label': monthLabel(k) },
      el('h2', {}, el('span', { class: 'm' }, month), el('span', { class: 'y' }, year)),
      el('ol', {}, events.map(renderEvent)));
  }));
}

// With "Show completed" on, completed events sit above the rest: bring the next event (or the
// one happening now) to the top of the view. With only completed events, show the most recent.
function scrollToNow(behavior) {
  const list = $('#list');
  const next = list.querySelector('.event:not(.is-past)');
  const events = list.querySelectorAll('.event');
  if (!events.length) return;
  let anchor = next || events[events.length - 1];
  // At the start of a month, show the month's name too.
  if (anchor === anchor.parentElement.firstElementChild) anchor = anchor.closest('.month');
  if (anchor === list.firstElementChild) {
    // Nothing above it to skip: just make sure the list's start is in view.
    if (window.scrollY > $('#events').offsetTop) $('#events').scrollIntoView({ behavior });
    return;
  }
  anchor.scrollIntoView({ block: 'start', behavior });
}

function update({ url = true, scroll = true } = {}) {
  syncControls();
  render();
  if (url) writeURL();
  // An instant jump: completed events appear or vanish above the view, which a smooth scroll fights.
  if (scroll) scrollToNow('instant');
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
  // A link to a completed event turns on "Show completed"; clear filters that would hide it.
  if (!filterEvents([e], filters, { today }).length) {
    const past = filters.past || status(e, today) === 'past';
    if (!filterEvents([e], { ...filters, past }, { today }).length) filters = { ...EMPTY_FILTERS };
    filters.past = past;
    update({ scroll: false });
  }
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
  const setBarHeight = () => document.documentElement.style.setProperty('--filters-h', `${bar.offsetHeight}px`);
  setBarHeight();
  new ResizeObserver(setBarHeight).observe(bar);

  update({ url: false, scroll: false });
  const linked = data.events.some((e) => `#${e.id}` === decodeURIComponent(location.hash));
  if (linked) showTarget();
  else scrollToNow('instant');
  addEventListener('hashchange', showTarget);
}

main();
