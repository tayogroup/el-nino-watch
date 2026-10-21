// The light page (/lite, owner 2026-10-21): one server-rendered table-first page for slow connections.
// No map, pictures, fonts or scripts; the same cached forecast, gauge and alert data the main page uses.
// Text comes from the Somali catalogue (translations-so.js), so every English string here must be in
// work/i18n-public.json. Source text (alert titles, place names) stays as the source wrote it.
import {readFileSync} from 'node:fs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
let catalogue = null;
function somali() {
  if (!catalogue) {
    const text = readFileSync(new URL('./dist/translations-so.js', import.meta.url), 'utf8');
    catalogue = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)).messages;
  }
  return catalogue;
}
const SCREEN = [[25, '25+ mm', 'high'], [10, '10+ mm', 'watch'], [0, 'Under 10 mm', 'low']];
const EAT = iso => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t + 3 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ' EAT' : ''; };

// The 14-day forecast query the main page sends (app.js), so both share the relay's cached copy.
export function liteForecastQuery(cities) {
  return `?latitude=${cities.map(c => c[2]).join(',')}&longitude=${cities.map(c => c[3]).join(',')}&current=temperature_2m,precipitation&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max&forecast_days=14&timezone=Africa%2FMogadishu`;
}

export function renderLite({cities, forecast, stations, alerts, language = 'en', now = new Date()}) {
  const so = language === 'so', words = so ? somali() : {};
  const t = text => (so && words[text]) || text;
  const rows = cities.map((city, index) => {
    const days = forecast?.[index]?.daily?.precipitation_sum, dates = forecast?.[index]?.daily?.time;
    const complete = Array.isArray(days) && days.length === 14 && days.every(v => typeof v === 'number');
    const peak = complete ? Math.max(...days) : null;
    return {city, total: complete ? days.reduce((a, b) => a + b, 0) : null, peak, peakDay: complete ? dates?.[days.indexOf(peak)] : null};
  }).sort((a, b) => (b.peak ?? -1) - (a.peak ?? -1));
  const screen = peak => { if (peak === null) return `<span class="badge">${t('Unavailable')}</span>`; const [, label, kind] = SCREEN.find(([min]) => peak >= min); return `<span class="badge ${kind}">${t(label)}</span>`; };
  const active = (alerts?.alerts || []).filter(a => !a.endsAt || Date.parse(a.endsAt) > now.getTime())
    .sort((a, b) => (b.sourceId === 'moewr') - (a.sourceId === 'moewr')).slice(0, 12);
  const gauges = (stations?.stations || []).filter(s => s.status !== 'Not functional' && Number.isFinite(s.levelM));
  const gaugeWord = s => s.levelM >= s.bankFullM ? 'Bank full' : s.levelM >= s.highM ? 'High' : s.levelM >= s.moderateM ? 'Moderate' : 'Below moderate';
  const other = so ? 'en' : 'so';
  return `<!doctype html>
<html lang="${so ? 'so' : 'en'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#082448">
<title>${esc(t('El Nino Watch · Light version'))}</title>
<meta name="description" content="${esc(t('A light page for slow connections: rainfall for the 44 cities, river levels and alerts, with no map or pictures.'))}">
<style>
body{margin:0;font:15px/1.45 system-ui,-apple-system,'Segoe UI',Arial,sans-serif;color:#153653;background:#fff}
header{background:#082448;color:#fff;padding:10px 12px}header a{color:#fff}
main{max-width:860px;margin:0 auto;padding:10px 12px 40px}
h1{font-size:20px;margin:0}h2{font-size:17px;margin:20px 0 6px}
p{margin:6px 0}.muted{color:#586f89;font-size:13px}
table{border-collapse:collapse;width:100%;font-size:14px;overflow-wrap:break-word}th,td{text-align:left;padding:5px 3px;border-bottom:1px solid #dce6f0;vertical-align:top}
th{font-size:12px;color:#586f89}td.n{text-align:right}
.badge{display:inline-block;font-size:12px;font-weight:700;border-radius:4px;padding:0 5px;background:#e9f1fa}
.low{background:#e3f4ea;color:#11734b}.watch{background:#fff3d6;color:#8a5a00}.high{background:#fde3dc;color:#a1301c}.official{background:#082448;color:#fff}
ul{padding-left:18px;margin:6px 0}li{margin:4px 0}
@media (prefers-color-scheme:dark){body{background:#0b1626;color:#dbe7f5}.muted,th{color:#9fb3c9}th,td{border-color:#22344b}.badge{background:#1a2c44}a{color:#8cc3ff}}
</style></head>
<body>
<header><h1>El Nino Watch</h1><p>${esc(t('Light version for slow connections'))} · <a href="/lite?lang=${other}" lang="${other}">${so ? 'English' : 'Soomaali'}</a> · <a href="/?lang=${language}">${esc(t('Full site'))}</a></p></header>
<main>
<p class="muted">${esc(t('Forecasts are computer model estimates, not official warnings. Only MOEWR issues official flood warnings.'))} ${esc(t('Updated'))}: ${esc(EAT(now.toISOString()))}</p>
<h2>${esc(t('Alerts'))}</h2>
${active.length ? `<ul>${active.map(a => `<li>${a.sourceId === 'moewr' ? `<span class="badge official">${esc(t('Official'))}</span> ` : ''}<b>${esc(a.title)}</b><br><span class="muted">${esc(a.source || '')}${a.severityText ? ' · ' + esc(t(a.severityText)) : ''}${a.issuedAt ? ' · ' + esc(EAT(a.issuedAt)) : ''}</span></li>`).join('')}</ul>`
  : `<p>${esc(t(alerts?.available === false ? 'Alerts are unavailable right now.' : 'No active alerts.'))}</p>`}
<h2>${esc(t('Rain in the next 14 days'))}</h2>
<p class="muted">${esc(t('Wettest first. The screen uses the wettest single day: under 10 mm, 10 mm or more, 25 mm or more.'))}</p>
<table><thead><tr><th>${esc(t('City'))}</th><th class="n">${esc(t('14 days'))}</th><th class="n">${esc(t('Wettest day'))}</th></tr></thead><tbody>
${rows.map(r => `<tr><td><a href="/?lang=${language}#city=${encodeURIComponent(r.city[0])}">${esc(r.city[0])}</a><br><span class="muted">${esc(t(r.city[1]))}</span></td><td class="n">${r.total === null ? '—' : r.total.toFixed(0) + ' mm'}</td><td class="n">${r.peak === null ? '' : `${r.peak.toFixed(0)} mm <span class="muted">${esc(r.peakDay || '')}</span><br>`}${screen(r.peak)}</td></tr>`).join('\n')}
</tbody></table>
<h2>${esc(t('River gauges'))}</h2>
${gauges.length ? `<table><thead><tr><th>${esc(t('Gauge'))}</th><th>${esc(t('River'))}</th><th class="n">${esc(t('Level'))}</th><th>${esc(t('Status'))}</th></tr></thead><tbody>
${gauges.map(s => `<tr><td>${esc(s.name)}<br><span class="muted">${esc(s.observedAt || '')}</span></td><td>${esc(t(s.river))}</td><td class="n">${s.levelM.toFixed(2)} m</td><td>${esc(t(gaugeWord(s)))}</td></tr>`).join('\n')}
</tbody></table>` : `<p>${esc(t('River gauge readings are unavailable right now.'))}</p>`}
<p class="muted">${esc(t('Sources: Open-Meteo forecasts, SWALIM river gauges, MOEWR, ICPAC, GDACS and other feeds listed on the Sources page.'))} <a href="/sources?lang=${language}">${esc(t('Sources'))}</a></p>
</main>
</body></html>`;
}
