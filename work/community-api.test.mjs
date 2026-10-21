import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp, rm, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCommunityHandler, reviewKeysFrom} from './somalia-flood-watch/community.mjs';

const testParent = path.dirname(fileURLToPath(import.meta.url));
const folder = await mkdtemp(path.join(testParent, 'community-test-'));
const cities = [{id:'mogadishu', name:'Mogadishu'}, {id:'jowhar', name:'Jowhar'}];
const REVIEW_KEY = 'reviewer-key-for-tests-0123456789', OWNER_KEY = 'owner-stats-key-for-tests-0123456789';
const reviewers = reviewKeysFrom({statsKey:OWNER_KEY, reviewKeys:` short, ${REVIEW_KEY} `});
// A report saved before the review hold has no review field and stays public.
await writeFile(path.join(folder, 'reports.json'), JSON.stringify({version:1, reports:[{id:'00000000-0000-4000-8000-000000000001', cityId:'jowhar', cityName:'Jowhar', category:'rain', observedAt:'2026-10-01T08:00:00.000Z', receivedAt:'2026-10-01T08:05:00.000Z', status:'unverified', description:'Saved before the review hold.', author:'Anonymous', media:[], comments:[], receiptHash:'0'.repeat(64)}]}));
let handler = createCommunityHandler({dataDir:folder, cities, reviewers});
const server = http.createServer(async (req, res) => {
  if (!await handler(req, res, new URL(req.url, 'http://localhost'))) { res.writeHead(404); res.end('fallback'); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
let assertions = 0;
const equal = (actual, expected) => { assert.equal(actual, expected); assertions++; };
const ok = value => { assert.ok(value); assertions++; };
const request = async (endpoint, options = {}) => {
  const response = await fetch(origin + endpoint, options);
  const body = await response.json();
  return {response, body};
};
const base = {cityId:'mogadishu', category:'flood', observedAt:new Date(Date.now()-60000).toISOString(), description:'Water is covering this street following heavy rain.', author:'Neighbour', latitude:2.0469, longitude:45.3182, deaths:null, injuries:2, damagedProperties:3};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const form = (payload = base, files = []) => {
  const result = new FormData(); result.set('payload', JSON.stringify(payload));
  for (const file of files) result.append('media', new Blob([file.bytes], {type:file.type}), file.name || 'evidence.png');
  return result;
};
const postHeld = (payload, files, headers = {}) => request('/api/community/reports', {method:'POST', headers:{Origin:origin, ...headers}, body:form(payload, files)});
const review = (id, decision, key = REVIEW_KEY) => request(`/api/community/review/${id}`, {method:'POST', headers:{Origin:origin, 'Content-Type':'application/json', 'X-Review-Key':key}, body:JSON.stringify({decision})});
// The checks below are about publishing, so each accepted report is approved straight away.
const post = async (payload, files, headers) => { const made = await postHeld(payload, files, headers); if (made.response.status === 201) equal((await review(made.body.report.id, 'approve')).response.status, 200); return made; };

try {
  equal((await fetch(origin + '/not-community')).status, 404);
  let result = await request('/api/community/reports');
  equal(result.response.status, 200); equal(result.body.total, 1); equal(result.body.reports[0].description, 'Saved before the review hold.');
  equal((await review('00000000-0000-4000-8000-000000000001', 'remove', OWNER_KEY)).response.status, 200);
  result = await request('/api/community/reports');
  equal(result.response.status, 200); equal(result.body.reports.length, 0); equal(result.body.total, 0);
  // Review hold (owner, 2026-10-21): a new report, its media and its comments stay private until approved.
  const held = await postHeld(base, [{bytes:png, type:'image/png', name:'held.png'}]);
  equal(held.response.status, 201); equal(held.body.report.review, 'pending'); equal(held.body.report.status, 'unverified');
  result = await request('/api/community/reports'); equal(result.body.total, 0);
  const heldMedia = origin + held.body.report.media[0].url;
  equal((await fetch(heldMedia)).status, 401);
  equal((await fetch(heldMedia, {headers:{'X-Review-Key':'w'.repeat(40)}})).status, 403);
  let heldResponse = await fetch(heldMedia, {headers:{'X-Review-Key':REVIEW_KEY}}); equal(heldResponse.status, 200); equal(heldResponse.headers.get('cache-control'), 'no-store');
  result = await request(`/api/community/reports/${held.body.report.id}/comments`, {method:'POST', headers:{Origin:origin, 'Content-Type':'application/json'}, body:JSON.stringify({body:'Seen it too.'})}); equal(result.response.status, 404);
  equal((await request('/api/community/review')).response.status, 401);
  equal((await request('/api/community/review', {headers:{'X-Review-Key':'short'}})).response.status, 403);
  result = await request('/api/community/review', {headers:{'X-Review-Key':REVIEW_KEY}});
  equal(result.response.status, 200); equal(result.body.reviewer, 'reviewer'); equal(result.body.pendingTotal, 1); equal(result.body.pending[0].id, held.body.report.id); ok(!JSON.stringify(result.body).includes('receiptHash'));
  equal((await request('/api/community/review', {headers:{'X-Review-Key':OWNER_KEY}})).body.reviewer, 'owner');
  equal((await review(held.body.report.id, 'publish')).response.status, 400);
  equal((await review(held.body.report.id, 'approve', 'x'.repeat(40))).response.status, 403);
  result = await request(`/api/community/review/${held.body.report.id}`, {method:'POST', headers:{Origin:'https://attacker.example', 'Content-Type':'application/json', 'X-Review-Key':REVIEW_KEY}, body:JSON.stringify({decision:'approve'})}); equal(result.response.status, 403);
  equal((await review(held.body.report.id, 'approve')).response.status, 200);
  result = await request('/api/community/reports'); equal(result.body.total, 1); equal(result.body.reports[0].review, 'approved'); equal(result.body.reports[0].status, 'unverified'); ok(!('reviewedBy' in result.body.reports[0]));
  equal((await fetch(heldMedia)).status, 200);
  equal((await review(held.body.report.id, 'remove')).response.status, 200);
  result = await request('/api/community/reports'); equal(result.body.total, 0); equal((await fetch(heldMedia)).status, 404); equal((await readdir(path.join(folder,'media'))).length, 0);
  equal((await review(held.body.report.id, 'approve')).response.status, 404);
  result = await post(base, [{bytes:png, type:'image/png', name:'../../photo.png'}]);
  equal(result.response.status, 201);
  const first = result.body.report, receipt = result.body.receiptToken;
  equal(first.cityName, 'Mogadishu'); equal(first.status, 'unverified'); equal(first.deaths, null); equal(first.injuries, 2);
  equal(first.media.length, 1); equal(first.media[0].name, 'photo.png'); equal(first.media[0].type, 'image/png');
  ok(first.media[0].url.startsWith('/api/community/media/')); ok(!('receiptHash' in first)); equal(receipt.length, 64); equal(receipt, result.body.receipt);
  result = await request('/api/community/reports?city=mogadishu'); equal(result.body.reports.length, 1); equal(result.body.reports[0].id, first.id); ok(!JSON.stringify(result.body).includes(receipt)); ok(!JSON.stringify(result.body).includes('receiptHash'));
  result = await request('/api/community/reports?city=jowhar'); equal(result.body.reports.length, 0);
  result = await request('/api/community/reports?city=unknown'); equal(result.response.status, 400);
  result = await request('/api/community/reports?limit=999'); equal(result.response.status, 400);
  let mediaResponse = await fetch(origin + first.media[0].url); equal(mediaResponse.status, 200); equal(mediaResponse.headers.get('content-type'), 'image/png'); equal(mediaResponse.headers.get('x-content-type-options'), 'nosniff'); equal(Buffer.compare(Buffer.from(await mediaResponse.arrayBuffer()), png), 0);
  mediaResponse = await fetch(origin + first.media[0].url, {headers:{Range:'bytes=0-7'}}); equal(mediaResponse.status, 206); equal(mediaResponse.headers.get('content-range'), `bytes 0-7/${png.length}`); equal((await mediaResponse.arrayBuffer()).byteLength, 8);
  mediaResponse = await fetch(origin + first.media[0].url, {method:'HEAD'}); equal(mediaResponse.status, 200); equal((await mediaResponse.arrayBuffer()).byteLength, 0);
  mediaResponse = await fetch(origin + first.media[0].url, {headers:{Range:'bytes=999999-'}}); equal(mediaResponse.status, 416);
  result = await post({...base, cityId:'fake-city'}); equal(result.response.status, 400);
  result = await post({...base, latitude:999}); equal(result.response.status, 400);
  result = await post({...base, longitude:null}); equal(result.response.status, 400);
  result = await post({...base, deaths:-1}); equal(result.response.status, 400);
  result = await post({...base, injuries:'2'}); equal(result.response.status, 400);
  result = await post({...base, observedAt:new Date(Date.now()+86400000).toISOString()}); equal(result.response.status, 400);
  result = await post({...base, observedAt:'2026-02-30T12:00:00Z'}); equal(result.response.status, 400);
  result = await post({...base, observedAt:'2026-01-01T12:00:00'}); equal(result.response.status, 400);
  // District and landmark: optional (blank is unknown), trimmed, bounded, plain text.
  equal(first.district, null); equal(first.landmark, null);
  result = await post({...base, district:'x'.repeat(81)}); equal(result.response.status, 400);
  result = await post({...base, landmark:'x'.repeat(121)}); equal(result.response.status, 400);
  result = await post({...base, district:'Hodan\u0007'}); equal(result.response.status, 400);
  result = await post({...base, landmark:42}); equal(result.response.status, 400);
  result = await post({...base, district:'  Hodan  ', landmark:'Near Bakara market'}); equal(result.response.status, 201);
  equal(result.body.report.district, 'Hodan'); equal(result.body.report.landmark, 'Near Bakara market');
  const placed = result.body.report, placedReceipt = result.body.receiptToken;
  result = await request('/api/community/reports?city=mogadishu'); ok(result.body.reports.some(report => report.id === placed.id && report.district === 'Hodan' && report.landmark === 'Near Bakara market'));
  result = await request(`/api/community/reports/${placed.id}`, {method:'DELETE', headers:{Origin:origin, 'Content-Type':'application/json'}, body:JSON.stringify({receipt:placedReceipt})}); equal(result.response.status, 200);
  // Mogadishu: a district from the list or none. Other cities: free text.
  // Date range: applied by the server before the newest-N cut, in whole East Africa Time days.
  const lateDay = await post({...base, observedAt:'2026-10-13T20:59:00Z'}), nextDay = await post({...base, observedAt:'2026-10-13T21:00:00Z'});
  equal(lateDay.response.status, 201); equal(nextDay.response.status, 201);
  const lateId = lateDay.body.report.id, nextId = nextDay.body.report.id;
  result = await request('/api/community/reports?city=mogadishu&from=2026-10-14&to=2026-10-14'); equal(result.response.status, 200);
  ok(result.body.reports.some(report => report.id === nextId)); ok(!result.body.reports.some(report => report.id === lateId)); equal(result.body.from, '2026-10-14'); equal(result.body.to, '2026-10-14');
  result = await request('/api/community/reports?to=2026-10-13'); ok(result.body.reports.some(report => report.id === lateId)); ok(!result.body.reports.some(report => report.id === nextId));
  result = await request('/api/community/reports?limit=1'); ok(!result.body.reports.some(report => report.id === lateId));
  result = await request('/api/community/reports?limit=1&from=2026-10-13&to=2026-10-13'); equal(result.body.reports.length, 1); equal(result.body.reports[0].id, lateId);
  result = await request('/api/community/reports?from=2026-02-30'); equal(result.response.status, 400);
  result = await request('/api/community/reports?from=13%2F10%2F2026'); equal(result.response.status, 400);
  result = await request('/api/community/reports?from=2026-10-14&to=2026-10-13'); equal(result.response.status, 400);
  for (const made of [lateDay, nextDay]) { result = await request(`/api/community/reports/${made.body.report.id}`, {method:'DELETE', headers:{Origin:origin, 'Content-Type':'application/json'}, body:JSON.stringify({receipt:made.body.receiptToken})}); equal(result.response.status, 200); }
  result = await post({...base, district:'Nowhere'}); equal(result.response.status, 400);
  // Landmark type: from the list or none.
  result = await post({...base, landmarkType:'castle'}); equal(result.response.status, 400);
  result = await post({...base, landmarkType:7}); equal(result.response.status, 400);
  result = await post({...base, landmarkType:'bridge', landmark:'Siinka Dheer'}); equal(result.response.status, 201); equal(result.body.report.landmarkType, 'bridge'); equal(result.body.report.landmark, 'Siinka Dheer');
  result = await request(`/api/community/reports/${result.body.report.id}`, {method:'DELETE', headers:{Origin:origin, 'Content-Type':'application/json'}, body:JSON.stringify({receipt:result.body.receiptToken})}); equal(result.response.status, 200);
  result = await post({...base}); equal(result.response.status, 201); equal(result.body.report.landmarkType, null);
  result = await request(`/api/community/reports/${result.body.report.id}`, {method:'DELETE', headers:{Origin:origin, 'Content-Type':'application/json'}, body:JSON.stringify({receipt:result.body.receiptToken})}); equal(result.response.status, 200);
  result = await post({...base, cityId:'jowhar', district:'Hantiwadaag'}); equal(result.response.status, 201); equal(result.body.report.district, 'Hantiwadaag');
  result = await request(`/api/community/reports/${result.body.report.id}`, {method:'DELETE', headers:{Origin:origin, 'Content-Type':'application/json'}, body:JSON.stringify({receipt:result.body.receiptToken})}); equal(result.response.status, 200);
  result = await post({...base, sourceUrl:'javascript:alert(1)'}); equal(result.response.status, 400);
  result = await post(base, [{bytes:Buffer.from('<script>bad</script>'), type:'image/png'}]); equal(result.response.status, 415);
  result = await post(base, [{bytes:Buffer.from('<svg/>'), type:'image/svg+xml'}]); equal(result.response.status, 415);
  result = await post(base, Array.from({length:5}, () => ({bytes:png, type:'image/png'}))); equal(result.response.status, 400);
  result = await post(base, [], {Origin:'https://attacker.example'}); equal(result.response.status, 403);
  result = await post(base, [], {'Sec-Fetch-Site':'cross-site'}); equal(result.response.status, 403);
  result = await request('/api/community/reports', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(base)}); equal(result.response.status, 415);
  result = await request(`/api/community/reports/${first.id}/comments`, {method:'POST', headers:{Origin:origin, 'Content-Type':'application/json'}, body:JSON.stringify({author:'Responder', body:'This report needs local verification.'})});
  equal(result.response.status, 201); equal(result.body.comment.author, 'Responder'); ok(result.body.comment.id);
  result = await request(`/api/community/reports/${first.id}/comments`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({body:'x'})}); equal(result.response.status, 400);
  // A new handler simulates process restart; submissions and discussion survive.
  handler = createCommunityHandler({dataDir:folder, cities, reviewers});
  result = await request('/api/community/reports'); equal(result.body.reports[0].comments.length, 1); equal(result.body.reports[0].media.length, 1);
  const disk = JSON.parse(await readFile(path.join(folder,'reports.json'),'utf8')); ok(disk.reports[0].receiptHash); ok(!JSON.stringify(disk).includes(receipt));
  // Concurrent report writes are serialized; neither update overwrites the other.
  const simultaneous = await Promise.all([post({...base, cityId:'jowhar', latitude:null, longitude:null, description:'First concurrent community flood report.'}), post({...base, description:'Second concurrent community rain report.', category:'rain', injuries:null, damagedProperties:null})]);
  equal(simultaneous[0].response.status, 201); equal(simultaneous[1].response.status, 201);
  result = await request('/api/community/reports?limit=1'); equal(result.body.total, 3); equal(result.body.reports.length, 1); equal(result.body.truncated, true);
  const unknownCount = simultaneous[1].body.report; equal(unknownCount.injuries, null); equal(unknownCount.deaths, null);
  result = await request(`/api/community/reports/${first.id}`, {method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({receipt:'a'.repeat(64)})}); equal(result.response.status, 403);
  result = await request(`/api/community/reports/${first.id}`, {method:'DELETE', headers:{Origin:origin, 'Content-Type':'application/json'}, body:JSON.stringify({receipt})}); equal(result.response.status, 200); equal(result.body.removed, true);
  result = await request('/api/community/reports'); equal(result.body.total, 2);
  mediaResponse = await fetch(origin + first.media[0].url); equal(mediaResponse.status, 404); equal((await readdir(path.join(folder,'media'))).length, 0);
  result = await request(`/api/community/reports/${simultaneous[0].body.report.id}`, {method:'DELETE', headers:{Authorization:`Bearer ${simultaneous[0].body.receiptToken}`}}); equal(result.response.status, 200);
  // Oversized upload is rejected before any report or media becomes public.
  const large = Buffer.alloc(50 * 1024 * 1024 + 1); png.copy(large);
  result = await post(base, [{bytes:large, type:'image/png'}]); equal(result.response.status, 413);
  result = await request('/api/community/reports'); equal(result.body.total, 1); equal((await readdir(path.join(folder,'media'))).length, 0);
  // Wrong review keys are counted per address and day; after 20 the right key waits too.
  handler = createCommunityHandler({dataDir:folder, cities, reviewers});
  for (let attempt = 0; attempt < 20; attempt++) equal((await request('/api/community/review', {headers:{'X-Review-Key':'guess-'.repeat(6)}})).response.status, 403);
  equal((await request('/api/community/review', {headers:{'X-Review-Key':REVIEW_KEY}})).response.status, 429);
  // Without any review key the queue is closed and new reports simply wait.
  handler = createCommunityHandler({dataDir:folder, cities});
  result = await request('/api/community/review', {headers:{'X-Review-Key':REVIEW_KEY}}); equal(result.response.status, 403); equal(result.body.error, 'Report review is not set up on this server.');
  console.log(`Community API: ${assertions} assertions passed (review hold, durable reports/media/comments, unknown counts, receipt removal, origin/upload validation, ranges and concurrent writes).`);
} finally {
  server.close(); await once(server, 'close');
  assert.ok(path.resolve(folder).startsWith(path.resolve(testParent) + path.sep));
  await rm(folder, {recursive:true, force:true});
}
