import fs from 'node:fs/promises';
import { harness, detailedFixture, citiesFixture, assert, BASE } from './verify.mjs';

const detailRequests = h => h.requests.filter(url => url.includes('api.open-meteo.com/v1/forecast') && new URL(url).searchParams.has('hourly'));
const lastRender = h => h.moduleCalls.findLast(call => call.module === 'daily' && call.method === 'render')?.args[0];
const harnessDaily = options => harness({ dailyMock: {}, ...options });
const checks = [];
const test = async (name, fn) => { await fn(); checks.push(name); console.log(`PASS ${name}`); };

await test('Mogadishu opens with a single-city 14-day EAT hourly request and a separate daily feed', async () => {
  const h = harnessDaily(); await h.settle();
  const render = lastRender(h), u = new URL(detailRequests(h)[0]);
  assert.equal(render.city.name, 'Mogadishu');
  assert.equal(render.forecast.latitude, 2.0469);
  assert.equal(render.forecast.hourly.time.length, 336);
  assert.equal(render.date, '2026-10-13');
  assert.equal(render.forecast.utc_offset_seconds, 10800);
  assert.equal(u.searchParams.get('latitude'), '2.0469');
  assert.equal(u.searchParams.get('longitude'), '45.3182');
  assert.equal(u.searchParams.get('forecast_days'), '14');
  assert.equal(u.searchParams.get('timezone'), 'Africa/Mogadishu');
  assert.equal(u.searchParams.get('temperature_unit'), 'celsius');
  assert.equal(u.searchParams.get('wind_speed_unit'), 'kmh');
  assert.equal(u.searchParams.get('precipitation_unit'), 'mm');
  for (const field of ['temperature_2m', 'precipitation', 'precipitation_probability', 'wind_speed_10m', 'wind_direction_10m', 'relative_humidity_2m', 'cloud_cover', 'weather_code']) {
    assert.ok(u.searchParams.get('hourly').split(',').includes(field), `${field} requested`);
  }
  assert.ok(h.requests.some(url => url.includes('api.open-meteo.com/v1/forecast') && !new URL(url).searchParams.has('hourly')), '44-city outlook still requested independently');
  assert.ok(render.loadedAt);
});

await test('city and date controls pass the matching forecast and EAT day to detailed weather', async () => {
  const h = harnessDaily(); await h.settle();
  h.get('daily-city').onchange({ target: { value: '6' } }); await h.settle();
  assert.equal(h.evaluate('selected'), 6);
  let render = lastRender(h);
  assert.equal(render.city.name, 'Beledweyne');
  assert.equal(render.forecast.latitude, 4.7358);
  render.onDay(8); render = lastRender(h);
  assert.equal(render.date, '2026-10-21');
  assert.equal(h.get('day-label').textContent, render.date);
  const hourly = render.forecast.hourly;
  const indices = hourly.time.map((timestamp, i) => timestamp.startsWith(render.date + 'T') ? i : -1).filter(i => i >= 0);
  assert.equal(indices.length, 24);
  assert.equal(hourly.time[indices[0]], '2026-10-21T00:00');
  assert.equal(hourly.temperature_2m[indices[0]], 26.08);
});

await test('an added city uses its own coordinates and hourly forecast without changing the original city order', async () => {
  const h = harnessDaily(); await h.settle();
  assert.equal(citiesFixture.length, 44);
  assert.equal(citiesFixture[6][0], 'Beledweyne');
  h.get('daily-city').onchange({ target: { value: '43' } }); await h.settle();
  const render = lastRender(h), u = new URL(detailRequests(h).at(-1)), city = citiesFixture[43];
  assert.equal(render.city.name, city[0]);
  assert.equal(render.forecast.latitude, city[2]);
  assert.equal(render.forecast.longitude, city[3]);
  assert.equal(Number(u.searchParams.get('latitude')), city[2]);
  assert.equal(Number(u.searchParams.get('longitude')), city[3]);
  assert.equal(render.forecast.hourly.time.length, 336);
  assert.equal(h.evaluate('selected'), 43);
});

await test('null hourly values and unavailable later days remain missing in the selected-city response', async () => {
  const fixture = detailedFixture(0);
  fixture.hourly.precipitation[7] = null;
  fixture.hourly.temperature_2m[7] = null;
  fixture.daily.uv_index_max[13] = null;
  for (const key of Object.keys(fixture.hourly)) fixture.hourly[key] = fixture.hourly[key].slice(0, 7 * 24);
  const h = harnessDaily({ detailed: fixture }); await h.settle();
  let render = lastRender(h);
  assert.ok(!render.error, 'aligned partial hourly coverage is accepted');
  assert.equal(render.forecast.hourly.precipitation[7], null);
  assert.equal(render.forecast.hourly.temperature_2m[7], null);
  render.onDay(13); render = lastRender(h);
  assert.equal(render.date, '2026-10-26');
  assert.equal(render.forecast.daily.uv_index_max[13], null);
  assert.ok(!render.forecast.hourly.time.some(time => time.startsWith(render.date + 'T')), 'day 14 has no synthesized hourly rows');
});

await test('failed detailed refresh retains only that city’s previous data, time and stale label', async () => {
  const h = harnessDaily(); await h.settle();
  const first = lastRender(h), timestamp = first.loadedAt;
  h.setTime(BASE + 16 * 60000); h.setDetailedError(0, 'Detailed source offline');
  await h.evaluate('loadDetailed(0, true)'); await h.settle();
  let render = lastRender(h);
  assert.equal(render.forecast.latitude, first.forecast.latitude);
  assert.equal(render.loadedAt, timestamp);
  assert.equal(render.stale, true);
  assert.match(render.error, /offline/);
  h.evaluate('selectCity(1)'); await h.settle(); render = lastRender(h);
  assert.equal(render.city.name, 'Hargeisa');
  assert.equal(render.forecast.latitude, 9.5624);
  assert.equal(render.stale, false);
  assert.equal(render.error, null);
  h.evaluate('selectCity(0)'); await h.settle(); render = lastRender(h);
  assert.equal(render.city.name, 'Mogadishu');
  assert.equal(render.loadedAt, timestamp);
  assert.match(render.error, /offline/);
});

await test('late responses from another city cannot replace the current city’s detailed panel', async () => {
  const h = harnessDaily(); await h.settle();
  const releaseHargeisa = h.holdDetailed(1), releaseBosaso = h.holdDetailed(2);
  h.evaluate('selectCity(1)'); await h.settle();
  h.evaluate('selectCity(2)'); await h.settle();
  assert.equal(lastRender(h).city.name, 'Bosaso');
  assert.equal(lastRender(h).forecast, null, 'pending Bosaso does not reuse another city’s data');
  releaseBosaso(); await h.settle();
  assert.equal(lastRender(h).forecast.latitude, 11.2842);
  const calls = h.moduleCalls.filter(c => c.module === 'daily' && c.method === 'render').length;
  releaseHargeisa(); await h.settle();
  assert.equal(lastRender(h).city.name, 'Bosaso');
  assert.equal(lastRender(h).forecast.latitude, 11.2842);
  assert.equal(h.moduleCalls.filter(c => c.module === 'daily' && c.method === 'render').length, calls, 'background response does not redraw selected panel');
  assert.equal(h.evaluate('detailedFeeds.get(1).data.latitude'), 9.5624);
});

await test('15-minute, manual and visibility-resume refreshes retrieve the currently selected detailed city', async () => {
  const h = harnessDaily(); await h.settle();
  const timer = h.timers.find(t => t.kind === 'interval' && t.ms === 15 * 60000);
  let before = detailRequests(h).length;
  h.setTime(BASE + 16 * 60000); await timer.fn(); await h.settle();
  assert.equal(detailRequests(h).length, before + 1);
  assert.equal(new URL(detailRequests(h).at(-1)).searchParams.get('latitude'), '2.0469');
  before = detailRequests(h).length;
  await h.get('refresh').onclick(); await h.settle();
  assert.equal(detailRequests(h).length, before + 1, 'manual refresh bypasses 15-minute cache');
  h.get('daily-city').onchange({ target: { value: '7' } }); await h.settle();
  h.setTime(BASE + 32 * 60000); before = detailRequests(h).length;
  await h.documentEvents.get('visibilitychange')(); await h.settle();
  assert.equal(detailRequests(h).length, before + 1);
  assert.equal(new URL(detailRequests(h).at(-1)).searchParams.get('latitude'), '2.7809');
});

await test('returning to a fresh city uses its own cache and overlapping detailed refreshes do not duplicate requests', async () => {
  const h = harnessDaily(); await h.settle();
  h.evaluate('selectCity(1)'); await h.settle();
  const beforeReturn = detailRequests(h).length;
  h.evaluate('selectCity(0)'); await h.settle();
  assert.equal(detailRequests(h).length, beforeReturn, 'fresh Mogadishu result is reused');
  assert.equal(lastRender(h).forecast.latitude, 2.0469);
  const release = h.holdDetailed(0), beforeRefresh = detailRequests(h).length;
  const first = h.evaluate('loadDetailed(0, true)'); await h.settle();
  const second = h.evaluate('loadDetailed(0, true)'); await h.settle();
  assert.equal(detailRequests(h).length, beforeRefresh + 1);
  release(); await Promise.all([first, second]); await h.settle();
  assert.equal(lastRender(h).loading, false);
});

await test('selected hour is an integer from 0 to 23 and changes propagate through the callback', async () => {
  const h = harnessDaily(); await h.settle();
  lastRender(h).onHour(99); assert.equal(lastRender(h).selectedHour, 23);
  lastRender(h).onHour(-9); assert.equal(lastRender(h).selectedHour, 0);
  lastRender(h).onHour(8.8); assert.equal(lastRender(h).selectedHour, 8);
  lastRender(h).onHour('invalid'); assert.equal(lastRender(h).selectedHour, 0);
  lastRender(h).onDay(1); assert.equal(lastRender(h).selectedHour, 12);
  lastRender(h).onDay(0); assert.equal(lastRender(h).selectedHour, 11, 'today starts at the current EAT hour');
});

await test('invalid alignment or timezone cannot replace a successful detailed forecast', async () => {
  const h = harnessDaily(); await h.settle();
  const timestamp = lastRender(h).loadedAt;
  h.setTime(BASE + 16 * 60000);
  const wrongZone = detailedFixture(0); wrongZone.utc_offset_seconds = 0; h.setDetailed(0, wrongZone);
  await h.evaluate('loadDetailed(0, true)'); await h.settle();
  assert.equal(lastRender(h).loadedAt, timestamp);
  assert.match(lastRender(h).error, /time|UTC/i);
  const misaligned = detailedFixture(0); misaligned.hourly.precipitation.pop(); h.setDetailed(0, misaligned);
  await h.evaluate('loadDetailed(0, true)'); await h.settle();
  assert.equal(lastRender(h).loadedAt, timestamp);
  assert.match(lastRender(h).error, /precipitation/);
  assert.equal(lastRender(h).forecast.hourly.time.length, 336);
});

await test('an unavailable initial detailed feed cannot invent hourly conditions or a retrieval timestamp', async () => {
  const h = harnessDaily({ detailedError: 'Network unavailable' }); await h.settle();
  assert.equal(lastRender(h).forecast, null);
  assert.equal(lastRender(h).loadedAt, null);
  assert.match(lastRender(h).error, /unavailable/);
  assert.equal(h.evaluate('feeds.weather.data.length'), 44, 'other live feeds remain independent');
});

await test('midnight moves selected details to the new EAT day and bypasses yesterday’s cache', async () => {
  const h = harnessDaily(); await h.settle();
  h.setTime('2026-10-13T21:01:00Z'); h.evaluate('render()');
  assert.equal(lastRender(h).date, '2026-10-14');
  const before = detailRequests(h).length;
  await h.evaluate('loadDetailed(0)'); await h.settle();
  assert.equal(detailRequests(h).length, before + 1);
  assert.equal(lastRender(h).forecast.daily.time[0], '2026-10-14');
});

await test('daily module UI references exist and its script loads before the integration', async () => {
  const html = await fs.readFile(new URL('./dist/index.html', import.meta.url), 'utf8');
  const js = await fs.readFile(new URL('./dist/daily.js', import.meta.url), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const queried = [...js.matchAll(/(?:\$|document\.getElementById)\(['"]([^'"]+)['"]\)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(queried.filter(id => !ids.has(id)))], []);
  assert.ok(html.indexOf('src="daily.js"') < html.indexOf('src="app.js"'));
});

console.log(`Verified ${checks.length} detailed-weather integration checks.`);

