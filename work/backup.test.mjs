import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {createServer} from './somalia-flood-watch/server.mjs';
import {createBackup, backupFromEnv} from './somalia-flood-watch/backup.mjs';

const ZONE = 'test-zone', KEY = 'test-key-not-real', PREFIX = 'el-nino-watch';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const quiet = {log() {}, error() {}};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// In-memory stand-in for the Bunny Storage HTTP API: PUT with Checksum,
// GET file, GET dir/ listing (200 [] for a missing directory), DELETE file or dir/.
async function fakeStorage() {
  const files = new Map(), calls = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks), rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    calls.push(`${req.method} ${rel}`);
    if (req.headers.accesskey !== KEY) { res.writeHead(401); return res.end('{"HttpCode":401}'); }
    if (!rel.startsWith(`${ZONE}/`)) { res.writeHead(404); return res.end(); }
    const key = rel.slice(ZONE.length + 1);
    if (req.method === 'PUT') {
      if (req.headers.checksum !== sha(body).toUpperCase()) { res.writeHead(400); return res.end('checksum'); }
      files.set(key, body); res.writeHead(201); return res.end();
    }
    if (req.method === 'GET' && key.endsWith('/')) {
      const children = new Map();
      for (const [name, bytes] of files) if (name.startsWith(key)) {
        const rest = name.slice(key.length), dir = rest.includes('/');
        children.set(dir ? rest.split('/')[0] : rest, {ObjectName:dir ? rest.split('/')[0] : rest, IsDirectory:dir, Length:dir ? 0 : bytes.length});
      }
      res.writeHead(200, {'Content-Type':'application/json'}); return res.end(JSON.stringify([...children.values()]));
    }
    if (req.method === 'GET') { if (!files.has(key)) { res.writeHead(404); return res.end(); } res.writeHead(200); return res.end(files.get(key)); }
    if (req.method === 'DELETE') {
      const doomed = key.endsWith('/') ? [...files.keys()].filter(name => name.startsWith(key)) : files.has(key) ? [key] : [];
      doomed.forEach(name => files.delete(name)); res.writeHead(doomed.length ? 200 : 404); return res.end();
    }
    res.writeHead(405); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {files, calls, endpoint:`http://127.0.0.1:${server.address().port}`, close:() => new Promise(resolve => server.close(resolve))};
}
const names = (files, dir) => [...new Set([...files.keys()].filter(name => name.startsWith(`${PREFIX}/${dir}/`)).map(name => name.slice(PREFIX.length + dir.length + 2).split('/')[0]))].sort();
const backupFor = (storage, dataDir, extra = {}) => createBackup({dataDir, zone:ZONE, key:KEY, endpoint:storage.endpoint, prefix:PREFIX, log:quiet, retryDelayMs:1, ...extra});

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {origin:`http://127.0.0.1:${server.address().port}`, close:() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); }};
}
async function postReport(origin, cityId, withPhoto) {
  const form = new FormData();
  form.set('payload', JSON.stringify({cityId, category:'rain', observedAt:new Date(Date.now() - 60000).toISOString(), description:'Synthetic backup test only; this is not a real weather report.', deaths:null, injuries:0, damagedProperties:null}));
  if (withPhoto) form.append('media', new Blob([PNG], {type:'image/png'}), 'backup-check.png');
  const response = await fetch(origin + '/api/community/reports', {method:'POST', headers:{Origin:origin}, body:form});
  assert.equal(response.status, 201);
  return response.json();
}

test('real reports and photos back up, skip unchanged runs, survive a restart and restore into a working server', async () => {
  const storage = await fakeStorage(), dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-backup-'));
  try {
    const empty = backupFor(storage, dataDir);
    assert.equal((await empty.runOnce()).result, 'nothing-to-back-up');
    assert.ok(storage.calls.some(call => call.startsWith('GET ') && call.endsWith('/snapshots/')), 'an empty run still reaches the store');
    const wrongKeyEmpty = createBackup({dataDir, zone:ZONE, key:'wrong', endpoint:storage.endpoint, prefix:PREFIX, log:quiet});
    assert.equal((await wrongKeyEmpty.runOnce()).result, 'failed', 'a wrong key shows before the first report exists');
    assert.deepEqual(names(storage.files, 'snapshots'), []);

    const app = await listen(createServer({dataDir}));
    const first = await postReport(app.origin, 'mogadishu', true);
    await postReport(app.origin, 'galkayo', false);
    await app.close();

    const backup = backupFor(storage, dataDir);
    const run = await backup.runOnce(new Date('2026-10-14T10:00:00Z'));
    assert.equal(run.result, 'snapshot');
    assert.equal(run.reports, 2);
    assert.equal(run.uploaded, 1);
    assert.deepEqual(names(storage.files, 'snapshots'), ['2026-10-14T10-00-00Z']);
    assert.deepEqual(storage.files.get(`${PREFIX}/snapshots/2026-10-14T10-00-00Z/reports.json`), await readFile(path.join(dataDir, 'reports.json')));
    const [mediaName] = names(storage.files, 'media');
    assert.match(mediaName, new RegExp(`^${first.report.media[0].id}\\.png$`));
    assert.deepEqual(storage.files.get(`${PREFIX}/media/${mediaName}`), PNG);

    const again = await backup.runOnce(new Date('2026-10-14T16:00:00Z'));
    assert.equal(again.result, 'unchanged');
    assert.equal(again.uploaded, 0);
    const restarted = backupFor(storage, dataDir);
    assert.equal((await restarted.runOnce(new Date('2026-10-14T22:00:00Z'))).result, 'unchanged', 'a restart compares with the newest stored snapshot');
    assert.equal(names(storage.files, 'snapshots').length, 1);
    assert.equal(backup.status().lastResult, 'unchanged');
    assert.equal(backup.status().reports, 2);

    assert.equal(await backupFor(storage, dataDir).restoreIfEmpty(), false, 'existing storage is never overwritten');

    await rm(dataDir, {recursive:true, force:true});
    await mkdir(dataDir);
    assert.equal(await backupFor(storage, dataDir, {restoreIfEmpty:false}).restoreIfEmpty(), false);
    assert.deepEqual(await readdir(dataDir), []);
    assert.equal(await backupFor(storage, dataDir).restoreIfEmpty(), true);
    // New reports are held for review (owner, 2026-10-21): they come back still held, with their photo.
    const key = 'backup-test-review-key-0123456789';
    const restored = await listen(createServer({dataDir, reviewKeys:key}));
    assert.equal((await (await fetch(restored.origin + '/api/community/reports')).json()).total, 0);
    const list = await (await fetch(restored.origin + '/api/community/review', {headers:{'X-Review-Key':key}})).json();
    assert.equal(list.pendingTotal, 2);
    const photo = await fetch(restored.origin + list.pending.find(report => report.id === first.report.id).media[0].url, {headers:{'X-Review-Key':key}});
    assert.equal(photo.status, 200);
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), PNG);
    await restored.close();
  } finally { await storage.close(); await rm(dataDir, {recursive:true, force:true}); }
});

test('snapshots expire by age but the newest three stay, and media no kept snapshot names is pruned', async () => {
  const storage = await fakeStorage(), dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-retention-'));
  const id = letter => letter.repeat(40), t0 = Date.parse('2026-01-01T00:00:00Z'), hour = 3600000, day = 24 * hour;
  const save = reports => writeFile(path.join(dataDir, 'reports.json'), JSON.stringify({version:1, reports}));
  const report = (name, media) => ({id:name, media:media.map(letter => ({id:id(letter), type:'image/png'}))});
  try {
    await mkdir(path.join(dataDir, 'media'));
    for (const letter of 'abc') await writeFile(path.join(dataDir, 'media', `${id(letter)}.png`), PNG);
    const backup = backupFor(storage, dataDir, {retentionDays:14});
    await save([report('r1', ['a']), report('r2', ['b'])]);          assert.equal((await backup.runOnce(new Date(t0))).result, 'snapshot');
    await rm(path.join(dataDir, 'media', `${id('a')}.png`));
    await save([report('r2', ['b'])]);                               await backup.runOnce(new Date(t0 + hour));
    await save([report('r2', ['b']), report('r3', ['c'])]);          await backup.runOnce(new Date(t0 + 2 * hour));
    await save([report('r2', ['b']), report('r3', ['c']), report('r4', [])]); await backup.runOnce(new Date(t0 + 3 * hour));
    assert.deepEqual(names(storage.files, 'media'), ['a', 'b', 'c'].map(letter => `${id(letter)}.png`));

    await save([report('r2', ['b']), report('r3', ['c']), report('r4', []), report('r5', [])]);
    const late = await backup.runOnce(new Date(t0 + 15 * day));
    assert.equal(late.expired, 2);
    assert.equal(late.pruned, 1);
    assert.deepEqual(names(storage.files, 'snapshots'), ['2026-01-01T02-00-00Z', '2026-01-01T03-00-00Z', '2026-01-16T00-00-00Z']);
    assert.deepEqual(names(storage.files, 'media'), ['b', 'c'].map(letter => `${id(letter)}.png`), "a deleted report's photo leaves the backup once its snapshots expire");

    const quietMonth = await backup.runOnce(new Date(t0 + 40 * day));
    assert.equal(quietMonth.result, 'unchanged');
    assert.equal(quietMonth.expired, 0, 'the newest three survive however old they are');
    assert.equal(names(storage.files, 'snapshots').length, 3);
  } finally { await storage.close(); await rm(dataDir, {recursive:true, force:true}); }
});

test('storage failures are reported without secrets and never break the app; status is opt-in', async () => {
  const storage = await fakeStorage(), dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-backup-fail-'));
  try {
    await writeFile(path.join(dataDir, 'reports.json'), JSON.stringify({version:1, reports:[]}));
    const errors = [];
    const wrongKey = createBackup({dataDir, zone:ZONE, key:'wrong', endpoint:storage.endpoint, log:{log() {}, error:message => errors.push(message)}});
    const failed = await wrongKey.runOnce();
    assert.equal(failed.result, 'failed');
    assert.match(wrongKey.status().lastError, /HTTP 401/);
    for (const text of [JSON.stringify(wrongKey.status()), ...errors]) { assert.ok(!text.includes(ZONE)); assert.ok(!text.includes('wrong')); }

    await rm(path.join(dataDir, 'reports.json'));
    const unreachable = createBackup({dataDir, zone:ZONE, key:KEY, endpoint:'http://127.0.0.1:9', log:quiet, retryDelayMs:1});
    assert.equal(await unreachable.restoreIfEmpty(), false, 'an unreachable store lets the app start empty');

    assert.equal(backupFromEnv({dataDir, env:{}}), null);
    assert.equal(backupFromEnv({dataDir, env:{BACKUP_STORAGE_ZONE:ZONE}}), null);
    const configured = backupFromEnv({dataDir, env:{BACKUP_STORAGE_ZONE:ZONE, BACKUP_STORAGE_KEY:KEY, BACKUP_INTERVAL_HOURS:'x', BACKUP_RETENTION_DAYS:'30'}, log:quiet});
    assert.equal(configured.status().intervalHours, 6, 'an invalid interval falls back to the default');
    assert.equal(configured.status().retentionDays, 30);

    const off = await listen(createServer({dataDir}));
    assert.deepEqual(await (await fetch(off.origin + '/api/backup-status')).json(), {enabled:false});
    await off.close();
    const on = await listen(createServer({dataDir, backup:configured}));
    const status = await (await fetch(on.origin + '/api/backup-status')).json();
    assert.equal(status.enabled, true);
    assert.ok(!JSON.stringify(status).includes(KEY) && !JSON.stringify(status).includes(ZONE));
    await on.close();
  } finally { await storage.close(); await rm(dataDir, {recursive:true, force:true}); }
});

test('visit counts are backed up and restored, and a report change backs up within minutes', async () => {
  const storage = await fakeStorage(), dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-visits-backup-'));
  try {
    const counts = JSON.stringify({version:1, days:{'2026-10-14':{views:7, tabs:{}, cities:{}, countries:{}, languages:{}, devices:{}}}});
    await writeFile(path.join(dataDir, 'visits.json'), counts);
    const backup = backupFor(storage, dataDir);
    assert.equal((await backup.runOnce()).result, 'nothing-to-back-up');
    assert.equal(storage.files.get(`${PREFIX}/visits.json`)?.toString(), counts, 'counts go up even before the first report');
    const puts = () => storage.calls.filter(call => call === `PUT ${ZONE}/${PREFIX}/visits.json`).length;
    await backup.runOnce();
    assert.equal(puts(), 1, 'unchanged counts are not uploaded again');

    await rm(path.join(dataDir, 'visits.json'));
    assert.equal(await backupFor(storage, dataDir).restoreIfEmpty(), false, 'no report snapshot exists yet');
    assert.equal(await readFile(path.join(dataDir, 'visits.json'), 'utf8'), counts, 'the counts come back regardless');

    const quick = backupFor(storage, dataDir);
    quick.soon(20); quick.soon(20);
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(quick.status().lastResult, 'nothing-to-back-up', 'soon() ran a backup');
    quick.stop();
  } finally { await storage.close(); await rm(dataDir, {recursive:true, force:true}); }
});
