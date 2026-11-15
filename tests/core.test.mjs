import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validate, filterEvents, filtersFromParams, filtersToParams, status, countdown,
  dateRange, weekdayRange, toICS, feedsTarget, venuePlace, mapsUrl, regionOf, flag, EMPTY_FILTERS, weekendOf, isWeekend, withinWeekend,
} from '../js/core.js';

const data = JSON.parse(readFileSync(new URL('../data/events.json', import.meta.url), 'utf8'));
const ctx = { today: '2026-11-14' };
const f = (over) => ({ ...EMPTY_FILTERS, ...over });

test('event data is valid', () => {
  assert.deepEqual(validate(data), []);
});

test('validate catches bad events', () => {
  const bad = { updated: '2026-11-14', events: [
    { id: 'x', type: 'nope', name: 'X', start: '2027-01-02', end: '2027-01-01', formats: ['chess'], city: 'A', country: 'ZZ', lat: 0, lng: 0 },
    { id: 'x', type: 'pt', name: 'Y', start: '2027-01-01', end: '2027-01-01', formats: ['modern'], city: 'B', country: 'US', lat: 0, lng: 0, links: { info: 'http://insecure' } },
  ] };
  const errs = validate(bad).join('\n');
  for (const s of ['unknown type', 'end is before start', 'unknown format', 'no region', 'duplicate id', 'links.info']) {
    assert.match(errs, new RegExp(s));
  }
});

test('status and countdown', () => {
  const e = { start: '2026-11-13', end: '2026-11-15' };
  assert.equal(status(e, '2026-11-12'), 'upcoming');
  assert.equal(status(e, '2026-11-14'), 'live');
  assert.equal(status(e, '2026-11-16'), 'past');
  assert.equal(countdown(e, '2026-11-14'), 'Day 2 of 3');
  assert.equal(countdown(e, '2026-11-12'), 'Tomorrow');
  assert.equal(countdown(e, '2026-11-03'), 'in 10 days');
  assert.equal(countdown(e, '2026-12-01'), 'Completed');
});

test('date labels', () => {
  assert.equal(dateRange('2027-01-08', '2027-01-10'), 'Jan 8–10');
  assert.equal(dateRange('2027-01-30', '2027-02-01'), 'Jan 30 – Feb 1');
  assert.equal(dateRange('2027-02-14', '2027-02-14'), 'Feb 14');
  assert.equal(weekdayRange('2027-01-09', '2027-01-10'), 'Sat–Sun');
});

test('completed events are left out unless asked for', () => {
  const upcoming = filterEvents(data.events, f(), ctx);
  assert.ok(upcoming.every((e) => e.end >= ctx.today));
  assert.ok(upcoming.some((e) => e.id === '2026-worlds-32'), 'a live event counts as upcoming');
  assert.ok(filterEvents(data.events, f({ past: true }), ctx).length > upcoming.length);
});

test('filter by type: Pro Tours, Worlds and the Limited Championship are one choice', () => {
  const r = filterEvents(data.events, f({ types: ['pro'] }), ctx);
  assert.deepEqual([...new Set(r.map((e) => e.type))].sort(), ['lc', 'pt', 'worlds']);
  const rc = filterEvents(data.events, f({ types: ['rc', 'spotlight'] }), ctx);
  assert.ok(rc.length && rc.every((e) => e.type === 'rc' || e.type === 'spotlight'));
});

test('filter by region and by country', () => {
  const eu = filterEvents(data.events, f({ locs: ['europe'] }), ctx);
  assert.ok(eu.length && eu.every((e) => regionOf(e.country) === 'europe'));
  const jp = filterEvents(data.events, f({ locs: ['JP'], past: true }), ctx);
  assert.deepEqual([...new Set(jp.map((e) => e.city))].sort(), ['Aichi', 'Shizuoka', 'Tokyo', 'Yokohama']);
});

test('search ignores case and accents and matches formats, sets, organizers', () => {
  const ids = (q) => filterEvents(data.events, f({ q }), ctx).map((e) => e.id);
  assert.ok(ids('sao paulo').includes('2027-rc-sao-paulo'));
  assert.ok(ids('PIONEER').includes('2027-spotlight-valencia'));
  assert.ok(ids('titanbreach montreal').includes('2027-spotlight-montreal'));
  assert.ok(ids('star city').every((id) => data.events.find((e) => e.id === id).organizer === 'Star City Games'));
});

test('filters survive the URL', () => {
  const filters = { types: ['pro', 'rc'], formats: ['standard', 'pioneer'], locs: ['US', 'europe'], rcOnly: true, q: 'standard', past: true };
  const back = filtersFromParams(new URLSearchParams(filtersToParams(filters).toString()));
  assert.deepEqual(back, filters);
  assert.deepEqual(filtersFromParams(new URLSearchParams('type=bogus,pro&loc=europe,jp,mars&format=chess,modern')),
    { types: ['pro'], formats: ['modern'], locs: ['europe', 'JP'], rcOnly: false, q: '', past: false });
});

test('calendar feed is valid iCalendar', () => {
  const ics = toICS(data, data.events);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, data.events.length);
  for (const line of ics.split('\r\n')) {
    assert.ok(new TextEncoder().encode(line).length <= 75, `line too long: ${line}`);
  }
  // All-day events end the day after their last day.
  assert.match(ics, /DTSTART;VALUE=DATE:20271203\r\nDTEND;VALUE=DATE:20271206/);
});

test('flags', () => {
  assert.equal(flag('US'), '🇺🇸');
  assert.equal(flag('x'), '');
});

test('every event falls within one Friday-to-Sunday weekend', () => {
  const off = data.events.filter((e) => !withinWeekend(e)).map((e) => `${e.id} ${e.start}–${e.end}`);
  assert.deepEqual(off, []);
});

test('isWeekend and withinWeekend', () => {
  assert.ok(isWeekend({ start: '2027-01-08', end: '2027-01-10' }));
  assert.ok(!isWeekend({ start: '2027-01-09', end: '2027-01-10' }));
  assert.ok(withinWeekend({ start: '2027-01-09', end: '2027-01-10' })); // Sat–Sun
  assert.ok(withinWeekend({ start: '2027-02-14', end: '2027-02-14' })); // Sun
  assert.ok(!withinWeekend({ start: '2027-05-22', end: '2027-05-24' })); // Sat–Mon
  assert.ok(!withinWeekend({ start: '2027-01-07', end: '2027-01-09' })); // Thu–Sat
});

test('weekendOf', () => {
  assert.deepEqual(weekendOf('2027-01-09'), { start: '2027-01-08', end: '2027-01-10' }); // Sat
  assert.deepEqual(weekendOf('2027-02-14'), { start: '2027-02-12', end: '2027-02-14' }); // Sun
  assert.deepEqual(weekendOf('2027-01-08'), { start: '2027-01-08', end: '2027-01-10' }); // Fri
  assert.equal(weekendOf('2027-01-06'), null); // Wed
});

test('filter by format', () => {
  const pioneer = filterEvents(data.events, f({ formats: ['pioneer'] }), ctx);
  assert.ok(pioneer.length && pioneer.every((e) => e.formats.includes('pioneer')));
  const limited = filterEvents(data.events, f({ formats: ['limited'] }), ctx).map((e) => e.id);
  assert.ok(limited.includes('2027-pt-nauctis'), 'mixed-format events match each of their formats');
  assert.ok(!limited.includes('2027-spotlight-dc'), 'Team Limited is its own format');
});

test('qualifying events link to the event they feed', () => {
  const rc = data.events.find((e) => e.id === '2027-rc-st-louis');
  const pt = data.events.find((e) => e.id === '2027-pt-tokyo');
  assert.deepEqual(feedsTarget(data, rc), { id: pt.id, label: pt.name });
  assert.deepEqual(feedsTarget(data, { feeds: 'A future event' }), { id: null, label: 'A future event' });
  const bad = structuredClone(data);
  bad.events.find((e) => e.id === '2027-rc-st-louis').feeds = '2027-pt-nowhere';
  assert.match(validate(bad).join('\n'), /feeds names no listed event/);
  assert.ok(toICS(data, [rc]).replace(/\r\n /g, '').includes(`Qualifies for: ${pt.name}`)); // unfold lines first
});

test('several choices in one filter match any of them', () => {
  const both = filterEvents(data.events, f({ formats: ['pioneer', 'modern'], past: true }), ctx);
  assert.ok(both.length && both.every((e) => e.formats.some((x) => x === 'pioneer' || x === 'modern')));
  assert.ok(both.some((e) => e.formats.includes('pioneer')) && both.some((e) => e.formats.includes('modern')));
  const places = filterEvents(data.events, f({ locs: ['JP', 'oceania'], past: true }), ctx);
  assert.deepEqual([...new Set(places.map((e) => e.country))].sort(), ['AU', 'JP']);
  // Across filters, every one must match.
  const usPioneer = filterEvents(data.events, f({ formats: ['pioneer'], locs: ['US'] }), ctx);
  assert.ok(usPioneer.length && usPioneer.every((e) => e.country === 'US' && e.formats.includes('pioneer')));
});

test('location can apply to Regional Championships only', () => {
  const r = filterEvents(data.events, f({ locs: ['US'], rcOnly: true }), ctx);
  const rcs = r.filter((e) => e.type === 'rc');
  assert.ok(rcs.length && rcs.every((e) => e.country === 'US'), 'RCs only in the US');
  assert.ok(r.some((e) => e.type !== 'rc' && e.country !== 'US'), 'everything else, anywhere');
  const all = filterEvents(data.events, f(), ctx).filter((e) => e.type !== 'rc');
  assert.equal(r.filter((e) => e.type !== 'rc').length, all.length);
});

test('map links search for the building when named, else the city', () => {
  const dc = data.events.find((e) => e.id === '2027-spotlight-dc');
  assert.equal(venuePlace(dc), 'Walter E. Washington Convention Center');
  assert.match(mapsUrl(dc), /query=Walter%20E\.%20Washington%20Convention%20Center%2C%20Washington%2C%20DC%2C%20USA$/);
  const tokyo = data.events.find((e) => e.id === '2027-pt-tokyo'); // "MagicCon: Tokyo": no building
  assert.equal(venuePlace(tokyo), null);
  assert.match(mapsUrl(tokyo), /query=Tokyo%2C%20Japan$/);
});

test('organizer sites are https', () => {
  assert.ok(Object.keys(data.organizers).length > 0);
  assert.match(validate({ ...data, organizers: { X: 'http://insecure' } }).join('\n'), /organizers\.X/);
});
