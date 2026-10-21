import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {createPartners, observedTime, FIELD_COLUMNS} from './somalia-flood-watch/partners.mjs';

const OWNER = 'owner-stats-key-for-partner-tests-0123';
async function start(dataDir, options = {}) {
  let handler = createPartners({dataDir, statsKey:OWNER, ...options});
  const server = http.createServer(async (req, res) => { if (!await handler(req, res, new URL(req.url, 'http://localhost'))) { res.writeHead(404); res.end(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (endpoint, {method = 'GET', body, owner, partner, headers = {}} = {}) => {
    const response = await fetch(origin + endpoint, {method, headers:{Origin:origin, ...(body ? {'Content-Type':'application/json'} : {}), ...(owner ? {'X-Stats-Key':owner} : {}), ...(partner ? {'X-Partner-Key':partner} : {}), ...headers}, body:body ? JSON.stringify(body) : undefined});
    return {status:response.status, body:await response.json()};
  };
  return {origin, call, restart:() => { handler = createPartners({dataDir, statsKey:OWNER, ...options}); }, close:async () => { server.close(); await once(server, 'close'); }};
}
const field = (extra = {}) => ({observed_at:'2026-10-20 08:30', category:'flood', site:'Camp A', description:'Water 40 cm deep at the camp entrance.', water_depth_cm:'40', households_affected:'12', road_access:'limited', ...extra});

test('the owner makes, renews, revokes and deletes partner links; only a hash is stored', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-partners-')), app = await start(dataDir);
  try {
    assert.equal((await app.call('/api/partners')).status, 401);
    assert.equal((await app.call('/api/partners', {owner:'x'.repeat(40)})).status, 403);
    let result = await app.call('/api/partners', {method:'POST', owner:OWNER, body:{name:'Example Relief'}});
    assert.equal(result.status, 201); assert.equal(result.body.partner.name, 'Example Relief'); assert.equal(result.body.key.length, 43);
    const {key} = result.body, partnerId = result.body.partner.id;
    assert.equal((await app.call('/api/partners', {method:'POST', owner:OWNER, body:{name:'example relief'}})).status, 409, 'names are unique');
    const disk = await readFile(path.join(dataDir, 'partners.json'), 'utf8');
    assert.ok(!disk.includes(key), 'the link key is never stored'); assert.ok(!JSON.stringify((await app.call('/api/partners', {owner:OWNER})).body).includes('keyHash'));
    assert.equal((await app.call('/api/partner', {partner:key})).body.partner.name, 'Example Relief');
    result = await app.call(`/api/partners/${partnerId}`, {method:'POST', owner:OWNER, body:{action:'new-link'}});
    assert.equal(result.status, 200); assert.notEqual(result.body.key, key);
    assert.equal((await app.call('/api/partner', {partner:key})).status, 403, 'a new link stops the old one');
    const second = result.body.key;
    assert.equal((await app.call('/api/partner', {partner:second})).status, 200);
    assert.equal((await app.call(`/api/partners/${partnerId}`, {method:'POST', owner:OWNER, body:{action:'revoke'}})).body.partner.revokedAt !== null, true);
    assert.equal((await app.call('/api/partner', {partner:second})).status, 403, 'a revoked link stops working');
    assert.equal((await app.call(`/api/partners/${partnerId}`, {method:'POST', owner:OWNER, body:{action:'delete', confirmName:'Wrong'}})).status, 400);
    assert.equal((await app.call(`/api/partners/${partnerId}`, {method:'POST', owner:OWNER, body:{action:'delete', confirmName:'Example Relief'}})).status, 200);
    assert.deepEqual((await app.call('/api/partners', {owner:OWNER})).body.partners, []);
    assert.equal((await app.call('/api/partners', {method:'POST', owner:OWNER, body:{name:'Other'}, headers:{Origin:'https://attacker.example'}})).status, 403);
  } finally { await app.close(); await rm(dataDir, {recursive:true, force:true}); }
});

test('a workspace keeps its own sites and review notes, private from other partners, across a restart', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-partners-')), app = await start(dataDir);
  try {
    const a = (await app.call('/api/partners', {method:'POST', owner:OWNER, body:{name:'Partner A'}})).body.key;
    const b = (await app.call('/api/partners', {method:'POST', owner:OWNER, body:{name:'Partner B'}})).body.key;
    assert.equal((await app.call('/api/partner')).status, 401);
    let result = await app.call('/api/partner/sites', {method:'POST', partner:a, body:{name:'Camp A', kind:'camp', latitude:2.05, longitude:45.31, note:'Main IDP site'}});
    assert.equal(result.status, 201); const site = result.body.site;
    assert.equal((await app.call('/api/partner/sites', {method:'POST', partner:a, body:{name:'camp a', latitude:2.1, longitude:45.3}})).status, 409);
    assert.equal((await app.call('/api/partner/sites', {method:'POST', partner:a, body:{name:'Far away', latitude:40, longitude:10}})).status, 400);
    assert.equal((await app.call('/api/partner/sites', {method:'POST', partner:a, body:{name:'No place'}})).status, 400);
    assert.equal((await app.call(`/api/partner/sites/${site.id}`, {method:'POST', partner:a, body:{name:'Camp A', kind:'camp', latitude:2.0512345, longitude:45.31, note:'Moved gate'}})).body.site.latitude, 2.05123);
    const reportId = '11111111-2222-4333-8444-555555555555';
    result = await app.call(`/api/partner/reviews/${reportId}`, {method:'POST', partner:a, body:{stage:'checked', note:'Our team saw it.', by:'Amina'}});
    assert.equal(result.status, 200);
    assert.equal((await app.call(`/api/partner/reviews/${reportId}`, {method:'POST', partner:a, body:{stage:'verified'}})).status, 400, 'there is no verified stage');
    const other = (await app.call('/api/partner', {partner:b})).body;
    assert.deepEqual(other.sites, []); assert.deepEqual(other.reviews, {}, 'partner B sees none of partner A');
    app.restart();
    const mine = (await app.call('/api/partner', {partner:a})).body;
    assert.equal(mine.sites[0].note, 'Moved gate'); assert.equal(mine.reviews[reportId].stage, 'checked'); assert.equal(mine.reviews[reportId].by, 'Amina');
    assert.equal((await app.call(`/api/partner/sites/${site.id}`, {method:'DELETE', partner:a})).status, 200);
    assert.deepEqual((await app.call('/api/partner', {partner:a})).body.sites, []);
    await app.call(`/api/partner/reviews/${reportId}`, {method:'POST', partner:a, body:{stage:'unreviewed'}});
    assert.deepEqual((await app.call('/api/partner', {partner:a})).body.reviews, {}, 'clearing a note removes it');
  } finally { await app.close(); await rm(dataDir, {recursive:true, force:true}); }
});

test('field records: row checks, duplicates, corrections, and they stay unverified', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-partners-')), app = await start(dataDir);
  try {
    const key = (await app.call('/api/partners', {method:'POST', owner:OWNER, body:{name:'Field Team'}})).body.key;
    let result = await app.call('/api/partner/field', {method:'POST', partner:key, body:{records:[
      field({record_id:'uuid:aaa'}),
      field({record_id:'uuid:bbb', site:'Camp B', category:'rain', description:'Heavy rain since dawn.'}),
      field({record_id:'uuid:aaa'}),
      field({record_id:'', observed_at:'2026-10-20 09:10'}),
      field({category:'tsunami'}),
      field({observed_at:'2026-02-30 10:00'}),
      field({site:'', city:'', description:'No place given at all.'}),
      field({households_affected:'2.5'})
    ]}});
    assert.equal(result.status, 201);
    assert.equal(result.body.added.length, 2);
    assert.deepEqual(result.body.duplicates.map(item => [item.row, item.reason]), [[3, 'record-id'], [4, 'same-observation']]);
    assert.deepEqual(result.body.errors.map(item => item.row), [5, 6, 7, 8]);
    const first = result.body.added[0];
    assert.equal(first.status, 'unverified'); assert.equal(first.stage, 'unreviewed'); assert.equal(first.observedAt, '2026-10-20T05:30:00.000Z', 'a bare time is East Africa Time');
    assert.equal(first.waterDepthCm, 40); assert.equal(first.householdsAffected, 12); assert.equal(first.roadAccess, 'limited');
    result = await app.call('/api/partner/field', {method:'POST', partner:key, body:{records:[field({record_id:'uuid:ccc', corrects:'uuid:aaa', water_depth_cm:'60', description:'Correction: water 60 cm deep.'})]}});
    assert.equal(result.body.added[0].corrects, first.id); assert.deepEqual(result.body.corrected, [first.id]);
    assert.equal((await app.call('/api/partner/field', {method:'POST', partner:key, body:{records:[field({corrects:'uuid:zzz'})]}})).body.errors[0].message, 'The record it corrects was not found.');
    const stored = (await app.call('/api/partner', {partner:key})).body.field;
    assert.equal(stored.find(item => item.id === first.id).correctedBy, result.body.added[0].id);
    result = await app.call(`/api/partner/field/${first.id}`, {method:'POST', partner:key, body:{stage:'checked', note:'Confirmed by phone.'}});
    assert.equal(result.body.record.stage, 'checked'); assert.equal(result.body.record.status, 'unverified', 'a partner check never makes a record verified');
    assert.equal((await app.call('/api/partner/field', {method:'POST', partner:key, body:{records:Array.from({length:501}, () => field())}})).status, 413);
    assert.equal((await app.call('/api/partner/field', {method:'POST', partner:key, body:{records:[]}})).status, 400);
  } finally { await app.close(); await rm(dataDir, {recursive:true, force:true}); }
});

test('observed times, the column list, and wrong-key limits', async () => {
  assert.equal(observedTime('2026-10-20T08:30:00Z'), '2026-10-20T08:30:00.000Z');
  assert.equal(observedTime('2026-10-20T11:30:00+03:00'), '2026-10-20T08:30:00.000Z');
  assert.equal(observedTime('2026-10-20'), '2026-10-19T21:00:00.000Z');
  assert.throws(() => observedTime(new Date(Date.now() + 86400000).toISOString()), /future/);
  assert.throws(() => observedTime('20/10/2026'), /date/);
  assert.deepEqual(FIELD_COLUMNS.slice(0, 4), ['record_id', 'corrects', 'observed_at', 'category']);
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-partners-')), app = await start(dataDir);
  try {
    for (let i = 0; i < 20; i++) assert.equal((await app.call('/api/partner', {partner:'guess-' + i})).status, 403);
    assert.equal((await app.call('/api/partners', {owner:OWNER})).status, 429, 'after 20 wrong keys the address waits a day');
  } finally { await app.close(); await rm(dataDir, {recursive:true, force:true}); }
  const unset = await mkdtemp(path.join(os.tmpdir(), 'elnino-partners-')), off = await start(unset, {statsKey:''});
  try { assert.equal((await off.call('/api/partners', {owner:OWNER})).body.error, 'The private view is not set up.'); }
  finally { await off.close(); await rm(unset, {recursive:true, force:true}); }
});
