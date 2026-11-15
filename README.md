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
  "start": "2027-01-08", "end": "2027-01-10",
  "formats": ["limited"], "set": "Star Trek",
  "city": "Lille", "country": "FR", "lat": 50.63, "lng": 3.06,
  "organizer": "Fanfinity",
  "prize": "$50,000 prize pool; Top 8 earn Pro Tour invitations",
  "links": { "info": "comp2027" }
}
```

| Field | |
|---|---|
| `id` | Unique, lowercase-kebab; also the event's permalink (`/#2027-spotlight-lille`) and calendar UID, so don't change it once published |
| `type` | `pt`, `worlds`, `lc`, `rc` or `spotlight` (see `TYPES` in `js/core.js`) |
| `start`, `end` | Dates at the venue, `YYYY-MM-DD` |
| `formats` | Any of `limited`, `team-limited`, `standard`, `pioneer`, `modern`, `legacy`, `vintage`, `pauper` |
| `country` | ISO 3166 alpha-2 code; its region comes from `COUNTRY_REGION` in `js/core.js` |
| `lat`, `lng` | City coordinates |
| optional | `set`, `organizer`, `venue`, `prize`, `feeds` (what it qualifies for), `notes` |
| `links` | Any of `info`, `stream`, `coverage`, `results`, `decklists`: a full `https://` URL, or a key of the top-level `sources` map |

Then bump `updated` and run:

```sh
npm run build   # checks the data and regenerates calendar.ics
npm test
```

## Working on the site

It is a static site with no build step and no dependencies: `index.html`, `css/style.css`, `js/app.js` (the page) and `js/core.js` (filtering, dates and the iCalendar feed, shared with the Node scripts and tests).

```sh
npm run dev     # http://localhost:8642
```

## Hosting

The site is served by the `mtgupdate` Cloudflare Worker with static assets (`hosting/`), the same setup as decklist.app. Pushing to `main` runs the tests and deploys, once the repository has a `CLOUDFLARE_API_TOKEN` secret (a token with **Workers Scripts: Edit**). To deploy by hand:

```sh
npm ci
npm run deploy
```

`hosting/build.mjs` copies the public files into `hosting/dist`. `hosting/index.mjs` redirects `www.mtgupdate.com` to `mtgupdate.com` and serves `calendar.ics` as `text/calendar`.

### Connecting mtgupdate.com

The domain is registered at Namecheap and its DNS is served by Cloudflare:

1. In Cloudflare, **Add a domain** → `mtgupdate.com` (Free plan) and note the two nameservers it assigns.
2. In Namecheap, **Domain List → mtgupdate.com → Manage → Nameservers → Custom DNS**, enter Cloudflare's two nameservers and save.
3. Once Cloudflare shows the zone as **Active**, edit `hosting/wrangler.jsonc`: uncomment `routes` and set `workers_dev` to `false`, then deploy. Wrangler creates the DNS records and certificates for both hostnames.

---

mtgupdate is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy. Not approved or endorsed by Wizards.
