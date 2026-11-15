// Applies proposed event changes to the schedule, one at a time, keeping only those that
// leave the data valid. Used by scripts/update-events.mjs; tested in tests/merge.test.mjs.
import { validate, withinWeekend } from '../../js/core.js';

const REQUIRED_FOR_ADD = ['type', 'name', 'start', 'end', 'formats', 'city', 'country', 'lat', 'lng'];
const EDITABLE = ['name', 'start', 'end', 'formats', 'set', 'city', 'country', 'lat', 'lng',
  'organizer', 'venue', 'prize', 'feeds', 'notes'];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Returns the field-by-field differences a change would make to an event, as [field, old, new].
function diffFields(event, fields) {
  const diffs = [];
  for (const key of EDITABLE) {
    if (fields[key] === undefined || fields[key] === null) continue;
    if (!same(event[key], fields[key])) diffs.push([key, event[key], fields[key]]);
  }
  for (const [key, url] of Object.entries(fields.links || {})) {
    if (!url) continue;
    if ((event.links || {})[key] !== url) diffs.push([`links.${key}`, event.links?.[key], url]);
  }
  return diffs;
}

function applyFields(event, fields) {
  for (const key of EDITABLE) {
    if (fields[key] !== undefined && fields[key] !== null) event[key] = fields[key];
  }
  const links = Object.fromEntries(Object.entries(fields.links || {}).filter(([, v]) => v));
  if (Object.keys(links).length) event.links = { ...(event.links || {}), ...links };
}

// data: the parsed events.json (left untouched). changes: [{ action, id, reason, evidence, fields }].
// Returns { data, applied: [{ change, diffs }], rejected: [{ change, why }] }.
export function applyChanges(data, changes, { source } = {}) {
  let current = structuredClone(data);
  const applied = [];
  const rejected = [];

  for (const change of changes) {
    const next = structuredClone(current);
    const fields = change.fields || {};
    let event = next.events.find((e) => e.id === change.id);
    let diffs;

    if (event) {
      if (fields.type && fields.type !== event.type) {
        rejected.push({ change, why: `would change the event type from ${event.type} to ${fields.type}` });
        continue;
      }
      diffs = diffFields(event, fields);
      if (!diffs.length) continue; // Already up to date.
      applyFields(event, fields);
    } else if (change.action === 'update') {
      rejected.push({ change, why: `no event with id ${change.id}` });
      continue;
    } else {
      const missing = REQUIRED_FOR_ADD.filter((k) => fields[k] === undefined || fields[k] === null);
      if (missing.length) {
        rejected.push({ change, why: `new event is missing ${missing.join(', ')}` });
        continue;
      }
      event = { id: change.id, type: fields.type };
      applyFields(event, fields);
      next.events.push(event);
      diffs = [['added', null, `${event.name}, ${event.city}, ${event.start}–${event.end}`]];
    }

    const errors = validate(next).filter((e) => e.includes(`(${change.id})`) || !e.includes('('));
    if (!withinWeekend(event)) errors.push(`${event.start}–${event.end} is not within one Friday–Sunday weekend`);
    if (errors.length) {
      rejected.push({ change, why: errors.join('; ') });
      continue;
    }
    current = next;
    applied.push({ change, diffs, source });
  }

  current.events.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  return { data: current, applied, rejected };
}
