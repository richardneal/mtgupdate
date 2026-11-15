// Renders the link-preview image (Discord, Slack, X, iMessage...): the top of the schedule,
// i.e. what's live and the next few events, as a 1200x630 PNG drawn by headless Chrome.
// The deploy runs it every time and once a day, so the preview keeps up with the schedule.
//
//   node scripts/og-image.mjs [out.png]      (default: hosting/dist/og.png)
//   CHROME_PATH=/path/to/chrome to choose the browser.

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { status, countdown, dateRange, todayISO, formatLabel, countryName, sortEvents } from '../js/core.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] || join(root, 'hosting/dist/og.png');
const data = JSON.parse(readFileSync(join(root, 'data/events.json'), 'utf8'));
const today = todayISO();
const ROWS = 5;

const COLORS = { spotlight: '#f59a4f', rc: '#6cc27a', pt: '#6ea6f5', lc: '#ee88bb', worlds: '#a991f5' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const upcoming = sortEvents(data.events).filter((e) => status(e, today) !== 'past').slice(0, ROWS);

const rows = upcoming.map((e) => {
  const live = status(e, today) === 'live';
  return `
    <li style="--accent:${COLORS[e.type]}">
      <span class="date">${esc(dateRange(e.start, e.end))}</span>
      <span class="what">
        <span class="name">${esc(e.name)}</span>
        <span class="sub">${esc(formatLabel(e))}</span>
      </span>
      <span class="where">
        ${live ? `<span class="live">${esc(countdown(e, today))}</span>` : ''}
        <span class="city">${esc(e.city)}</span>
        <span class="country">${esc(countryName(e.country))}</span>
      </span>
    </li>`;
}).join('');

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&display=block">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1200px; height: 630px; overflow: hidden; }
  body { background: #121620; color: #e8ebf1; font-family: Barlow, sans-serif; padding: 52px 64px 44px; display: flex; flex-direction: column; }
  header { display: flex; align-items: baseline; gap: 22px; }
  .brand { font: 500 64px/1 "Barlow Condensed", sans-serif; letter-spacing: -0.01em; }
  .brand b { font-weight: 700; }
  .tag { color: #a2a9b8; font-size: 26px; }
  ol { list-style: none; margin-top: 30px; border-top: 3px solid #e8ebf1; flex: 1; }
  li { display: grid; grid-template-columns: 230px 1fr auto; align-items: center; gap: 24px; height: 80px; border-bottom: 1px solid #252c3b; }
  li:last-child { border-bottom: 0; }
  .date { color: var(--accent); font: 700 46px/1 "Barlow Condensed", sans-serif; white-space: nowrap; }
  .what { display: flex; flex-direction: column; min-width: 0; }
  .name { font: 600 32px/1.1 "Barlow Condensed", sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { color: var(--accent); font-size: 19px; font-weight: 600; margin-top: 2px; }
  .where { display: flex; align-items: baseline; gap: 10px; white-space: nowrap; }
  .city { font-size: 26px; font-weight: 600; }
  .country { color: #a2a9b8; font-size: 21px; }
  .live { color: var(--accent); font-size: 20px; font-weight: 600; margin-right: 8px; }
  footer { display: flex; justify-content: space-between; color: #737b8c; font-size: 21px; padding-top: 14px; }
  footer b { color: #e8ebf1; font-weight: 600; }
</style></head>
<body>
  <header><span class="brand"><b>mtg</b>update</span><span class="tag">Upcoming paper Magic events</span></header>
  <ol>${rows}</ol>
  <footer><span>Pro Tours, Worlds, Regional Championships and Spotlights</span><b>mtgupdate.com</b></footer>
</body></html>`;

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('No Chrome found. Set CHROME_PATH.');
  return found;
}

const work = join(tmpdir(), `mtgupdate-og-${process.pid}`);
mkdirSync(work, { recursive: true });
const page = join(work, 'og.html');
writeFileSync(page, html);
mkdirSync(dirname(out), { recursive: true });
try {
  execFileSync(findChrome(), [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--window-size=1200,630',
    // Give the web fonts time to load before the shot is taken.
    '--virtual-time-budget=8000',
    `--user-data-dir=${join(work, 'profile')}`,
    `--screenshot=${out}`, pathToFileURL(page).href,
  ], { stdio: 'pipe' });
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`Wrote ${out}: ${upcoming.length} events, as of ${today}`);
