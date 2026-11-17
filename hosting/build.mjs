// Copies the public site into hosting/dist for `wrangler deploy`.
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const output = new URL('./dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'favicon.svg', 'robots.txt', 'calendar.ics', 'css', 'js', 'data']) {
  await cp(new URL(file, root), new URL(file, output), { recursive: true });
}
// Link previews cache images by URL, so give the preview image a new URL on each day's deploy.
const index = new URL('index.html', output);
const day = new Date().toISOString().slice(0, 10);
await writeFile(index, (await readFile(index, 'utf8')).replaceAll('/og.png"', `/og.png?v=${day}"`));

// "Schedule last updated": the date of the last commit that changed the event data. (Update
// pull requests don't touch an in-file date, so they can't collide over it.)
try {
  const changed = execFileSync('git', ['log', '-1', '--format=%cs', '--', 'data/events.json'], { cwd: fileURLToPath(root) }).toString().trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(changed)) {
    const dataFile = new URL('data/events.json', output);
    const d = JSON.parse(await readFile(dataFile, 'utf8'));
    d.updated = changed;
    await writeFile(dataFile, JSON.stringify(d, null, 2) + '\n');
  }
} catch { /* not a git checkout: keep the date in the file */ }

console.log(`Site assets prepared in ${fileURLToPath(output)}`);
