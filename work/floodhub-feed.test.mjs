import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {floodHubAlert, gaugeLabel, nearestCity, loadFloodHubAlerts, GAUGE_RADIUS_KM} from './somalia-flood-watch/floodhub-feed.mjs';
import {loadOfficialAlerts, ALERT_SOURCES} from './somalia-flood-watch/alerts-feed.mjs';

const dist = new URL('./somalia-flood-watch/dist/', import.meta.url);
const cities = JSON.parse(await readFile(new URL('cities.json', dist), 'utf8'));
const NOW = new Date('2026-10-15T15:00:00Z');
const KEY = 'test-key-not-real';
// Beledweyne is at 4.7358, 45.2036; Luuq at 3.8031, 42.5445.
const status = (gaugeId, severity, extra = {}) => ({gaugeId, qualityVerified: true, gaugeLocation: {latitude: 4.75, longitude: 45.21}, issuedTime: '2026-10-15T06:00:00Z',
  forecastTimeRange: {start: '2026-10-15T00:00:00Z', end: '2026-10-21T00:00:00Z'}, forecastTrend: 'RISE', severity,
  forecastChange: {valueChange: {lowerBound: 0.42, upperBound: 0.91}, referenceTimeRange: {start: '2026-10-14T00:00:00Z', end: '2026-10-15T00:00:00Z'}}, source: 'HYBAS', ...extra});
const beledweyne = {name: 'Beledweyne', region: 'Hiraan', km: 2};

test('a gauge flood status becomes an alert for its city; no flooding and unknown do not', () => {
  const alert = floodHubAlert(status('g1', 'SEVERE'), {siteName: 'Belet Weyne', river: 'Shabelle'}, beledweyne);
  assert.equal(alert.title, 'Beledweyne · Google Flood Hub: river forecast at Danger level', 'Flood Hub\'s word for SEVERE');
  assert.equal(alert.severity, 'severe'); assert.equal(alert.severityText, 'Danger level');
  assert.equal(alert.basis, 'river-forecast'); assert.equal(alert.sourceId, 'floodhub');
  assert.deepEqual(alert.scope.cities, ['Beledweyne']); assert.equal(alert.scope.gauge, 'Belet Weyne gauge (Shabelle)');
  assert.equal(alert.description, 'At the Belet Weyne gauge (Shabelle), Google Flood Hub forecasts the river at its Danger level. The forecast river level is rising. Forecast change from the last known level: +0.4 to +0.9 m. This is an AI model forecast from Google, not an official warning.');
  assert.equal(alert.endsAt, '2026-10-21T00:00:00.000Z');
  assert.equal(alert.sourceUrl, 'https://sites.research.google/floods/l/4.7500/45.2100/12/g/g1', 'the link opens the gauge\'s own page');
  assert.equal(floodHubAlert(status('hybas_1121133480', 'SEVERE', {gaugeLocation: {latitude: 0.44375, longitude: 42.71875}}), null, beledweyne).sourceUrl,
    'https://sites.research.google/floods/l/0.4437/42.7188/12/g/hybas_1121133480', 'a real Somali gauge (Webi Jubba near Jilib), checked in the browser');
  assert.equal(floodHubAlert(status('a/b?c', 'SEVERE'), null, beledweyne).sourceUrl, 'https://sites.research.google/floods/l/4.7500/45.2100/12/g/a%2Fb%3Fc', 'an odd gauge ID cannot change the path');
  assert.equal(floodHubAlert(status('g1', 'SEVERE', {gaugeLocation: {}}), null, beledweyne).sourceUrl, 'https://sites.research.google/floods/', 'no location: Flood Hub itself');
  assert.equal(floodHubAlert(status('g1', 'EXTREME'), null, beledweyne).title, 'Beledweyne · Google Flood Hub: river forecast at Extreme level');
  assert.equal(floodHubAlert(status('g1', 'EXTREME'), null, beledweyne).severityText, 'Extreme level');
  assert.equal(floodHubAlert(status('g1', 'ABOVE_NORMAL'), null, beledweyne).title, 'Beledweyne · Google Flood Hub: river forecast at Warning level', 'Flood Hub\'s word for ABOVE_NORMAL');
  assert.equal(floodHubAlert(status('g1', 'ABOVE_NORMAL'), null, beledweyne).severityText, 'Warning level');
  assert.equal(floodHubAlert(status('g1', 'ABOVE_NORMAL'), null, beledweyne).severity, 'minor');
  assert.equal(floodHubAlert(status('g1', 'ABOVE_NORMAL', {forecastTrend: 'FORECAST_TREND_UNSPECIFIED', forecastChange: undefined}), null, beledweyne).description,
    'At the river gauge, Google Flood Hub forecasts the river at its Warning level. This is an AI model forecast from Google, not an official warning.');
  for (const severity of ['NO_FLOODING', 'UNKNOWN', 'SEVERITY_UNSPECIFIED']) assert.equal(floodHubAlert(status('g1', severity), null, beledweyne), null, severity);
  assert.equal(floodHubAlert(status('g1', 'SEVERE'), null, null), null, 'no city, no alert');
  assert.equal(floodHubAlert(status('g1', 'SEVERE', {issuedTime: 'soon'}), null, beledweyne), null, 'an unreadable date is rejected');
});

test('gauge labels and the nearest city within the radius', () => {
  assert.equal(gaugeLabel({siteName: 'Luuq', river: 'Juba'}), 'Luuq gauge (Juba)');
  assert.equal(gaugeLabel({river: 'Juba'}), 'Juba river gauge');
  assert.equal(gaugeLabel({siteName: '<b>Luuq</b>'}), 'b Luuq /b gauge', 'markup is never carried through');
  assert.equal(gaugeLabel(undefined), 'River gauge');
  assert.equal(nearestCity({latitude: 4.75, longitude: 45.21}, cities).name, 'Beledweyne');
  assert.equal(nearestCity({latitude: 3.81, longitude: 42.55}, cities).name, 'Luuq');
  assert.equal(nearestCity({latitude: 4.7358 + (GAUGE_RADIUS_KM + 3) / 111, longitude: 45.2036}, cities), null, 'beyond the radius');
  assert.equal(nearestCity({}, cities), null);
});

function googleFetch({statuses, pages = 1, gaugesFail = false}) {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    requests.push({href, method: options.method, headers: options.headers || {}, body: options.body ? JSON.parse(options.body) : null});
    if (href.endsWith('floodStatus:searchLatestFloodStatusByArea')) {
      const body = JSON.parse(options.body), page = body.pageToken ? Number(body.pageToken) : 0, size = Math.ceil(statuses.length / pages);
      return {ok: true, status: 200, json: async () => ({floodStatuses: statuses.slice(page * size, (page + 1) * size), ...(page + 1 < pages ? {nextPageToken: String(page + 1)} : {})})};
    }
    if (href.includes('gauges:batchGet')) {
      if (gaugesFail) return {ok: false, status: 500, json: async () => ({})};
      const ids = new URL(href).searchParams.getAll('names').map(name => name.replace('gauges/', ''));
      return {ok: true, status: 200, json: async () => ({gauges: ids.map(gaugeId => ({gaugeId, siteName: `Site ${gaugeId}`, river: 'Shabelle'}))})};
    }
    throw new Error(`unexpected request ${href}`);
  };
  return {fetchImpl, requests};
}

test('loading: the key goes in a header only, every page is read, the worst gauge per city is kept', async () => {
  await assert.rejects(loadFloodHubAlerts({now: NOW, fetchImpl: async () => { throw new Error('no request expected'); }, cities, apiKey: ''}), /GOOGLE_FLOOD_API_KEY is not set/);
  const statuses = [
    status('bw-above', 'ABOVE_NORMAL'), status('bw-severe', 'SEVERE', {gaugeLocation: {latitude: 4.70, longitude: 45.20}}),
    status('luuq', 'EXTREME', {gaugeLocation: {latitude: 3.81, longitude: 42.55}}),
    status('far', 'SEVERE', {gaugeLocation: {latitude: 9.0, longitude: 49.5}}),
    status('old', 'EXTREME', {issuedTime: '2026-10-10T06:00:00Z'}), status('over', 'EXTREME', {forecastTimeRange: {start: '2026-10-10T00:00:00Z', end: '2026-10-15T12:00:00Z'}}),
    status('calm', 'NO_FLOODING'), status('quiet', 'UNKNOWN')
  ];
  const {fetchImpl, requests} = googleFetch({statuses, pages: 3});
  const loaded = await loadFloodHubAlerts({now: NOW, fetchImpl, cities, apiKey: KEY});
  assert.deepEqual(loaded.alerts.map(alert => `${alert.scope.cities[0]}:${alert.googleSeverity}:${alert.gaugeId}`).sort(), ['Beledweyne:SEVERE:bw-severe', 'Luuq:EXTREME:luuq']);
  assert.equal(loaded.alerts.find(alert => alert.gaugeId === 'luuq').scope.gauge, 'Site luuq gauge (Shabelle)');
  assert.deepEqual(loaded.severities, {EXTREME: 3, SEVERE: 2, ABOVE_NORMAL: 1, NO_FLOODING: 1, UNKNOWN: 1});
  assert.equal(loaded.gauges, 8); assert.equal(loaded.rejectedExpired, 2); assert.equal(loaded.awayFromCities, 1);
  assert.equal(loaded.notice, '1 gauges with a flood signal are more than 25 km from a monitored city; see Google Flood Hub for them.');
  const searches = requests.filter(request => request.href.endsWith(':searchLatestFloodStatusByArea'));
  assert.equal(searches.length, 3, 'every page is read');
  assert.deepEqual(searches[0].body, {regionCode: 'SO', pageSize: 5000});
  assert.equal(searches[1].body.pageToken, '1');
  for (const request of requests) {
    assert.equal(request.headers['X-Goog-Api-Key'], KEY);
    assert.ok(!request.href.includes(KEY), 'the key is never in a URL');
    assert.ok(request.href.startsWith('https://floodforecasting.googleapis.com/v1/'));
  }
  const names = new URL(requests.find(request => request.href.includes('gauges:batchGet')).href).searchParams.getAll('names').sort();
  assert.deepEqual(names, ['gauges/bw-above', 'gauges/bw-severe', 'gauges/luuq'], 'names are asked only for gauges near a city');

  const noNames = await loadFloodHubAlerts({now: NOW, fetchImpl: googleFetch({statuses: [status('new-gauge', 'SEVERE')], gaugesFail: true}).fetchImpl, cities, apiKey: KEY});
  assert.equal(noNames.alerts[0].scope.gauge, 'River gauge', 'a failed name lookup still gives the alert');
  const refused = async () => ({ok: false, status: 403, json: async () => ({error: {message: `API key ${KEY} not valid`}})});
  await assert.rejects(loadFloodHubAlerts({now: NOW, fetchImpl: refused, cities, apiKey: KEY}), error => error.message === 'Google Flood Forecasting API returned HTTP 403.');
});

test('switched off without a key: no Google request and no Flood Hub source in the alerts feed', async () => {
  const requested = [];
  const offline = async url => { requested.push(String(url)); throw new Error('offline'); };
  await assert.rejects(loadOfficialAlerts({now: NOW, fetchImpl: offline, cities, floodHubKey: ''}));
  assert.ok(!requested.some(url => url.startsWith(ALERT_SOURCES.floodhubApi)), 'Google is not asked without a key');
  const gdacsOnly = async url => String(url).startsWith(ALERT_SOURCES.gdacs) ? {ok: true, status: 200, text: async () => JSON.stringify({type: 'FeatureCollection', features: []})} : offline(url);
  const off = await loadOfficialAlerts({now: NOW, fetchImpl: gdacsOnly, cities, floodHubKey: ''});
  assert.deepEqual(off.sources.map(item => item.id), ['icpac', 'gdacs', 'moewr'], 'no Flood Hub source, not even a failed one');
  assert.doesNotMatch(off.coverageNote, /Google/);
  const {fetchImpl} = googleFetch({statuses: [status('bw', 'SEVERE')]});
  const loaded = await loadOfficialAlerts({now: NOW, fetchImpl: async (url, options) => String(url).startsWith(ALERT_SOURCES.floodhubApi) ? fetchImpl(url, options) : offline(url), cities, floodHubKey: KEY});
  const source = loaded.sources.find(item => item.id === 'floodhub');
  assert.equal(source.available, true); assert.equal(source.name, 'Google Flood Hub river forecast');
  assert.deepEqual(loaded.alerts.map(alert => alert.title), ['Beledweyne · Google Flood Hub: river forecast at Danger level']);
  assert.match(loaded.coverageNote, /Google Flood Hub river forecasts are AI model forecasts at river gauges near the cities, not official warnings\./);
});

async function alertsWindow() {
  const option = {hidden: true};
  const nodes = Object.fromEntries(['alerts-summary', 'alerts-list', 'alerts-status', 'alerts-scope', 'alerts-type', 'alerts-notify'].map(id => [id, {innerHTML: '', value: ''}]));
  nodes['alerts-source'] = {value: '', querySelector: selector => selector === 'option[value="floodhub"]' ? option : null};
  const window = {document: {getElementById: id => nodes[id], addEventListener() {}}, localStorage: {getItem() { return null; }, setItem() {}}};
  const context = vm.createContext({window, Date, URL, URLSearchParams});
  vm.runInContext(await readFile(new URL('share.js', dist), 'utf8'), context);
  vm.runInContext(await readFile(new URL('alerts.js', dist), 'utf8'), context);
  return {window, nodes, option};
}

test('on the Alerts tab: Flood Hub badge, gauge place line, source filter offered only when switched on, not-official share line', async () => {
  const {window, nodes, option} = await alertsWindow();
  const now = NOW.toISOString();
  const alert = floodHubAlert(status('bw', 'SEVERE'), {siteName: 'Belet Weyne', river: 'Shabelle'}, beledweyne);
  const input = {cities, selectedCity: cities.findIndex(city => city[0] === 'Beledweyne'), now, scope: 'city',
    officialFeed: {data: {alerts: [{...alert}], sources: [{id: 'floodhub', name: 'Google Flood Hub river forecast', available: true, fetchedAt: now}]}, lastSuccess: now, fetchedAt: now}, weatherFeed: null, stationFeed: null};
  const model = window.FloodAlerts.build(input);
  assert.equal(model.alerts.length, 1);
  const card = model.alerts[0];
  assert.equal(card.badge, 'River forecast · Google Flood Hub');
  assert.equal(card.scopeLabel, 'Beledweyne · Belet Weyne gauge (Shabelle)');
  assert.equal(card.severityLabel, 'Danger level'); assert.equal(card.official, false);
  assert.equal(window.FloodAlerts.build({...input, source: 'floodhub'}).alerts.length, 1);
  assert.equal(window.FloodAlerts.build({...input, source: 'moewr'}).alerts.length, 0);
  assert.equal(window.FloodAlerts.build({...input, severity: 'high'}).alerts.length, 1, 'Danger is the top severity level');
  const warning = {...floodHubAlert(status('bw', 'ABOVE_NORMAL'), null, beledweyne)};
  const warningInput = {...input, officialFeed: {...input.officialFeed, data: {...input.officialFeed.data, alerts: [warning]}}};
  assert.equal(window.FloodAlerts.build({...warningInput, severity: 'low'}).alerts.length, 1, 'Flood Hub\'s Warning level is in the Minor group, not with MOEWR\'s national warning');
  assert.equal(window.FloodAlerts.build({...warningInput, severity: 'high'}).alerts.length, 0);
  assert.equal(window.FloodAlerts.build({...input, selectedCity: 0}).alerts.length, 0, 'not shown for another city');
  window.FloodAlerts.render(input);
  assert.equal(option.hidden, false, 'the source option appears once the server has the key');
  assert.match(nodes['alerts-summary'].innerHTML, /<b>1<\/b> River forecasts \(Google Flood Hub\)/);
  assert.match(nodes['alerts-list'].innerHTML, /<span class="badge">Danger level<\/span>/);
  assert.ok(nodes['alerts-list'].innerHTML.includes('<a href="https://sites.research.google/floods/l/4.7500/45.2100/12/g/bw" target="_blank" rel="noopener">Open gauge on Flood Hub ↗</a>'), 'the card links to the gauge page, and says so');
  window.FloodAlerts.render({...input, officialFeed: {...input.officialFeed, data: {...input.officialFeed.data, alerts: [{...alert, sourceUrl: 'https://sites.research.google/floods/'}]}}});
  assert.ok(nodes['alerts-list'].innerHTML.includes('<a href="https://sites.research.google/floods/" target="_blank" rel="noopener">Read source ↗</a>'), 'no gauge page, no gauge label');
  window.FloodAlerts.render(input);
  assert.equal(JSON.stringify(window.FloodAlerts.shareLines(card).at(-1)), JSON.stringify([{t: 'Not an official warning.'}]));
  window.FloodAlerts.render({...input, officialFeed: {...input.officialFeed, data: {alerts: [], sources: [{id: 'icpac', available: true, fetchedAt: now}]}}});
  assert.equal(option.hidden, true, 'hidden while the source is switched off');
  assert.doesNotMatch(nodes['alerts-summary'].innerHTML, /Google Flood Hub/);
});

test('Flood Hub titles, places and descriptions read in Somali', async () => {
  const document = {readyState: 'complete', title: '', body: {nodeType: 11, childNodes: []}, documentElement: {setAttribute() {}}, getElementById: () => null, querySelectorAll: () => []};
  const window = {document, location: {href: 'https://elninowatch.so/?lang=so', protocol: 'https:'}, localStorage: {getItem: () => null, setItem() {}}};
  const context = vm.createContext({window, URL});
  vm.runInContext(await readFile(new URL('translations-so.js', dist), 'utf8'), context);
  vm.runInContext(await readFile(new URL('i18n.js', dist), 'utf8'), context);
  const so = text => window.SiteLanguage.translateText(text);
  assert.equal(so('Beledweyne · Google Flood Hub: river forecast at Danger level'), 'Beledweyne · Google Flood Hub: saadaasha webiga, heerka khatarta');
  assert.equal(so('Hudur · Google Flood Hub: river forecast at Warning level'), 'Hudur · Google Flood Hub: saadaasha webiga, heerka digniinta');
  for (const [en, so_] of [['Extreme level', 'Heerka aad u daran'], ['Danger level', 'Heerka khatarta'], ['Warning level', 'Heerka digniinta'], ['Open gauge on Flood Hub ↗', 'Ka fur xarunta cabbirka webiga Flood Hub ↗']]) assert.equal(so(en), so_);
  assert.equal(so('Luuq · Google Flood Hub: river forecast at Extreme level'), 'Luuq · Google Flood Hub: saadaasha webiga, heerka aad u daran');
  assert.equal(so('Beledweyne · Belet Weyne gauge (Shabelle)'), 'Beledweyne · xarunta cabbirka webiga Belet Weyne (Shabelle)', 'the city name stays whole');
  assert.equal(so('Luuq · Luuq gauge'), 'Luuq · xarunta cabbirka webiga Luuq');
  assert.equal(so('Luuq · Juba river gauge'), 'Luuq · xarunta cabbirka webiga Juba');
  assert.equal(so('Luuq · River gauge'), 'Luuq · xarunta cabbirka webiga');
  assert.equal(so('River forecast · Google Flood Hub'), 'Saadaasha webiga · Google Flood Hub');
  const description = floodHubAlert(status('g1', 'SEVERE'), {siteName: 'Belet Weyne', river: 'Shabelle'}, beledweyne).description;
  assert.equal(so(description), 'Google Flood Hub wuxuu saadaalinayaa in webigu gaaro heerkiisa khatarta ee xarunta cabbirka webiga Belet Weyne (Shabelle). Heerka webiga ee la saadaaliyay wuu kacayaa. Isbeddelka la saadaaliyay marka loo eego heerkii ugu dambeeyay ee la ogaa: +0.4 ilaa +0.9 m. Tani waa saadaal moodeel AI ah oo ka timid Google, ma aha digniin rasmi ah.');
  assert.equal(so(floodHubAlert(status('g1', 'ABOVE_NORMAL', {forecastTrend: 'NO_CHANGE', forecastChange: undefined}), null, beledweyne).description), 'Google Flood Hub wuxuu saadaalinayaa in webigu gaaro heerkiisa digniinta ee xarunta cabbirka webiga. Heerka webiga ee la saadaaliyay wuu degan yahay. Tani waa saadaal moodeel AI ah oo ka timid Google, ma aha digniin rasmi ah.');
  assert.equal(so('Google Flood Hub river forecast: 3 gauges with a flood signal are more than 25 km from a monitored city; see Google Flood Hub for them.'), 'Saadaasha webiga ee Google Flood Hub: 3 cabbir oo leh calaamad fatahaad ayaa in ka badan 25 km u jira magaalo la dabagalo; ka eeg Google Flood Hub.');
});

test('the Alerts tab links to Google Flood Hub over Somalia', async () => {
  const index = await readFile(new URL('index.html', dist), 'utf8');
  const start = index.indexOf('id="alerts-panel"'), panel = index.slice(start, index.indexOf('</section>', start));
  assert.ok(panel.includes('<a href="https://sites.research.google/floods/l/5/48/6" target="_blank" rel="noopener">Google Flood Hub river forecasts ↗</a>'));
});

test('the Sources tab links to Google Flood Hub over Somalia', async () => {
  const index = await readFile(new URL('index.html', dist), 'utf8');
  const start = index.indexOf('id="method-panel"'), panel = index.slice(start, index.indexOf('</section>', start));
  assert.ok(start > 0 && panel.includes('data-site-tab="sources"'), 'the method section is on the Sources tab');
  assert.ok(panel.includes('<a href="https://sites.research.google/floods/l/5/48/6" target="_blank" rel="noopener">River forecasts: Google Flood Hub ↗</a>'));
});

test('the site footer links to Google Flood Hub over Somalia', async () => {
  const index = await readFile(new URL('index.html', dist), 'utf8');
  const start = index.indexOf('<footer class="site-footer'), footer = index.slice(start, index.indexOf('</footer>', start));
  assert.ok(start > 0 && footer.includes('<a href="https://sites.research.google/floods/l/5/48/6" target="_blank" rel="noopener">Google Flood Hub river forecasts ↗</a>'));
});
