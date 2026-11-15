import {
  TYPES, FILTER_GROUPS, REGIONS, FORMATS, feedsTarget, EMPTY_FILTERS, venuePlace, mapsUrl,
  regionOf, countryName, flag, todayISO, status, dateRange, weekdayRange,
  monthKey, monthLabel, countdown, resolveLink, formatLabel, filterEvents,
  sortEvents, filtersFromParams, filtersToParams, toICS, matchesLoc, weekendOf,
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
  ['stream', 'Stream'],
  ['coverage', 'Coverage'],
  ['results', 'Results'],
  ['decklists', 'Decklists'],
  ['melee', 'Melee'],
  ['event', 'Event page'],
  ['info', 'Info'],
];

let data;
let filters = { ...EMPTY_FILTERS };
// 'list' (every detail) or 'compact' (a line per event, grouped by weekend). Kept in the URL
// and remembered for the next visit.
let view = 'list';
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

// ---- Format and Location menus -------------------------------------------
// Each is a button that opens a list of checkboxes. Several choices in one menu match any of
// them; nothing checked means all. Counts follow the other filters, so each choice shows what
// it would add.

const MENUS = {
  formats: { el: () => $('#format-menu'), test: (e, v) => e.formats.includes(v) },
  locs: { el: () => $('#loc-menu'), test: (e, v) => matchesLoc(e, [v]) },
};

function buildMenus() {
  const formats = Object.keys(FORMATS).filter((f) => data.events.some((e) => e.formats.includes(f)));
  fillMenu('formats', formats.map((f) => ({ value: f, label: FORMATS[f] })));

  const byRegion = new Map();
  for (const e of data.events) {
    const r = regionOf(e.country);
    if (!byRegion.has(r)) byRegion.set(r, new Set());
    byRegion.get(r).add(e.country);
  }
  const places = [];
  for (const r of Object.keys(REGIONS)) {
    if (!byRegion.has(r)) continue;
    places.push({ value: r, label: REGIONS[r], kind: 'region' });
    const countries = [...byRegion.get(r)].sort((a, b) => countryName(a).localeCompare(countryName(b)));
    for (const c of countries) places.push({ value: c, label: countryName(c), flag: flag(c), kind: 'country', region: r });
  }
  fillMenu('locs', places);

  for (const [key, menu] of Object.entries(MENUS)) {
    const root = menu.el();
    const button = root.querySelector('.menu-button');
    const panel = root.querySelector('.menu-panel');
    button.addEventListener('click', () => (panel.hidden ? openMenu(root) : closeMenu(root)));
    root.querySelector('.menu-options').addEventListener('change', (ev) => {
      const v = ev.target.value;
      filters[key] = ev.target.checked ? [...filters[key], v] : filters[key].filter((x) => x !== v);
      // Checking a region covers its countries, so drop any of them picked on their own.
      if (key === 'locs' && REGIONS[v] && ev.target.checked) {
        filters.locs = filters.locs.filter((x) => REGIONS[x] || regionOf(x) !== v);
      }
      update();
    });
    root.querySelector('.menu-clear').addEventListener('click', () => { filters[key] = []; update(); });
    root.querySelector('.menu-done').addEventListener('click', () => { closeMenu(root); button.focus(); });
  }
  document.addEventListener('click', (ev) => {
    for (const m of Object.values(MENUS)) if (!m.el().contains(ev.target)) closeMenu(m.el());
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    for (const m of Object.values(MENUS)) {
      const root = m.el();
      if (!root.querySelector('.menu-panel').hidden) { closeMenu(root); root.querySelector('.menu-button').focus(); }
    }
  });
}

function fillMenu(key, options) {
  const box = MENUS[key].el().querySelector('.menu-options');
  box.replaceChildren(...options.map((o) => el('label', { class: `opt${o.kind ? ` ${o.kind}` : ''}`, 'data-region': o.region },
    el('input', { type: 'checkbox', value: o.value }),
    o.flag ? el('span', { class: 'opt-flag', 'aria-hidden': 'true' }, o.flag) : null,
    el('span', { class: 'opt-label' }, o.label),
    el('span', { class: 'n' }))));
}

function openMenu(root) {
  for (const m of Object.values(MENUS)) if (m.el() !== root) closeMenu(m.el());
  root.querySelector('.menu-panel').hidden = false;
  root.querySelector('.menu-button').setAttribute('aria-expanded', 'true');
  root.querySelector('.menu-options input')?.focus();
}

function closeMenu(root) {
  root.querySelector('.menu-panel').hidden = true;
  root.querySelector('.menu-button').setAttribute('aria-expanded', 'false');
}

function syncMenu(key) {
  const root = MENUS[key].el();
  const chosen = filters[key];
  const pool = filterEvents(data.events, { ...filters, [key]: [] }, { today });
  const labels = [];
  for (const opt of root.querySelectorAll('.opt')) {
    const input = opt.querySelector('input');
    const v = input.value;
    const coveredByRegion = key === 'locs' && opt.dataset.region && chosen.includes(opt.dataset.region);
    input.checked = chosen.includes(v) || coveredByRegion;
    input.disabled = coveredByRegion;
    const n = pool.filter((e) => MENUS[key].test(e, v)).length;
    opt.querySelector('.n').textContent = String(n);
    opt.classList.toggle('zero', n === 0);
    if (chosen.includes(v)) labels.push(opt.querySelector('.opt-label').textContent);
  }
  const label = !labels.length ? root.dataset.all
    : labels.length <= 2 ? labels.join(' + ')
    : `${labels.length} ${root.dataset.noun}`;
  const scoped = key === 'locs' && filters.rcOnly && labels.length;
  root.querySelector('.menu-label').textContent = scoped ? `${label} (RCs only)` : label;
  if (key === 'locs') $('#rconly').checked = filters.rcOnly;
  root.querySelector('.menu-button').classList.toggle('set', labels.length > 0);
  root.querySelector('.menu-clear').disabled = !labels.length;
}

function syncControls() {
  for (const chip of document.querySelectorAll('#types .chip')) {
    const t = chip.dataset.type;
    chip.setAttribute('aria-pressed', String(t ? filters.types.includes(t) : !filters.types.length));
  }
  syncMenu('formats');
  syncMenu('locs');
  if ($('#q').value !== filters.q) $('#q').value = filters.q;
  $('#past').checked = filters.past;
  for (const b of document.querySelectorAll('.view-toggle button')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  $('#reset').hidden = !(filters.types.length || filters.formats.length || filters.locs.length || filters.q.trim());
}

function writeURL() {
  const params = filtersToParams(filters);
  if (view === 'compact') params.set('view', 'compact');
  const p = params.toString();
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
    // A Twitch stream during the event shows as "Watch live" once checkLiveStreams() confirms
    // the channel is broadcasting; until then, and between broadcasts, it is a plain link.
    const twitch = key === 'stream' && s === 'live' && twitchChannel(url);
    out.push(el('a', {
      class: 'act', href: url, target: '_blank', rel: 'noopener', 'data-twitch': twitch || null,
    }, label));
  }
  if (s === 'upcoming') {
    out.push(el('button', {
      class: 'act', type: 'button', title: 'Download this event as an .ics file',
      onclick: () => downloadICS([e], `${e.id}.ics`),
    }, 'Add to calendar'));
  }
  return out;
}

// ---- Is the stream up? ------------------------------------------------------

const liveChannels = new Map(); // channel -> true/false, from /api/live

function twitchChannel(url) {
  const m = /^https:\/\/(?:www\.)?twitch\.tv\/([a-z0-9_]{3,25})\/?$/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}

function showLiveStreams() {
  for (const a of document.querySelectorAll('a[data-twitch]')) {
    const up = liveChannels.get(a.dataset.twitch) === true;
    a.classList.toggle('live', up);
    a.textContent = up ? 'Watch live' : 'Stream';
    // "Day 2 of 3" becomes "Live now, day 2 of 3" only while the broadcast is on.
    const row = a.closest('.event');
    const status = row?.querySelector('.countdown');
    if (!status) continue;
    row.classList.toggle('on-air', up);
    const text = status.dataset.text;
    status.replaceChildren(...(up
      ? [el('span', { class: 'live-dot', 'aria-hidden': 'true' }), `Live now, ${text.charAt(0).toLowerCase()}${text.slice(1)}`]
      : [text]));
  }
}

async function checkLiveStreams() {
  const channels = [...new Set([...document.querySelectorAll('a[data-twitch]')].map((a) => a.dataset.twitch))];
  await Promise.all(channels.map(async (c) => {
    try {
      const res = await fetch(`/api/live?channel=${encodeURIComponent(c)}`);
      if (res.ok) liveChannels.set(c, (await res.json()).live === true);
    } catch { /* offline or no API (local preview): leave it a plain link */ }
  }));
  showLiveStreams();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The big numbers in the date column: "9–10" within a month, "30 – 1" across two.
function dayBlock(e) {
  const [, m1, d1] = e.start.split('-').map(Number);
  const [, m2, d2] = e.end.split('-').map(Number);
  const days = e.start === e.end ? `${d1}` : `${d1}–${d2}`;
  return el('time', { class: 'when', datetime: e.start, 'aria-label': `${dateRange(e.start, e.end)}, ${weekdayRange(e.start, e.end)}` },
    el('span', { class: 'days' }, days),
    el('span', { class: 'dow' }, m1 !== m2
      ? `${MONTHS[m1 - 1]} ${d1} – ${MONTHS[m2 - 1]} ${d2}, ${weekdayRange(e.start, e.end)}`
      : weekdayRange(e.start, e.end)));
}

function renderEvent(e, { row = true } = {}) {
  const s = status(e, today);
  const meta = [
    e.organizer && (data.organizers?.[e.organizer]
      ? ['Hosted by ', el('a', { class: 'org', href: data.organizers[e.organizer], target: '_blank', rel: 'noopener' }, e.organizer)]
      : `Hosted by ${e.organizer}`),
    e.venue && (() => {
      const place = venuePlace(e);
      if (!place) return e.venue;
      const lead = e.venue.slice(0, e.venue.length - place.length);
      return [lead, el('a', { class: 'map', href: mapsUrl(e), target: '_blank', rel: 'noopener', title: 'Open in Google Maps' }, place)];
    })(),
    e.feeds && (() => {
      const t = feedsTarget(data, e);
      return t.id ? ['Qualifies for ', el('a', { class: 'feeds', href: `#${t.id}` }, t.label)] : `Qualifies for ${t.label}`;
    })(),
    e.notes && !e.venue ? e.notes : null,
  ].filter(Boolean);

  return el('li', { class: `event t-${e.type} is-${s}`, id: row ? e.id : null, 'data-row': row || null },
    dayBlock(e),
    el('div', { class: 'what' },
      el('p', { class: 'fmt' }, formatLabel(e)),
      el('h3', {}, el('a', { href: `#${e.id}` }, e.name)),
      meta.length ? el('p', { class: 'meta' }, meta.map((m) => el('span', {}, m))) : null,
      el('p', { class: 'actions' }, eventLinks(e, s))),
    el('p', { class: 'where' },
      el('span', { class: 'city' },
        // With a venue named, its link is in the details; otherwise the city opens the map.
        venuePlace(e) ? e.city : el('a', { class: 'map', href: mapsUrl(e), target: '_blank', rel: 'noopener', title: 'Open in Google Maps' }, e.city)),
      el('span', { class: 'country' }, el('span', { class: 'flag', 'aria-hidden': 'true' }, flag(e.country)), countryName(e.country))),
    el('div', { class: 'side' },
      el('p', { class: 'countdown', 'data-text': countdown(e, today) }, countdown(e, today))));
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLabel = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

// One line per event; clicking it opens the full details underneath.
function renderCompactRow(e) {
  const s = status(e, today);
  const details = el('div', { class: 'crow-details', id: `${e.id}-details`, hidden: true });
  const button = el('button', {
    class: 'crow-main', type: 'button', 'aria-expanded': 'false', 'aria-controls': `${e.id}-details`,
    onclick: () => toggleRow(li),
  },
  el('span', { class: 'c-days' }, weekdayRange(e.start, e.end)),
  el('span', { class: 'c-name' }, e.name),
  el('span', { class: 'c-fmt' }, formatLabel(e)),
  el('span', { class: 'c-place' }, `${e.city}, `, el('span', { class: 'flag', 'aria-hidden': 'true' }, flag(e.country)), countryName(e.country)),
  el('span', { class: 'c-status countdown', 'data-text': countdown(e, today) }, countdown(e, today)));
  const li = el('li', { class: `crow t-${e.type} is-${s}`, id: e.id, 'data-row': true }, button, details);
  return li;
}

function toggleRow(li, open) {
  const button = li.querySelector('.crow-main');
  const details = li.querySelector('.crow-details');
  const show = open ?? details.hidden;
  if (show && !details.childElementCount) {
    const e = data.events.find((x) => x.id === li.id);
    details.append(el('ul', {}, renderEvent(e, { row: false })));
    showLiveStreams();
  }
  details.hidden = !show;
  button.setAttribute('aria-expanded', String(show));
}

// Months, then the weekends in them (nearly every event runs over one), then the events.
function renderCompact(shown) {
  const weekends = new Map();
  for (const e of shown) {
    const w = weekendOf(e.start) || { start: e.start, end: e.end };
    if (!weekends.has(w.start)) weekends.set(w.start, { ...w, events: [] });
    weekends.get(w.start).events.push(e);
  }
  const months = new Map();
  for (const w of weekends.values()) {
    const k = monthKey(w.start);
    if (!months.has(k)) months.set(k, []);
    months.get(k).push(w);
  }
  return [...months].map(([k, ws]) => {
    const [month, year] = monthLabel(k).split(' ');
    return el('section', { class: 'month compact', 'aria-label': monthLabel(k) },
      el('h2', {}, el('span', { class: 'm' }, month), el('span', { class: 'y' }, year)),
      el('div', { class: 'weekends' }, ws.map((w) => el('section', { class: 'weekend', 'aria-label': `${dayLabel(w.start)} to ${dayLabel(w.end)}` },
        el('h3', { class: 'wk' }, `${dayLabel(w.start)} – ${dayLabel(w.end)}`),
        el('ol', {}, w.events.map(renderCompactRow))))));
  });
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

  if (view === 'compact') {
    list.replaceChildren(...renderCompact(shown));
    showLiveStreams();
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
  showLiveStreams();
}

// With "Show completed" on, completed events sit above the rest: bring the next event (or the
// one happening now) to the top of the view. With only completed events, show the most recent.
function scrollToNow(behavior) {
  const list = $('#list');
  const next = list.querySelector('[data-row]:not(.is-past)');
  const rows = list.querySelectorAll('[data-row]');
  if (!rows.length) return;
  let anchor = next || rows[rows.length - 1];
  // At the start of a weekend or month, show its heading too.
  if (anchor === anchor.parentElement.firstElementChild) {
    const weekend = anchor.closest('.weekend');
    anchor = weekend && weekend !== weekend.parentElement.firstElementChild ? weekend : anchor.closest('.month');
  }
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
  if (node.classList.contains('crow')) toggleRow(node, true);
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

  const params = new URLSearchParams(location.search);
  filters = filtersFromParams(params);
  let saved = null;
  try { saved = localStorage.getItem('view'); } catch { /* storage unavailable */ }
  view = (params.get('view') || saved) === 'compact' ? 'compact' : 'list';
  buildTypeChips();

  buildMenus();
  $('#rconly').addEventListener('change', (ev) => { filters.rcOnly = ev.target.checked; update(); });
  for (const b of document.querySelectorAll('.view-toggle button')) {
    b.addEventListener('click', () => {
      view = b.dataset.view;
      try { localStorage.setItem('view', view); } catch { /* storage unavailable */ }
      update();
    });
  }
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
  // Whatever is pinned at the top (header and filters, or on phones just the filters) sets how far
  // below it scroll targets and month headings sit.
  const masthead = $('.masthead');
  const bar = $('.filters');
  const setBarHeight = () => {
    const pinned = getComputedStyle(masthead).display === 'contents' ? bar : masthead;
    document.documentElement.style.setProperty('--filters-h', `${pinned.offsetHeight}px`);
  };
  setBarHeight();
  const ro = new ResizeObserver(setBarHeight);
  ro.observe(masthead);
  ro.observe(bar);

  update({ url: false, scroll: false });
  const linked = data.events.some((e) => `#${e.id}` === decodeURIComponent(location.hash));
  if (linked) showTarget();
  else scrollToNow('instant');
  addEventListener('hashchange', showTarget);
  checkLiveStreams();
  setInterval(checkLiveStreams, 2 * 60 * 1000);
}

main();
