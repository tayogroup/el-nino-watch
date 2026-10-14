/* El Nino Watch: ICPAC's weekly rainfall forecast layers on the flood map.
   Two toggles: the heavy / very heavy / extremely heavy rainfall areas (above the
   90th, 95th and 99th percentile for that week of the year) and the weekly total.
   Tiles come straight from ICPAC's East Africa Hazards Watch map server; the
   forecast week comes from this site's /api/alerts (alerts-feed.mjs), so the map
   and the Alerts tab always show the same ICPAC week. Loaded after map.js. */
(function () {
  'use strict';
  const WMS = 'https://eahazardswatch.icpac.net/mapserver/';
  const heavy = document.getElementById('layer-icpac-heavy');
  const total = document.getElementById('layer-icpac-total');
  const legend = document.getElementById('icpac-legend');
  if (!heavy || !total || !legend) return;
  const LEVELS = [['Heavy (above 90th percentile)', '#AFEEEE'], ['Very heavy (above 95th percentile)', '#1774CD'], ['Extremely heavy (above 99th percentile)', '#06008B']];
  const TOTALS = [['1', '#D9D9D9'], ['10', '#FFA500'], ['30', '#FEFF00'], ['50', '#CAFF70'], ['100', '#00FF00'], ['200+', '#67CD01']];
  let forecast = null, tileTrouble = false;

  const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const swatch = (color, label) => { const row = node('span', 'icpac-key'); const box = node('i'); box.style.background = color; row.append(box, node('span', '', label)); return row; };

  function render() {
    legend.replaceChildren();
    legend.hidden = !(heavy.checked || total.checked) && forecast !== null;
    if (!forecast) { legend.hidden = false; legend.append(node('p', 'note', 'The ICPAC forecast week is not available yet, so its layers cannot be shown.')); return; }
    const head = node('p', 'icpac-head');
    head.append(node('b', '', 'ICPAC forecast week: ' + forecast.weekLabel));
    legend.append(head);
    if (heavy.checked) {
      const group = node('div', 'icpac-group');
      group.append(node('span', 'icpac-title', 'Rainfall above the usual for this week'));
      for (const [label, color] of LEVELS) group.append(swatch(color, label));
      legend.append(group);
    }
    if (total.checked) {
      const group = node('div', 'icpac-group');
      group.append(node('span', 'icpac-title', 'Weekly rainfall total (mm)'));
      for (const [label, color] of TOTALS) group.append(swatch(color, label));
      legend.append(group);
    }
    if (tileTrouble) legend.append(node('p', 'note', 'Some ICPAC map tiles did not load.'));
    legend.append(node('p', 'note', 'Source: ICPAC East Africa Hazards Watch · regional model forecast, not an official warning.'));
  }

  const params = () => ({time: forecast.time, REGION_STATE: 'IGAD', MASK_NAME: 'ADMIN'});
  const onError = () => { if (!tileTrouble) { tileTrouble = true; render(); } };
  function apply(attempt = 0) {
    if (!forecast) return render();
    const explorer = window.FloodExplorer;
    const ready = explorer?.overlay?.('icpac-total', total.checked ? {url: WMS, layers: 'weekly_total_precipitation', params: params(), opacity: 0.45, attribution: 'ICPAC', onError} : null);
    explorer?.overlay?.('icpac-heavy', heavy.checked ? {url: WMS, layers: 'weekly_heavy_rainfall,weekly_very_heavy_rainfall,weekly_extreme_heavy_rainfall', params: params(), opacity: 0.5, attribution: 'ICPAC', onError} : null);
    // The map is created by app.js; if a toggle is used before that, try again shortly.
    if (ready === false && (heavy.checked || total.checked) && attempt < 20) setTimeout(() => apply(attempt + 1), 500);
    render();
  }

  heavy.disabled = total.disabled = true;
  heavy.addEventListener('change', () => apply());
  total.addEventListener('change', () => apply());
  legend.hidden = true;
  if (!/^https?:$/.test(window.location?.protocol || '')) return;
  fetch('/api/alerts', {cache: 'no-store'})
    .then(response => response.ok ? response.json() : null)
    .then(data => {
      const source = (data?.sources || []).find(item => item.id === 'icpac');
      if (source?.available && /^\d{4}-\d{2}-\d{2}$/.test(source.forecast?.time || '')) {
        forecast = source.forecast;
        heavy.disabled = total.disabled = false;
        apply();
      } else render();
    })
    .catch(() => render());
})();
