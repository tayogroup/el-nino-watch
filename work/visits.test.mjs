import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {createVisits, deviceOf, PUBLISH_AFTER} from './somalia-flood-watch/visits.mjs';
import {createServer} from './somalia-flood-watch/server.mjs';
import vm from 'node:vm';

const dist = new URL('./somalia-flood-watch/dist/', import.meta.url);
const html = await readFile(new URL('index.html', dist), 'utf8');
const cities = JSON.parse(await readFile(new URL('cities.json', dist), 'utf8'));
const quiet = {log() {}, error() {}};
const PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129 Safari/537.36';

function request(method, body, headers = {}, address = '10.0.0.1') {
  const req = Readable.from(body === undefined ? [] : [typeof body === 'string' ? body : JSON.stringify(body)]);
  Object.assign(req, {method, headers: {host: 'elninowatch.so', 'user-agent': DESKTOP, ...headers}, socket: {remoteAddress: address}});
  return req;
}
function call(visits, path, req) {
  return new Promise(resolve => {
    const res = {writeHead(status) { this.status = status; }, end(body) { resolve({status: this.status, body: body ? JSON.parse(body.toString()) : null}); }};
    visits.handle(req, res, new URL(path, 'https://elninowatch.so'));
  });
}
const view = (extra = {}) => ({type: 'view', tab: 'overview', city: 'Mogadishu', lang: 'en', ...extra});

test('every visit is counted, with its tab, city, language, device and country', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-visits-'));
  try {
    const visits = createVisits({dataDir, cities, log: quiet, publishAfter: 1, now: () => Date.parse('2026-10-14T22:30:00Z')});
    for (let i = 0; i < 3; i++) assert.deepEqual((await call(visits, '/api/visit', request('POST', view()))).status, 202);
    await call(visits, '/api/visit', request('POST', view({tab: 'weather', city: 'Kismayo', lang: 'so'}), {'user-agent': PHONE, 'cdn-requestcountrycode': 'so'}));
    await call(visits, '/api/visit', request('POST', {type: 'tab', tab: 'alerts'}));
    await call(visits, '/api/visit', request('POST', {type: 'city', city: 'Somewhere Else'}));
    const {body} = await call(visits, '/api/visits?days=7', request('GET'));
    assert.equal(body.published, true);
    assert.deepEqual(body.days, [{date: '2026-10-15', views: 4}], 'a visit at 01:30 East Africa time belongs to that East African day');
    assert.equal(body.totals.views, 4, 'the same visitor four times is four visits');
    assert.equal(body.allTimeVisits, 4);
    assert.deepEqual(body.totals.tabs, {overview: 3, weather: 1, alerts: 1});
    assert.deepEqual(body.totals.cities, {Mogadishu: 3, Kismayo: 1, other: 1}, 'unknown city names are not stored as written');
    assert.deepEqual(body.totals.languages, {en: 3, so: 1});
    assert.deepEqual(body.totals.devices, {desktop: 3, mobile: 1});
    assert.deepEqual(body.totals.countries, {unknown: 3, SO: 1});
    assert.ok(!JSON.stringify(body).includes('10.0.0.1') && !JSON.stringify(body).includes('Chrome'), 'no address or browser string is published');

    await visits.flush();
    const saved = await readFile(path.join(dataDir, 'visits.json'), 'utf8');
    assert.ok(!saved.includes('10.0.0.1') && !saved.includes('Chrome'), 'nor stored');
    const reloaded = createVisits({dataDir, cities, log: quiet, publishAfter: 1, now: () => Date.parse('2026-10-14T22:30:00Z')});
    assert.equal((await call(reloaded, '/api/visits', request('GET'))).body.totals.views, 4, 'counts survive a restart');
  } finally { await rm(dataDir, {recursive: true, force: true}); }
});

test('nothing is published until the site has had the threshold of visits', async () => {
  assert.equal(PUBLISH_AFTER, 1000, 'the owner lowered it from 3,000 on 2026-10-16');
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-visits-'));
  try {
    const visits = createVisits({dataDir, cities, log: quiet, publishAfter: 3});
    const first = await call(visits, '/api/visit', request('POST', view()));
    assert.equal(first.body.published, false);
    const hidden = (await call(visits, '/api/visits', request('GET'))).body;
    assert.deepEqual(Object.keys(hidden).sort(), ['allTimeVisits', 'note', 'published', 'threshold'], 'before the threshold: the total only, no breakdowns');
    assert.equal(hidden.allTimeVisits, 1, 'the total, as progress towards the threshold');
    assert.match(hidden.note, /3 visits/);
    await call(visits, '/api/visit', request('POST', view()));
    assert.equal((await call(visits, '/api/visit', request('POST', view()))).body.published, true);
    assert.equal((await call(visits, '/api/visits', request('GET'))).body.totals.views, 3);
  } finally { await rm(dataDir, {recursive: true, force: true}); }
});

test('bots, other sites, junk and floods are not counted', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-visits-'));
  try {
    const visits = createVisits({dataDir, cities, log: quiet, publishAfter: 1});
    assert.equal((await call(visits, '/api/visit', request('POST', view(), {'user-agent': 'Googlebot/2.1'}))).body.counted, false);
    assert.equal((await call(visits, '/api/visit', request('POST', view(), {'user-agent': ''}))).body.counted, false);
    assert.equal((await call(visits, '/api/visit', request('POST', view(), {origin: 'https://evil.example'}))).status, 403);
    assert.equal((await call(visits, '/api/visit', request('POST', view(), {'sec-fetch-site': 'cross-site'}))).status, 403);
    assert.equal((await call(visits, '/api/visit', request('POST', '{not json'))).status, 400);
    assert.equal((await call(visits, '/api/visit', request('POST', {type: 'purchase'}))).status, 400);
    assert.equal((await call(visits, '/api/visit', request('POST', 'x'.repeat(3000)))).status, 413);
    assert.equal((await call(visits, '/api/visit', request('GET'))).status, 405);
    let counted = 0;
    for (let i = 0; i < 205; i++) if ((await call(visits, '/api/visit', request('POST', view(), {}, '10.9.9.9'))).body.counted) counted++;
    assert.equal(counted, 200, 'one connection is capped per day');
    assert.equal((await call(visits, '/api/visit', request('POST', view(), {}, '10.9.9.8'))).body.counted, true, 'others still count');
    assert.equal(deviceOf('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'), 'tablet');
  } finally { await rm(dataDir, {recursive: true, force: true}); }
});

test('the page wiring: hidden footer link, scripts before app.js, /stats, and quick backups on report changes', async () => {
  assert.match(html, /<a href="\/stats" id="visitor-stats-link" hidden>Visitor statistics<\/a>/);
  assert.ok(html.indexOf('<script src="visits.js"></script>') > 0 && html.indexOf('<script src="visits.js"></script>') < html.indexOf('<script src="app.js"></script>'));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-visits-server-'));
  let soon = 0;
  const server = createServer({dataDir, backup: {soon: () => soon++, status: () => ({enabled: true})}});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const stats = await fetch(base + '/stats');
    assert.equal(stats.status, 200);
    assert.match(await stats.text(), /<title>Visitor statistics \| El Nino Watch<\/title>/);
    assert.equal((await (await fetch(base + '/api/visits')).json()).published, false);
    const form = new FormData();
    form.set('payload', JSON.stringify({cityId: 'mogadishu', category: 'rain', observedAt: new Date(Date.now() - 60000).toISOString(), description: 'Synthetic test only; this is not a real weather report.', deaths: null, injuries: 0, damagedProperties: null}));
    const posted = await fetch(base + '/api/community/reports', {method: 'POST', headers: {Origin: base}, body: form});
    assert.equal(posted.status, 201);
    assert.equal(soon, 1, 'saving a report asks for a backup soon');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, {recursive: true, force: true});
  }
});

test('the owner sees the numbers early with the key, sent only as a header', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-visits-'));
  const KEY = 'k'.repeat(32);
  try {
    const visits = createVisits({dataDir, cities, log: quiet, publishAfter: 3000, statsKey: KEY});
    await call(visits, '/api/visit', request('POST', view()));
    assert.equal((await call(visits, '/api/visits', request('GET'))).body.published, false, 'the public still sees nothing');
    assert.equal((await call(visits, `/api/visits?key=${KEY}`, request('GET'))).body.privateView, undefined, 'a key in the address is ignored');
    const owner = await call(visits, '/api/visits', request('GET', undefined, {'x-stats-key': KEY}));
    assert.equal(owner.status, 200);
    assert.equal(owner.body.privateView, true);
    assert.equal(owner.body.published, false);
    assert.equal(owner.body.totals.views, 1);
    assert.equal((await call(visits, '/api/visits', request('GET', undefined, {'x-stats-key': 'k'.repeat(31) + 'x'}))).status, 403);
    let refused = 0;
    for (let i = 0; i < 25; i++) if ((await call(visits, '/api/visits', request('GET', undefined, {'x-stats-key': 'wrong'}, '10.7.7.7'))).status === 429) refused++;
    assert.equal(refused, 5, 'twenty wrong keys a day per connection, then refused');
    assert.equal((await call(visits, '/api/visits', request('GET', undefined, {'x-stats-key': KEY}, '10.7.7.7'))).status, 429, 'even the right key, once locked out');

    const noKey = createVisits({dataDir, cities, log: quiet});
    assert.equal((await call(noKey, '/api/visits', request('GET', undefined, {'x-stats-key': KEY}))).status, 403, 'no key configured: no private view');
    const weak = createVisits({dataDir, cities, log: quiet, statsKey: 'short'});
    assert.equal((await call(weak, '/api/visits', request('GET', undefined, {'x-stats-key': 'short'}))).status, 403, 'a guessable key is refused outright');
  } finally { await rm(dataDir, {recursive: true, force: true}); }
});

// The /stats page's own script, run against a stubbed /api/visits answer.
async function statsPage(answer) {
  const html = await readFile(new URL('./somalia-flood-watch/dist/stats.html', import.meta.url), 'utf8');
  const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const node = () => ({innerHTML: '', className: '', hidden: false, open: false, value: '', checked: false, textContent: '', addEventListener() {}, querySelectorAll: () => []});
  const nodes = Object.fromEntries(['root', 'owner', 'owner-form', 'owner-key', 'owner-msg', 'owner-remember'].map(id => [id, node()]));
  const requests = [];
  const fetch = async (url, options) => { requests.push({url, options}); return {ok: true, status: 200, json: async () => answer}; };
  vm.runInContext(script, vm.createContext({document: {getElementById: id => nodes[id]}, fetch, localStorage: {getItem: () => null, setItem() {}, removeItem() {}}, Intl, Number, Math, Object, String, Date, Promise}));
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  return {root: nodes.root, requests};
}

test('before the threshold, /stats shows the total as progress and nothing else', async () => {
  const {root, requests} = await statsPage({published: false, threshold: 1000, allTimeVisits: 327, note: 'Visitor statistics are published once the site has had 1,000 visits.'});
  assert.ok(root.innerHTML.includes('<b>327</b> of 1,000 visits'), root.innerHTML);
  assert.ok(root.innerHTML.includes('style="width:32.7%"'), 'the bar is drawn to scale');
  assert.ok(root.innerHTML.includes('role="progressbar"') && root.innerHTML.includes('aria-valuenow="327"') && root.innerHTML.includes('aria-valuemax="1000"'));
  assert.ok(!/Countries|Tabs viewed|Busiest day/.test(root.innerHTML), 'no breakdowns');
  assert.equal(requests[0].options.headers['X-Stats-Key'], undefined, 'the public view sends no key');
  const over = await statsPage({published: false, threshold: 1000, allTimeVisits: 1200, note: ''});
  assert.ok(over.root.innerHTML.includes('style="width:100.0%"'), 'the bar never runs past full');
  const older = await statsPage({published: false, threshold: 1000, note: 'Visitor statistics are published once the site has had 1,000 visits.'});
  assert.ok(!older.root.innerHTML.includes('progressbar'), 'a reply without a total draws no counter');
});
