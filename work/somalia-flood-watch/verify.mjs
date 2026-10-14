import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = await fs.readFile(new URL('./dist/app.js', import.meta.url), 'utf8');
const copernicusSource = await fs.readFile(new URL('./dist/copernicus.js', import.meta.url), 'utf8');
const citiesFixture = JSON.parse(await fs.readFile(new URL('./dist/cities.json', import.meta.url), 'utf8'));
const BASE = Date.parse('2026-10-13T08:00:00Z');
const DAY = 86400000;
const days = (now = BASE, count = 14) => Array.from({ length: count }, (_, i) => new Date(now + 3 * 3600000 + i * DAY).toISOString().slice(0, 10));
const weatherFixture = (now = BASE) => citiesFixture.map((city, i) => ({
  latitude: city[2],
  longitude: city[3],
  timezone: 'Africa/Mogadishu', utc_offset_seconds: 10800,
  daily: { time: days(now), precipitation_sum: Array(14).fill(i + 1), precipitation_probability_max: Array(14).fill(40), temperature_2m_max: Array(14).fill(30) }
}));
const riverFixture = (now = BASE) => weatherFixture(now).map(v => ({ ...v, timezone: 'GMT', utc_offset_seconds: 0,
  daily: { time: days(now), river_discharge: Array(14).fill(100) }
}));
const copernicusFixture = (cityId = 'mogadishu', now = BASE) => {
  const city = citiesFixture.find(c => c[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') === cityId) || citiesFixture[0];
  const browser = new URL('https://browser.dataspace.copernicus.eu/');
  browser.searchParams.set('lat', city[2]); browser.searchParams.set('lng', city[3]);
  const item = (id, collectionId, datetime, cloudCoverPercent, platform) => ({id, datetime, cloudCoverPercent, platform,
    metadataUrl:`https://stac.dataspace.copernicus.eu/v1/collections/${collectionId}/items/${id}`, browserUrl:browser.href});
  return {available:true, city:{id:cityId,name:city[0],lat:city[2],lon:city[3]}, fetchedAt:new Date(now).toISOString(),
    queryWindow:{start:new Date(now - 14 * DAY).toISOString(),end:new Date(now).toISOString()},
    missions:{optical:{available:true,collectionId:'sentinel-2-l2a',error:null,scenes:[item('FIXTURE-SENTINEL2','sentinel-2-l2a','2026-10-12T07:00:00Z',15,'Sentinel-2A')]},
      radar:{available:true,collectionId:'sentinel-1-grd',error:null,scenes:[{...item('FIXTURE-SENTINEL1','sentinel-1-grd','2026-10-12T15:08:00Z',null,'Sentinel-1C'),browserSelectionRequired:true,polarizations:['VV','VH'],orbitDirection:'descending'}]}},
    authenticationRequired:false, processing:{available:false,requiresCredentials:true,note:'Fixture catalogue uses public metadata; pixel processing requires server credentials.'},
    coverageNote:'Fixture acquisition metadata does not confirm flooding or city classification coverage.'};
};
const detailedFixture = (city = 0, now = BASE) => {
  const dates = days(now), time = dates.flatMap(date => Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, '0')}:00`));
  const fill = fn => time.map((_, h) => fn(h % 24, Math.floor(h / 24)));
  return {
    latitude: weatherFixture(now)[city].latitude, longitude: weatherFixture(now)[city].longitude,
    timezone: 'Africa/Mogadishu', utc_offset_seconds: 10800,
    current: { time: `${dates[0]}T11:00`, temperature_2m: 24 + city, apparent_temperature: 25 + city, relative_humidity_2m: 65,
      precipitation: .2, weather_code: 3, wind_speed_10m: 12, wind_direction_10m: 90, is_day: 1 },
    current_units: { temperature_2m: '°C', apparent_temperature: '°C', relative_humidity_2m: '%', precipitation: 'mm', wind_speed_10m: 'km/h', wind_direction_10m: '°' },
    daily: { time: dates, weather_code: Array(14).fill(3), temperature_2m_max: Array(14).fill(30 + city), temperature_2m_min: Array(14).fill(20 + city),
      apparent_temperature_max: Array(14).fill(31 + city), apparent_temperature_min: Array(14).fill(21 + city),
      precipitation_sum: Array.from({ length: 14 }, (_, d) => d + 1), precipitation_probability_max: Array(14).fill(70),
      wind_speed_10m_max: Array(14).fill(20), wind_gusts_10m_max: Array(14).fill(32), wind_direction_10m_dominant: Array(14).fill(90),
      sunrise: dates.map(d => `${d}T05:45`), sunset: dates.map(d => `${d}T18:00`), uv_index_max: Array(14).fill(8),
      shortwave_radiation_sum: Array(14).fill(22), daylight_duration: Array(14).fill(44100), sunshine_duration: Array(14).fill(26000) },
    daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_sum: 'mm', precipitation_probability_max: '%', wind_speed_10m_max: 'km/h' },
    hourly: { time, temperature_2m: fill((h, d) => 20 + city + h / 10 + d / 100), apparent_temperature: fill(h => 21 + city + h / 10), dew_point_2m: fill(() => 18),
      relative_humidity_2m: fill(h => 60 + h), precipitation_probability: fill(h => 30 + h), precipitation: fill(h => h / 10), rain: fill(h => h / 10),
      weather_code: fill(() => 3), cloud_cover: fill(() => 45), visibility: fill(() => 15000), wind_speed_10m: fill(h => 10 + h / 10),
      wind_direction_10m: fill(() => 90), wind_gusts_10m: fill(() => 25), pressure_msl: fill(() => 1010), surface_pressure: fill(() => 1005),
      is_day: fill(h => h >= 6 && h < 18 ? 1 : 0), uv_index: fill(h => h >= 6 && h < 18 ? 4 : 0), shortwave_radiation: fill(h => h >= 6 && h < 18 ? 500 : 0) },
    hourly_units: { temperature_2m: '°C', apparent_temperature: '°C', relative_humidity_2m: '%', precipitation_probability: '%', precipitation: 'mm', wind_speed_10m: 'km/h', wind_direction_10m: '°', wind_gusts_10m: 'km/h', visibility: 'm', pressure_msl: 'hPa', cloud_cover: '%' }
  };
};

function harness(options = {}) {
  let now = BASE;
  const elements = new Map(), timers = [], requests = [], downloads = [], blobs = new Map(), moduleCalls = [];
  const documentEvents = new Map(), windowEvents = new Map();
  const storage = new Map();
  let weather = options.weather ?? weatherFixture(), river = options.river ?? riverFixture(), weatherError = options.weatherError ?? null, riverError = options.riverError ?? null;
  let fetchGate = null;
  const detailedFeeds = new Map(), detailedErrors = new Map(), detailedGates = new Map();
  const detailKey = url => weatherFixture().findIndex(w => Number(new URL(url).searchParams.get('latitude')) === w.latitude);
  const getDetailed = city => detailedFeeds.get(city) ?? options.detailed ?? detailedFixture(city, now);
  const makeElement = id => ({ id, value: '', textContent: '', innerHTML: '', disabled: false, checked: false, hidden: false, href: '', style: {}, dataset: {},
    classList: { values: new Set(), add(...names) { names.forEach(name => this.values.add(name)); }, remove(...names) { names.forEach(name => this.values.delete(name)); }, contains(name) { return this.values.has(name); }, toggle(name, force) { const enabled = force === undefined ? !this.values.has(name) : !!force; if (enabled) this.values.add(name); else this.values.delete(name); return enabled; } },
    addEventListener(type, fn) { this.events ??= {}; this.events[type] = fn; },
    setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k] ?? null; }, removeAttribute(k) { delete this[k]; },
    setCustomValidity() {}, reportValidity() {}, querySelectorAll() { return []; },
    appendChild() {}, remove() {}, click() { if (this.download) downloads.push({ name: this.download, blob: blobs.get(this.href) }); this.onclick?.(); },
    closest() { return null; }
  });
  const get = id => { if (!elements.has(id)) elements.set(id, makeElement(id)); return elements.get(id); };
  const navLinks = Array.from({ length: 5 }, (_, i) => makeElement('nav-link-' + i));
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  class FakeURL extends URL { static createObjectURL(blob) { const key = `blob:test/${blobs.size}`; blobs.set(key, blob); return key; } static revokeObjectURL() {} }
  const doc = { hidden: false, visibilityState: 'visible', getElementById: get, createElement: () => makeElement('created'),
    addEventListener: (name, fn) => documentEvents.set(name, fn), querySelectorAll: selector => selector === '#primary-nav a' ? navLinks : [], body: makeElement('body') };
  const sandbox = { console, URL: FakeURL, URLSearchParams, Blob, Date: FakeDate, Intl, Math, JSON, Number, String, Array, Object,
    document: doc, location: { href: 'http://localhost/', protocol: 'http:' }, navigator: { onLine: true },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    AbortSignal: { timeout: () => ({}), any: () => ({}) }, AbortController,
    setTimeout: (fn, ms) => { const t = { fn, ms, kind: 'timeout' }; timers.push(t); return t; }, clearTimeout() {},
    setInterval: (fn, ms) => { const t = { fn, ms, kind: 'interval' }; timers.push(t); return t; }, clearInterval() {},
    fetch: async url => { const u = String(url); requests.push(u); const isWeather = u.includes('api.open-meteo.com/v1/forecast'), isRiver = u.includes('flood-api.open-meteo.com'), isDetailed = isWeather && new URL(u).searchParams.has('hourly');
      let extra;
      if (u === '/api/enso') extra = { available: true, fetchedAt: new FakeDate().toISOString(), issuedAt: '2026-10-08', alertStatus: 'Fixture advisory', synopsis: 'Fixture ENSO climate context', weekly: { date: '2026-10-05', nino34Anomaly: .4 } };
      if (u === '/api/stations') extra = { available: true, fetchedAt: new FakeDate().toISOString(), stations: [{ code: 'SH001', name: 'Beledweyne', river: 'Shabelle', levelM: 4.2, moderateM: 6.5, highM: 7.3, bankFullM: 8.3, observedAt: '2026-10-12', status: 'Daily reading', sourceUrl: 'https://www.faoswalim.org/' }] };
      if (u === '/api/alerts') extra = { available: true, fetchedAt: new FakeDate().toISOString(), alerts: [], sources: [{ id: 'snma', name: 'SNMA fixture warning feed', available: true, fetchedAt: new FakeDate().toISOString(), returnedCount: 0 }] };
      if (u.includes('gdacs.org/')) extra = { features: [{ properties: { eventtype: 'FL', iso3: 'SOM', name: 'Fixture source flood event', fromdate: '2026-10-10', todate: '2026-10-14', datemodified: '2026-10-13T07:00:00Z', alertlevel: 'Green', iscurrent: true, source: 'GDACS', url: { report: 'https://www.gdacs.org/' } } }] };
      if (u.startsWith('/api/copernicus?')) extra = copernicusFixture(new URL(u, 'http://localhost').searchParams.get('city'), now);
      if (!isWeather && !isRiver && !extra) throw new Error(`Unstubbed feed: ${u}`);
      const city = isDetailed ? detailKey(u) : null;
      assert.ok(!isDetailed || city >= 0, 'detailed request uses a known single city latitude');
      const data = structuredClone(isDetailed ? getDetailed(city) : isWeather ? weather : isRiver ? river : extra);
      const error = isDetailed ? detailedErrors.get(city) ?? options.detailedError ?? null : isWeather ? weatherError : isRiver ? riverError : null;
      const detailGate = detailedGates.get(city);
      if (isDetailed && detailGate) await detailGate.promise;
      if (fetchGate && !isDetailed) await fetchGate.promise;
      if (error) throw new Error(error);
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => structuredClone(data), text: async () => JSON.stringify(data) };
    }
  };
  sandbox.window = { SOMALIA_CITIES: structuredClone(citiesFixture), document: doc, addEventListener: (name, fn) => windowEvents.set(name, fn), location: sandbox.location, setTimeout: sandbox.setTimeout, setInterval: sandbox.setInterval };
  if (options.globals) Object.assign(sandbox, options.globals);
  if (options.windowGlobals) { Object.assign(sandbox.window, options.windowGlobals); Object.assign(sandbox, options.windowGlobals); }
  if (options.explorerMock) sandbox.FloodExplorer = sandbox.window.FloodExplorer = new Proxy({}, { get: (_, method) => (...args) => { moduleCalls.push({ module: 'explorer', method, args }); return options.explorerMock[method]?.(...args); } });
  if (options.planningMock) sandbox.FloodPlanning = sandbox.window.FloodPlanning = new Proxy({}, { get: (_, method) => (...args) => { moduleCalls.push({ module: 'planning', method, args }); return options.planningMock[method]?.(...args); } });
  if (options.dailyMock) sandbox.DailyWeather = sandbox.window.DailyWeather = new Proxy({}, { get: (_, method) => (...args) => { moduleCalls.push({ module: 'daily', method, args }); return options.dailyMock[method]?.(...args); } });
  const context = vm.createContext(sandbox);
  const evaluate = code => vm.runInContext(code, context);
  evaluate(copernicusSource);
  evaluate(source);
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
  return { get, elements, navLinks, requests, timers, downloads, doc, documentEvents, windowEvents, moduleCalls, evaluate, settle,
    setTime(value) { now = typeof value === 'number' ? value : Date.parse(value); },
    setFeeds(w, r) { weather = w; river = r; },
    setErrors(w, r) { weatherError = w; riverError = r; },
    setDetailed(city, data) { detailedFeeds.set(city, data); },
    setDetailedError(city, error) { detailedErrors.set(city, error); },
    holdDetailed(city) { let release; const promise = new Promise(resolve => { release = resolve; }); detailedGates.set(city, { promise }); return () => { detailedGates.delete(city); release(); }; },
    holdFetch() { let release; const promise = new Promise(resolve => { release = resolve; }); fetchGate = { promise }; return () => { fetchGate = null; release(); }; },
    snapshot(code) { return JSON.parse(JSON.stringify(evaluate(code))); }
  };
}

export { harness, weatherFixture, riverFixture, copernicusFixture, detailedFixture, citiesFixture, BASE, DAY, days, assert };

async function csv(h) {
  await h.evaluate('exportForecast()');
  assert.ok(h.downloads.length, 'CSV download was created');
  const data = await h.downloads.at(-1).blob.text();
  const rows = data.trim().split(/\r?\n/).map(line => [...line.matchAll(/"((?:""|[^"])*)"/g)].map(m => m[1].replaceAll('""', '"')));
  const [header, ...body] = rows;
  return body.map(row => Object.fromEntries(header.map((key, i) => [key, row[i]])));
}

async function regressionTests() {
  const checks = [];
  const test = async (name, fn) => { await fn(); checks.push(name); console.log(`PASS ${name}`); };
  await test('30 cities and a 14-day EAT forecast export produce 420 unique rows', async () => {
    const h = harness(); await h.settle();
    assert.equal(h.evaluate('cities.length'), 30);
    assert.deepEqual(h.snapshot('expectedDays()'), days());
    assert.equal(h.evaluate('feeds.weather.data.length'), 30);
    assert.equal(h.evaluate('summary(0).total'), 14);
    const rows = await csv(h);
    assert.equal(rows.length, 420);
    assert.equal(new Set(rows.map(row => `${row.city}:${row.date}`)).size, 420);
    assert.ok(rows.every(row => row.weather_fetched_at && row.river_fetched_at));
    assert.equal(rows[0].date, '2026-10-13');
    assert.equal(rows[13].date, '2026-10-26');
    assert.equal(rows.at(-1).city, citiesFixture[29][0]);
    assert.equal(rows.at(-1).rain_mm, '30');
    const outlook = h.requests.find(url => url.includes('api.open-meteo.com/v1/forecast') && !new URL(url).searchParams.has('hourly'));
    assert.deepEqual(new URL(outlook).searchParams.get('latitude').split(',').map(Number), citiesFixture.map(city => city[2]));
    assert.deepEqual(new URL(outlook).searchParams.get('longitude').split(',').map(Number), citiesFixture.map(city => city[3]));
  });
  await test('one failed source retains its previous data and successful source gets its own timestamp', async () => {
    const h = harness(); await h.settle();
    const old = h.snapshot('({weather:feeds.weather.lastSuccess,river:feeds.river.lastSuccess})');
    h.setTime(BASE + 16 * 60000); h.setErrors('network offline', null);
    await h.evaluate('load()'); await h.settle();
    assert.equal(h.evaluate('feeds.weather.data.length'), 30);
    assert.equal(h.snapshot('feeds.weather.lastSuccess'), old.weather);
    assert.notEqual(h.snapshot('feeds.river.lastSuccess'), old.river);
    assert.ok(h.evaluate('feeds.weather.error'));
    const rows = await csv(h);
    assert.notEqual(rows[0].weather_fetched_at, rows[0].river_fetched_at);
    assert.equal(rows[0].weather_stale, 'true');
    assert.equal(rows[0].river_stale, 'false');
    assert.match(h.get('feed-status').innerHTML, /network offline/);
    assert.match(h.get('risk').textContent, /stale/);
  });
  await test('connected evidence renders NOAA, Copernicus and matched SWALIM station provenance', async () => {
    const h = harness(); await h.settle();
    assert.equal(h.get('connection').textContent, '7/8 feeds connected');
    assert.equal(h.get('enso-title').textContent, 'Fixture advisory');
    assert.match(h.get('enso-date').textContent, /2026-10-08/);
    assert.match(h.get('scenes').innerHTML, /FIXTURE-SENTINEL2/);
    assert.match(h.get('scenes').innerHTML, /FIXTURE-SENTINEL1/);
    assert.match(h.get('scenes').innerHTML, /Sentinel-1 radar/);
    assert.match(h.get('scenes').innerHTML, /Sentinel-2 optical/);
    assert.match(h.get('copernicus-status').textContent, /Copernicus public API connected/);
    assert.ok(h.requests.includes('/api/copernicus?city=mogadishu'), 'selected city uses the combined server API');
    assert.match(h.get('events').innerHTML, /Fixture source flood event/);
    h.evaluate('selectCity(6)'); await h.settle();
    assert.match(h.get('station').innerHTML, /Beledweyne/);
    assert.match(h.get('station').innerHTML, /Below moderate-risk threshold/);
    assert.match(h.get('station').innerHTML, /2026-10-12/);
  });
  await test('successful responses become explicitly stale after two hours without new retrieval', async () => {
    const h = harness(); await h.settle();
    h.setTime(BASE + 121 * 60000); h.evaluate('render()');
    assert.equal(h.get('connection').textContent, '0/8 feeds connected');
    assert.match(h.get('feed-status').innerHTML, /Stale \/ last known/);
    assert.match(h.get('risk').textContent, /stale/);
    const rows = await csv(h);
    assert.equal(rows[0].weather_stale, 'true');
    assert.equal(rows[0].river_stale, 'true');
  });
  await test('missing rainfall is unavailable rather than zero and every daily CSV row remains represented', async () => {
    const w = weatherFixture(); w[0].daily.precipitation_sum[6] = null;
    const h = harness({ weather: w }); await h.settle();
    h.evaluate('selectCity(0)'); await h.settle();
    assert.equal(h.evaluate('summary(0).total'), null);
    const rows = await csv(h);
    assert.equal(rows.length, 420);
    assert.equal(rows[6].rain_mm, '');
    assert.ok(!h.get('bars').innerHTML.includes('NaN'));
  });
  await test('weather dates and river dates align by calendar date rather than response position', async () => {
    const w = weatherFixture(), r = riverFixture();
    for (const c of w) { c.daily.precipitation_sum = Array.from({ length: 14 }, (_, i) => i + 1); for (const values of Object.values(c.daily)) values.reverse(); }
    for (const c of r) { c.daily.time = days(BASE - DAY); c.daily.river_discharge = Array.from({ length: 14 }, (_, i) => 100 + i); }
    const h = harness({ weather: w, river: r }); await h.settle();
    const rows = await csv(h);
    assert.equal(rows[0].date, '2026-10-13');
    assert.equal(rows[0].rain_mm, '1');
    const riverColumn = Object.keys(rows[0]).find(k => k.startsWith('river_discharge'));
    assert.equal(rows[0][riverColumn], '101');
    assert.equal(rows[13][riverColumn], '');
  });
  await test('EAT midnight rolls the window and excludes the previous day', async () => {
    const h = harness(); await h.settle();
    h.setTime('2026-10-13T21:01:00Z');
    const expected = h.snapshot('expectedDays()');
    assert.equal(expected[0], '2026-10-14');
    assert.equal(expected[13], '2026-10-27');
    h.evaluate('render()');
    assert.equal(h.evaluate('summary(0).total'), null);
    const rows = await csv(h);
    assert.equal(rows[0].date, '2026-10-14');
    assert.equal(rows[13].date, '2026-10-27');
    assert.equal(rows[13].rain_mm, '');
  });
  await test('automatic refresh runs every 15 minutes and refreshes after returning to the tab', async () => {
    const h = harness(); await h.settle();
    const timer = h.timers.find(t => t.kind === 'interval' && t.ms === 15 * 60000);
    assert.ok(timer, '15-minute refresh interval exists');
    h.setTime(BASE + 16 * 60000); let before = h.requests.length;
    await timer.fn(); await h.settle();
    assert.ok(h.requests.length >= before + 2);
    const resume = h.documentEvents.get('visibilitychange');
    assert.ok(resume, 'visibility resume handler exists');
    h.setTime(BASE + 32 * 60000); before = h.requests.length;
    await resume(); await h.settle();
    assert.ok(h.requests.length >= before + 2);
  });
  await test('invalid multi-city response cannot advance the successful weather timestamp', async () => {
    const h = harness(); await h.settle();
    const old = h.snapshot('feeds.weather.lastSuccess');
    h.setTime(BASE + 16 * 60000); h.setFeeds(weatherFixture().slice(0, 29), riverFixture());
    await h.evaluate('load()'); await h.settle();
    assert.equal(h.snapshot('feeds.weather.lastSuccess'), old);
    assert.ok(h.evaluate('feeds.weather.error'));
  });
  await test('overlapping refresh triggers do not duplicate forecast requests', async () => {
    const h = harness(); await h.settle();
    const before = h.requests.filter(u => u.includes('api.open-meteo.com/v1/forecast') && !new URL(u).searchParams.has('hourly')).length;
    const release = h.holdFetch();
    const first = h.evaluate('load()'); await h.settle();
    const second = h.evaluate('load()'); await h.settle();
    assert.equal(h.requests.filter(u => u.includes('api.open-meteo.com/v1/forecast') && !new URL(u).searchParams.has('hourly')).length, before + 1);
    release(); await Promise.all([first, second]); await h.settle();
  });
  await test('unreachable initial forecast has no invented data or successful fetch timestamp', async () => {
    const h = harness({ weatherError: 'offline', riverError: 'offline' }); await h.settle();
    assert.ok(!h.evaluate('feeds.weather.data?.length'));
    assert.ok(!h.evaluate('feeds.river.data?.length'));
    assert.ok(!h.evaluate('feeds.weather.lastSuccess'));
    assert.equal(h.evaluate('summary(0).total'), null);
  });
  const html = await fs.readFile(new URL('./dist/index.html', import.meta.url), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const queried = [...source.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]);
  await test('all directly referenced JavaScript UI IDs exist in the HTML', async () => assert.deepEqual([...new Set(queried.filter(id => !ids.has(id)))], []));
  console.log(`Verified ${checks.length} behavioral and structural checks.`);
}

if (process.argv[1] && new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href === import.meta.url) {
  await regressionTests();
}
