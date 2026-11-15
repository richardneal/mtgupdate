// Checks the sources in sources/sources.json for new or changed event information, asks
// Claude to turn each new article or changed organizer page into changes to data/events.json,
// and applies the ones that pass validation. Run by .github/workflows/update-events.yml,
// which opens a pull request with the result.
//
//   node scripts/update-events.mjs              check every source
//   node scripts/update-events.mjs --dry-run    list what would be read; no Claude calls, no writes
//   node scripts/update-events.mjs --only URL   read just this page (also: ONLY_URL=...)
//   node scripts/update-events.mjs --mark-seen  record everything currently listed as read
//
// Claude credentials (not needed for --dry-run or --mark-seen):
// - In GitHub Actions: Workload Identity Federation. The job's GitHub identity token is exchanged
//   for a short-lived Anthropic token; no API key is stored. Needs the ANTHROPIC_FEDERATION_RULE_ID,
//   ANTHROPIC_ORGANIZATION_ID and ANTHROPIC_SERVICE_ACCOUNT_ID repository variables (and
//   ANTHROPIC_WORKSPACE_ID if the rule covers several workspaces) and `id-token: write`.
// - Locally: ANTHROPIC_API_KEY, or an `ant auth login` profile.

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { oidcFederationProvider } from '@anthropic-ai/sdk/lib/credentials/oidc-federation';
import { z } from 'zod';
import { TYPES, FORMATS, toICS, todayISO, daysBetween, countryName } from '../js/core.js';
import { applyChanges, toChanges } from './lib/merge.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const paths = {
  events: `${root}data/events.json`,
  calendar: `${root}calendar.ics`,
  sources: `${root}sources/sources.json`,
  seen: `${root}sources/seen.json`,
  summary: `${root}.update-summary.md`,
};
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const MARK_SEEN = args.includes('--mark-seen');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : process.env.ONLY_URL || '';
const MAX_DOCS = 10; // Articles read per run; the rest wait for the next run.
const MAX_CHARS = 60000;
const UA = 'mtgupdate (+https://mtgupdate.com; schedule of competitive Magic events)';

const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));
const today = todayISO();

// ---- Fetching and reading pages ------------------------------------------

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/rss+xml,*/*' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…' };
function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

// Readable text of an HTML page or fragment: scripts, styles and site chrome removed.
function pageText(html) {
  const body = html
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(header|footer|nav|aside|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const main = body.match(/<(article|main)\b[\s\S]*<\/\1>/i)?.[0] || body;
  return decode(main
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/section)\b[^>]*>/gi, '\n')
    .replace(/<a\b[^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 <$1>')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

// ---- Listing what each source has ----------------------------------------

function listMagicgg(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href="(\/news\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const text = pageText(m[2]).split('\n').map((s) => s.trim()).filter(Boolean);
    const date = text.find((t) => /^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(t));
    const title = text.find((t) => t !== date) || m[1];
    out.push({ url: new URL(m[1], base).href, title, date: date || '' });
  }
  return out;
}

function listWizards(html, base) {
  const out = [];
  for (const m of html.matchAll(/href="(\/en\/news\/announcements\/[^"#?]+)"/g)) {
    const slug = m[1].split('/').pop();
    out.push({ url: new URL(m[1], base).href, title: slug.replace(/-/g, ' '), date: '' });
  }
  return out;
}

function listRSS(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const tag = (t) => decode(item.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1] || '').trim();
    return {
      url: tag('link'),
      title: tag('title'),
      date: tag('pubDate'),
      categories: [...item.matchAll(/<category>([\s\S]*?)<\/category>/g)].map((c) => decode(c[1]).trim()),
      content: decode(item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/)?.[1] || ''),
    };
  });
}

function relevant(source, item) {
  const hay = [item.title, item.url, ...(item.categories || [])].join(' ');
  if (source.match && !new RegExp(source.match, 'i').test(hay)) return false;
  if (source.exclude && new RegExp(source.exclude, 'i').test(hay)) return false;
  return true;
}

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

// Every document worth reading this run: new matching articles, and organizer pages whose text changed.
async function collect(sources, seen) {
  const docs = [];
  for (const source of sources) {
    try {
      if (source.kind === 'page') {
        const html = await get(source.url);
        const text = pageText(html);
        const h = hash(text);
        if (seen.pages[source.url]?.hash !== h || ONLY === source.url) {
          docs.push({ source, url: source.url, title: source.name, text, pageHash: h });
        }
        continue;
      }
      const raw = await get(source.url);
      const items = source.kind === 'magicgg-news' ? listMagicgg(raw, source.url)
        : source.kind === 'wizards-news' ? listWizards(raw, source.url)
        : source.kind === 'rss' ? listRSS(raw)
        : [];
      const unique = [...new Map(items.map((i) => [i.url, i])).values()];
      for (const item of unique) {
        if (!relevant(source, item)) continue;
        if (seen.articles[item.url] && ONLY !== item.url) continue;
        docs.push({ source, ...item });
      }
    } catch (err) {
      console.warn(`! ${source.id}: ${err.message}`);
    }
  }
  if (ONLY && !docs.some((d) => d.url === ONLY)) {
    docs.push({ source: { id: 'manual', name: 'Requested page', check: 'A page someone asked the workflow to read.' }, url: ONLY, title: ONLY });
  }
  if (ONLY) return docs.filter((d) => d.url === ONLY);
  // Organizer pages first: they are the most reliable source, and the per-run limit must not crowd them out.
  return [...docs.filter((d) => d.pageHash), ...docs.filter((d) => !d.pageHash)];
}

// ---- Asking Claude ---------------------------------------------------------

const AUDIENCE = 'https://api.anthropic.com';

// In GitHub Actions, sign in with the job's own identity. GitHub's identity tokens last about
// five minutes and each can be exchanged only once, so fetch a fresh one every time the SDK
// renews its Anthropic token rather than reading one saved at the start of the job.
function makeClient() {
  const env = process.env;
  const requestURL = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (env.ANTHROPIC_FEDERATION_RULE_ID && env.ANTHROPIC_ORGANIZATION_ID) {
    if (!requestURL || !requestToken) {
      throw new Error('Federation is configured but GitHub gave the job no identity token. The workflow needs `permissions: id-token: write`.');
    }
    return new Anthropic({
      credentials: oidcFederationProvider({
        identityTokenProvider: async () => {
          const res = await fetch(`${requestURL}&audience=${encodeURIComponent(AUDIENCE)}`, {
            headers: { Authorization: `Bearer ${requestToken}` },
          });
          if (!res.ok) throw new Error(`GitHub identity token request failed: HTTP ${res.status}`);
          return (await res.json()).value;
        },
        federationRuleId: env.ANTHROPIC_FEDERATION_RULE_ID,
        organizationId: env.ANTHROPIC_ORGANIZATION_ID,
        serviceAccountId: env.ANTHROPIC_SERVICE_ACCOUNT_ID || undefined,
        workspaceId: env.ANTHROPIC_WORKSPACE_ID || undefined,
        baseURL: 'https://api.anthropic.com',
        fetch,
      }),
    });
  }
  if (env.GITHUB_ACTIONS && !env.ANTHROPIC_API_KEY) {
    throw new Error('No Claude credentials: set the ANTHROPIC_FEDERATION_RULE_ID, ANTHROPIC_ORGANIZATION_ID and ANTHROPIC_SERVICE_ACCOUNT_ID repository variables (see README, Automatic updates).');
  }
  return new Anthropic();
}

// One flat record per field changed: a small schema the API compiles quickly. (A nested object
// with every field optional was rejected as "Schema is too complex".) toChanges() groups the
// records back into one change per event for applyChanges().
const FIELDS = ['type', 'name', 'start', 'end', 'formats', 'set', 'city', 'country', 'lat', 'lng',
  'organizer', 'venue', 'feeds', 'notes',
  'links.event', 'links.info', 'links.coverage', 'links.results', 'links.decklists', 'links.melee', 'links.stream'];
const Output = z.object({
  changes: z.array(z.object({
    id: z.string().describe('An existing id for an update; a new lowercase-kebab id like 2027-spotlight-lille for an add'),
    action: z.enum(['add', 'update']),
    field: z.enum(FIELDS),
    value: z.string().describe('The new value. Dates YYYY-MM-DD; formats comma-separated keys; lat and lng as decimal numbers; country an ISO 3166-1 alpha-2 code; links full https URLs; feeds the id of the event qualified for when the schedule lists it, else a short description'),
    reason: z.string().describe('One sentence: what the source says that calls for this change'),
    evidence: z.string().describe('The words in the source that support it, quoted exactly, under 200 characters'),
  })),
});


const INSTRUCTIONS = `You keep the schedule for mtgupdate.com, a site listing large competitive paper Magic: The Gathering events. You are given the current schedule and one document: a news article or an event organizer's schedule page. Report what the document says that the schedule should add or change.

Event types we list: ${Object.entries(TYPES).map(([k, t]) => `${k} (${t.label})`).join(', ')}. Formats: ${Object.keys(FORMATS).join(', ')}.

Rules:
- Only use facts the document states. Never guess dates, venues or cities. The schedule doesn't list prize pools; ignore them. If the document doesn't change anything we list, return no changes; most articles won't.
- Report only facts that are new or different. If the schedule already says the same thing, even in other words ("Star City Games" and "SCG"), leave it alone: never reword, shorten or restyle existing text.
- Only paper events of the types above. Not Magic Online or Arena events, not RCQs or store events, not other games.
- Update an existing event (by its id) when the document gives better or newer facts for it: dates, venue, organizer, format, what it qualifies for, or links to its results, decklists, coverage or stream. Use the document's URL for the link when the document itself is that page (for example a decklists article is links.decklists). A melee.gg tournament page for the event (pairings, standings, decklists) is links.melee.
- Add an event only when the document clearly announces one we don't list, with its dates and city. Give lat and lng for the city, its ISO country code, and an id of the form <year>-<type>-<city>.
- Events run Friday to Sunday, or Saturday and Sunday. Use the dates of the event itself as the source gives them; a convention's Friday-to-Sunday dates are right for an event held at it unless the source says the event runs fewer days.
- An organizer's own schedule page is the most reliable source for its events' dates and venues. Write a venue at a convention as "<Convention name>, <venue name>", e.g. "SCG CON Richmond, Greater Richmond Convention Center".
- Keep names in the schedule's style ("Spotlight: <set>", "Regional Championship", "Pro Tour <name>"). Use American spelling and plain words.
- Today is ${today}. Past events can still get results, decklist and coverage links.`;

function compactSchedule(data) {
  // Everything Claude might be asked to change, so it can tell what the schedule already says.
  // (Leaving fields out once made it "add" facts that were already listed.) Links show as URLs.
  return JSON.stringify(data.events.map(({ lat, lng, ...e }) => ({
    ...e,
    links: e.links && Object.fromEntries(Object.entries(e.links).map(([k, v]) => [k, data.sources?.[v] || v])),
  })));
}

async function extract(client, schedule, doc) {
  const text = (doc.text ?? '').slice(0, MAX_CHARS);
  const response = await client.beta.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high', format: betaZodOutputFormat(Output) },
    system: [
      { type: 'text', text: INSTRUCTIONS },
      { type: 'text', text: `Current schedule:\n${schedule}`, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{
      role: 'user',
      content: `Source: ${doc.source.name}\nHow to read this source: ${doc.source.check}\nURL: ${doc.url}\nTitle: ${doc.title}${doc.date ? `\nPublished: ${doc.date}` : ''}\n\n<document>\n${text}\n</document>`,
    }],
  });
  if (response.stop_reason === 'refusal') throw new Error(`declined (${response.stop_details?.category ?? 'no category'})`);
  if (response.stop_reason === 'max_tokens') throw new Error('response was cut off');
  if (!response.parsed_output) throw new Error('no usable output');
  const u = response.usage;
  console.log(`    tokens: ${u.input_tokens} in, ${u.cache_read_input_tokens || 0} cached, ${u.cache_creation_input_tokens || 0} written to cache, ${u.output_tokens} out`);
  return toChanges(response.parsed_output.changes);
}

// ---- Melee tournament pages -----------------------------------------------
// Players lean on an event's melee.gg page (pairings, standings, decklists), but Melee has no
// public search API. So for events starting soon or just finished, Claude searches melee.gg,
// and a page only counts if its title names the event's city and its start date matches.

const MELEE_AHEAD_DAYS = 90;   // look this far ahead (registration pages go up early)...
const MELEE_BEHIND_DAYS = 14;  // ...and this far back
const MELEE_MAX = 8;           // events searched per run
// melee.gg refuses GitHub's addresses, so pages are checked through the site's Worker.
const MELEE_CHECK = process.env.MELEE_CHECK_URL || 'https://mtgupdate.richard-f81.workers.dev/api/melee';
const MELEE_EVERY_DAYS = 3;    // don't search the same event again sooner than this

export function meleeCandidates(data, seen) {
  return data.events
    .filter((e) => !e.links?.melee)
    .filter((e) => daysBetween(today, e.start) <= MELEE_AHEAD_DAYS && daysBetween(e.end, today) <= MELEE_BEHIND_DAYS)
    .filter((e) => !seen.melee?.[e.id] || daysBetween(seen.melee[e.id], today) >= MELEE_EVERY_DAYS)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, MELEE_MAX);
}

const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

async function findMelee(client, e) {
  const messages = [{
    role: 'user',
    content: `Find the melee.gg tournament page for this Magic: The Gathering event. Search melee.gg only.\n\n` +
      `Event: ${e.name}\nCity: ${e.city}, ${countryName(e.country)}\nDates: ${e.start} to ${e.end}\n` +
      `Organizer: ${e.organizer || 'Wizards of the Coast'}${e.venue ? `\nVenue: ${e.venue}` : ''}\n\n` +
      `Answer with the main event's URL, of the form https://melee.gg/Tournament/View/<number>, on a line by itself. ` +
      `Not a side event, qualifier or last-chance qualifier. If you can't find the main event's page, answer NONE.`,
  }];
  let response;
  for (let i = 0; i < 4; i++) {
    response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4, allowed_domains: ['melee.gg'] }],
      messages,
    });
    if (response.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: response.content });
  }
  const answer = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const url = /https:\/\/melee\.gg\/Tournament\/View\/\d+/i.exec(answer)?.[0];
  if (!url) return null;

  // Check the page before trusting it: the city in its title, and a start date on our dates.
  const id = url.split('/').pop();
  const res = await fetch(`${MELEE_CHECK}?id=${id}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`couldn't check ${url}: ${res.status} ${await res.text()}`);
  const { title = '', start: startsOn } = await res.json();
  const cityWords = fold(e.city).split(/[^a-z]+/).filter((w) => w.length >= 3);
  const datesMatch = startsOn && daysBetween(e.start, startsOn) >= -2 && daysBetween(startsOn, e.end) >= -1;
  if (!cityWords.some((w) => fold(title).includes(w)) || !datesMatch) {
    console.log(`  Melee: ${url} ("${title}", starts ${startsOn || '?'}) doesn't match ${e.id}; skipped`);
    return null;
  }
  return { url, title };
}

// ---- Run -------------------------------------------------------------------

function describe(v) {
  if (v === undefined || v === null) return '(none)';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function summarize(results, failures) {
  const lines = ['Event updates found by the scheduled check of the sources in `sources/sources.json`. Please check each change against its source before merging.', ''];
  for (const r of results) {
    if (!r.applied.length && !r.rejected.length) continue;
    lines.push(`### [${r.doc.title}](${r.doc.url})`, `${r.doc.source.name}${r.doc.date ? `, ${r.doc.date}` : ''}`, '');
    for (const { change, diffs } of r.applied) {
      lines.push(`- **${change.action === 'add' ? 'Added' : 'Updated'} \`${change.id}\`**: ${change.reason}`);
      for (const [field, from, to] of diffs) {
        lines.push(field === 'added' ? `  - ${to}` : `  - ${field}: ${describe(from)} → ${describe(to)}`);
      }
      if (change.evidence) lines.push(`  - Source: “${change.evidence}”`);
    }
    for (const { change, why } of r.rejected) {
      lines.push(`- Not applied, \`${change.id}\`: ${change.reason} (${why})`);
    }
    lines.push('');
  }
  if (failures.length) {
    lines.push('### Not read', ...failures.map((f) => `- [${f.doc.title}](${f.doc.url}): ${f.error}`), '');
  }
  return lines.join('\n');
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main() {
  const config = readJSON(paths.sources);
  const seen = readJSON(paths.seen);
  let data = readJSON(paths.events);

  const docs = await collect(config.sources, seen);
  console.log(`${docs.length} document(s) to read${docs.length > MAX_DOCS ? `; reading the first ${MAX_DOCS}` : ''}`);
  for (const d of docs) console.log(`  ${d.source.id}: ${d.title} <${d.url}>`);
  const meleeQueue = meleeCandidates(data, seen);
  console.log(`${meleeQueue.length} event(s) to look up on melee.gg${meleeQueue.length ? `: ${meleeQueue.map((e) => e.id).join(', ')}` : ''}`);

  const markSeen = (doc) => {
    if (doc.pageHash) seen.pages[doc.url] = { hash: doc.pageHash, checked: today };
    else if (doc.source.kind !== undefined) seen.articles[doc.url] = today;
  };

  if (DRY) return;
  if (MARK_SEEN) {
    docs.forEach(markSeen);
    writeFileSync(paths.seen, JSON.stringify(seen, null, 2) + '\n');
    console.log(`Recorded ${docs.length} document(s) as read.`);
    output('seen_changed', String(docs.length > 0));
    return;
  }
  if (!docs.length && !meleeQueue.length) return;

  const client = makeClient();
  // Every document sees the schedule as it was at the start of the run, so the cached prompt
  // prefix stays the same all run. Changes found earlier still apply: the merge skips repeats.
  const schedule = compactSchedule(data);
  const results = [];
  const failures = [];
  for (const doc of docs.slice(0, MAX_DOCS)) {
    try {
      if (doc.text === undefined) doc.text = doc.content ? pageText(doc.content) : pageText(await get(doc.url));
      const changes = await extract(client, schedule, doc);
      const result = applyChanges(data, changes, { source: doc.url });
      data = result.data;
      results.push({ doc, ...result });
      markSeen(doc);
      console.log(`  ${doc.title}: ${result.applied.length} applied, ${result.rejected.length} not applied`);
    } catch (err) {
      // A refused sign-in fails every document the same way: stop, and fail the run so GitHub emails.
      if (err instanceof Anthropic.AuthenticationError || /token exchange failed|authentication/i.test(err.message)) {
        throw new Error(`Couldn't sign in to the Claude API: ${err.message}`);
      }
      failures.push({ doc, error: err.message });
      console.warn(`! ${doc.title}: ${err.message}`);
    }
  }

  seen.melee ||= {};
  let searched = 0;
  for (const e of meleeQueue) {
    try {
      const found = await findMelee(client, e);
      seen.melee[e.id] = today;
      searched++;
      if (!found) { console.log(`  Melee: nothing yet for ${e.id}`); continue; }
      const result = applyChanges(data, [{
        action: 'update', id: e.id, reason: 'melee.gg has this event\'s tournament page.', evidence: found.title,
        fields: { links: { melee: found.url } },
      }], { source: found.url });
      data = result.data;
      results.push({ doc: { source: { name: 'melee.gg search' }, url: found.url, title: `${found.title} (melee.gg)` }, ...result });
      console.log(`  Melee: ${e.id} -> ${found.url}`);
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || /token exchange failed|authentication/i.test(err.message)) {
        throw new Error(`Couldn't sign in to the Claude API: ${err.message}`);
      }
      failures.push({ doc: { url: 'https://melee.gg', title: `melee.gg search for ${e.id}` }, error: err.message });
      console.warn(`! Melee search for ${e.id}: ${err.message}`);
    }
  }

  const changed = results.some((r) => r.applied.length);
  if (changed) {
    data.updated = today;
    writeFileSync(paths.events, JSON.stringify(data, null, 2) + '\n');
    writeFileSync(paths.calendar, toICS(data, data.events));
  }
  writeFileSync(paths.seen, JSON.stringify(seen, null, 2) + '\n');
  const summary = summarize(results, failures);
  writeFileSync(paths.summary, summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  output('events_changed', String(changed));
  output('seen_changed', String(results.length > 0 || searched > 0));
  console.log(changed ? 'Schedule updated.' : 'No changes to the schedule.');
  if (failures.length && !results.length) throw new Error(`None of the ${failures.length} document(s) could be read.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
