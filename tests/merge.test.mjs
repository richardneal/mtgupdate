import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyChanges, toChanges } from '../scripts/lib/merge.mjs';

const data = JSON.parse(readFileSync(new URL('../data/events.json', import.meta.url), 'utf8'));
const byId = (d, id) => d.events.find((e) => e.id === id);

test('updates an event and reports what changed', () => {
  const { data: out, applied, rejected } = applyChanges(data, [{
    action: 'update', id: '2027-spotlight-zagreb', reason: 'Venue announced', evidence: '…',
    fields: { venue: 'Zagreb Arena', links: { event: 'https://example.com/zagreb' } },
  }]);
  assert.equal(rejected.length, 0);
  assert.deepEqual(applied[0].diffs.map(([f]) => f), ['venue', 'links.event']);
  assert.equal(byId(out, '2027-spotlight-zagreb').venue, 'Zagreb Arena');
  assert.equal(byId(out, '2027-spotlight-zagreb').links.info, byId(data, '2027-spotlight-zagreb').links.info, 'existing links are kept');
  assert.equal(byId(data, '2027-spotlight-zagreb').venue, undefined, 'the input is not modified');
});

test('skips changes that change nothing', () => {
  const e = byId(data, '2027-rc-richmond');
  const { applied, rejected } = applyChanges(data, [{ action: 'update', id: e.id, reason: '', evidence: '', fields: { start: e.start, city: e.city } }]);
  assert.equal(applied.length + rejected.length, 0);
});

test('adds a new event', () => {
  const { data: out, applied } = applyChanges(data, [{
    action: 'add', id: '2027-rc-atlanta', reason: 'Announced', evidence: '…',
    fields: { type: 'rc', name: 'Regional Championship', start: '2027-09-10', end: '2027-09-12', formats: ['modern'], city: 'Atlanta', country: 'US', lat: 33.75, lng: -84.39, organizer: 'Star City Games' },
  }]);
  assert.equal(applied.length, 1);
  assert.equal(byId(out, '2027-rc-atlanta').city, 'Atlanta');
  const starts = out.events.map((e) => e.start);
  assert.deepEqual(starts, [...starts].sort(), 'events stay in date order');
});

test('rejects changes that would break the data, and keeps the rest', () => {
  const { data: out, applied, rejected } = applyChanges(data, [
    { action: 'update', id: '2027-rc-louisville', reason: 'Bad dates', evidence: '', fields: { start: '2027-04-17', end: '2027-04-19' } }, // Sat–Mon
    { action: 'update', id: 'no-such-event', reason: '', evidence: '', fields: { venue: 'X' } },
    { action: 'update', id: '2027-pt-tokyo', reason: 'Type change', evidence: '', fields: { type: 'worlds' } },
    { action: 'add', id: '2027-rc-nowhere', reason: 'Incomplete', evidence: '', fields: { type: 'rc', name: 'Regional Championship', city: 'Nowhere' } },
    { action: 'update', id: '2027-pt-tokyo', reason: 'Bad link', evidence: '', fields: { links: { results: 'http://insecure.example' } } },
    { action: 'update', id: '2027-pt-tokyo', reason: 'Venue', evidence: '', fields: { venue: 'Tokyo Big Sight' } },
  ]);
  assert.equal(rejected.length, 5);
  assert.match(rejected[0].why, /weekend/);
  assert.match(rejected[1].why, /no event/);
  assert.match(rejected[2].why, /type/);
  assert.match(rejected[3].why, /missing/);
  assert.match(rejected[4].why, /links\.results/);
  assert.equal(applied.length, 1);
  assert.equal(byId(out, '2027-rc-louisville').start, '2027-04-16');
  assert.equal(byId(out, '2027-pt-tokyo').venue, 'Tokyo Big Sight');
});

test('groups per-field records into one change per event', () => {
  const changes = toChanges([
    { id: '2027-rc-atlanta', action: 'add', field: 'type', value: 'rc', reason: 'Announced.', evidence: 'Atlanta RC' },
    { id: '2027-rc-atlanta', action: 'add', field: 'formats', value: 'Pioneer, team_limited', reason: 'Announced.', evidence: 'Atlanta RC' },
    { id: '2027-rc-atlanta', action: 'add', field: 'lat', value: '33.75', reason: 'Announced.', evidence: 'Atlanta RC' },
    { id: '2027-rc-atlanta', action: 'add', field: 'country', value: 'us', reason: 'Announced.', evidence: 'Atlanta RC' },
    { id: '2027-pt-tokyo', action: 'update', field: 'links.coverage', value: 'https://example.com/c', reason: 'Coverage.', evidence: 'watch' },
    { id: '2027-pt-tokyo', action: 'update', field: 'venue', value: 'Tokyo Big Sight', reason: 'Venue.', evidence: 'Big Sight' },
  ]);
  assert.equal(changes.length, 2);
  const [atl, tokyo] = changes;
  assert.equal(atl.action, 'add');
  assert.deepEqual(atl.fields, { type: 'rc', formats: ['pioneer', 'team-limited'], lat: 33.75, country: 'US' });
  assert.deepEqual(tokyo.fields, { links: { coverage: 'https://example.com/c' }, venue: 'Tokyo Big Sight' });
  assert.equal(tokyo.reason, 'Coverage. Venue.');
});
