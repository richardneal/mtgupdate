// Copies the public site into hosting/dist for `wrangler deploy`.
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
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

console.log(`Site assets prepared in ${fileURLToPath(output)}`);
