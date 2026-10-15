import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const nodes = Object.fromEntries(['alerts-summary', 'alerts-list', 'alerts-status', 'alerts-scope', 'alerts-type', 'alerts-notify'].map(id => [id, { innerHTML: '', textContent: '', value: '', disabled: false }]));
const delivered = []; let permissionRequests = 0;
class Notifications {
  static permission = 'default';
  static async requestPermission() { permissionRequests++; this.permission = 'granted'; return 'granted'; }
  constructor(title, options) { delivered.push({ title, ...options }); }
}
const memory = new Map();
const sandbox = { window: { document: { getElementById(id) { return nodes[id]; } }, Notification: Notifications, localStorage: { getItem(k) { return memory.get(k); }, setItem(k, v) { memory.set(k, v); } } }, Date, URL };
vm.runInNewContext(fs.readFileSync(new URL('./somalia-flood-watch/dist/alerts.js', import.meta.url), 'utf8'), sandbox);
const { build, render } = sandbox.window.FloodAlerts;
const now = '2026-10-13T12:00:00Z', fetchedAt = '2026-10-13T11:55:00Z';
const cities = [['Mogadishu'], ['Galkayo'], ['Beledweyne'], ['Jowhar'], ['Afgooye'], ['Luuq']];
const dates = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
const feed = data => ({ data, lastSuccess: fetchedAt, error: null, stale: false });
const weather = cities.map(() => ({ daily: { time: dates, precipitation_sum: [0, 0, 0, 99] } }));
weather[0].daily.precipitation_sum = [0, 10, 25, 99];
weather[1].daily.precipitation_sum = [30, 0, 0, 0];
const official = { id: 'som1', sourceId:'icpac', title: 'Rainfall advisory', source:'ICPAC', sourceUrl: 'https://www.icpac.net/weekly-forecast/', issuedAt: '2026-10-13T08:00:00Z', startsAt: '2026-10-13T08:00:00Z', endsAt: '2026-10-14T08:00:00Z', severity: 'moderate', status: 'active', scope: { country: 'Somalia', cities: [] }, description: '<script>fake</script>', basis: 'regional-forecast' };
const event = { ...official, id: 'gdacs1', sourceId: 'gdacs', title: 'Model signal', source: 'GDACS / GLOFAS', basis: 'model-event', severity: 'minor' };
const input = { cities, selectedCity: 0, now, weatherFeed: feed(weather), stationFeed: feed({ stations: [] }), officialFeed: feed({ alerts: [official, event], sources: [{ id:'icpac', name:'ICPAC', available: true, fetchedAt }, { id: 'gdacs', name: 'GDACS', available: true, fetchedAt }], coverageNote: 'Coverage is incomplete.' }), scope: 'city', type: 'all' };
let model = build(input);
assert.equal(model.alerts.length, 4);
assert.equal(model.counts.regional, 1);
assert.equal(model.counts.events, 1);
assert.equal(model.counts.screens, 2);
assert.equal(model.forecastDates.join(','), dates.slice(0, 3).join(','));
assert.ok(model.alerts.find(a => a.id === 'som1').scopeLabel.includes('country-level'));
assert.equal(model.alerts.find(a => a.id === 'gdacs1').badge, 'GDACS model-based signal');
assert.equal(model.alerts.filter(a => a.kind === 'screen').some(a => a.cityNames.includes('Galkayo')), false);
assert.equal(build({ ...input, scope: 'all' }).counts.screens, 3);
assert.equal(build({ ...input, type: 'source' }).alerts.length, 2);
assert.equal(build({ ...input, type: 'screen' }).alerts.length, 2);
assert.equal(build({ ...input, officialFeed: { ...input.officialFeed, stale: true } }).counts.regional, 0);
assert.equal(build({ ...input, weatherFeed: { ...input.weatherFeed, error: 'HTTP 503' } }).counts.screens, 0);
assert.ok(build({ ...input, weatherFeed: { ...input.weatherFeed, error: 'HTTP 503' } }).messages.some(m => m.includes('HTTP 503')));
assert.equal(build({ ...input, weatherFeed: { ...input.weatherFeed, lastSuccess: '2026-10-13T09:00:00Z' } }).counts.screens, 0);
assert.equal(build({ ...input, weatherFeed: { ...input.weatherFeed, lastSuccess: '2026-10-14T09:00:00Z' } }).counts.screens, 0);
const altered = a => ({ ...input, officialFeed: feed({ alerts: [a] }) });
assert.equal(build(altered({ ...official, status: 'ended' })).counts.regional, 0);
assert.equal(build(altered({ ...official, endsAt: '2026-10-13T12:00:00Z' })).counts.regional, 0);
assert.equal(build(altered({ ...official, issuedAt: null })).counts.regional, 0);
assert.equal(build(altered({ ...official, issuedAt: '2026-10-14T08:00:00Z' })).counts.regional, 0);
assert.equal(build(altered({ ...official, sourceUrl: 'javascript:alert(1)' })).alerts.find(a => a.id === 'som1').sourceUrl, null);
assert.equal(build(altered({ ...official, scope: { country: 'Somalia', cities: ['Galkayo'] } })).counts.regional, 0);
assert.ok(build(altered({ ...official, scope: { country: 'Somalia', cities: [], areaDescription: 'Benadir / Hiran' } })).alerts.find(a => a.id === 'som1').scopeLabel.includes('source area: Benadir / Hiran'), 'Source area text is shown without turning it into a verified city match');
assert.equal(build({ ...input, officialFeed: feed({ ...input.officialFeed.data, sources: [{ id:'icpac', name:'ICPAC', available: false, fetchedAt, error: 'Source offline' }] }) }).counts.regional, 0);
const station = { code: 'SH001', name: 'Beled Weyne', levelM: 7, moderateM: 6, highM: 7, bankFullM: 8, observedAt: '2026-10-13', sourceUrl: 'https://example.org/station' };
const gaugeInput = { ...input, selectedCity: 2, stationFeed: feed({ stations: [station] }) };
assert.equal(build(gaugeInput).counts.gauges, 1);
assert.equal(build(gaugeInput).alerts.find(a => a.basis === 'observed-gauge').severity, 'high');
assert.equal(build({ ...gaugeInput, stationFeed: feed({ stations: [{ ...station, observedAt: null }] }) }).counts.gauges, 0);
assert.equal(build({ ...gaugeInput, stationFeed: feed({ stations: [{ ...station, observedAt: '2026-10-14' }] }) }).counts.gauges, 0);
assert.equal(build({ ...gaugeInput, stationFeed: feed({ stations: [{ ...station, observedAt: '2026-10-10' }] }) }).counts.gauges, 0);
assert.equal(build({ ...gaugeInput, stationFeed: { ...gaugeInput.stationFeed, error: 'old source' } }).counts.gauges, 0);
assert.equal(build({ ...gaugeInput, stationFeed: feed({ stations: [{ ...station, levelM: 0 }] }) }).counts.gauges, 0);
assert.equal(build({ ...gaugeInput, stationFeed: feed({ stations: [{ ...station, highM: 5 }] }) }).counts.gauges, 0, 'Invalid threshold ordering does not create a stage alert');
assert.ok(build(gaugeInput).alerts.find(a => a.basis === 'observed-gauge').timingLabel.includes('source gives date only'), 'Date-only measurements do not invent an observation time');
const missingWeather = structuredClone(weather); missingWeather[0].daily.precipitation_sum[0] = null;
assert.equal(build({ ...input, weatherFeed: feed(missingWeather) }).weatherCoverage[0].complete, false);
let selectedScope, selectedType;
render({ ...input, onScope(value) { selectedScope = value; }, onType(value) { selectedType = value; } });
assert.ok(nodes['alerts-list'].innerHTML.includes('&lt;script&gt;fake&lt;/script&gt;'));
assert.ok(!nodes['alerts-list'].innerHTML.includes('<script>'));
assert.ok(nodes['alerts-list'].innerHTML.includes('alert-warning'));
assert.ok(nodes['alerts-summary'].innerHTML.includes('including full today'));
assert.equal(permissionRequests, 0, 'Rendering never requests browser permission');
nodes['alerts-scope'].onchange({ target: { value: 'all' } }); assert.equal(selectedScope, 'all');
nodes['alerts-type'].onchange({ target: { value: 'source' } }); assert.equal(selectedType, 'source');
await nodes['alerts-notify'].onclick();
assert.equal(permissionRequests, 1);
assert.equal(delivered.length, 3, 'Initial notification batch is bounded');
render({ ...input, now: '2026-10-13T12:01:00Z', weatherFeed: { ...input.weatherFeed, lastSuccess: '2026-10-13T12:00:00Z' } });
assert.equal(delivered.length, 3, 'A retrieval timestamp change does not trigger duplicate notifications');
const newWeather = structuredClone(weather); newWeather[0].daily.precipitation_sum[1] = 26;
render({ ...input, weatherFeed: feed(newWeather) });
assert.equal(delivered.length, 4, 'A new screening severity can notify once');
render({ ...input, weatherFeed: { ...feed(newWeather), stale: true } });
assert.equal(delivered.length, 4, 'Stale signals do not notify');
render({ ...input, weatherFeed: null, stationFeed: null, officialFeed: null });
assert.ok(nodes['alerts-list'].innerHTML.includes('does not confirm'));
assert.ok(nodes['alerts-status'].innerHTML.includes('unavailable'));
render({ ...input, officialFeed: feed({ alerts: [], sources: [{ id:'icpac', name:'ICPAC', available: true, fetchedAt, publishedAt: '2026-05-11T06:00:00Z', rejectedExpired: 3 }] }) });
assert.ok(nodes['alerts-status'].innerHTML.includes('11/05/2026'));
assert.ok(nodes['alerts-status'].innerHTML.includes('3 expired records excluded'));
assert.ok(nodes['alerts-status'].innerHTML.includes('new API retrieval is not a new warning'));
const noDom = { window: {}, Date, URL };
vm.runInNewContext(fs.readFileSync(new URL('./somalia-flood-watch/dist/alerts.js', import.meta.url), 'utf8'), noDom);
assert.equal(noDom.window.FloodAlerts.build(input).alerts.length, 4, 'Pure build works without a document or browser APIs');
// Severity filter: four levels across the sources' different words; together they cover every alert.
const levelOf = severity => ({ extreme: 'high', severe: 'high', high: 'high', moderate: 'medium', elevated: 'medium', minor: 'low', watch: 'low' })[severity] || 'unknown';
const everyAlert = build(input).alerts;
assert.equal(build(input).severity, 'all');
let coveredBySeverity = 0;
for (const level of ['high', 'medium', 'low', 'unknown']) {
  const shown = build({ ...input, severity: level });
  assert.equal(shown.severity, level);
  assert.ok(shown.alerts.every(a => levelOf(a.severity) === level), `only ${level} alerts`);
  coveredBySeverity += shown.alerts.length;
}
assert.equal(coveredBySeverity, everyAlert.length, 'the four levels together show every alert once');
assert.ok(new Set(everyAlert.map(a => levelOf(a.severity))).size > 1, 'the test alerts span more than one level');
assert.equal(build({ ...input, severity: '__proto__' }).severity, 'all', 'an unknown value shows everything');
assert.equal(build({ ...input, severity: 'high', type: 'screen' }).alerts.every(a => a.kind === 'screen' && levelOf(a.severity) === 'high'), true, 'severity and signal combine');
const severityNode = { value: '', onchange: null }, severityChoices = [];
nodes['alerts-severity'] = severityNode;
render({ ...input, severity: 'medium', onSeverity: value => severityChoices.push(value) });
assert.equal(severityNode.value, 'medium', 'the dropdown shows the active level');
severityNode.onchange({ target: { value: 'high' } });
assert.deepEqual(severityChoices, ['high']);
assert.ok(nodes['alerts-status'].innerHTML.includes('· the selected filters ·'), 'notifications say they follow the filters');
delete nodes['alerts-severity'];

// City filter (All 30 cities coverage): the cities the alerts name; a city keeps its own alerts and Somalia-wide notices.
const allCoverage = build({ ...input, scope: 'all' });
assert.ok(allCoverage.cityOptions.length > 1, 'the test alerts name more than one city');
assert.deepEqual([...allCoverage.cityOptions], [...allCoverage.cityOptions].sort((a, b) => a.localeCompare(b)), 'listed alphabetically');
const firstCity = allCoverage.cityOptions[0], forCity = build({ ...input, scope: 'all', city: firstCity });
assert.equal(forCity.cityFilter, firstCity);
assert.ok(forCity.alerts.length > 0 && forCity.alerts.length < allCoverage.alerts.length, 'choosing a city narrows the list');
assert.ok(forCity.alerts.every(a => !a.cityNames.length || a.cityNames.includes(firstCity)), 'only that city, or Somalia-wide notices');
assert.equal(build({ ...input, scope: 'all', city: firstCity.toUpperCase() }).cityFilter, firstCity, 'matched regardless of case');
assert.equal(build({ ...input, scope: 'all', city: 'Atlantis' }).cityFilter, 'all', 'an unknown city shows everything');
const singleCity = build({ ...input, scope: 'city', city: firstCity });
assert.equal(singleCity.cityOptions.length, 0); assert.equal(singleCity.cityFilter, 'all', 'no City filter in the selected-city coverage');
const citySelectNode = { value: '', innerHTML: '', dataset: {}, onchange: null }, cityFieldNode = { hidden: true }, cityChoices = [];
nodes['alerts-city'] = citySelectNode; nodes['alerts-city-field'] = cityFieldNode;
render({ ...input, scope: 'all', city: firstCity, onCity: value => cityChoices.push(value) });
assert.equal(cityFieldNode.hidden, false);
assert.match(citySelectNode.innerHTML, new RegExp(`^<option value="all">All cities</option><option value="${firstCity}" data-i18n-skip>${firstCity}</option>`));
assert.equal(citySelectNode.value, firstCity);
citySelectNode.onchange({ target: { value: 'all' } }); assert.deepEqual(cityChoices, ['all']);
render({ ...input, scope: 'city' });
assert.equal(cityFieldNode.hidden, true, 'hidden in the selected-city coverage');
delete nodes['alerts-city']; delete nodes['alerts-city-field'];

// Source filter: every alert names one of four sources, and each choice shows only that source.
const sourceKeys = ['icpac', 'gdacs', 'swalim', 'open-meteo'];
assert.ok(everyAlert.every(a => sourceKeys.includes(a.sourceKey)), 'every alert has a known source');
assert.ok(new Set(everyAlert.map(a => a.sourceKey)).size > 1, 'the test alerts come from more than one source');
let coveredBySource = 0;
for (const key of sourceKeys) {
  const shown = build({ ...input, source: key });
  assert.equal(shown.sourceFilter, key);
  assert.ok(shown.alerts.every(a => a.sourceKey === key), `only ${key}`);
  coveredBySource += shown.alerts.length;
}
assert.equal(coveredBySource, everyAlert.length, 'the four sources together show every alert once');
assert.equal(build({ ...input, source: 'constructor' }).sourceFilter, 'all');
assert.ok(build({ ...input, source: 'swalim' }).alerts.every(a => a.source === 'FAO SWALIM river observation'));
const sourceNode = { value: '', onchange: null }, sourceChoices = [];
nodes['alerts-source'] = sourceNode;
render({ ...input, source: 'icpac', onSource: value => sourceChoices.push(value) });
assert.equal(sourceNode.value, 'icpac');
sourceNode.onchange({ target: { value: 'gdacs' } });
assert.deepEqual(sourceChoices, ['gdacs']);
delete nodes['alerts-source'];

// Share rows: with share.js loaded, every alert carries one; source event titles stay as published.
const shareNodes = Object.fromEntries(Object.keys(nodes).map(id => [id, { innerHTML: '', textContent: '', value: '', disabled: false }]));
const shareSandbox = { window: { document: { getElementById: id => shareNodes[id], addEventListener() {} }, Notification: Notifications, localStorage: { getItem() { return null; }, setItem() {} } }, Date, URL, URLSearchParams };
vm.runInNewContext(fs.readFileSync(new URL('./somalia-flood-watch/dist/share.js', import.meta.url), 'utf8'), shareSandbox);
vm.runInNewContext(fs.readFileSync(new URL('./somalia-flood-watch/dist/alerts.js', import.meta.url), 'utf8'), shareSandbox);
shareSandbox.window.FloodAlerts.render(input);
const sharedHtml = shareNodes['alerts-list'].innerHTML, sharedModel = shareSandbox.window.FloodAlerts.build(input);
const decodeShare = value => value.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
const shareLines = [...sharedHtml.matchAll(/data-share-lines="([^"]+)"/g)].map(match => JSON.parse(decodeShare(match[1])));
assert.ok(sharedModel.alerts.length > 0); assert.equal(shareLines.length, sharedModel.alerts.length, 'One share row per alert');
shareLines.forEach((lines, index) => {
  const alert = sharedModel.alerts[index], asPublished = ['model-event', 'event-monitoring'].includes(alert.basis);
  assert.equal(JSON.stringify(lines[0][0]), JSON.stringify(asPublished ? alert.title : { t: alert.title }), 'Source event titles are not translated');
  assert.equal(JSON.stringify(lines.at(-1)), JSON.stringify([{ t: 'Not an official warning.' }]));
});
assert.ok(sharedHtml.includes('data-share-tab="alerts"'));
// Shorter posts: no "retrieved" time, and no place line when the title already begins with the place.
const flatten = lines => lines.map(line => line.map(part => typeof part === 'string' ? part : part.t).join('')).join('\n');
let placeLed = 0;
for (const a of sharedModel.alerts) {
  const lines = shareSandbox.window.FloodAlerts.shareLines(a), text = flatten(lines);
  assert.doesNotMatch(text, /retrieved/, 'no retrieval time in a post');
  assert.ok(text.includes(a.source), 'the source is named');
  if (String(a.title).startsWith(a.scopeLabel + ' ·')) { placeLed++; assert.equal(lines.length, 3, 'the place is not repeated'); }
}
assert.ok(placeLed > 0, 'the test alerts include titles that begin with the place');
const screen = shareSandbox.window.FloodAlerts.shareLines({ title: 'Galdogob · Elevated rainfall', scopeLabel: 'Galdogob', timingLabel: 'Forecast day 2026-10-17 · retrieved 15/10/2026, 12:43:03 EAT', source: 'Open-Meteo weather forecast', basis: 'app-screen' });
assert.equal(flatten(screen), 'Galdogob · Elevated rainfall\nForecast day 2026-10-17 · Open-Meteo weather forecast\nNot an official warning.');
const gauge = shareSandbox.window.FloodAlerts.shareLines({ title: 'Jowhar · river high-risk threshold reached', scopeLabel: 'Jowhar · Jowhar gauge', timingLabel: 'Observed 2026-10-15 (source gives date only) · retrieved 15/10/2026, 12:37:21 EAT', source: 'FAO SWALIM river observation', basis: 'observed-gauge' });
assert.equal(flatten(gauge), 'Jowhar · river high-risk threshold reached\nJowhar · Jowhar gauge\nObserved 2026-10-15 (source gives date only) · FAO SWALIM river observation\nNot an official warning.', 'a place line that adds the gauge name stays');
console.log('alerts.js: source identity, time validity, scope, screening, gauge freshness, escaping, callbacks and notification deduplication passed.');
