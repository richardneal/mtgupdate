# mtgupdate

**[mtgupdate.com](https://mtgupdate.com)**: every large competitive paper Magic: The Gathering event in one place. It is the paper counterpart to [mtgoupdate](https://mtgoupdate.com) (Magic Online) and [mtgaupdate](https://mtgaupdate.com) (Arena).

It lists Pro Tours, the World Championship, the Limited Championship, Regional Championships and the Magic Spotlight Series. Events can be filtered by type and location (region or country), searched by city, set, format or organizer, and added to a calendar one at a time or all together through the subscribable feed at `/calendar.ics`. Every filter is kept in the URL, so a filtered view can be shared as a link.

## Adding or fixing an event

All the data lives in [`data/events.json`](data/events.json). Each event looks like this:

```json
{
  "id": "2027-spotlight-lille",
  "type": "spotlight",
  "name": "Spotlight: Star Trek",
  "start": "2027-01-09", "end": "2027-01-10",
  "formats": ["limited"], "set": "Star Trek",
  "city": "Lille", "country": "FR", "lat": 50.63, "lng": 3.06,
  "organizer": "Fanfinity",
  "feeds": "2027-pt-tokyo",
  "links": { "info": "spotlightStarTrek" }
}
```

| Field | |
|---|---|
| `id` | Unique, lowercase-kebab; also the event's permalink (`/#2027-spotlight-lille`) and calendar UID, so don't change it once published |
| `type` | `pt`, `worlds`, `lc`, `rc` or `spotlight` (see `TYPES` in `js/core.js`) |
| `start`, `end` | Dates at the venue, `YYYY-MM-DD` |
| `formats` | Any of `limited`, `team-limited`, `standard`, `pioneer`, `modern`, `legacy`, `vintage`, `pauper` |
| `organizer` | Its name; if the top-level `organizers` map has the name, the page links it to that site |
| `country` | ISO 3166 alpha-2 code; its region comes from `COUNTRY_REGION` in `js/core.js` |
| `lat`, `lng` | City coordinates |
| optional | `set`, `organizer`, `venue`, `feeds` (what it qualifies for: the id of a listed event, which the page links to, or plain text), `notes` |
| `links` | Any of `event` (the organizer's page), `info`, `stream`, `coverage`, `results`, `decklists`, `melee` (the melee.gg tournament): a full `https://` URL, or a key of the top-level `sources` map |

Then run:

```sh
npm run build   # checks the data, puts it in canonical order, and writes calendar.ics
npm test
```

`calendar.ics` isn't kept in git: the deploy builds it. The footer's "Schedule last updated" date is the date of the last commit that changed `data/events.json`.

## Working on the site

It is a static site with no build step and no dependencies: `index.html`, `css/style.css`, `js/app.js` (the page) and `js/core.js` (filtering, dates and the iCalendar feed, shared with the Node scripts and tests).

```sh
npm run dev     # http://localhost:8642
```

## Automatic updates

Once a day the **Check for event updates** workflow (`.github/workflows/update-events.yml`) runs `scripts/update-events.mjs`. It reads the sources in [`sources/sources.json`](sources/sources.json): magic.gg news, Wizards announcements, Star City Games articles and organizer schedule pages such as SCG CON. Each new article that mentions premier events, and each organizer page whose text changed, goes to Claude, which reports what the schedule should add or change. Changes that pass the same checks as a hand edit go into a pull request of their own (one per run, holding only `data/events.json`), with every change listed beside the words in its source. Once the tests pass it merges itself and the site deploys; the pull request stays as the record of each change and its source. What was read is recorded in `sources/seen.json`, committed straight to `main` on every run, so nothing is read twice and open pull requests never conflict over it. For events within 90 days, the check also looks for their melee.gg tournament pages and links those it can confirm.

`sources/sources.json` also records, for each organizer, what it hosts and where to check its schedule. Organizer pages are the most reliable source for dates and venues. To watch a new source, such as an independent series' schedule, add an entry there.

The workflow signs in to the Claude API with its own GitHub identity (Workload Identity Federation), so no API key is stored in the repository. In the Claude Console, under **Settings → Workload identity → Connect workload → GitHub Actions**, register GitHub's issuer (`https://token.actions.githubusercontent.com`) and a rule that matches only this repository's `main` branch:

- Subject: `repo:richardneal/mtgupdate:ref:refs/heads/main` (scheduled and manual runs on `main` both have this subject)
- Audience: `https://api.anthropic.com`
- Claim `repository_owner`: `richardneal`

Then add the IDs it gives you as repository **variables** (not secrets; they aren't sensitive) under Settings → Secrets and variables → Actions → Variables: `ANTHROPIC_FEDERATION_RULE_ID` (`fdrl_...`), `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_SERVICE_ACCOUNT_ID` (`svac_...`), and `ANTHROPIC_WORKSPACE_ID` (`wrkspc_...`) if the rule covers more than one workspace.

To read one page right away, run the workflow from the Actions tab with its URL. Locally, with an API key:

```sh
node scripts/update-events.mjs --dry-run      # list what would be read
ANTHROPIC_API_KEY=... node scripts/update-events.mjs --only https://magic.gg/news/...
```

## Hosting

The site is served by the `mtgupdate` Cloudflare Worker with static assets (`hosting/`), the same setup as decklist.app. Pushing to `main` runs the tests and deploys, once the repository has a `CLOUDFLARE_API_TOKEN` secret (a token with **Workers Scripts: Edit**). To deploy by hand:

```sh
npm ci
npm run deploy
```

`hosting/build.mjs` copies the public files into `hosting/dist`. `hosting/index.mjs` redirects `www.mtgupdate.com` and plain `http://` to `https://mtgupdate.com`, serves `calendar.ics` as `text/calendar`, and answers two small APIs: `/api/live?channel=` (is a Twitch channel broadcasting) and `/api/melee?id=` (a Melee tournament's title and start date, for the daily check, since melee.gg refuses GitHub's addresses).

### The domain

mtgupdate.com is registered at Namecheap, with its nameservers pointed at Cloudflare (`chip.ns.cloudflare.com`, `pearl.ns.cloudflare.com`), where the zone is on the Free plan. `hosting/wrangler.jsonc` attaches `mtgupdate.com` and `www.mtgupdate.com` to the Worker as custom domains, so Cloudflare manages their DNS records and certificates. The zone keeps Namecheap's email-forwarding MX and SPF records.

---

mtgupdate is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy. Not approved or endorsed by Wizards.
