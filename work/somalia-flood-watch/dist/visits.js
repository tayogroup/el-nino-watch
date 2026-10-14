/* El Nino Watch: report anonymous visits to this site's own server (visits.mjs).
   One "view" per page load, then "tab" and "city" when the visitor switches.
   Nothing identifying is sent: the tab, the city, the page language. No cookies
   or storage are used. Browsers asking not to be tracked (Global Privacy Control,
   Do Not Track) send nothing. Loaded before app.js. */
(function () {
  'use strict';
  if (!/^https?:$/.test(window.location?.protocol || '')) return;
  const nav = window.navigator || {};
  if (nav.globalPrivacyControl === true || nav.doNotTrack === '1' || window.doNotTrack === '1') return;

  const link = document.getElementById('visitor-stats-link');
  let viewSent = false, lastTab = null, lastCity = null;

  function state() {
    const mayor = document.body?.classList.contains('mayor-view');
    return {
      tab: mayor ? 'mayor' : (window.SiteTabs?.current || 'overview'),
      city: document.getElementById('site-city')?.value || '',
      lang: document.documentElement.lang === 'so' ? 'so' : 'en'
    };
  }
  function send(type) {
    const now = state();
    lastTab = now.tab; lastCity = now.city;
    // text/plain keeps this a simple same-origin request; keepalive lets it finish on page exit.
    fetch('/api/visit', {method: 'POST', body: JSON.stringify({type, ...now}), headers: {'Content-Type': 'text/plain'}, keepalive: true, credentials: 'omit'})
      .then(response => response.ok ? response.json() : null)
      .then(result => { if (result?.published && link) link.hidden = false; })
      .catch(() => {});
  }

  // After the app has settled the city and language for this load.
  setTimeout(() => { viewSent = true; send('view'); }, 1500);
  window.addEventListener('site-tab-change', event => {
    if (viewSent && event.detail?.tab && event.detail.tab !== lastTab) send('tab');
  });
  window.addEventListener('site-city-change', event => {
    if (viewSent && event.detail?.city && event.detail.city !== lastCity) send('city');
  });
})();
