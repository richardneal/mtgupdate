// mtgupdate.com Worker: serves the static site from hosting/dist (the ASSETS binding), plus
// /api/live, which says whether a Twitch channel is broadcasting right now.
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // One address: https://mtgupdate.com (www and plain http redirect to it, keeping the path).
    if (url.hostname === 'www.mtgupdate.com' || (url.protocol === 'http:' && url.hostname === 'mtgupdate.com')) {
      url.hostname = 'mtgupdate.com';
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === '/api/live') return live(url, ctx);
    if (url.pathname === '/api/melee') return melee(url);

    const response = await env.ASSETS.fetch(request);

    // The calendar feed: calendar apps poll it, so give it the right type and a short cache.
    if (url.pathname === '/calendar.ics' && response.ok) {
      const out = new Response(response.body, response);
      out.headers.set('Content-Type', 'text/calendar; charset=utf-8');
      out.headers.set('Cache-Control', 'public, max-age=3600');
      return out;
    }
    return response;
  },
};

// GET /api/live?channel=magic -> {"channel":"magic","live":true}
// Twitch serves a channel's preview image only while it is live; offline, the image URL
// redirects to a placeholder. That needs no Twitch API key. Answers are cached for a minute.
async function live(url, ctx) {
  const channel = (url.searchParams.get('channel') || '').toLowerCase();
  if (!/^[a-z0-9_]{3,25}$/.test(channel)) {
    return Response.json({ error: 'channel must be a Twitch login name' }, { status: 400 });
  }
  const cacheKey = new Request(`https://mtgupdate.com/api/live?channel=${channel}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let isLive = false;
  try {
    const res = await fetch(`https://static-cdn.jtvnw.net/previews-ttv/live_user_${channel}-80x45.jpg`, {
      redirect: 'manual',
    });
    isLive = res.status === 200;
  } catch {
    // Treat a failed check as offline; the page then shows a plain Stream link.
  }
  const out = Response.json({ channel, live: isLive }, {
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
  ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

// GET /api/melee?id=471980 -> {"id":"471980","title":"World Championship 32 in Atlanta, USA","start":"2026-11-13"}
// The daily update check runs on GitHub, whose addresses melee.gg refuses, so it asks here for
// a tournament's title and start date to confirm a page found by search really is the event.
async function melee(url) {
  const id = url.searchParams.get('id') || '';
  if (!/^\d{1,9}$/.test(id)) return Response.json({ error: 'id must be a Melee tournament number' }, { status: 400 });
  const res = await fetch(`https://melee.gg/Tournament/View/${id}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; mtgupdate; +https://mtgupdate.com)' },
  });
  if (!res.ok) return Response.json({ id, error: `melee.gg answered ${res.status}` }, { status: 502 });
  const html = await res.text();
  const title = (html.match(/<meta content="([^"]*)" property="og:title"/)?.[1] || '')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
  const start = html.match(/\b(20\d\d-\d\d-\d\d)T\d\d:\d\d/)?.[1] || null;
  return Response.json({ id, title, start }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
