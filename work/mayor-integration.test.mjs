import fs from 'node:fs';
import vm from 'node:vm';
import { harness, assert, BASE, citiesFixture, days } from './somalia-flood-watch/verify.mjs';

const alertsWindow = {};
vm.runInNewContext(fs.readFileSync(new URL('./somalia-flood-watch/dist/alerts.js', import.meta.url), 'utf8'), { window: alertsWindow });
const clone = value => JSON.parse(JSON.stringify(value));
const slug = city => city[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const report = (id, cityId, extra = {}) => ({ id, cityId, category: 'flood', description: 'Fixture field observation awaiting verification.', observedAt: '2026-10-13T07:00:00Z', receivedAt: '2026-10-13T07:05:00Z', deaths: null, injuries: null, damagedProperties: null, ...extra });
const response = data => ({ ok: true, status: 200, json: async () => clone(data), text: async () => JSON.stringify(data) });
const checks = [];
async function test(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }

async function setup(hash = '') {
  const location = { href: 'http://localhost/' + hash, protocol: 'http:', hash };
  let init, communityInit, originalFetch;
  const renderCalls = [], alertInputs = [], queueRequests = [], behavior = new Map();
  const routeHistory = [];
  const managerFetchRouter = async url => {
    const value = String(url);
    if (!value.startsWith('/api/community/reports')) return originalFetch(url);
    const parsed = new URL(value, 'http://localhost');
    const cityId = parsed.searchParams.get('city');
    queueRequests.push({ url: value, cityId });
    assert.ok(cityId, 'the operational queue always requests one explicit city');
    const action = behavior.get(cityId);
    if (typeof action === 'function') return action(value);
    return response(action || { reports: [], cityId, total: 0, truncated: false, fetchedAt: new Date(BASE).toISOString() });
  };
  const CityManager = { init: options => { init = options; }, render: input => { renderCalls.push(input); return input; } };
  const FloodAlerts = { render() {}, build: input => { alertInputs.push(input); return alertsWindow.FloodAlerts.build(input); } };
  const CommunityReports = { init: options => { communityInit = options; }, refresh: async () => {}, selectCity() {} };
  const history = { replaceState(_state, _title, hashValue) { location.hash = String(hashValue); location.href = 'http://localhost/' + hashValue; routeHistory.push(location.hash); } };
  const h = harness({ explorerMock: {}, globals: { location }, windowGlobals: { location, history, CityManager, FloodAlerts, CommunityReports, managerFetchRouter } });
  originalFetch = h.evaluate('fetch');
  h.evaluate('fetch = window.managerFetchRouter');
  await h.settle();
  // The shared harness starts the controller before this city-report router is
  // installed. Replace that initial unstubbed attempt with a real city fixture.
  if (h.evaluate("dashboardView === 'mayor'")) {
    await h.evaluate('loadManagerReports(selected, true)'); await h.settle();
  }
  h.get('map-panel').parentElement = h.get('manager-map-workspace');
  return { h, location, renderCalls, alertInputs, queueRequests, behavior, routeHistory,
    get init() { return init; }, get communityInit() { return communityInit; },
    latest() { return renderCalls.at(-1); },
    async mayor() { h.evaluate("setDashboardView('mayor')"); await h.settle(); await h.evaluate('loadManagerReports(selected, true)'); await h.settle(); },
    queue(cityId, reports, extra = {}) { behavior.set(cityId, { reports, cityId, total: reports.length, truncated: false, fetchedAt: new Date(BASE).toISOString(), ...extra }); }
  };
}

await test('bare home defaults to the original 30-city overview with all-city coverage and map extent', async () => {
  const s = await setup();
  assert.equal(s.h.evaluate('dashboardView'), 'public');
  assert.equal(s.h.evaluate('managerTool'), '');
  assert.equal(s.h.evaluate('selected'), 0);
  assert.equal(s.queueRequests.length, 0, 'the overview does not load a mayor triage queue');
  assert.equal(s.renderCalls.length, 0, 'the overview does not render a hidden mayor briefing');
  assert.equal(s.h.get('mayor-panel').hidden, true);
  assert.equal(s.h.get('manager-tool-bar').hidden, true);
  assert.equal(s.h.doc.body.classList.contains('mayor-view'), false);
  assert.equal(s.h.evaluate('alertScope'), 'all');
  assert.equal((s.h.get('rows').innerHTML.match(/<tr\b/g) || []).length, 15);
  assert.equal((s.h.get('rows-secondary').innerHTML.match(/<tr\b/g) || []).length, 15);
  for (const id of ['city', 'daily-city', 'reportcity']) {
    assert.equal((s.h.get(id).innerHTML.match(/<option\b/g) || []).length, 30);
  }
  assert.ok(s.h.moduleCalls.some(call => call.module === 'explorer' && call.method === 'overview'), 'bare home fits all 30 city locations');
  assert.ok(!s.h.moduleCalls.some(call => call.module === 'explorer' && call.method === 'focus'), 'bare home does not immediately zoom into Mogadishu');
  assert.equal(s.init.cities.length, 30);
  assert.equal(typeof s.init.onSelectCity, 'function');
  assert.equal(typeof s.init.onDay, 'function');
  assert.equal(typeof s.init.onOpenSection, 'function');
});

await test('an explicit mayor link opens the Mogadishu briefing and its city report queue', async () => {
  const s = await setup('#view=mayor');
  assert.equal(s.h.evaluate('dashboardView'), 'mayor');
  assert.equal(s.h.evaluate('selected'), 0);
  assert.equal(s.h.get('mayor-panel').hidden, false);
  assert.equal(s.h.doc.body.classList.contains('mayor-view'), true);
  assert.equal(s.latest().community.cityId, 'mogadishu');
  assert.ok(s.queueRequests.some(request => request.cityId === 'mogadishu'));
});

await test('mayor deep link selects Galkayo and city/day navigation preserves the mayor route', async () => {
  const s = await setup('#view=mayor&city=Galkayo');
  await s.h.evaluate('loadManagerReports(selected, true)'); await s.h.settle();
  assert.equal(s.h.evaluate('selected'), 10);
  assert.equal(s.h.evaluate('dashboardView'), 'mayor');
  assert.equal(s.latest().selectedCity, 10);
  assert.ok(s.queueRequests.some(request => request.cityId === 'galkayo'));
  s.init.onSelectCity(7); await s.h.settle();
  s.init.onDay('2026-10-26'); await s.h.settle();
  const p = new URLSearchParams(s.location.hash.slice(1));
  assert.equal(p.get('view'), 'mayor');
  assert.equal(p.get('city'), 'Jowhar');
  assert.equal(p.get('day'), '2026-10-26');
  assert.equal(s.latest().selectedDate, '2026-10-26');
  assert.equal(s.latest().weatherRows[0].date, '2026-10-13', 'operational weather still begins at today');
  assert.deepEqual(clone(s.latest().alertModel.forecastDates), days().slice(0, 3), 'the alert window remains today and the following two EAT dates');
  s.h.evaluate("setDashboardView('public')"); await s.h.settle();
  assert.equal(new URLSearchParams(s.location.hash.slice(1)).get('view'), 'public');
  assert.equal(s.h.evaluate('dashboardView'), 'public');
  assert.equal(s.h.evaluate('managerTool'), '');
  assert.equal(s.h.get('mayor-panel').hidden, true);
  assert.equal(s.h.doc.body.classList.contains('mayor-view'), false);
  assert.equal(new URLSearchParams(s.location.hash.slice(1)).get('city'), 'Jowhar');
  assert.equal(s.h.evaluate('selectedDay'), 13);
});

await test('view-only mayor links open the briefing while city-only links return to the overview', async () => {
  const s = await setup();
  s.h.evaluate('selectCity(10)'); await s.h.settle();
  s.location.hash = '#view=mayor';
  s.h.windowEvents.get('hashchange')(); await s.h.settle();
  assert.equal(s.h.evaluate('dashboardView'), 'mayor');
  assert.equal(s.h.evaluate('selected'), 10);
  assert.ok(s.queueRequests.some(request => request.cityId === 'galkayo'));
  s.location.hash = '#city=Galkayo';
  s.h.windowEvents.get('hashchange')(); await s.h.settle();
  assert.equal(s.h.evaluate('dashboardView'), 'public');
  assert.equal(s.h.evaluate('selected'), 10);
  assert.equal(s.h.evaluate('managerTool'), '');
  assert.equal(s.h.get('mayor-panel').hidden, true);
});

await test('city-only Galkayo and public links open the original 30-city overview', async () => {
  for (const hash of ['#city=Galkayo', '#city=Galkayo&view=public']) {
    const s = await setup(hash);
    assert.equal(s.h.evaluate('dashboardView'), 'public');
    assert.equal(s.h.evaluate('managerTool'), '');
    assert.equal(s.h.evaluate('selected'), 10);
    assert.equal(s.renderCalls.length, 0);
    assert.equal(s.queueRequests.length, 0);
    assert.equal(s.h.get('mayor-panel').hidden, true);
    assert.equal((s.h.get('rows').innerHTML.match(/<tr\b/g) || []).length, 15);
    assert.equal((s.h.get('rows-secondary').innerHTML.match(/<tr\b/g) || []).length, 15);
  }
});

await test('home and invalid fragments return from mayor tools to the 30-city overview', async () => {
  const s = await setup('#city=Galkayo&view=mayor&tool=weather');
  for (const hash of ['#top', '#unknown-section', '#view=public', '#view=unknown', '#tool=unknown']) {
    s.location.hash = hash;
    s.h.windowEvents.get('hashchange')(); await s.h.settle();
    assert.equal(s.h.evaluate('dashboardView'), 'public');
    assert.equal(s.h.evaluate('selected'), 10);
    assert.equal(s.h.evaluate('managerTool'), '');
    assert.equal(s.h.doc.body.classList.contains('mayor-view'), false);
    assert.equal(s.h.get('mayor-panel').hidden, true);
    assert.equal(s.h.get('manager-tool-bar').hidden, true);
  }
});

await test('header links toggle between the all-city overview and explicit mayor dashboard', async () => {
  const s = await setup(), publicLink = s.h.navLinks[0], mayorLink = s.h.navLinks[1];
  publicLink.dataset.dashboardView = 'public'; publicLink.href = '#view=public';
  mayorLink.dataset.dashboardView = 'mayor'; mayorLink.href = '#view=mayor';
  const oldQuery = s.h.doc.querySelectorAll;
  s.h.doc.querySelectorAll = selector => selector === '[data-manager-tool], [data-dashboard-view]' ? [publicLink, mayorLink] : oldQuery(selector);
  s.h.evaluate('setupNavigation(); updateDashboardView()');
  assert.equal(publicLink['aria-current'], 'page');
  assert.equal(mayorLink['aria-current'], undefined);
  mayorLink.events.click({preventDefault() {}}); await s.h.settle();
  assert.equal(s.h.evaluate('dashboardView'), 'mayor');
  assert.equal(mayorLink['aria-current'], 'page');
  assert.equal(publicLink['aria-current'], undefined);
  s.init.onOpenSection('weather'); await s.h.settle();
  publicLink.events.click({preventDefault() {}}); await s.h.settle();
  assert.equal(s.h.evaluate('dashboardView'), 'public');
  assert.equal(s.h.evaluate('managerTool'), '');
  assert.equal(s.h.get('mayor-panel').hidden, true);
  assert.equal(s.h.get('manager-tool-bar').hidden, true);
  assert.equal(publicLink['aria-current'], 'page');
  assert.equal(s.h.get('daily-panel').classList.contains('mayor-active-tool'), false);
  const route = new URLSearchParams(s.location.hash.slice(1));
  assert.equal(route.get('view'), 'public');
  assert.equal(route.get('tool'), null);
});

await test('city queue ignores foreign reports, retains truncation and does not sum nullable impacts', async () => {
  const s = await setup();
  s.queue('mogadishu', [report('local-report', 'mogadishu', { injuries: 2 }), report('foreign-report', 'galkayo', { deaths: 10 })], { total: 280, truncated: true });
  await s.mayor();
  const c = clone(s.latest().community);
  assert.equal(c.cityId, 'mogadishu');
  assert.equal(c.available, true);
  assert.equal(c.total, 280, 'source total is not replaced by the loaded or filtered count');
  assert.equal(c.truncated, true);
  assert.deepEqual(c.records.map(value => value.id), ['local-report']);
  assert.equal(c.records[0].deaths, null);
  assert.equal(c.records[0].injuries, 2);
  assert.equal(c.records[0].damagedProperties, null);
  assert.equal(c.deaths, undefined, 'there is no fabricated city casualty total');
  assert.equal(c.injuries, undefined);
  s.communityInit.onChange([report('all-cities-filtered', 'galkayo')], { available: true, loading: false, cityId: null, scope: 'all', category: 'damage', total: 1, fetchedAt: new Date(BASE).toISOString() });
  await s.h.settle();
  assert.deepEqual(clone(s.latest().community.records).map(value => value.id), ['local-report']);
  assert.equal(s.latest().community.total, 280);
});

await test('late Galkayo queue responses do not replace a selected Mogadishu queue', async () => {
  const s = await setup();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  s.behavior.set('galkayo', async () => { await gate; return response({ reports: [report('galkayo-late', 'galkayo')], cityId: 'galkayo', total: 1, truncated: false, fetchedAt: new Date(BASE).toISOString() }); });
  s.queue('mogadishu', [report('mogadishu-now', 'mogadishu')]);
  await s.h.evaluate('loadManagerReports(selected, true)'); await s.h.settle();
  s.h.evaluate('selectCity(10)'); await s.h.settle();
  s.h.evaluate("setDashboardView('mayor')"); await s.h.settle();
  assert.ok(s.queueRequests.some(request => request.cityId === 'galkayo'));
  s.h.evaluate('selectCity(0)'); await s.h.settle();
  assert.equal(s.latest().selectedCity, 0);
  assert.equal(s.latest().community.cityId, 'mogadishu');
  release(); await s.h.settle();
  assert.equal(s.latest().selectedCity, 0);
  assert.equal(s.latest().community.cityId, 'mogadishu');
  assert.deepEqual(clone(s.latest().community.records).map(value => value.id), ['mogadishu-now']);
});

await test('city queue caching avoids redundant fetches and failed refresh preserves its original retrieval time', async () => {
  const s = await setup();
  s.queue('mogadishu', [report('retained-report', 'mogadishu')]);
  await s.mayor();
  const before = clone(s.latest().community);
  const requestCount = s.queueRequests.length;
  await s.h.evaluate('loadManagerReports(selected)'); await s.h.settle();
  assert.equal(s.queueRequests.length, requestCount);
  s.h.setTime(BASE + 16 * 60 * 1000);
  s.behavior.set('mogadishu', async () => { throw Error('fixture city queue outage'); });
  await s.h.evaluate('loadManagerReports(selected, true)'); await s.h.settle();
  const after = clone(s.latest().community);
  assert.equal(after.lastSuccess, before.lastSuccess);
  assert.deepEqual(after.records.map(value => value.id), ['retained-report']);
  assert.match(after.error, /fixture city queue outage/);
  assert.equal(after.stale, true);
});

await test('a response naming the wrong city cannot replace the requested operational queue', async () => {
  const s = await setup();
  s.queue('mogadishu', [report('correct-city-retained', 'mogadishu')]);
  await s.mayor();
  const before = clone(s.latest().community);
  s.behavior.set('mogadishu', { reports: [report('wrong-city-response', 'galkayo')], cityId: 'galkayo', total: 1, fetchedAt: new Date(BASE + 60000).toISOString() });
  await s.h.evaluate('loadManagerReports(selected, true)'); await s.h.settle();
  assert.deepEqual(clone(s.latest().community.records).map(value => value.id), ['correct-city-retained']);
  assert.equal(s.latest().community.lastSuccess, before.lastSuccess);
  assert.match(s.latest().community.error, /selected city/i);
  assert.equal(s.latest().community.stale, true);
});

await test('map and terrain actions stay in the mayor shell using report coordinates', async () => {
  const s = await setup();
  s.h.evaluate('selectCity(10)'); await s.h.settle(); await s.mayor();
  s.init.onOpenSection('map', { latitude: 6.7797, longitude: 47.4418 });
  assert.equal(s.h.evaluate('dashboardView'), 'mayor');
  assert.equal(s.h.evaluate('managerTool'), 'map-panel');
  assert.equal(s.h.evaluate('selected'), 10);
  const route = new URLSearchParams(s.location.hash.slice(1));
  assert.equal(route.get('view'), 'mayor');
  assert.equal(route.get('tool'), 'map');
  assert.equal(s.h.get('mayor-panel').hidden, true);
  assert.equal(s.h.get('map-panel').classList.contains('mayor-active-tool'), true);
  assert.equal(s.h.get('map-panel').parentElement.classList.contains('mayor-active-tool'), true);
  const point = s.h.moduleCalls.findLast(value => value.module === 'explorer' && value.method === 'focusPoint');
  assert.deepEqual(point.args, [6.7797, 47.4418]);
  const inspected = s.h.moduleCalls.findLast(value => value.module === 'explorer' && value.method === 'inspect');
  assert.deepEqual(inspected.args, [6.7797, 47.4418]);
  await s.mayor();
  s.init.onOpenSection('terrain');
  assert.equal(s.h.evaluate('managerTool'), 'map-panel');
  assert.equal(s.h.moduleCalls.findLast(value => value.module === 'explorer' && value.method === 'showTerrain').args[0], 10);
});

await test('supporting panel routes preserve selected city and day and return to the briefing', async () => {
  const s = await setup('#city=Galkayo&day=2026-10-26&hour=16&tool=weather');
  assert.equal(s.h.evaluate('dashboardView'), 'mayor');
  assert.equal(s.h.evaluate('managerTool'), 'daily-panel');
  assert.equal(s.h.evaluate('selected'), 10);
  assert.equal(s.h.evaluate('selectedDay'), 13);
  assert.equal(s.h.evaluate('selectedHour'), 16);
  for (const [tool, section] of [['alerts','alerts-panel'], ['community','community-panel'], ['map','map-panel'], ['weather','daily-panel']]) {
    s.init.onOpenSection(tool); await s.h.settle();
    const p = new URLSearchParams(s.location.hash.slice(1));
    assert.equal(p.get('city'), 'Galkayo');
    assert.equal(p.get('day'), '2026-10-26');
    assert.equal(p.get('hour'), '16');
    assert.equal(p.get('view'), 'mayor');
    assert.equal(p.get('tool'), tool);
    assert.equal(s.h.evaluate('managerTool'), section);
    assert.equal(s.h.get(section).classList.contains('mayor-active-tool'), true);
    assert.equal(s.h.get('mayor-panel').hidden, true);
    assert.equal(s.h.get('manager-tool-bar').hidden, false);
  }
  s.h.get('mayor-home-button').onclick(); await s.h.settle();
  const p = new URLSearchParams(s.location.hash.slice(1));
  assert.equal(p.get('city'), 'Galkayo');
  assert.equal(p.get('day'), '2026-10-26');
  assert.equal(p.get('view'), 'mayor');
  assert.equal(p.get('tool'), null);
  assert.equal(s.h.evaluate('managerTool'), '');
  assert.equal(s.h.get('mayor-panel').hidden, false);
  assert.equal(s.h.get('manager-tool-bar').hidden, true);
  assert.equal(s.latest().selectedCity, 10);
  assert.equal(s.latest().selectedDate, '2026-10-26');
  assert.equal(s.h.get('daily-panel').classList.contains('mayor-active-tool'), false);
  assert.equal(s.h.get('map-panel').parentElement.classList.contains('mayor-active-tool'), false);
});

await test('city changes while a supporting panel is open still refresh the mayor report queue', async () => {
  const s = await setup();
  s.init.onOpenSection('weather'); await s.h.settle();
  s.queue('galkayo', [report('new-city-report', 'galkayo')]);
  const count = s.queueRequests.length;
  s.init.onSelectCity(10); await s.h.settle();
  assert.equal(s.h.evaluate('managerTool'), 'daily-panel');
  assert.ok(s.queueRequests.slice(count).some(request => request.cityId === 'galkayo'));
  s.h.get('mayor-home-button').onclick(); await s.h.settle();
  assert.equal(s.latest().selectedCity, 10);
  assert.equal(s.latest().community.cityId, 'galkayo');
  assert.deepEqual(clone(s.latest().community.records).map(value => value.id), ['new-city-report']);
});

await test('explicit public coverage overrides tools while invalid tools remain on the overview', async () => {
  for (const hash of ['#city=Galkayo&view=public&tool=unknown', '#city=Galkayo&view=public&tool=map', '#city=Galkayo&tool=unknown']) {
    const s = await setup(hash);
    assert.equal(s.h.evaluate('managerTool'), '');
    s.init.onOpenSection('unknown-section');
    assert.equal(s.h.evaluate('dashboardView'), 'public');
    assert.equal(s.h.evaluate('managerTool'), '');
    assert.equal(s.h.evaluate('selected'), 10);
  }
});

await test('delivered HTML starts on all 30 cities and offers an explicit mayor link', async () => {
  const html = fs.readFileSync(new URL('./somalia-flood-watch/dist/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="(?:workspace-view-switch|public-view-button|mayor-view-button)"/);
  assert.doesNotMatch(html.match(/<body\b[^>]*>/)?.[0] || '', /mayor-view/);
  assert.match(html, /<section\b(?=[^>]*id="mayor-panel")(?=[^>]*\bhidden)[^>]*>/);
  assert.match(html, /<a\b(?=[^>]*data-dashboard-view="public")[^>]*>All 30 cities<\/a>/);
  assert.match(html, /<a\b(?=[^>]*data-dashboard-view="mayor")[^>]*>City planning desk<\/a>/);
  assert.match(html, /id="manager-tool-bar"/);
  assert.match(html, /id="mayor-home-button"/);
  assert.match(html, /id="manager-tool-title"/);
});

await test('city-scoped alert model keeps national notices distinct and excludes another city notice', async () => {
  const s = await setup(); await s.mayor();
  s.h.evaluate(`feeds.alerts.data.alerts = [
    {id:'country',title:'Somalia source notice',basis:'regional-forecast',status:'active',sourceId:'icpac',severity:'moderate',issuedAt:'2026-10-13T07:00:00Z',endsAt:'2026-10-14T07:00:00Z',scope:{country:'Somalia',cities:[]}},
    {id:'other-city',title:'Galkayo source notice',basis:'regional-forecast',status:'active',sourceId:'icpac',severity:'severe',issuedAt:'2026-10-13T07:00:00Z',endsAt:'2026-10-14T07:00:00Z',scope:{country:'Somalia',cities:['Galkayo']}}
  ]; renderMayor();`);
  const model = s.latest().alertModel;
  assert.equal(model.scope, 'city');
  assert.equal(model.selectedCity, 'Mogadishu');
  assert.equal(model.counts.regional, 1);
  assert.match(model.alerts.find(value => value.id === 'country').scopeLabel, /city extent unspecified/);
  assert.ok(!model.alerts.some(value => value.id === 'other-city'));
  assert.ok(s.alertInputs.every(input => input.scope === 'city' && input.type === 'all'));
  s.h.setTime(BASE + 121 * 60 * 1000); s.h.evaluate('renderMayor()');
  assert.equal(s.latest().alertModel.alerts.length, 0, 'stale source records and stale rainfall are withheld from active signals');
  assert.equal(s.latest().alertModel.fresh.weather, false);
  assert.equal(s.latest().alertModel.fresh.official, false);
});

await test('minute refresh updates the mayor operational clock even when forecast dates are unchanged', async () => {
  const s = await setup(); await s.mayor();
  const before = s.renderCalls.length;
  s.h.setTime(BASE + 60 * 1000);
  const timer = s.h.timers.find(value => value.kind === 'interval' && value.ms === 60000);
  assert.ok(timer);
  timer.fn(); await s.h.settle();
  assert.ok(s.renderCalls.length > before);
  assert.equal(Date.parse(s.latest().now), BASE + 60 * 1000);
  assert.equal(s.latest().weatherRows[0].date, '2026-10-13');
});

console.log(`Mayor controller integration passed: ${checks.length} checks.`);
