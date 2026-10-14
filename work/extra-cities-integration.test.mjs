import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {harness, assert, BASE, DAY, citiesFixture, weatherFixture, riverFixture, days} from './somalia-flood-watch/verify.mjs';

const dist = new URL('./somalia-flood-watch/dist/', import.meta.url);
const [html, extraStoreSource, mayorSource, mayorStoreSource, citiesSource, floodSource, extraUiSource] = await Promise.all(
  ['index.html', 'extra-cities-store.js', 'mayor.js', 'mayor-store.js', 'cities.js', 'flood-outlook.js', 'extra-cities.js'].map(file => fs.readFile(new URL(file, dist), 'utf8'))
);
const plain = value => JSON.parse(JSON.stringify(value));
const floodWindow = {};
vm.runInNewContext(floodSource, {window: floodWindow, URL, Date, Blob});

async function setup(options = {}) {
  const calls = [], initCalls = [], extraCalls = [];
  const hash = options.hash ?? '#view=mayor';
  const location = {href: 'http://localhost/' + hash, protocol: 'http:', hash};
  const CityManager = {init(input) { initCalls.push(input); }, render(input) { calls.push(input); return input; }};
  const ExtraCities = {init(input) { extraCalls.push({method: 'init', input}); }, open() { extraCalls.push({method: 'open'}); }};
  const FloodOutlook = {render() {}};
  const history = {replaceState(_state, _title, hash) { location.hash = String(hash); location.href = 'http://localhost/' + hash; }};
  const h = harness({...options, explorerMock: {}, globals: {location}, windowGlobals: {location, history, CityManager, ExtraCities, FloodOutlook}});
  await h.settle();
  return {h, calls, initCalls, extraCalls, location, latest: () => calls.at(-1), flood: () => calls.at(-1)?.floodOutlook};
}

async function exportedRows(h) {
  await h.evaluate('exportForecast()');
  return (await h.downloads.at(-1).blob.text()).trim().split(/\r?\n/).slice(1);
}

test('the additional-city trigger is shared across both views and the dialog remains outside hidden main panels', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(match => match[1]);
  for (const script of ['cities.js', 'extra-cities-store.js', 'extra-cities.js', 'flood-outlook.js', 'mayor.js']) {
    assert.ok(scripts.includes(script), script + ' is included in the app');
    assert.ok(scripts.indexOf(script) < scripts.indexOf('app.js'), script + ' loads before controller initialization');
  }
  assert.ok(scripts.indexOf('cities.js') < scripts.indexOf('extra-cities-store.js'), 'duplicate checking has the original cities before the store starts');
  assert.ok(scripts.indexOf('extra-cities-store.js') < scripts.indexOf('extra-cities.js'), 'dialog starts after its store');
  assert.equal((html.match(/id="extra-cities-open"/g) || []).length, 1);
  assert.equal((html.match(/id="extra-cities-root"/g) || []).length, 1);
  const trigger = html.indexOf('id="extra-cities-open"');
  assert.ok(trigger < html.indexOf('id="mayor-panel"'), 'the trigger is no longer inside the hidden mayor panel');
  assert.match(html.slice(html.lastIndexOf('<div', trigger), trigger), /mayor-shell/, 'the trigger uses a shared visible toolbar');
  const host = html.indexOf('id="extra-cities-root"');
  assert.ok(host > html.indexOf('</main>'), 'dialog host is not hidden by mayor-only main-panel styling');
  assert.ok(host < html.indexOf('class="mobile-bottom-nav"'), 'dialog host is mounted before the mobile navigation');
});

test('adding an extra city leaves the main 30-city selectors, network batch and 420-row forecast export unchanged', async () => {
  const s = await setup({hash: ''}), h = s.h;
  assert.equal(h.evaluate('dashboardView'), 'public', 'adding a city works from the default all-city overview');
  assert.equal(h.get('mayor-panel').hidden, true);
  assert.equal(s.initCalls[0].cities.length, 30);
  assert.ok(s.extraCalls.some(call => call.method === 'init'), 'extra-city dialog initializes');
  const original = h.snapshot('cities');
  h.evaluate('window.localStorage = localStorage');
  h.evaluate(extraStoreSource);
  h.evaluate("window.ExtraCitiesStore.add({name:'Ceel Buur',region:'Galgaduud'})");
  h.get('extra-cities-close').focus = () => {};
  h.evaluate(extraUiSource);
  h.evaluate('window.ExtraCities.init()');
  h.get('extra-cities-open').events.click();
  assert.equal(h.get('extra-cities-dialog').hidden, false, 'the real static button opens the additional-city dialog');
  assert.match(h.get('extra-cities-list').innerHTML, /Ceel Buur/, 'the added city appears in the dialog list');
  assert.equal(h.evaluate('window.ExtraCitiesStore.list().length'), 1);
  assert.equal(h.evaluate('window.ExtraCitiesStore.list()[0].lat'), null, 'unknown added-city coordinates remain unknown');
  h.evaluate('render()');
  assert.deepEqual(h.snapshot('cities'), original, 'app city array is unchanged after local addition');
  assert.equal(h.evaluate('cities === window.SOMALIA_CITIES'), true);
  assert.equal(h.evaluate('cities.length'), 30);
  assert.equal(h.evaluate('selected'), 0, 'adding a city does not change the main selected city');
  for (const id of ['city', 'daily-city', 'reportcity']) {
    assert.equal((h.get(id).innerHTML.match(/<option\b/g) || []).length, 30);
    assert.ok(!h.get(id).innerHTML.includes('Ceel Buur'), 'extra city is not silently appended to ' + id);
  }
  assert.equal((await exportedRows(h)).length, 420);
  const request = h.requests.find(url => url.includes('api.open-meteo.com/v1/forecast') && !new URL(url).searchParams.has('hourly'));
  assert.deepEqual(new URL(request).searchParams.get('latitude').split(',').map(Number), citiesFixture.map(city => city[2]));
  assert.deepEqual(new URL(request).searchParams.get('longitude').split(',').map(Number), citiesFixture.map(city => city[3]));
  assert.equal(s.calls.length, 0, 'the additional-city dialog does not open or repaint the mayor view');
  assert.equal(s.initCalls[0].cities.length, 30);
});

test('mayor flood outlook aligns rainfall and river discharge by source calendar date rather than response position', async () => {
  const weather = weatherFixture(), river = riverFixture();
  for (let city = 0; city < 30; city++) {
    weather[city].daily.precipitation_sum = days().map((_, day) => city * 10 + day);
    for (const values of Object.values(weather[city].daily)) values.reverse();
    river[city].daily.time = days(BASE - DAY);
    river[city].daily.river_discharge = days(BASE - DAY).map((_, day) => city * 100 + day);
    for (const values of Object.values(river[city].daily)) values.reverse();
  }
  const s = await setup({weather, river, hash: '#view=mayor&city=Galkayo'}), input = s.flood();
  assert.equal(input.cityName, 'Galkayo');
  assert.equal(input.region, 'Mudug');
  assert.deepEqual(plain(input.days), days());
  assert.equal(input.weatherRows.length, 14);
  assert.equal(input.riverRows.length, 14);
  assert.equal(input.weatherRows[0].rain, 100);
  assert.equal(input.weatherRows[13].rain, 113);
  assert.equal(input.riverRows[0].discharge, 1001);
  assert.equal(input.riverRows[12].discharge, 1013);
  assert.equal(input.riverRows[13].discharge, null, 'missing UTC model date is not carried forward');
  const model = floodWindow.FloodOutlook.build(input);
  assert.equal(model.daily[0].discharge, 1001);
  assert.equal(model.daily[13].discharge, null);
  assert.equal(model.weeks[1].peakDischarge, null, 'an incomplete week does not invent a complete river peak');
});

test('null source values and initial source outages remain unknown throughout the 14-day outlook', async () => {
  const weather = weatherFixture(), river = riverFixture();
  weather[0].daily.precipitation_sum[3] = null;
  river[0].daily.river_discharge[8] = null;
  const s = await setup({weather, river});
  assert.equal(s.flood().weatherRows[3].rain, null);
  assert.equal(s.flood().riverRows[8].discharge, null);
  const model = floodWindow.FloodOutlook.build(s.flood());
  assert.equal(model.daily[3].rain, null);
  assert.equal(model.daily[8].discharge, null);
  assert.equal(model.weeks[0].rainTotal, null);
  const outage = await setup({weatherError: 'weather fixture outage', riverError: 'river fixture outage'});
  const unavailable = floodWindow.FloodOutlook.build(outage.flood());
  assert.equal(unavailable.daily.length, 14);
  assert.ok(unavailable.daily.every(row => row.rain === null && row.discharge === null));
  assert.equal(unavailable.weather.available, false);
  assert.equal(unavailable.river.available, false);
  assert.match(unavailable.weather.error, /weather fixture outage/);
  assert.match(unavailable.river.error, /river fixture outage/);
});

test('each source keeps its own successful timestamp and stale status when another source fails', async () => {
  const s = await setup(), h = s.h, first = plain(s.flood());
  h.setTime(BASE + 16 * 60000); h.setErrors('weather fixture failure', null);
  await h.evaluate('load()'); await h.settle();
  let input = s.flood();
  assert.equal(input.weatherFeed.lastSuccess, first.weatherFeed.lastSuccess);
  assert.notEqual(input.riverFeed.lastSuccess, first.riverFeed.lastSuccess);
  assert.equal(input.weatherFeed.stale, true);
  assert.equal(input.riverFeed.stale, false);
  const riverAt = input.riverFeed.lastSuccess;
  h.setTime(BASE + 32 * 60000); h.setErrors(null, 'river fixture failure');
  await h.evaluate('load()'); await h.settle();
  input = s.flood();
  const weatherAt = input.weatherFeed.lastSuccess;
  assert.notEqual(weatherAt, first.weatherFeed.lastSuccess);
  assert.equal(input.riverFeed.lastSuccess, riverAt);
  assert.equal(input.weatherFeed.stale, false);
  assert.equal(input.riverFeed.stale, true);
  h.setTime(BASE + 48 * 60000); h.setErrors('weather fixture failure', 'river fixture failure');
  await h.evaluate('load()'); await h.settle();
  input = s.flood();
  assert.equal(input.weatherFeed.lastSuccess, weatherAt);
  assert.equal(input.riverFeed.lastSuccess, riverAt);
  assert.equal(input.weatherFeed.stale, true);
  assert.equal(input.riverFeed.stale, true);
  const model = floodWindow.FloodOutlook.build(input);
  assert.ok(model.daily.every(row => row.weatherStale && row.riverStale));
  assert.ok(model.daily.every(row => row.rain !== null && row.discharge !== null), 'last-known values are retained with their stale flags');
});

test('city navigation uses the matching city river record and clears a previous city gauge', async () => {
  const river = riverFixture();
  river[6].daily.river_discharge.fill(610);
  river[10].daily.river_discharge.fill(1010);
  const s = await setup({river});
  s.h.evaluate('selectCity(6)'); await s.h.settle();
  assert.equal(s.flood().cityName, 'Beledweyne');
  assert.equal(s.flood().riverRows[0].discharge, 610);
  assert.equal(s.flood().station.code, 'SH001');
  s.h.evaluate('selectCity(10)'); await s.h.settle();
  assert.equal(s.flood().cityName, 'Galkayo');
  assert.equal(s.flood().riverRows[0].discharge, 1010);
  assert.equal(s.flood().station, null, 'Beledweyne gauge is not reused for Galkayo');
  assert.equal(floodWindow.FloodOutlook.build(s.flood()).gauge.matched, false);
});

test('a future selected forecast day preserves the 14-day EAT window and advances safely at EAT midnight', async () => {
  const s = await setup({hash: '#view=mayor&city=Galkayo&day=2026-10-26'});
  assert.equal(s.flood().selectedDate, '2026-10-26');
  assert.deepEqual(plain(s.flood().days), days());
  assert.equal(s.flood().weatherRows[0].date, '2026-10-13');
  assert.equal(s.flood().weatherRows[13].date, '2026-10-26');
  assert.equal(floodWindow.FloodOutlook.build(s.flood()).today, '2026-10-13');
  s.flood().onDay('2026-10-15'); await s.h.settle();
  assert.equal(s.flood().selectedDate, '2026-10-15');
  assert.deepEqual(plain(s.flood().days), days());
  s.h.setTime('2026-10-13T21:01:00Z'); s.h.evaluate('render()');
  const model = floodWindow.FloodOutlook.build(s.flood());
  assert.equal(model.today, '2026-10-14');
  assert.equal(model.dates[0], '2026-10-14');
  assert.equal(model.dates.at(-1), '2026-10-27');
  assert.equal(model.daily.at(-1).rain, null, 'the old source cannot supply tomorrow’s new far-end date');
  assert.equal(model.daily.at(-1).discharge, null);
});

function actionTarget(attributes = {}, value = '') {
  return {id: attributes.id || '', value, textContent: '', getAttribute(name) { return Object.hasOwn(attributes, name) ? attributes[name] : null; }, closest(selector) { return Object.hasOwn(attributes, selector.slice(1, -1)) ? this : null; }};
}

test('the real Mayor UI repaints the flood outlook after action CRUD and report review', () => {
  const values = new Map(), elements = new Map(), handlers = {}, outlookCalls = [];
  let content = '';
  const host = {addEventListener(name, callback) { handlers[name] = callback; }, get innerHTML() { return content; }, set innerHTML(value) {
    content = value;
    for (const match of value.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) elements.set(match[1], {id: match[1], textContent: '', innerHTML: '', focus() { document.activeElement = this; }});
  }};
  elements.set('mayor-root', host);
  const document = {activeElement: null, getElementById: id => elements.get(id) || null};
  const root = {document, crypto: {randomUUID}, localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)}, FloodOutlook: {render(input) { outlookCalls.push(input); const slot = document.getElementById('mayor-flood-outlook'); assert.ok(slot, 'a fresh forecast slot exists on each Mayor render'); slot.innerHTML = 'Rendered 14-day fixture'; }}};
  const context = vm.createContext({window: root, document, console, URL, Date, Blob});
  for (const source of [citiesSource, mayorStoreSource, mayorSource]) vm.runInContext(source, context);
  const timestamp = new Date(BASE).toISOString(), dates = days(), floodOutlook = {cityName: 'Galkayo', days: dates, selectedDate: dates[0], weatherRows: dates.map(date => ({date, rain: 10})), riverRows: dates.map(date => ({date, discharge: 100})), weatherFeed: {data: [{}], lastSuccess: timestamp}, riverFeed: {data: [{}], lastSuccess: timestamp}, now: timestamp};
  const input = {cities: root.SOMALIA_CITIES, selectedCity: 10, selectedDate: dates[0], days: dates, weatherRows: floodOutlook.weatherRows, weatherFeed: floodOutlook.weatherFeed, now: timestamp, floodOutlook, community: {available: true, cityId: 'galkayo', lastSuccess: timestamp, records: [{id: 'local-report', cityId: 'galkayo', category: 'flood', description: 'Field report awaiting verification.', observedAt: timestamp}]}};
  root.CityManager.init({cities: root.SOMALIA_CITIES});
  root.CityManager.render(input);
  const dispatch = (type, target) => handlers[type]({target, preventDefault() {}});
  function repainted(before) {
    assert.ok(outlookCalls.length > before, 'workflow update repaints the complete forecast');
    assert.equal(outlookCalls.at(-1).cityName, 'Galkayo');
    assert.equal(outlookCalls.at(-1).riverRows.length, 14);
    assert.match(document.getElementById('mayor-flood-outlook').innerHTML, /Rendered 14-day fixture/);
  }
  let before = outlookCalls.length;
  dispatch('input', actionTarget({'data-action-field': 'title'}, 'Clear drainage access'));
  dispatch('submit', actionTarget({id: 'mayor-action-form'}));
  repainted(before);
  const action = root.CityManagerStore.list('galkayo')[0];
  assert.equal(action.title, 'Clear drainage access');
  before = outlookCalls.length;
  dispatch('change', actionTarget({'data-action-status': action.id}, 'in-progress'));
  repainted(before);
  before = outlookCalls.length;
  dispatch('click', actionTarget({'data-edit-action': action.id}));
  dispatch('input', actionTarget({'data-action-field': 'title'}, 'Confirm drainage access'));
  dispatch('submit', actionTarget({id: 'mayor-action-form'}));
  repainted(before);
  assert.equal(root.CityManagerStore.list('galkayo')[0].title, 'Confirm drainage access');
  before = outlookCalls.length;
  dispatch('change', actionTarget({'data-review-report': 'local-report'}, 'checking'));
  repainted(before);
  before = outlookCalls.length;
  const remove = actionTarget({'data-delete-action': action.id});
  dispatch('click', remove); dispatch('click', remove);
  repainted(before);
  assert.equal(root.CityManagerStore.list('galkayo').length, 0);
});
