// Shared logic for mtgupdate: used by the page (js/app.js) and by Node (scripts/, tests/).
// No DOM access in this file.

export const SITE = 'https://mtgupdate.com';

export const TYPES = {
  pt:        { label: 'Pro Tour',             short: 'PT',        rank: 1 },
  worlds:    { label: 'World Championship',   short: 'Worlds',    rank: 0 },
  lc:        { label: 'Limited Championship', short: 'LC',        rank: 2 },
  rc:        { label: 'Regional Championship', short: 'RC',       rank: 3 },
  spotlight: { label: 'Spotlight Series',     short: 'Spotlight', rank: 4 },
};
// The event filter: Pro Tours, Worlds and the Limited Championship share one choice.
export const FILTER_GROUPS = {
  pro:       { label: 'Pro Tours & Worlds', types: ['pt', 'worlds', 'lc'], color: 'pt' },
  rc:        { label: 'Regional Championships',   types: ['rc'],                 color: 'rc' },
  spotlight: { label: 'Spotlight Series',         types: ['spotlight'],          color: 'spotlight' },
};

export function groupOf(type) {
  return Object.keys(FILTER_GROUPS).find((g) => FILTER_GROUPS[g].types.includes(type));
}

export const FORMATS = {
  limited: 'Limited',
  'team-limited': 'Team Limited',
  standard: 'Standard',
  pioneer: 'Pioneer',
  modern: 'Modern',
  legacy: 'Legacy',
  vintage: 'Vintage',
  pauper: 'Pauper',
  // Listed before its format is announced.
  tbd: 'Format TBD',
};

export const REGIONS = {
  na: 'North America',
  sa: 'South America',
  europe: 'Europe',
  asia: 'Asia',
  oceania: 'Oceania',
};

const COUNTRY_REGION = {
  // North America includes Mexico, Central America and the Caribbean.
  US: 'na', CA: 'na', MX: 'na', GT: 'na', CR: 'na', PA: 'na', PR: 'na', DO: 'na',
  BR: 'sa', AR: 'sa', CL: 'sa', CO: 'sa', PE: 'sa', UY: 'sa', EC: 'sa', VE: 'sa',
  FR: 'europe', HR: 'europe', NL: 'europe', ES: 'europe', BE: 'europe', DE: 'europe',
  GB: 'europe', IT: 'europe', PL: 'europe', CZ: 'europe', PT: 'europe', SE: 'europe',
  AT: 'europe', CH: 'europe', IE: 'europe', DK: 'europe', NO: 'europe', FI: 'europe',
  TR: 'europe',
  JP: 'asia', CN: 'asia', TW: 'asia', TH: 'asia', KR: 'asia', SG: 'asia', PH: 'asia',
  MY: 'asia', HK: 'asia', ID: 'asia', VN: 'asia',
  AU: 'oceania', NZ: 'oceania',
};

// Names Magic's organized play uses where they differ from the browser's.
const COUNTRY_NAMES = { TW: 'Chinese Taipei', US: 'USA' };

export function regionOf(country) {
  return COUNTRY_REGION[country] || 'other';
}

let displayNames;
export function countryName(code) {
  if (COUNTRY_NAMES[code]) return COUNTRY_NAMES[code];
  try {
    displayNames ||= new Intl.DisplayNames(['en'], { type: 'region' });
    return displayNames.of(code) || code;
  } catch {
    return code;
  }
}

export function flag(code) {
  if (!/^[A-Z]{2}$/.test(code || '')) return '';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

// ---- Dates -------------------------------------------------------------
// Event dates are plain calendar dates (YYYY-MM-DD) in the venue's own time zone.

export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function utcDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function daysBetween(fromISO, toISO) {
  return Math.round((utcDay(toISO) - utcDay(fromISO)) / 86400000);
}

export function addDays(iso, n) {
  const d = new Date(utcDay(iso) + n * 86400000);
  return d.toISOString().slice(0, 10);
}

// Big events fall within one Friday-to-Sunday weekend: most run all three days,
// some only Saturday and Sunday. Given any day of it, returns that weekend; null for a weekday.
export function weekendOf(iso) {
  const back = { 5: 0, 6: 1, 0: 2 }[new Date(utcDay(iso)).getUTCDay()];
  if (back === undefined) return null;
  const start = addDays(iso, -back);
  return { start, end: addDays(start, 2) };
}

// True when the event runs the full Friday-to-Sunday weekend.
export function isWeekend(event) {
  const w = weekendOf(event.start);
  return !!w && w.start === event.start && w.end === event.end;
}

// True when every day of the event falls within one weekend.
export function withinWeekend(event) {
  const w = weekendOf(event.start);
  return !!w && event.end >= event.start && event.end <= w.end;
}

export function status(event, today) {
  if (today < event.start) return 'upcoming';
  if (today > event.end) return 'past';
  return 'live';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parts(iso) {
  const d = new Date(utcDay(iso));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), w: d.getUTCDay() };
}

// "Jan 9–10", "Jan 30 – Feb 1", "Feb 14"
export function dateRange(start, end) {
  const a = parts(start), b = parts(end);
  if (start === end) return `${MONTHS[a.m]} ${a.d}`;
  if (a.m === b.m && a.y === b.y) return `${MONTHS[a.m]} ${a.d}–${b.d}`;
  return `${MONTHS[a.m]} ${a.d} – ${MONTHS[b.m]} ${b.d}`;
}

// "Fri–Sun", "Sat"
export function weekdayRange(start, end) {
  const a = parts(start), b = parts(end);
  return start === end ? WEEKDAYS[a.w] : `${WEEKDAYS[a.w]}–${WEEKDAYS[b.w]}`;
}

export function monthKey(iso) {
  return iso.slice(0, 7);
}

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  return `${names[m - 1]} ${y}`;
}

// "Today", "Tomorrow", "in 12 days", "in 3 weeks", "in 4 months"
export function countdown(event, today) {
  const s = status(event, today);
  if (s === 'live') {
    const day = daysBetween(event.start, today) + 1;
    const total = daysBetween(event.start, event.end) + 1;
    // Underway, not necessarily on air: the page adds "Live now" only while the stream is up.
    return total > 1 ? `Day ${day} of ${total}` : 'Today';
  }
  if (s === 'past') return 'Completed';
  const n = daysBetween(today, event.start);
  if (n === 1) return 'Tomorrow';
  if (n < 21) return `in ${n} days`;
  if (n < 63) return `in ${Math.round(n / 7)} weeks`;
  return `in ${Math.round(n / 30.44)} months`;
}

// ---- Data --------------------------------------------------------------

export function resolveLink(data, value) {
  if (!value) return null;
  return data.sources?.[value] || value;
}

export function formatLabel(event) {
  return event.formats.map((f) => FORMATS[f] || f).join(' + ');
}

// What an event qualifies players for: `feeds` is the id of a listed event (shown as a link
// to it) or, for something we don't list, plain text.
export function feedsTarget(data, event) {
  if (!event.feeds) return null;
  const target = data.events.find((x) => x.id === event.feeds);
  return target ? { id: target.id, label: target.name } : { id: null, label: event.feeds };
}

// Google Maps search for where an event is. A venue is written "<Convention>, <Building>", so the
// building is the part after the last comma; with no building named, search for the city.
export function venuePlace(event) {
  const v = event.venue || '';
  const i = v.lastIndexOf(', ');
  return i === -1 ? null : v.slice(i + 2);
}

export function mapsUrl(event) {
  const query = [venuePlace(event), event.city, countryName(event.country)].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function placeLabel(event) {
  return `${event.city}, ${countryName(event.country)}`;
}

export function searchText(event) {
  return [
    event.name, event.city, countryName(event.country), event.country, event.organizer,
    event.venue, event.set, event.feeds, TYPES[event.type]?.label, TYPES[event.type]?.short,
    REGIONS[regionOf(event.country)], ...event.formats.map((f) => FORMATS[f]),
  ].filter(Boolean).join(' ').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ---- Filtering ---------------------------------------------------------

// Each list holds the choices made in one filter; an empty list means "all". An event matches a
// filter when it matches any of its choices, and must match every filter.
// types: FILTER_GROUPS keys. formats: FORMATS keys. locs: region keys ('europe') or country codes ('US').
// rcOnly: apply locs to Regional Championships only and list every other event wherever it is
// (players can only play their own region's RC, but travel to anything else).
// past: list completed events too (the page's "Show completed", off by default).
export const EMPTY_FILTERS = Object.freeze({ types: [], formats: [], locs: [], rcOnly: false, q: '', past: false });

export function matchesLoc(event, locs) {
  const list = Array.isArray(locs) ? locs : locs ? [locs] : [];
  if (!list.length) return true;
  return list.some((l) => (REGIONS[l] ? regionOf(event.country) === l : event.country === l));
}

// ctx: { today }
export function filterEvents(events, filters, ctx) {
  const q = (filters.q || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const terms = q ? q.split(/\s+/) : [];
  return events.filter((e) => {
    if (!filters.past && status(e, ctx.today) === 'past') return false;
    if (filters.types.length && !filters.types.includes(groupOf(e.type))) return false;
    if (filters.formats.length && !e.formats.some((f) => filters.formats.includes(f))) return false;
    if ((!filters.rcOnly || e.type === 'rc') && !matchesLoc(e, filters.locs)) return false;
    if (terms.length) {
      const text = searchText(e);
      if (!terms.every((t) => text.includes(t))) return false;
    }
    return true;
  });
}

export function sortEvents(events) {
  return [...events].sort((a, b) =>
    a.start.localeCompare(b.start) ||
    TYPES[a.type].rank - TYPES[b.type].rank ||
    a.city.localeCompare(b.city));
}

// ---- URL state ---------------------------------------------------------

export function filtersFromParams(params) {
  const list = (name) => [...new Set((params.get(name) || '').split(',').filter(Boolean))];
  const types = list('type').filter((t) => FILTER_GROUPS[t]);
  const formats = list('format').filter((f) => FORMATS[f]);
  const locs = list('loc')
    .map((l) => (REGIONS[l] ? l : /^[a-z]{2}$/i.test(l) ? l.toUpperCase() : ''))
    .filter(Boolean);
  return { types, formats, locs, rcOnly: params.get('rconly') === '1', q: params.get('q') || '', past: params.get('past') === '1' };
}

export function filtersToParams(f) {
  const p = new URLSearchParams();
  if (f.types.length) p.set('type', f.types.join(','));
  if (f.formats.length) p.set('format', f.formats.join(','));
  if (f.locs.length) p.set('loc', f.locs.join(','));
  if (f.rcOnly) p.set('rconly', '1');
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.past) p.set('past', '1');
  return p;
}

// ---- iCalendar ---------------------------------------------------------

function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

// Fold lines to 75 octets, as RFC 5545 requires.
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = '';
  let curLen = 0;
  for (const ch of line) {
    const len = new TextEncoder().encode(ch).length;
    const limit = out.length ? 74 : 75;
    if (curLen + len > limit) {
      out.push(cur);
      cur = '';
      curLen = 0;
    }
    cur += ch;
    curLen += len;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function eventTitle(event) {
  return event.type === 'rc' || event.type === 'spotlight'
    ? `${event.name} – ${event.city}`
    : event.name;
}

export function toICS(data, events, { calName = 'mtgupdate: competitive paper Magic' } = {}) {
  const stamp = `${data.updated.replace(/-/g, '')}T000000Z`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//mtgupdate//mtgupdate.com//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(calName)}`,
    'X-WR-CALDESC:Large competitive paper Magic: The Gathering events',
    'REFRESH-INTERVAL;VALUE=DURATION:P1D',
    'X-PUBLISHED-TTL:P1D',
  ];
  for (const e of sortEvents(events)) {
    const desc = [
      `${TYPES[e.type].label}: ${formatLabel(e)}`,
      e.set && `Set: ${e.set}`,
      e.organizer && `Organizer: ${e.organizer}`,
      e.venue && `Venue: ${e.venue}`,
      e.feeds && `Qualifies for: ${feedsTarget(data, e).label}`,
      e.notes,
      `${SITE}/#${e.id}`,
    ].filter(Boolean).join('\n');
    const url = resolveLink(data, e.links?.info) || `${SITE}/#${e.id}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@mtgupdate.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${e.start.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${addDays(e.end, 1).replace(/-/g, '')}`,
      `SUMMARY:${icsEscape(eventTitle(e))}`,
      `LOCATION:${icsEscape(e.venue ? `${e.venue}, ${placeLabel(e)}` : placeLabel(e))}`,
      `GEO:${e.lat};${e.lng}`,
      `DESCRIPTION:${icsEscape(desc)}`,
      `URL:${url}`,
      `CATEGORIES:${icsEscape(TYPES[e.type].label)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---- Validation (used by the build and tests) --------------------------

export function validate(data) {
  const errors = [];
  const ids = new Set();
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(data.updated || '')) errors.push('updated: missing or not YYYY-MM-DD');
  for (const [name, url] of Object.entries(data.organizers || {})) {
    if (!/^https:\/\//.test(url)) errors.push(`organizers.${name}: not an https URL`);
  }
  for (const [i, e] of (data.events || []).entries()) {
    const at = `events[${i}] (${e.id || 'no id'})`;
    if (!/^[a-z0-9-]+$/.test(e.id || '')) errors.push(`${at}: id must be lowercase-kebab`);
    if (ids.has(e.id)) errors.push(`${at}: duplicate id`);
    ids.add(e.id);
    if (!TYPES[e.type]) errors.push(`${at}: unknown type "${e.type}"`);
    if (!e.name) errors.push(`${at}: missing name`);
    if (!iso.test(e.start || '') || !iso.test(e.end || '')) errors.push(`${at}: start/end must be YYYY-MM-DD`);
    else if (e.end < e.start) errors.push(`${at}: end is before start`);
    if (!Array.isArray(e.formats) || !e.formats.length) errors.push(`${at}: formats must be a non-empty list`);
    else for (const f of e.formats) if (!FORMATS[f]) errors.push(`${at}: unknown format "${f}"`);
    if (!e.city) errors.push(`${at}: missing city`);
    if (e.feeds && /^\d{4}-[a-z0-9-]+$/.test(e.feeds) && !data.events.some((x) => x.id === e.feeds)) {
      errors.push(`${at}: feeds names no listed event (${e.feeds})`);
    }
    if (!/^[A-Z]{2}$/.test(e.country || '')) errors.push(`${at}: country must be an ISO 3166 alpha-2 code`);
    else if (regionOf(e.country) === 'other') errors.push(`${at}: country ${e.country} has no region in js/core.js`);
    if (typeof e.lat !== 'number' || typeof e.lng !== 'number' ||
        Math.abs(e.lat) > 90 || Math.abs(e.lng) > 180) errors.push(`${at}: lat/lng missing or out of range`);
    for (const [k, v] of Object.entries(e.links || {})) {
      const url = resolveLink(data, v);
      if (!/^https:\/\//.test(url)) errors.push(`${at}: links.${k} is neither a source key nor an https URL`);
    }
  }
  return errors;
}
