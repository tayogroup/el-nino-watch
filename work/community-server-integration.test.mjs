import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtemp, rm, readFile, readdir} from 'node:fs/promises';
import {createServer} from './somalia-flood-watch/server.mjs';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const dataDir = await mkdtemp(path.join(testRoot, 'community-integration-'));
const nativeFetch = globalThis.fetch;
const REVIEW_KEY = 'integration-review-key-0123456789';
let upstreamRequests = 0, server, origin;
let checks = 0;
const equal = (actual, expected) => { assert.equal(actual, expected); checks++; };
const ok = value => { assert.ok(value); checks++; };
const start = async () => {
  server = createServer({dataDir, statsKey:'', reviewKeys:REVIEW_KEY});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
};
const stop = async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  server = undefined;
};
const api = async (route, options = {}) => {
  const response = await nativeFetch(origin + route, options);
  return {response, body:await response.json()};
};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
globalThis.fetch = async () => { upstreamRequests++; throw new Error('Intentional upstream outage in integration test'); };

try {
  await start();
  let response = await nativeFetch(origin + '/'); equal(response.status, 200);
  const html = await response.text(); ok(html.includes('El Nino Watch'));
  response = await nativeFetch(origin + '/cities.json'); equal(response.status, 200);
  const cities = await response.json(); equal(cities.length, 44); ok(cities.some(city => city[0] === 'Laasqoray'));
  response = await nativeFetch(origin + '/community.js'); equal(response.status, 200); ok(response.headers.get('content-type').startsWith('text/javascript'));
  let result = await api('/api/community/reports'); equal(result.response.status, 200); equal(result.body.total, 0); equal(upstreamRequests, 0);
  const payload = {cityId:'laasqoray', category:'rain', observedAt:new Date(Date.now()-60000).toISOString(), description:'Integration test only: rainfall visible over local roads.', latitude:11.1595, longitude:48.1994, deaths:null, injuries:null, damagedProperties:null};
  const form = new FormData(); form.set('payload', JSON.stringify(payload)); form.append('media', new Blob([png], {type:'image/png'}), 'test-evidence.png');
  result = await api('/api/community/reports', {method:'POST', headers:{Origin:origin}, body:form});
  equal(result.response.status, 201); equal(result.body.report.cityName, 'Laasqoray'); equal(result.body.report.cityId, 'laasqoray'); equal(result.body.report.status, 'unverified'); equal(result.body.report.deaths, null); equal(result.body.report.author, 'Anonymous');
  const {report, receiptToken} = result.body;
  // Held for review until approved; the review page is served at /review and is not indexed.
  equal((await api('/api/community/reports?city=laasqoray')).body.reports.length, 0);
  response = await nativeFetch(origin + '/review'); equal(response.status, 200); ok((await response.text()).includes('<meta name="robots" content="noindex, nofollow">'));
  result = await api(`/api/community/review/${report.id}`, {method:'POST', headers:{Origin:origin, 'Content-Type':'application/json', 'X-Review-Key':REVIEW_KEY}, body:JSON.stringify({decision:'approve'})}); equal(result.response.status, 200);
  response = await nativeFetch(origin + report.media[0].url); equal(response.status, 200); equal(Buffer.compare(Buffer.from(await response.arrayBuffer()), png), 0);
  response = await nativeFetch(origin + report.media[0].url, {headers:{Range:'bytes=0-7'}}); equal(response.status, 206); equal((await response.arrayBuffer()).byteLength, 8);
  result = await api('/api/community/reports?city=laasqoray'); equal(result.body.reports.length, 1); equal(result.body.reports[0].id, report.id); ok(!('receiptHash' in result.body.reports[0]));
  result = await api('/api/community/reports?city=mogadishu'); equal(result.body.reports.length, 0);
  result = await api(`/api/community/reports/${report.id}/comments`, {method:'POST', headers:{Origin:origin, 'Content-Type':'application/json'}, body:JSON.stringify({author:'Test responder', body:'Integration test comment; this is not a real flood report.'})});
  equal(result.response.status, 201); equal(result.body.comment.author, 'Test responder');
  // A feed outage returns its own unavailable response and does not block local reporting.
  result = await api('/api/enso'); equal(result.response.status, 503); equal(result.body.available, false); ok(upstreamRequests > 0);
  result = await api('/api/community/reports?city=laasqoray'); equal(result.response.status, 200); equal(result.body.reports[0].comments.length, 1);
  response = await nativeFetch(origin + '/api/not-a-route'); equal(response.status, 404);
  response = await nativeFetch(origin + '/..%5cserver.mjs'); equal(response.status, 403);
  response = await nativeFetch(origin + '/', {method:'POST'}); equal(response.status, 405);
  response = await nativeFetch(origin + '/data/reports.json'); equal(response.status, 404);
  // The public app cannot fetch the private receipt store or report uploads as static paths.
  const stored = JSON.parse(await readFile(path.join(dataDir,'reports.json'), 'utf8')); ok(stored.reports[0].receiptHash); ok(!JSON.stringify(stored).includes(receiptToken));
  await stop(); await start();
  result = await api('/api/community/reports?city=laasqoray'); equal(result.body.reports.length, 1); equal(result.body.reports[0].comments.length, 1);
  result = await api(`/api/community/reports/${report.id}`, {method:'DELETE', headers:{Origin:origin, 'Content-Type':'application/json'}, body:JSON.stringify({receipt:receiptToken})}); equal(result.response.status, 200); equal(result.body.removed, true);
  result = await api('/api/community/reports'); equal(result.body.total, 0); equal((await readdir(path.join(dataDir,'media'))).length, 0);
  response = await nativeFetch(origin + report.media[0].url); equal(response.status, 404);
  console.log(`Integrated community server: ${checks} checks passed (44-city API, real multipart/media/comments/deletion, persistence, private storage, static routes, and feed outage isolation).`);
} finally {
  globalThis.fetch = nativeFetch;
  if (server) await stop();
  assert.ok(path.resolve(dataDir).startsWith(path.resolve(testRoot) + path.sep));
  await rm(dataDir, {recursive:true, force:true});
}
