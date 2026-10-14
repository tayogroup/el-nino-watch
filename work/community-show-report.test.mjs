import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('./somalia-flood-watch/dist/community.js', import.meta.url), 'utf8');
const cities = [['Mogadishu'], ['Galkayo'], ['Beledweyne']];
const targetId = 'd18fd6e8-7a84-4f71-90ac-1c51573c590f';
const target = {id: targetId, cityId: 'galkayo', category: 'flood', description: 'Water covers a road near the market.', observedAt: '2026-10-13T09:00:00Z', receivedAt: '2026-10-13T10:00:00Z', media: [], comments: [], deaths: null, injuries: null, damagedProperties: null};
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };

function harness() {
  const nodes = new Map(), calls = [], focus = [], scrolls = [], changes = [];
  let response = async () => ({reports: [], fetchedAt: '2026-10-13T10:00:00Z'});
  class Node {
    constructor(id) { this.id = id; this.markup = ''; this.textContent = ''; this.value = ''; this.disabled = false; this.events = {}; this.attributes = {}; this.classList = {add() {}, remove() {}}; }
    set innerHTML(value) {
      this.markup = value;
      if (this.id === 'community-feed-list') for (const key of [...nodes.keys()]) if (key.startsWith('community-report-') && !['community-report-form', 'community-report-city'].includes(key)) nodes.delete(key);
      for (const match of value.matchAll(/id="([^"]+)"/g)) ensure(match[1]);
      if (this.id === 'community-root') {
        const form = ensure('community-report-form');
        form.elements = {latitude: {value: ''}, longitude: {value: ''}, cityId: ensure('community-report-city')};
      }
    }
    get innerHTML() { return this.markup; }
    addEventListener(type, handler) { this.events[type] = handler; }
    insertAdjacentHTML(_position, markup) { for (const match of markup.matchAll(/id="([^"]+)"/g)) ensure(match[1]); }
    querySelectorAll() { return []; }
    querySelector() { return null; }
    setAttribute(key, value) { this.attributes[key] = value; }
    scrollIntoView(options) { scrolls.push({id: this.id, ...options}); }
    focus(options) { focus.push({id: this.id, ...options}); }
  }
  function ensure(id) { if (!nodes.has(id)) nodes.set(id, new Node(id)); return nodes.get(id); }
  ensure('community-root');
  const sandbox = {
    window: {addEventListener() {}},
    document: {getElementById: id => nodes.get(id) || null},
    localStorage: {getItem() { return null; }, setItem() {}},
    location: {protocol: 'http:', href: 'http://127.0.0.1:4173/', origin: 'http://127.0.0.1:4173'},
    navigator: {}, URL, AbortController, setTimeout, clearTimeout, Date,
    fetch: async (url, options) => {
      calls.push({url, options});
      const data = await response(url);
      return {ok: !data.error, status: data.error ? 503 : 200, json: async () => data};
    }
  };
  vm.runInNewContext(script, sandbox);
  const api = sandbox.window.CommunityReports;
  api.init({cities, onChange: (records, meta) => changes.push({records: JSON.parse(JSON.stringify(records)), meta: JSON.parse(JSON.stringify(meta))})});
  return {api, nodes, calls, focus, scrolls, changes, setResponse: fn => {response = fn;}, change(id, value) {const node = nodes.get(id); node.value = value; node.events.change({target: node});}};
}

{
  const h = harness(); await flush();
  h.change('community-scope', 'all'); await flush();
  h.change('community-category', 'damage');
  const form = h.nodes.get('community-report-form'); form.elements.latitude.value = '2.04'; form.elements.longitude.value = '45.31';
  h.setResponse(async () => ({reports: [target], total: 1, fetchedAt: '2026-10-13T10:00:00Z'}));
  const callsBefore = h.calls.length;
  check(await h.api.showReport(targetId, 1), true);
  check(h.calls.length - callsBefore, 1, 'opening a report makes exactly one scoped refresh');
  check(h.calls.at(-1).url, '/api/community/reports?city=galkayo');
  check(h.nodes.get('community-scope').value, 'city', 'all-city filter resets');
  check(h.nodes.get('community-category').value, 'all', 'damage-only filter resets so a flood report is visible');
  check(h.nodes.get('community-report-city').value, 'galkayo');
  check(form.elements.latitude.value, '', 'coordinates from another report city clear');
  check(form.elements.longitude.value, '');
  check(h.nodes.get('community-location-status').textContent.includes('city changed'), true);
  check(h.nodes.get('community-report-' + targetId).attributes.tabindex, '-1');
  check(h.focus, [{id: 'community-report-' + targetId, preventScroll: true}]);
  check(h.scrolls, [{id: 'community-report-' + targetId, behavior: 'smooth', block: 'center'}]);
  check(h.changes.some(change => change.meta.cityId === 'galkayo' && change.meta.available === false && change.records.length === 0), true, 'old reports become unknown while loading');
  check(h.nodes.get('community-feed-list').innerHTML.includes('Unverified community report'), true);
  form.elements.latitude.value = '6.77'; form.elements.longitude.value = '47.43';
  check(await h.api.showReport(targetId, 1), true);
  check(form.elements.latitude.value, '6.77', 'opening another report in the same city preserves form coordinates');
}

{
  const h = harness(); await flush();
  const before = h.calls.length;
  for (const [id, index] of [['bad<id>', 1], ['x'.repeat(101), 1], ['', 1], [null, 1], [targetId, -1], [targetId, 99], [targetId, 1.5], [targetId, '1']]) check(await h.api.showReport(id, index), false);
  check(h.calls.length, before, 'invalid requests make no network call');
  h.setResponse(async () => ({reports: [], fetchedAt: '2026-10-13T10:00:00Z'}));
  check(await h.api.showReport(targetId, 1), false);
  check(h.nodes.get('community-status').textContent.includes('not returned in the latest loaded reports for Galkayo'), true);
  check(h.focus.length, 0, 'missing report never focuses a fabricated card');
  h.setResponse(async () => ({reports: [{...target, cityId: 'mogadishu'}]}));
  check(await h.api.showReport(targetId, 1), false, 'a report returned with the wrong city is never focused');
  check(h.focus.length, 0);
  h.setResponse(async () => ({error: 'Service offline'}));
  check(await h.api.showReport(targetId, 1), false);
  check(h.nodes.get('community-status').textContent, 'Community reports unavailable: Service offline', 'an outage retains the existing unavailable message');
  check(h.focus.length, 0);
}

{
  const h = harness(); await flush();
  const slow = deferred();
  h.setResponse(async url => url.includes('galkayo') ? slow.promise : {reports: [], fetchedAt: '2026-10-13T10:00:00Z'});
  const opening = h.api.showReport(targetId, 1);
  h.api.selectCity(0); await flush();
  slow.resolve({reports: [target]});
  check(await opening, false, 'late result cannot focus a report after the user selects another city');
  check(h.focus.length, 0);
  check(h.nodes.get('community-report-city').value, 'mogadishu');
  check(h.nodes.get('community-feed-title').textContent, 'Mogadishu community reports');
  check(h.nodes.get('community-feed-list').innerHTML.includes(targetId), false, 'late response cannot replace another city’s feed');
}

for (const [filter, value] of [['community-category', 'damage'], ['community-scope', 'all']]) {
  const h = harness(); await flush();
  const slow = deferred(); let first = true;
  h.setResponse(async () => { if (first) {first = false; return slow.promise;} return {reports: [target]}; });
  const opening = h.api.showReport(targetId, 1);
  h.change(filter, value);
  slow.resolve({reports: [target]});
  check(await opening, false, 'user filter changes cancel the focus request');
  check(h.focus.length, 0);
  check(h.nodes.get(filter).value, value);
}

{
  const h = harness(); await flush();
  const slow = deferred(); let first = true;
  h.setResponse(async () => { if (first) {first = false; return slow.promise;} return {reports: [target]}; });
  const opening = h.api.showReport(targetId, 1);
  h.change('community-category', 'damage'); h.change('community-category', 'all');
  slow.resolve({reports: [target]});
  check(await opening, false, 'returning to the previous filter does not revive a cancelled focus request');
  check(h.focus.length, 0);
}

{
  const h = harness(); await flush();
  const slow = deferred(); let first = true;
  h.setResponse(async () => { if (first) {first = false; return slow.promise;} return {reports: [target]}; });
  const initial = h.api.showReport('another-report', 1);
  check(await h.api.showReport(targetId, 1), true);
  slow.resolve({reports: [{...target, id: 'another-report'}]});
  check(await initial, false, 'a newer report-opening request takes priority');
  check(h.focus.length, 1);
  check(h.focus[0].id, 'community-report-' + targetId);
}

{
  const h = harness(); await flush();
  h.change('community-scope', 'all'); await flush();
  h.change('community-category', 'damage');
  const form = h.nodes.get('community-report-form'); form.elements.latitude.value = '2.04'; form.elements.longitude.value = '45.31';
  h.setResponse(async () => ({reports: [target], fetchedAt: '2026-10-13T10:00:00Z'}));
  const callsBefore = h.calls.length;
  check(await h.api.showCity(1), true);
  check(h.calls.length - callsBefore, 1, 'opening the city board makes one scoped query');
  check(h.calls.at(-1).url, '/api/community/reports?city=galkayo');
  check(h.nodes.get('community-scope').value, 'city');
  check(h.nodes.get('community-category').value, 'all');
  check(h.nodes.get('community-report-city').value, 'galkayo');
  check(form.elements.latitude.value, '');
  check(form.elements.longitude.value, '');
  check(h.focus.length, 0, 'opening a city without a report ID does not fabricate a focused report');
  check(h.scrolls.length, 0);
  check(h.nodes.get('community-feed-title').textContent, 'Galkayo community reports');
  check(h.nodes.get('community-feed-list').innerHTML.includes(targetId), true);
  h.setResponse(async () => ({reports: []}));
  check(await h.api.showCity(1), true, 'an empty but available city board opens successfully');
  check(h.nodes.get('community-status').textContent.includes('not returned'), false, 'city navigation has no missing-report error');
  for (const index of [-1, 99, null, '1', 1.2]) check(await h.api.showCity(index), false);
}

{
  const h = harness(); await flush();
  const slow = deferred();
  h.setResponse(async url => url.includes('galkayo') ? slow.promise : {reports: []});
  const opening = h.api.showCity(1);
  h.api.selectCity(0); await flush();
  slow.resolve({reports: [target]});
  check(await opening, false, 'late city board navigation cannot replace a newly selected city');
  check(h.nodes.get('community-feed-title').textContent, 'Mogadishu community reports');
  check(h.focus.length, 0);
}

{
  const h = harness(); await flush();
  h.setResponse(async () => ({error: 'Board unavailable'}));
  check(await h.api.showCity(1), false);
  check(h.nodes.get('community-status').textContent, 'Community reports unavailable: Board unavailable');
  check(h.focus.length, 0);
}

console.log(`Community report navigation passed ${checks} checks.`);
