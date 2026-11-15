// mtgupdate.com Worker: serves the static site from hosting/dist (the ASSETS binding), plus
// /api/live, which says whether a Twitch channel is broadcasting right now.
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.hostname === 'www.mtgupdate.com') {
      url.hostname = 'mtgupdate.com';
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === '/api/live') return live(url, ctx);

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
