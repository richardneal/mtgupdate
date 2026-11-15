// Checks data/events.json, keeps it in canonical form (sorted by date, 2-space JSON), and
// writes calendar.ics, the feed behind "Subscribe".
// Usage: node scripts/build.mjs [--check]   (--check fails instead of writing when anything is out of date)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validate, toICS } from '../js/core.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const eventsPath = `${root}data/events.json`;
const raw = readFileSync(eventsPath, 'utf8');
const data = JSON.parse(raw);

const errors = validate(data);
if (errors.length) {
  console.error(`data/events.json has ${errors.length} problem(s):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}

data.events.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
const canonical = JSON.stringify(data, null, 2) + '\n';
const ics = toICS(data, data.events);
const out = `${root}calendar.ics`;

if (process.argv.includes('--check')) {
  const stale = [];
  if (raw !== canonical) stale.push('data/events.json is not in canonical form');
  if (!existsSync(out) || readFileSync(out, 'utf8') !== ics) stale.push('calendar.ics is out of date');
  if (stale.length) {
    console.error(`${stale.join('; ')}. Run: npm run build`);
    process.exit(1);
  }
  console.log(`OK: ${data.events.length} events, calendar.ics up to date`);
} else {
  writeFileSync(eventsPath, canonical);
  writeFileSync(out, ics);
  console.log(`OK: ${data.events.length} events, wrote calendar.ics`);
}
