import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderLite, liteForecastQuery} from './somalia-flood-watch/lite.mjs';
import {canonicalQuery, createForecastRelay} from './somalia-flood-watch/forecast-relay.mjs';

const cities = JSON.parse(await readFile(new URL('./somalia-flood-watch/dist/cities.json', import.meta.url), 'utf8'));
const dates = Array.from({length: 14}, (_, i) => `2026-10-${String(21 + i > 31 ? 21 + i - 31 : 21 + i).padStart(2, '0')}`);
const forecast = cities.map((_, index) => ({daily: {time: dates, precipitation_sum: Array.from({length: 14}, (_, d) => d === 3 ? index : 1)}}));
forecast[5].daily.precipitation_sum[2] = null;
const stations = {stations: [
  {code: 'SH001', name: 'Belet Weyne', river: 'Shabelle', status: 'Functional', levelM: 6.2, moderateM: 5, highM: 6, bankFullM: 8.5, observedAt: '2026-10-21'},
  {code: 'SH006', name: 'Afgoi', river: 'Shabelle', status: 'Not functional', levelM: null}
]};
const alerts = {available: true, alerts: [
  {sourceId: 'icpac', title: 'Baidoa · ICPAC forecast: heavy rainfall', source: 'ICPAC', severityText: 'Heavy', issuedAt: '2026-10-20T05:00:00Z'},
  {sourceId: 'moewr', title: 'Hiraan region · national flood watch', source: 'MOEWR', severityText: 'Watch', issuedAt: '2026-10-21T11:00:00Z'},
  {sourceId: 'gdacs', title: 'Old event', source: 'GDACS', endsAt: '2026-10-01T00:00:00Z'}
]};
const now = new Date('2026-10-21T12:00:00Z');

test('the light page lists every city wettest first, with gauges and alerts, and no scripts or pictures', () => {
  const html = renderLite({cities, forecast, stations, alerts, now});
  assert.equal((html.match(/<tr><td><a href="\/\?lang=en#city=/g) || []).length, 44);
  const order = [...html.matchAll(/#city=([^"]+)"/g)].map(match => decodeURIComponent(match[1]));
  assert.equal(order[0], cities[43][0], 'the wettest day comes first');
  assert.equal(order.at(-1), cities[5][0], 'a city with a missing day is last and shown as unavailable');
  assert.match(html, /<span class="badge high">25\+ mm<\/span>/);
  assert.match(html, /<span class="badge watch">10\+ mm<\/span>/);
  assert.match(html, /<span class="badge low">Under 10 mm<\/span>/);
  assert.match(html, /<span class="badge">Unavailable<\/span>/);
  assert.ok(html.indexOf('Hiraan region') < html.indexOf('Baidoa'), 'the official MOEWR alert comes first');
  assert.match(html, /<span class="badge official">Official<\/span> <b>Hiraan region/);
  assert.equal((html.match(/badge official/g) || []).length, 1, 'only MOEWR is marked official');
  assert.ok(!html.includes('Old event'), 'ended alerts are left out');
  assert.match(html, /Belet Weyne<br><span class="muted">2026-10-21<\/span><\/td><td>Shabelle<\/td><td class="n">6\.20 m<\/td><td>High<\/td>/);
  assert.ok(!html.includes('Afgoi'), 'gauges without a reading are left out');
  assert.ok(!/<script|<img|<link/i.test(html), 'no scripts, pictures or stylesheets to download');
  assert.ok(Buffer.byteLength(html) < 20000);
});

test('the Somali light page uses the catalogue and keeps source text as written', () => {
  const html = renderLite({cities, forecast, stations, alerts, language: 'so', now});
  assert.match(html, /<html lang="so">/);
  assert.match(html, /Roobka 14-ka maalmood ee soo socda/);
  assert.match(html, /Ka yar 10 mm/);
  assert.match(html, /Hiraan region · national flood watch/, 'alert titles stay as the source wrote them');
  assert.match(html, /<a href="\/lite\?lang=en" lang="en">English<\/a>/);
  for (const english of ['Rain in the next 14 days', 'River gauges', 'Wettest day', 'No active alerts', 'Full site']) assert.ok(!html.includes(english), english);
});

test('missing sources still render a page', () => {
  const html = renderLite({cities, forecast: null, stations: {stations: []}, alerts: {available: false}, now});
  assert.equal((html.match(/<span class="badge">Unavailable<\/span>/g) || []).length, 44);
  assert.match(html, /Alerts are unavailable right now\./);
  assert.match(html, /River gauge readings are unavailable right now\./);
});

test('the light page asks the relay for the same forecast as the main page, so they share one cached copy', async () => {
  assert.doesNotThrow(() => canonicalQuery('forecast', liteForecastQuery(cities), {cities}));
  const app = await readFile(new URL('./somalia-flood-watch/dist/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes('&current=temperature_2m,precipitation&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max&forecast_days=14&timezone=Africa%2FMogadishu'));
  let calls = 0;
  const relay = createForecastRelay({cities, env: {}, fetchImpl: async () => { calls++; return new Response(JSON.stringify(forecast)); }});
  assert.equal((await relay.get('forecast', liteForecastQuery(cities))).length, 44);
  await relay.get('forecast', liteForecastQuery(cities));
  assert.equal(calls, 1, 'the second read is served from the cache');
});
