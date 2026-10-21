// Off-site backups of the community reports to a private Bunny Storage zone.
// Bunny Magic Containers volumes have no backups of their own, so the server
// copies reports.json and the uploaded media out on a schedule, and restores
// the newest snapshot when it starts on an empty volume.
//
// Enabled only when BACKUP_STORAGE_ZONE and BACKUP_STORAGE_KEY are set. The
// zone must have no pull zone attached: these files are private reports.
//
// Layout under <zone>/<prefix>/:
//   snapshots/<YYYY-MM-DDTHH-MM-SSZ>/reports.json   one per change
//   media/<id>.<ext>                                 shared by all snapshots
import {readFile, readdir, writeFile, rename, mkdir, stat, unlink} from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';

const SNAPSHOT = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;
const MEDIA_FILE = /^([a-f0-9]{40})\.[a-z0-9]+$/;
const MIN_KEEP = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = date => date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
const stampTime = name => Date.parse(name.replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, 'T$1:$2:$3Z'));
const positive = (value, fallback) => { const n = Number(value); return value !== undefined && value !== '' && Number.isFinite(n) && n > 0 ? n : fallback; };

function parseDatabase(bytes) {
  const saved = JSON.parse(bytes.toString('utf8'));
  if (saved.version !== 1 || !Array.isArray(saved.reports)) throw new Error('Invalid community database.');
  return saved;
}
const mediaIds = saved => new Set(saved.reports.flatMap(report => (report.media || []).map(media => media.id)));

export function backupFromEnv({dataDir, env = process.env, log = console} = {}) {
  if (!env.BACKUP_STORAGE_ZONE || !env.BACKUP_STORAGE_KEY) return null;
  return createBackup({
    dataDir, log,
    zone: env.BACKUP_STORAGE_ZONE, key: env.BACKUP_STORAGE_KEY,
    endpoint: env.BACKUP_STORAGE_ENDPOINT || 'https://storage.bunnycdn.com',
    prefix: env.BACKUP_PREFIX || 'el-nino-watch',
    intervalHours: positive(env.BACKUP_INTERVAL_HOURS, 6),
    retentionDays: positive(env.BACKUP_RETENTION_DAYS, 14),
    restoreIfEmpty: env.BACKUP_RESTORE_IF_EMPTY !== 'false'
  });
}

export function createBackup({dataDir, zone, key, endpoint, prefix = 'el-nino-watch', intervalHours = 6, retentionDays = 14, restoreIfEmpty: restoreEnabled = true, log = console, retryDelayMs = 5000}) {
  const storage = path.resolve(dataDir), mediaDir = path.join(storage, 'media'), database = path.join(storage, 'reports.json');
  // Files kept as one latest copy each, replaced when they change: the anonymous visit counts (visits.mjs)
  // and the partner workspaces (partners.mjs).
  const LATEST = [['visits.json', 'visit counts'], ['partners.json', 'partner workspaces']];
  const base = `${endpoint.replace(/\/+$/, '')}/${encodeURIComponent(zone)}/${prefix}`;
  const state = {enabled:true, intervalHours, retentionDays, lastAttemptAt:null, lastSuccessAt:null, lastResult:null, lastError:null, lastSnapshot:null, reports:null, mediaFiles:null};
  let lastHash = null, lastLatestHash = new Map(), running = null, timer = null, soonTimer = null;

  // Errors name the operation and HTTP status only, never the zone or key.
  async function call(method, rel, body, headers = {}) {
    const response = await fetch(`${base}/${rel}`, {method, body, headers:{AccessKey:key, ...headers}, signal:AbortSignal.timeout(120000)});
    if (!response.ok && !(response.status === 404 && (method === 'DELETE' || rel.endsWith('/')))) throw new Error(`Backup storage ${method} ${rel.split('/')[0]} returned HTTP ${response.status}.`);
    return response;
  }
  async function list(dir) {
    const response = await call('GET', `${dir}/`);
    if (response.status === 404) return [];
    const items = await response.json();
    return Array.isArray(items) ? items : [];
  }
  const put = (rel, bytes) => call('PUT', rel, bytes, {'Content-Type':'application/octet-stream', Checksum:sha256(bytes).toUpperCase()});
  const get = async rel => Buffer.from(await (await call('GET', rel)).arrayBuffer());
  const snapshotNames = async () => (await list('snapshots')).filter(item => item.IsDirectory && SNAPSHOT.test(item.ObjectName)).map(item => item.ObjectName).sort();
  const remoteMedia = async () => new Map((await list('media')).filter(item => !item.IsDirectory && MEDIA_FILE.test(item.ObjectName)).map(item => [item.ObjectName, item.Length]));

  async function writeAtomic(target, bytes) {
    const temporary = `${target}.${randomBytes(4).toString('hex')}.restore`;
    try { await writeFile(temporary, bytes, {flag:'wx', mode:0o600}); await rename(temporary, target); }
    catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  }

  async function backupLatest() {
    for (const [name] of LATEST) {
      let bytes;
      try { bytes = await readFile(path.join(storage, name)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      const hash = sha256(bytes);
      if (hash === lastLatestHash.get(name)) continue;
      await put(name, bytes);
      lastLatestHash.set(name, hash);
    }
  }

  async function backupOnce(now) {
    await backupLatest();
    let bytes;
    try { bytes = await readFile(database); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // Still reach the store, so a wrong zone or key shows as a failure even
      // before the first report exists.
      await snapshotNames();
      return {result:'nothing-to-back-up'};
    }
    const saved = parseDatabase(bytes), ids = mediaIds(saved);

    // Media first, so a snapshot never names a file the backup does not hold.
    const remote = await remoteMedia();
    let uploaded = 0, missing = 0, mediaFiles = 0;
    const local = await readdir(mediaDir).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const present = new Set();
    for (const name of local) {
      const match = MEDIA_FILE.exec(name);
      if (!match || !ids.has(match[1])) continue;
      present.add(match[1]);
      let file;
      try { file = await readFile(path.join(mediaDir, name)); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      mediaFiles++;
      if (remote.get(name) === file.length) continue;
      await put(`media/${name}`, file);
      remote.set(name, file.length);
      uploaded++;
    }
    for (const id of ids) if (!present.has(id)) missing++;

    const hash = sha256(bytes);
    const snapshots = await snapshotNames();
    if (lastHash === null && snapshots.length) lastHash = sha256(await get(`snapshots/${snapshots.at(-1)}/reports.json`));
    let result = 'unchanged', snapshot = null;
    if (hash !== lastHash || !snapshots.length) {
      snapshot = stamp(now);
      await put(`snapshots/${snapshot}/reports.json`, bytes);
      if (!snapshots.includes(snapshot)) snapshots.push(snapshot);
      lastHash = hash; result = 'snapshot';
    }

    // Prune by age, never the newest few, then drop media no kept snapshot names.
    const keep = new Set(snapshots.slice(-MIN_KEEP)), cutoff = now.getTime() - retentionDays * DAY_MS;
    const expired = snapshots.filter(name => !keep.has(name) && stampTime(name) < cutoff);
    for (const name of expired) await call('DELETE', `snapshots/${name}/`);
    let pruned = 0;
    if (expired.length) {
      const referenced = new Set(ids);
      for (const name of snapshots.filter(item => !expired.includes(item))) {
        for (const id of mediaIds(parseDatabase(await get(`snapshots/${name}/reports.json`)))) referenced.add(id);
      }
      for (const name of remote.keys()) {
        if (referenced.has(MEDIA_FILE.exec(name)[1])) continue;
        await call('DELETE', `media/${name}`);
        pruned++;
      }
    }
    return {result, snapshot, reports:saved.reports.length, mediaFiles, uploaded, missing, expired:expired.length, pruned};
  }

  function runOnce(now = new Date()) {
    if (running) return running;
    state.lastAttemptAt = now.toISOString();
    running = backupOnce(now).then(outcome => {
      Object.assign(state, {lastSuccessAt:now.toISOString(), lastResult:outcome.result, lastError:null});
      if (outcome.snapshot) state.lastSnapshot = outcome.snapshot;
      if (outcome.reports !== undefined) Object.assign(state, {reports:outcome.reports, mediaFiles:outcome.mediaFiles});
      if (outcome.result !== 'unchanged' || outcome.uploaded || outcome.expired) {
        log.log(`Backup ${outcome.result}${outcome.snapshot ? ' ' + outcome.snapshot : ''}: ${outcome.reports ?? 0} reports, ${outcome.uploaded ?? 0} new media files, ${outcome.expired ?? 0} snapshots and ${outcome.pruned ?? 0} media files pruned${outcome.missing ? `, ${outcome.missing} media files missing locally` : ''}.`);
      }
      return outcome;
    }, error => {
      Object.assign(state, {lastResult:'failed', lastError:error.message});
      log.error(`Backup failed: ${error.message}`);
      return {result:'failed', error:error.message};
    }).finally(() => { running = null; });
    return running;
  }

  async function restoreIfEmpty() {
    if (!restoreEnabled) return false;
    // Visit counts and partner workspaces come back on their own, whether or not reports need restoring.
    for (const [name, label] of LATEST) {
      const file = path.join(storage, name);
      try { await stat(file); } catch (error) {
        if (error.code === 'ENOENT') {
          try { const response = await call('GET', name); await mkdir(storage, {recursive:true}); await writeAtomic(file, Buffer.from(await response.arrayBuffer())); log.log(`Restore: ${label} restored.`); }
          catch (failure) { if (!/HTTP 404/.test(failure.message)) log.error(`${label[0].toUpperCase() + label.slice(1)} not restored: ${failure.message}`); }
        }
      }
    }
    try { await stat(database); return false; }
    catch (error) { if (error.code !== 'ENOENT') { log.error(`Restore skipped: ${error.message}`); return false; } }
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const snapshots = await snapshotNames();
        if (!snapshots.length) { log.log('Restore: no backup snapshot exists yet; starting with empty report storage.'); return false; }
        const newest = snapshots.at(-1), bytes = await get(`snapshots/${newest}/reports.json`), saved = parseDatabase(bytes);
        const remote = [...(await remoteMedia()).keys()];
        await mkdir(mediaDir, {recursive:true});
        let restored = 0, missing = 0;
        for (const id of mediaIds(saved)) {
          const name = remote.find(item => item.startsWith(`${id}.`));
          if (!name) { missing++; continue; }
          await writeAtomic(path.join(mediaDir, name), await get(`media/${name}`));
          restored++;
        }
        // reports.json last: an interrupted restore leaves the volume empty and retries next start.
        await writeAtomic(database, bytes);
        lastHash = sha256(bytes);
        log.log(`Restore: ${saved.reports.length} reports and ${restored} media files from snapshot ${newest}${missing ? `; ${missing} media files were not in the backup` : ''}.`);
        return true;
      } catch (error) {
        log.error(`Restore attempt ${attempt} failed: ${error.message}`);
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
      }
    }
    log.error('Restore failed three times; starting with empty report storage. Older snapshots remain in backup storage.');
    return false;
  }

  function start({firstRunMs = 60000} = {}) {
    if (timer) return;
    const tick = () => { runOnce(); timer = setTimeout(tick, intervalHours * 60 * 60 * 1000); timer.unref?.(); };
    timer = setTimeout(tick, firstRunMs);
    timer.unref?.();
    log.log(`Backups every ${intervalHours} h to private storage, ${retentionDays}-day retention.`);
  }
  // A report was added or removed: back up within a few minutes rather than
  // waiting up to the full interval. Repeated changes share one run.
  function soon(delayMs = 5 * 60 * 1000) {
    if (soonTimer) return;
    soonTimer = setTimeout(() => { soonTimer = null; runOnce(); }, delayMs);
    soonTimer.unref?.();
  }
  function stop() { clearTimeout(timer); clearTimeout(soonTimer); timer = null; soonTimer = null; }
  const status = () => ({...state});

  return {runOnce, restoreIfEmpty, start, stop, soon, status};
}
