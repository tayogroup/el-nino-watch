import test from 'node:test';
import assert from 'node:assert/strict';
import {OPEN_METEO, openMeteoUrl, openMeteoPlan} from './somalia-flood-watch/open-meteo.mjs';
import {createForecastRelay} from './somalia-flood-watch/forecast-relay.mjs';

test('without a key the free hosts are used and the query is unchanged', () => {
  assert.equal(openMeteoPlan({}), 'free');
  assert.equal(openMeteoUrl('forecast', 'latitude=2%2C3&longitude=45', {}), 'https://api.open-meteo.com/v1/forecast?latitude=2%2C3&longitude=45');
  assert.equal(openMeteoUrl('flood', '', {}), OPEN_METEO.flood.free);
});

test('with a paid key the customer hosts are used with the key', () => {
  const env = {OPEN_METEO_API_KEY: ' abc/123 '};
  assert.equal(openMeteoPlan(env), 'paid');
  assert.equal(openMeteoUrl('forecast', 'latitude=2', env), 'https://customer-api.open-meteo.com/v1/forecast?latitude=2&apikey=abc%2F123');
  assert.equal(openMeteoUrl('elevation', new URLSearchParams({latitude: '2'}), env), 'https://customer-api.open-meteo.com/v1/elevation?latitude=2&apikey=abc%2F123');
  assert.throws(() => openMeteoUrl('nope', '', env));
});

test('the forecast relay uses the paid host when a key is set and never returns the key', async () => {
  const requested = [];
  const relay = createForecastRelay({cities: [['Mogadishu', 'Banadir', 2.0469, 45.3182]], env: {OPEN_METEO_API_KEY: 'secret-key-1'}, fetchImpl: async url => { requested.push(String(url)); return {ok: false, status: 500}; }});
  let status, body = '';
  const res = {writeHead(code) { status = code; }, end(chunk) { body += chunk ? chunk.toString() : ''; }};
  await relay({method: 'GET'}, res, new URL('http://localhost/api/open-meteo/forecast?latitude=2.0469&longitude=45.3182&daily=precipitation_sum&timezone=Africa%2FMogadishu&forecast_days=14'));
  assert.ok(requested[0]?.startsWith('https://customer-api.open-meteo.com/v1/forecast?'), requested[0]);
  assert.match(requested[0], /apikey=secret-key-1$/);
  assert.equal(status, 502);
  assert.ok(!body.includes('secret-key-1'), 'the key is not in the error sent to the page');
});
