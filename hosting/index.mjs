// mtgupdate.com Worker: serves the static site from hosting/dist (the ASSETS binding).
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === 'www.mtgupdate.com') {
      url.hostname = 'mtgupdate.com';
      return Response.redirect(url.toString(), 301);
    }

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
