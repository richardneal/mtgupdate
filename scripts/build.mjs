// Checks data/events.json and writes calendar.ics, the feed behind "Subscribe".
// Usage: node scripts/build.mjs [--check]   (--check fails if calendar.ics is out of date)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validate, toICS } from '../js/core.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const data = JSON.parse(readFileSync(`${root}data/events.json`, 'utf8'));

const errors = validate(data);
if (errors.length) {
  console.error(`data/events.json has ${errors.length} problem(s):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}

const ics = toICS(data, data.events);
const out = `${root}calendar.ics`;
if (process.argv.includes('--check')) {
  if (!existsSync(out) || readFileSync(out, 'utf8') !== ics) {
    console.error('calendar.ics is out of date. Run: npm run build');
    process.exit(1);
  }
  console.log(`OK: ${data.events.length} events, calendar.ics up to date`);
} else {
  writeFileSync(out, ics);
  console.log(`OK: ${data.events.length} events, wrote calendar.ics`);
}
