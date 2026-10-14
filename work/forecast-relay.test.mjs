import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createForecastRelay, canonicalQuery, RELAY_FIELDS} from './somalia-flood-watch/forecast-relay.mjs';
import {createServer} from './somalia-flood-watch/server.mjs';

const dist = new URL('./somalia-flood-watch/dist/', import.meta.url);
const app = await readFile(new URL('app.js', dist), 'utf8');
const shim = await readFile(new URL('forecast-relay.js', dist), 'utf8');
const cities = JSON.parse(await readFile(new URL('cities.json', dist), 'utf8'));
const NOW = Date.parse('2026-10-14T09:00:00Z');
const day = offset => new Date(NOW + offset * 86400000).toISOString().slice(0, 10);
const coords = `latitude=${cities.map(c => c[2]).join(',')}&longitude=${cities.map(c => c[3]).join(',')}`;
const list = name => JSON.parse(app.match(new RegExp(`${name}=(\\[[^\\]]*\\])`))[1].replace(/'/g, '"'));

// The three requests exactly as app.js builds them.
const weatherQuery = '?' + coords + '&current=temperature_2m,precipitation&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max&forecast_days=14&timezone=Africa%2FMogadishu';
const riverQuery = `?${coords}&daily=river_discharge&start_date=${day(0)}&end_date=${day(13)}&timezone=GMT`;
const detailUrl = new URL('https://api.open-meteo.com/v1/forecast');
for (const [key, value] of [['latitude', cities[5][2]], ['longitude', cities[5][3]], ['daily', list('detailDailyFields').join(',')], ['hourly', list('detailHourlyFields').join(',')], ['forecast_days', '14'], ['timezone', 'Africa/Mogadishu'], ['temperature_unit', 'celsius'], ['wind_speed_unit', 'kmh'], ['precipitation_unit', 'mm']]) detailUrl.searchParams.set(key, String(value));

function call(handler, path, method = 'GET') {
  return new Promise(resolve => {
    const res = {writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { resolve({status: this.status, headers: this.headers, body: body ? body.toString() : ''}); }};
    Promise.resolve(handler({method}, res, new URL(path, 'http://127.0.0.1'))).then(handled => { if (!handled) resolve(null); });
  });
}
function upstream({status = 200, body = '[{"daily":{}}]', delay = 0} = {}) {
  const calls = [];
  const fetchImpl = async url => { calls.push(String(url)); if (delay) await new Promise(r => setTimeout(r, delay)); return {ok: status < 400, status, text: async () => body}; };
  return {calls, fetchImpl};
}

test('the relay allows every field app.js asks for, so the two cannot drift apart', () => {
  for (const field of list('detailDailyFields')) assert.ok(RELAY_FIELDS.daily.includes(field), `daily ${field}`);
  for (const field of list('detailHourlyFields')) assert.ok(RELAY_FIELDS.hourly.includes(field), `hourly ${field}`);
  assert.match(app, /api\.open-meteo\.com\/v1\/forecast\?\$\{coords\}&current=temperature_2m,precipitation&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max&forecast_days=14&timezone=Africa%2FMogadishu/);
  assert.match(app, /flood-api\.open-meteo\.com\/v1\/flood\?\$\{coords\}&daily=river_discharge&start_date=\$\{days\[0\]\}&end_date=\$\{days\[13\]\}&timezone=GMT/);
  for (const query of [weatherQuery, riverQuery.replace('?', ''), detailUrl.search]) assert.ok(canonicalQuery(query.includes('river_discharge') ? 'flood' : 'forecast', query, {cities, now: NOW}));
});

test('one upstream call serves every visitor until the copy is 15 minutes old', async () => {
  let now = NOW;
  const up = upstream({delay: 20});
  const relay = createForecastRelay({cities, fetchImpl: up.fetchImpl, now: () => now});
  const [a, b] = await Promise.all([call(relay, '/api/open-meteo/forecast' + weatherQuery), call(relay, '/api/open-meteo/forecast' + weatherQuery)]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(up.calls.length, 1, 'simultaneous visitors share one request');
  assert.ok(up.calls[0].startsWith('https://api.open-meteo.com/v1/forecast?'));
  assert.equal(a.body, '[{"daily":{}}]', 'the body is passed through unchanged');
  assert.equal(a.headers['Cache-Control'], 'no-store');
  assert.equal(a.headers['X-Retrieved-At'], new Date(NOW).toISOString());
  now += 14 * 60 * 1000;
  assert.equal((await call(relay, '/api/open-meteo/forecast' + weatherQuery)).headers['X-Relay-Cache'], 'hit');
  assert.equal(up.calls.length, 1);
  now += 2 * 60 * 1000;
  assert.equal((await call(relay, '/api/open-meteo/forecast' + weatherQuery)).headers['X-Relay-Cache'], 'miss');
  assert.equal(up.calls.length, 2);
  assert.equal((await call(relay, '/api/open-meteo/flood' + riverQuery)).status, 200);
  assert.ok(up.calls[2].startsWith('https://flood-api.open-meteo.com/v1/flood?'));
  assert.equal((await call(relay, '/api/open-meteo/forecast' + detailUrl.search)).status, 200);
  assert.equal(await call(relay, '/api/alerts'), null, 'other routes are not the relay\'s');
});

test('it is not an open proxy: unknown places, fields and values never reach Open-Meteo', async () => {
  const up = upstream();
  const relay = createForecastRelay({cities, fetchImpl: up.fetchImpl, now: () => NOW});
  const bad = [
    '?latitude=0&longitude=0&daily=precipitation_sum',
    `?latitude=${cities[0][2]}&longitude=${cities[0][3]}&daily=soil_moisture_0_to_1cm`,
    `?latitude=${cities[0][2]}&longitude=${cities[0][3]}&daily=precipitation_sum&models=ecmwf_ifs`,
    `?latitude=${cities[0][2]}&longitude=${cities[0][3]}&forecast_days=30`,
    `?latitude=${cities[0][2]}&longitude=${cities[0][3]}&timezone=Europe%2FBerlin`,
    `?latitude=${cities[0][2]},${cities[1][2]}&longitude=${cities[0][3]}`,
    `?latitude=${cities[0][2]}&latitude=${cities[1][2]}&longitude=${cities[0][3]}`
  ];
  for (const query of bad) assert.equal((await call(relay, '/api/open-meteo/forecast' + query)).status, 400, query);
  assert.equal((await call(relay, `/api/open-meteo/flood?${coords}&daily=river_discharge&start_date=2020-01-01&end_date=${day(13)}`)).status, 400);
  assert.equal((await call(relay, '/api/open-meteo/forecast' + weatherQuery, 'POST')).status, 405);
  assert.equal(up.calls.length, 0);
});

test('an upstream refusal is reported, not cached, and never answered with older data', async () => {
  let now = NOW, status = 200;
  const calls = [];
  const relay = createForecastRelay({cities, now: () => now, fetchImpl: async url => { calls.push(url); return {ok: status < 400, status, text: async () => '[{"n":' + calls.length + '}]'}; }});
  assert.equal((await call(relay, '/api/open-meteo/forecast' + weatherQuery)).status, 200);
  now += 16 * 60 * 1000; status = 429;
  const refused = await call(relay, '/api/open-meteo/forecast' + weatherQuery);
  assert.equal(refused.status, 502, 'an expired copy is not served as if fresh');
  assert.match(JSON.parse(refused.body).error, /HTTP 429/);
  status = 200;
  const recovered = await call(relay, '/api/open-meteo/forecast' + weatherQuery);
  assert.equal(recovered.body, '[{"n":3}]');
});

test('the page sends Open-Meteo requests through the relay and falls back to Open-Meteo itself', async () => {
  function load(protocol, respond) {
    const calls = [], window = {location: {protocol}};
    vm.runInNewContext(shim, {window, URL, fetch: async (url, options) => { calls.push(String(url)); return respond(String(url), options); }});
    return {api: window.ForecastRelay, calls};
  }
  const weather = 'https://api.open-meteo.com/v1/forecast' + weatherQuery, river = 'https://flood-api.open-meteo.com/v1/flood' + riverQuery;
  const ok = load('https:', () => ({ok: true, status: 200}));
  assert.equal(ok.api.route(weather), '/api/open-meteo/forecast' + weatherQuery);
  assert.equal(ok.api.route(river), '/api/open-meteo/flood' + riverQuery);
  assert.equal(ok.api.route('https://api.open-meteo.com/v1/elevation?latitude=1&longitude=2'), null);
  assert.equal(ok.api.route('https://geocoding-api.open-meteo.com/v1/search?name=x'), null);
  assert.equal(ok.api.fetch('https://example.org/x'), null, 'other requests are left to the caller');
  await ok.api.fetch(weather, {});
  assert.deepEqual(ok.calls, ['/api/open-meteo/forecast' + weatherQuery]);

  const failing = load('https:', url => url.startsWith('/api/') ? {ok: false, status: 502} : {ok: true, status: 200, direct: true});
  assert.equal((await failing.api.fetch(weather, {})).direct, true);
  assert.deepEqual(failing.calls, ['/api/open-meteo/forecast' + weatherQuery, weather]);

  const offline = load('https:', url => { if (url.startsWith('/api/')) throw new TypeError('Failed to fetch'); return {ok: true, direct: true}; });
  assert.equal((await offline.api.fetch(weather, {})).direct, true);

  const aborted = load('https:', () => { const error = new Error('aborted'); error.name = 'AbortError'; throw error; });
  await assert.rejects(aborted.api.fetch(weather, {}), {name: 'AbortError'});
  assert.equal(aborted.calls.length, 1, 'a cancelled request is not retried');

  assert.equal(load('file:', () => ({})).api.route(weather), null, 'the standalone file has no server to relay through');
  assert.match(app, /r=await\(window\.ForecastRelay\?\.fetch\?\.\(url,options\)\?\?fetch\(url,options\)\)/);
});

test('the real server answers the relay routes', async () => {
  const nativeFetch = globalThis.fetch, seen = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://api.open-meteo.com/')) { seen.push(String(url)); return new Response('[{"ok":1}]', {status: 200}); }
    return nativeFetch(url, options);
  };
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-relay-'));
  const server = createServer({dataDir});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await nativeFetch(base + '/api/open-meteo/forecast' + weatherQuery);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '[{"ok":1}]');
    assert.equal(seen.length, 1);
    assert.equal((await nativeFetch(base + '/api/open-meteo/forecast?latitude=0&longitude=0')).status, 400);
  } finally {
    globalThis.fetch = nativeFetch;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, {recursive: true, force: true});
  }
});
