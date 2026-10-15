import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {activeSeason, effectiveLevel, hydroAlert, loadHydroAlerts, HYDRO_REGIONS} from './somalia-flood-watch/hydro-feed.mjs';

const dist = new URL('./somalia-flood-watch/dist/', import.meta.url);
const cities = JSON.parse(await readFile(new URL('cities.json', dist), 'utf8'));
const run = {folder: '20261015T00', label: '15 Oct 2026 00:00 UTC', season: 'Deyr', publishedAt: '2026-10-15T11:41:00.000Z', startsAt: '2026-10-15T00:00:00Z', endsAt: '2026-10-19T23:59:59.000Z'};
const row = (region_id, level, extra = {}) => ({region_id, season: 'Deyr', run_folder: '20261015T00', run_date_label: '15 Oct 2026 00:00 UTC', best_model: 'ecmwf', frac_d1: 0.0190794, frac_d1_d3: 0.0245684, frac_d2_d5: 0.0247007, level, aa_pre_signal: false, aa_pre_active: false, aa_act_active: false, published_at: '2026-10-15T11:41:00.857278+00:00', ...extra});

test('levels follow the national service: an active anticipatory-action flag raises the level it belongs to', () => {
  assert.equal(effectiveLevel(row('bari', 'advisory', {aa_pre_active: true})), 'watch');
  assert.equal(effectiveLevel(row('bari', 'watch', {aa_act_active: true})), 'warning');
  assert.equal(effectiveLevel(row('bari', 'advisory', {aa_pre_signal: true})), 'advisory', 'a signal that is not active changes nothing');
  assert.equal(effectiveLevel(row('bari', 'clear')), 'clear');
  assert.equal(effectiveLevel(row('bari', 'unexpected')), 'clear');
});

test('the active season is Gu in March to June and Deyr otherwise (East Africa Time)', () => {
  assert.equal(activeSeason(new Date('2026-10-15T12:00:00Z')), 'Deyr');
  assert.equal(activeSeason(new Date('2026-04-10T12:00:00Z')), 'Gu');
  assert.equal(activeSeason(new Date('2026-02-28T22:00:00Z')), 'Gu', '1 March in East Africa Time');
  assert.equal(activeSeason(new Date('2026-01-10T12:00:00Z')), 'Deyr');
});

test('a regional level becomes an alert for the monitored cities in that region', () => {
  const warning = hydroAlert(row('bakool', 'warning', {aa_act_active: true}), run, cities);
  assert.equal(warning.title, 'Bakool region · national flood warning · anticipatory action activated');
  assert.deepEqual(warning.scope.cities, ['Hudur']);
  assert.equal(warning.severity, 'severe'); assert.equal(warning.severityText, 'Warning');
  assert.equal(warning.basis, 'national-hydrological-forecast'); assert.equal(warning.sourceId, 'moewr');
  assert.equal(warning.description, 'Bakool region: national flood warning for the Deyr season. Forecast flooded share of the region: 1.9% tomorrow, 2.5% over days 1–3, 2.5% over days 2–5.');
  assert.equal(hydroAlert(row('mudug', 'watch'), run, cities).title, 'Mudug region · national flood watch');
  assert.deepEqual(hydroAlert(row('mudug', 'watch'), run, cities).scope.cities, ['Galkayo', 'Galdogob']);
  assert.equal(hydroAlert(row('hiraan', 'advisory'), run, cities).severity, 'minor');
  assert.equal(hydroAlert(row('banadir', 'clear'), run, cities), null, 'clear regions are not alerts');
  assert.deepEqual(hydroAlert(row('woqooyi-galbeed', 'watch'), run, cities).scope.cities, ['Hargeisa', 'Berbera'], 'Sahil (Berbera) is part of Woqooyi Galbeed');
  assert.deepEqual(hydroAlert(row('middle-juba', 'watch'), run, cities).scope.cities, [], 'Middle Juba has no monitored city');
  assert.equal(hydroAlert(row('atlantis', 'warning'), run, cities), null, 'unknown regions are ignored');
  assert.equal(Object.keys(HYDRO_REGIONS).length, 18);
  const covered = new Set(Object.values(HYDRO_REGIONS).flatMap(([, regions]) => regions));
  assert.deepEqual(cities.filter(city => !covered.has(city[1])).map(city => city[0]), [], 'every monitored city falls in a national region');
});

test('loading: the public key from the service page, the latest run only, nothing stale', async () => {
  const token = ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({role: 'anon'})).toString('base64url'), 'sig'].join('.');
  const requests = [];
  const rows = [row('bakool', 'warning', {aa_act_active: true}), row('mudug', 'watch'), row('bay', 'clear'), row('mudug', 'warning', {run_folder: '20261014T00', published_at: '2026-10-14T11:00:00Z'})];
  let answer = rows;
  const fetchImpl = async (url, options = {}) => {
    requests.push({url: String(url), headers: options.headers || {}});
    if (String(url) === 'https://hydro.tekhub.so/') return {ok: true, text: async () => '<script type="module" src="/assets/app.X1.js"></script>'};
    if (String(url).endsWith('/assets/app.X1.js')) return {ok: true, text: async () => `const k="${token}";`};
    return {ok: true, status: 200, json: async () => answer};
  };
  const loaded = await loadHydroAlerts({now: new Date('2026-10-15T15:00:00Z'), fetchImpl, cities});
  assert.deepEqual(loaded.alerts.map(alert => alert.title), ['Bakool region · national flood warning · anticipatory action activated', 'Mudug region · national flood watch'], 'the older run is ignored');
  assert.deepEqual(loaded.levels, {warning: 1, watch: 1, advisory: 0, clear: 1});
  const query = requests.find(request => request.url.includes('/rest/v1/'));
  assert.ok(query.url.includes('season=eq.Deyr')); assert.equal(query.headers.apikey, token);
  answer = rows.map(item => ({...item, published_at: '2026-10-10T00:00:00Z'}));
  await assert.rejects(loadHydroAlerts({now: new Date('2026-10-15T15:00:00Z'), fetchImpl, cities}), /more than 3 days old/);
  answer = [];
  await assert.rejects(loadHydroAlerts({now: new Date('2026-10-15T15:00:00Z'), fetchImpl, cities}), /No national hydrological forecast/);
});

test('on the Alerts tab: official badge and level word, region-only alerts kept out of single-city views, official share line', async () => {
  const nodes = Object.fromEntries(['alerts-summary', 'alerts-list', 'alerts-status', 'alerts-scope', 'alerts-type', 'alerts-notify'].map(id => [id, {innerHTML: '', value: ''}]));
  const window = {document: {getElementById: id => nodes[id], addEventListener() {}}, localStorage: {getItem() { return null; }, setItem() {}}};
  const context = vm.createContext({window, Date, URL, URLSearchParams});
  vm.runInContext(await readFile(new URL('share.js', dist), 'utf8'), context);
  vm.runInContext(await readFile(new URL('alerts.js', dist), 'utf8'), context);
  const now = '2026-10-15T15:00:00Z';
  const national = [hydroAlert(row('mudug', 'watch', {aa_pre_active: true}), run, cities), hydroAlert(row('middle-juba', 'warning'), run, cities)];
  const input = {cities, selectedCity: cities.findIndex(city => city[0] === 'Galkayo'), now, scope: 'all', officialFeed: {data: {alerts: national.map(alert => ({...alert})), sources: [{id: 'moewr', available: true, fetchedAt: now}]}, lastSuccess: now, fetchedAt: now}, weatherFeed: null, stationFeed: null};
  const all = window.FloodAlerts.build(input);
  assert.equal(all.alerts.length, 2);
  const mudug = all.alerts.find(alert => alert.title.startsWith('Mudug'));
  assert.equal(mudug.badge, 'Official · National hydrological forecast (MOEWR)');
  assert.equal(mudug.scopeLabel, 'Galkayo, Galdogob · Mudug region');
  assert.equal(all.alerts.find(alert => alert.title.startsWith('Middle Juba')).scopeLabel, 'Middle Juba region');
  assert.equal(window.FloodAlerts.build({...input, scope: 'city'}).alerts.map(alert => alert.title.split(' ')[0]).join(), 'Mudug', 'Middle Juba is not shown as a Somalia-wide notice for Galkayo');
  assert.equal(window.FloodAlerts.build({...input, city: 'Galkayo'}).alerts.length, 1);
  assert.equal(window.FloodAlerts.build({...input, source: 'moewr'}).alerts.length, 2);
  assert.equal(window.FloodAlerts.build({...input, severity: 'high'}).alerts.map(alert => alert.title.split(' ')[0]).join(), 'Middle', 'warning is the top severity level');
  window.FloodAlerts.render(input);
  assert.match(nodes['alerts-list'].innerHTML, /<span class="badge">Watch<\/span>/, 'the card shows the national level word');
  assert.match(nodes['alerts-summary'].innerHTML, /<b>2<\/b> National flood forecasts \(MOEWR\)/);
  const lines = window.FloodAlerts.shareLines(mudug);
  assert.equal(JSON.stringify(lines.at(-1)), JSON.stringify([{t: 'Official national flood forecast (MOEWR).'}]));
  assert.match(nodes['alerts-list'].innerHTML, /data-share-short="\{&quot;t&quot;:&quot;Official forecast \(MOEWR\)\.&quot;\}"/, 'a shortened post still says official');
});

test('national titles, places and descriptions read in Somali', async () => {
  const document = {readyState: 'complete', title: '', body: {nodeType: 11, childNodes: []}, documentElement: {setAttribute() {}}, getElementById: () => null, querySelectorAll: () => []};
  const window = {document, location: {href: 'https://elninowatch.so/?lang=so', protocol: 'https:'}, localStorage: {getItem: () => null, setItem() {}}};
  const context = vm.createContext({window, URL});
  vm.runInContext(await readFile(new URL('translations-so.js', dist), 'utf8'), context);
  vm.runInContext(await readFile(new URL('i18n.js', dist), 'utf8'), context);
  const so = text => window.SiteLanguage.translateText(text);
  assert.equal(so('Bari region · national flood watch · anticipatory action pre-activation'), 'Gobolka Bari · feejignaanta fatahaadda qaranka · diyaargarowga tallaabada hore');
  assert.equal(so('Bakool region · national flood warning'), 'Gobolka Bakool · digniinta fatahaadda qaranka');
  assert.equal(so('Bosaso, Qardho · Bari region'), 'Bosaso, Qardho · Gobolka Bari', 'the place line keeps the city names whole');
  assert.equal(so('Middle Juba region'), 'Gobolka Middle Juba');
  assert.match(so('Bakool region: national flood warning for the Deyr season. Forecast flooded share of the region: 1.9% tomorrow, 2.5% over days 1–3, 2.5% over days 2–5.'), /^Gobolka Bakool: digniinta fatahaadda qaranka ee xilliga Deyr\. .*1\.9% berri/);
  assert.equal(so('Official · National hydrological forecast (MOEWR)'), 'Rasmi · Saadaasha biyaha qaranka (MOEWR)');
});
