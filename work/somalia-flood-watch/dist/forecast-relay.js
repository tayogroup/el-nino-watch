/* El Nino Watch: send the Open-Meteo forecast requests app.js builds through
   this site's server (/api/open-meteo/...), which caches one copy for every
   visitor (forecast-relay.mjs). The query is passed unchanged. If the relay
   fails for any reason the request goes to Open-Meteo directly, as before, so a
   relay outage never costs a forecast. Loaded before app.js, which calls
   ForecastRelay.fetch() only through optional chaining. */
(function () {
  'use strict';
  const ROUTES = {
    'api.open-meteo.com': {'/v1/forecast': '/api/open-meteo/forecast'},
    'flood-api.open-meteo.com': {'/v1/flood': '/api/open-meteo/flood'}
  };

  // The relay path for an Open-Meteo URL, or null when it is not relayed
  // (another host or endpoint, or the page opened from a file).
  function route(url) {
    try {
      if (!/^https?:$/.test(window.location?.protocol || '')) return null;
      const u = new URL(String(url));
      const path = ROUTES[u.hostname]?.[u.pathname];
      return path ? path + u.search : null;
    } catch { return null; }
  }

  // A fetch() promise for relayed URLs, or null so the caller fetches as usual.
  function relayFetch(url, options) {
    const target = route(url);
    if (!target) return null;
    const direct = () => fetch(url, options);
    return fetch(target, options).then(
      response => response.ok ? response : direct(),
      error => { if (error?.name === 'AbortError') throw error; return direct(); }
    );
  }

  window.ForecastRelay = Object.freeze({fetch: relayFetch, route});
})();
