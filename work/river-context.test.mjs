import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createRiverContext, summariseGeoglows, summariseUpstream, upstreamQuery, UPSTREAM_POINTS, UPSTREAM_RELAY_ROWS, LOWER_JUBA} from './somalia-flood-watch/river-context.mjs';
import {createForecastRelay} from './somalia-flood-watch/forecast-relay.mjs';

const dist = new URL('./somalia-flood-watch/dist/', import.meta.url);
const cities = JSON.parse(await readFile(new URL('cities.json', dist), 'utf8'));
const upstreamBody = UPSTREAM_POINTS.map((_, i) => ({daily: {time: Array.from({length: 7}, (_, d) => `2026-10-2${d + 1}`), precipitation_sum: [1, 2, 3, i * 4, 0, 0, 1]}}));
// GEOGLOWS shape: hourly datetimes with values every 3 hours and blanks between.
function geoglows(start, step) {
  const datetime = [], med = [], p25 = [], p75 = [];
  for (let h = 0; h < 15 * 24; h++) {
    datetime.push(new Date(Date.UTC(2026, 9, 21, h)).toISOString());
    const on = h % 3 === 0, value = start + step * Math.floor(h / 24);
    med.push(on ? value : ''); p25.push(on ? value - 50 : ''); p75.push(on ? value + 50 : '');
  }
  return {datetime, flow_med: med, flow_25p: p25, flow_75p: p75, metadata: {gen_date: '2026-10-21T22:46:57+00:00'}};
}

test('upstream points go through the relay, which accepts them alongside the cities', async () => {
  let calls = 0;
  const relay = createForecastRelay({cities: [...cities, ...UPSTREAM_RELAY_ROWS], env: {}, fetchImpl: async url => { calls++; assert.match(String(url), /latitude=7\.01667%2C6\.46667/); return new Response(JSON.stringify(upstreamBody)); }});
  const rows = summariseUpstream(await relay.get('forecast', upstreamQuery()));
  assert.equal(rows.length, 8);
  assert.equal(rows[0].name, 'Goba'); assert.equal(rows[0].totalMm, 7); assert.equal(rows[7].peakMm, 28); assert.equal(rows[7].peakDay, '2026-10-24');
  await relay.get('forecast', upstreamQuery()); assert.equal(calls, 1, 'cached like the city forecasts');
  assert.deepEqual(UPSTREAM_POINTS.map(p => p.river), ['Shabelle', 'Shabelle', 'Shabelle', 'Shabelle', 'Juba', 'Juba', 'Juba', 'Juba']);
  const broken = structuredClone(upstreamBody); broken[2].daily.precipitation_sum[1] = null;
  assert.equal(summariseUpstream(broken)[2].totalMm, null, 'a missing day is unavailable, never zero');
  assert.throws(() => summariseUpstream(upstreamBody.slice(1)), /every point/);
});

test('GEOGLOWS steps become daily values with a plain trend and no thresholds', () => {
  const rising = summariseGeoglows(geoglows(600, 60));
  assert.equal(rising.daily.length, 15); assert.deepEqual(rising.daily[0], {date: '2026-10-21', medianM3s: 600, lowM3s: 550, highM3s: 650});
  assert.equal(rising.trend, 'rising'); assert.equal(rising.peak.date, '2026-11-04'); assert.equal(rising.issuedAt, '2026-10-21T22:46:57+00:00');
  assert.equal(summariseGeoglows(geoglows(1700, -60)).trend, 'falling');
  assert.equal(summariseGeoglows(geoglows(800, 2)).trend, 'steady');
  // Up to a peak, then down below today's flow: the rise is what matters for planning.
  const wave = geoglows(1400, 0); wave.flow_med = wave.flow_med.map((v, i) => v === '' ? '' : (Math.floor(i / 24) < 5 ? 1400 + 70 * Math.floor(i / 24) : 1700 - 80 * (Math.floor(i / 24) - 5)));
  const crest = summariseGeoglows(wave); assert.equal(crest.trend, 'rising'); assert.equal(crest.peak.date, '2026-10-26'); assert.equal(crest.changePercent, 21);
  assert.ok(!JSON.stringify(rising).match(/threshold|return_period|flood/i));
  assert.throws(() => summariseGeoglows({error: 'zarr'}), /unexpected/);
  assert.deepEqual(LOWER_JUBA.map(p => p.city), ['Jilib', 'Jamaame']);
});

test('a GEOGLOWS outage is shown as unavailable and retried after 10 minutes, a good forecast is kept 3 hours', async () => {
  let time = Date.parse('2026-10-22T00:00:00Z'), ok = false, calls = 0;
  const relay = {get: async () => upstreamBody};
  const load = createRiverContext({relay, now: () => time, fetchImpl: async () => { calls++; return ok ? new Response(JSON.stringify(geoglows(700, 10))) : new Response('{"error":"zarr"}', {status: 400}); }});
  let data = await load();
  assert.equal(data.upstream.available, true);
  assert.equal(data.lowerJuba.points.every(p => !p.available), true); assert.match(data.lowerJuba.points[0].error, /HTTP 400/);
  assert.equal(data.lowerJuba.source, 'GEOGLOWS ECMWF Streamflow Service');
  ok = true; time += 5 * 60 * 1000; await load(); assert.equal(calls, 2, 'not retried within 10 minutes');
  time += 6 * 60 * 1000; data = await load(); assert.equal(calls, 4); assert.equal(data.lowerJuba.points[0].available, true);
  ok = false; time += 2 * 3600 * 1000; data = await load(); assert.equal(calls, 4, 'a good forecast is reused for 3 hours');
  time += 1.5 * 3600 * 1000; data = await load(); assert.equal(calls, 6);
  assert.equal(data.lowerJuba.points[0].available, true, 'a failed refresh keeps the last good forecast');
});

test('the page section renders both parts and says when either is unavailable', async () => {
  const nodes = {'upstream-rain': {innerHTML: ''}, 'lower-juba': {innerHTML: ''}};
  const window = {document: {getElementById: id => nodes[id] || null}, location: {protocol: 'file:'}};
  vm.runInContext(await readFile(new URL('river-context.js', dist), 'utf8'), vm.createContext({window, setInterval() {}}));
  window.RiverContext.renderUpstream({available: true, points: summariseUpstream(upstreamBody)});
  assert.match(nodes['upstream-rain'].innerHTML, /<b data-i18n-skip>Dolo Odo<\/b><small><span>Juba<\/span> · <span>Genale and Dawa meet, at the border<\/span><\/small>/);
  assert.match(nodes['upstream-rain'].innerHTML, /28 mm<\/span><br><span class="badge elevated">25\+ mm<\/span>/);
  window.RiverContext.renderJuba({points: LOWER_JUBA.map(p => ({...p, available: true, ...summariseGeoglows(geoglows(1700, -60))}))});
  assert.match(nodes['lower-juba'].innerHTML, /About 1,700 m³\/s now/);
  assert.match(nodes['lower-juba'].innerHTML, /Falling over the next 15 days/);
  assert.match(nodes['lower-juba'].innerHTML, /Highest: about 1,700 m³\/s on 2026-10-21/);
  window.RiverContext.renderUpstream({available: false}); window.RiverContext.renderJuba({points: [{...LOWER_JUBA[0], available: false}]});
  assert.match(nodes['upstream-rain'].innerHTML, /Upstream rainfall is unavailable right now\./);
  assert.match(nodes['lower-juba'].innerHTML, /The GEOGLOWS forecast is unavailable right now\./);
});
