import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {createVisits, deviceOf, PUBLISH_AFTER} from './somalia-flood-watch/visits.mjs';
import {createServer} from './somalia-flood-watch/server.mjs';

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
  assert.equal(PUBLISH_AFTER, 3000);
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-visits-'));
  try {
    const visits = createVisits({dataDir, cities, log: quiet, publishAfter: 3});
    const first = await call(visits, '/api/visit', request('POST', view()));
    assert.equal(first.body.published, false);
    const hidden = (await call(visits, '/api/visits', request('GET'))).body;
    assert.deepEqual(Object.keys(hidden).sort(), ['note', 'published', 'threshold'], 'no numbers before the threshold');
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
