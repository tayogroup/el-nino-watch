import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from './somalia-flood-watch/server.mjs';
import {SOURCES} from './somalia-flood-watch/feeds.mjs';

test('loopback relay caches verified source data and visibly marks failed refreshes stale', async () => {
  const stationHtml = await readFile(new URL('./swalim-stations.html', import.meta.url), 'utf8');
  const nativeFetch = globalThis.fetch;
  const nativeNow = Date.now;
  let now = nativeNow(), broken = false, requests = 0;
  Date.now = () => now;
  globalThis.fetch = async url => {
    requests++;
    if (broken) throw new Error('Test source connection failed');
    if (url === SOURCES.stations) return new Response(stationHtml);
    if (url === SOURCES.weekly) return new Response('07OCT2026 26.1 5.2 29.0 4.1 30.0 3.3 29.9 1.3');
    if (url === SOURCES.enso) return new Response('8 October 2026 ENSO Alert System Status: El Niño Advisory Synopsis: El Niño continues to strengthen.');
    throw new Error('Unexpected upstream source');
  };
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const first = await (await nativeFetch(`${base}/api/stations`)).json();
    assert.equal(first.available, true);
    assert.equal(first.stale, false);
    assert.equal(first.stations.find(r => r.code === 'SH004').levelM, 5.37);
    const cached = await (await nativeFetch(`${base}/api/stations`)).json();
    assert.equal(cached.fetchedAt, first.fetchedAt);
    assert.equal(requests, 1);
    now += 11 * 60 * 1000;
    broken = true;
    const stale = await (await nativeFetch(`${base}/api/stations`)).json();
    assert.equal(stale.available, true);
    assert.equal(stale.stale, true);
    assert.equal(stale.fetchedAt, first.fetchedAt);
    assert.match(stale.error, /Latest refresh failed/);
    const noEnso = await nativeFetch(`${base}/api/enso`);
    assert.equal(noEnso.status, 503);
    assert.equal((await noEnso.json()).available, false);
    assert.equal((await nativeFetch(`${base}/api/arbitrary?url=http://example.com`)).status, 404);
    assert.equal((await nativeFetch(`${base}/..%5cfeeds.mjs`)).status, 403);
    assert.equal((await nativeFetch(`${base}/`, {method: 'POST'})).status, 405);
    assert.equal((await nativeFetch(`${base}/`)).status, 200);
  } finally {
    globalThis.fetch = nativeFetch;
    Date.now = nativeNow;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
