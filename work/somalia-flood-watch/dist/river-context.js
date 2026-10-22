/* River context on the Alerts tab (owner, 2026-10-21): rain upstream in Ethiopia and the GEOGLOWS
   lower Juba river forecast, from /api/river-context (river-context.mjs). Model context, never a warning. */
(function (global) {
  'use strict';
  const doc = global.document, $ = id => doc.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const REFRESH_MS = 30 * 60 * 1000;
  const screen = mm => mm >= 25 ? '<span class="badge elevated">25+ mm</span>' : mm >= 10 ? '<span class="badge watch">10+ mm</span>' : '<span class="badge lower">Under 10 mm</span>';
  const TREND = {rising: 'Rising over the next {0} days', falling: 'Falling over the next {0} days', steady: 'Steady over the next {0} days'};

  function renderUpstream(data) {
    const box = $('upstream-rain'); if (!box) return;
    if (!data?.available) { box.innerHTML = '<p>Upstream rainfall is unavailable right now.</p>'; return; }
    box.innerHTML = `<table class="river-table"><thead><tr><th>Place</th><th>7 days</th><th>Wettest day</th></tr></thead><tbody>${data.points.map(p => `<tr><td><b data-i18n-skip>${esc(p.name)}</b><small><span>${esc(p.river)}</span> · <span>${esc(p.area)}</span></small></td><td>${p.totalMm === null ? '—' : `<span data-i18n-skip>${p.totalMm.toFixed(0)} mm</span>`}</td><td>${p.peakMm === null ? '<span>Unavailable</span>' : `<span data-i18n-skip>${p.peakMm.toFixed(0)} mm</span><br>${screen(p.peakMm)}`}</td></tr>`).join('')}</tbody></table>`;
  }
  function renderJuba(data) {
    const box = $('lower-juba'); if (!box) return;
    const points = data?.points || [];
    if (!points.some(p => p.available)) { box.innerHTML = '<p>The GEOGLOWS forecast is unavailable right now.</p>'; return; }
    box.innerHTML = points.map(p => p.available ? `<div class="juba-point"><b>${esc(p.name)}</b>
      <p>${`About {0} m³/s now`.replace('{0}', p.daily[0].medianM3s.toLocaleString('en'))}</p>
      <p class="juba-trend juba-${esc(p.trend)}">${TREND[p.trend].replace('{0}', p.daily.length)}</p>
      <p>${`Highest: about {0} m³/s on {1}`.replace('{0}', p.peak.medianM3s.toLocaleString('en')).replace('{1}', p.peak.date)}</p>
      ${p.issuedAt ? `<p class="river-small">${'Model run {0}'.replace('{0}', String(p.issuedAt).slice(0, 10))}</p>` : ''}</div>`
      : `<div class="juba-point"><b>${esc(p.name)}</b><p>The GEOGLOWS forecast is unavailable right now.</p></div>`).join('');
  }
  async function load() {
    if (!/^https?:$/.test(global.location?.protocol || '')) { renderUpstream(null); renderJuba(null); return; }
    try {
      const response = await fetch('/api/river-context', {cache: 'no-store'});
      const data = await response.json();
      renderUpstream(data.upstream); renderJuba(data.lowerJuba);
    } catch { renderUpstream(null); renderJuba(null); }
  }
  global.RiverContext = Object.freeze({renderUpstream, renderJuba, load});
  if (doc && $('river-context')) { load(); setInterval(load, REFRESH_MS); }
})(window);
