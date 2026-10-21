// Partner workspaces (owner, 2026-10-21). The owner makes one private link per partner organisation at
// /partners (STATS_KEY). The link opens /partner, a workspace only that link can read: the partner's own
// sites, its shared review notes on public community reports, and field records it collects (one at a
// time or imported from an ODK / KoboToolbox CSV). Nothing in a workspace is public, and nothing in it
// is ever marked verified: a partner's "checked" is its own review stage, not a confirmation.
//
// Only a SHA-256 hash of each link key is stored, so a lost link cannot be shown again; the owner makes a
// new one, which stops the old one working. Keys travel in the X-Partner-Key header, never in a URL the
// server sees (the link carries the key after "#").
import path from 'node:path';
import {mkdir, readFile, writeFile, rename, unlink} from 'node:fs/promises';
import {randomUUID, randomBytes, createHash, timingSafeEqual} from 'node:crypto';

const MAX_PARTNERS = 50, MAX_SITES = 200, MAX_REVIEWS = 2000, MAX_FIELD = 5000, MAX_IMPORT = 500;
const MAX_BODY = 1024 * 1024, MAX_KEY_FAILURES = 20;
export const SITE_KINDS = Object.freeze(['camp', 'clinic', 'school', 'water', 'market', 'road', 'bridge', 'office', 'warehouse', 'other']);
export const REVIEW_STAGES = Object.freeze(['unreviewed', 'checking', 'checked', 'not-confirmed']);
export const FIELD_CATEGORIES = Object.freeze(['flood', 'rain', 'damage', 'displacement', 'access', 'other']);
export const ROAD_ACCESS = Object.freeze(['open', 'limited', 'closed', 'unknown']);
// The field form's question names. A KoboToolbox or ODK form that uses these names exports a CSV this
// workspace imports as it is (partner.html also reads Kobo's "_uuid" and group prefixes).
export const FIELD_COLUMNS = Object.freeze(['record_id', 'corrects', 'observed_at', 'category', 'site', 'city', 'latitude', 'longitude', 'water_depth_cm', 'households_affected', 'people_displaced', 'road_access', 'description', 'reporter']);

class RequestError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new RequestError(status, message); };
const sha = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function reply(res, status, body) {
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  res.end(bytes);
}
function text(value, name, min, max, optional = false) {
  if (value === undefined || value === null || (optional && String(value).trim() === '')) { if (optional) return null; fail(400, `${name} is required.`); }
  if (typeof value !== 'string' && typeof value !== 'number') fail(400, `${name} must be text.`);
  const clean = String(value).trim().replace(/\r\n?/g, '\n');
  if (CONTROL.test(clean)) fail(400, `${name} contains unsupported characters.`);
  if (clean.length < min || clean.length > max) fail(400, `${name} must be ${min}–${max} characters.`);
  return clean;
}
function choice(value, list, name, fallback = null) {
  if (value === undefined || value === null || value === '') { if (fallback !== null) return fallback; fail(400, `${name} is required.`); }
  const clean = String(value).trim().toLowerCase();
  if (!list.includes(clean)) fail(400, `${name} must be one of: ${list.join(', ')}.`);
  return clean;
}
function number(value, name, min, max, integer = false) {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) fail(400, `${name} must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}.`);
  return n;
}
function coordinates(lat, lon, required) {
  const latitude = number(lat, 'Latitude', -90, 90), longitude = number(lon, 'Longitude', -180, 180);
  if ((latitude === null) !== (longitude === null)) fail(400, 'Latitude and longitude go together.');
  if (latitude === null) { if (required) fail(400, 'Latitude and longitude are required.'); return {latitude:null, longitude:null}; }
  // Somalia and its neighbours, the same box the hazard point lookup uses.
  if (latitude < -2 || latitude > 13 || longitude < 40 || longitude > 52) fail(400, 'The location must be in or near Somalia.');
  return {latitude:Math.round(latitude * 1e5) / 1e5, longitude:Math.round(longitude * 1e5) / 1e5};
}
// "2026-10-21T08:30:00Z", "2026-10-21T11:30:00+03:00", or a bare "2026-10-21 11:30" read as East Africa Time.
export function observedTime(value) {
  const raw = text(value, 'Observed time', 10, 40);
  const local = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(raw);
  const iso = local ? `${local[1]}T${local[2] || '00'}:${local[3] || '00'}:${local[4] || '00'}+03:00` : raw;
  const time = Date.parse(iso);
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw) || !Number.isFinite(time)) fail(400, 'Observed time must be a date such as 2026-10-21 08:30.');
  const date = new Date(time), day = raw.slice(0, 10);
  // Reject impossible days such as 2026-02-30 that Date would roll over.
  if (local && new Date(Date.parse(`${day}T12:00:00Z`)).toISOString().slice(0, 10) !== day) fail(400, 'Observed time is not a real date.');
  if (time > Date.now() + 10 * 60000) fail(400, 'Observed time cannot be in the future.');
  if (time < Date.parse('2020-01-01T00:00:00Z')) fail(400, 'Observed time is too old.');
  return date.toISOString();
}

function sitePayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Site must be an object.');
  return {name:text(input.name, 'Site name', 2, 80), kind:choice(input.kind, SITE_KINDS, 'Site type', 'other'), ...coordinates(input.latitude, input.longitude, true), note:text(input.note, 'Note', 1, 500, true)};
}
function fieldPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Each record must be an object.');
  const record = {
    recordId:text(input.record_id ?? input.recordId, 'Record ID', 1, 120, true),
    corrects:text(input.corrects, 'Corrects', 1, 120, true),
    observedAt:observedTime(input.observed_at ?? input.observedAt),
    category:choice(input.category, FIELD_CATEGORIES, 'Category'),
    site:text(input.site, 'Site', 1, 80, true),
    city:text(input.city, 'City', 1, 80, true),
    ...coordinates(input.latitude, input.longitude, false),
    waterDepthCm:number(input.water_depth_cm ?? input.waterDepthCm, 'Water depth (cm)', 0, 1000),
    householdsAffected:number(input.households_affected ?? input.householdsAffected, 'Households affected', 0, 1000000, true),
    peopleDisplaced:number(input.people_displaced ?? input.peopleDisplaced, 'People displaced', 0, 10000000, true),
    roadAccess:choice(input.road_access ?? input.roadAccess, ROAD_ACCESS, 'Road access', 'unknown'),
    description:text(input.description, 'Description', 2, 2000),
    reporter:text(input.reporter, 'Reporter', 1, 80, true)
  };
  if (!record.site && !record.city && record.latitude === null) fail(400, 'Give a site, a city or a location.');
  return record;
}
// Same place, same kind of record, same description, observed within an hour: the same observation sent twice.
const placeKey = record => (record.site || record.city || (record.latitude === null ? '' : `${record.latitude.toFixed(3)},${record.longitude.toFixed(3)}`)).toLowerCase();
function sameObservation(a, b) {
  return placeKey(a) === placeKey(b) && a.category === b.category && Math.abs(Date.parse(a.observedAt) - Date.parse(b.observedAt)) <= 3600000
    && a.description.replace(/\s+/g, ' ').toLowerCase() === b.description.replace(/\s+/g, ' ').toLowerCase();
}

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) fail(413, 'Request is too large.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { fail(400, 'Send JSON.'); }
}
function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Requests must come from this site.');
  if (!req.headers.origin) return;
  let origin; try { origin = new URL(req.headers.origin); } catch { fail(403, 'Invalid request origin.'); }
  if (origin.host !== req.headers.host) fail(403, 'Requests must come from this site.');
}
const newKey = () => randomBytes(32).toString('base64url');
// What a partner sees of itself, and what the owner sees of each partner. Never the key hash.
const summary = partner => ({id:partner.id, name:partner.name, createdAt:partner.createdAt, revokedAt:partner.revokedAt || null, linkMadeAt:partner.linkMadeAt, sites:partner.sites.length, reviews:Object.keys(partner.reviews).length, fieldRecords:partner.field.length});
const workspace = partner => ({partner:{id:partner.id, name:partner.name}, sites:partner.sites, reviews:partner.reviews, field:partner.field,
  limits:{sites:MAX_SITES, reviews:MAX_REVIEWS, fieldRecords:MAX_FIELD, importRows:MAX_IMPORT}, columns:FIELD_COLUMNS, fetchedAt:now()});

export function createPartners({dataDir, statsKey = '', onChange} = {}) {
  if (!dataDir) throw new Error('Partner storage needs a data directory.');
  const storage = path.resolve(dataDir), file = path.join(storage, 'partners.json');
  const ownerKey = typeof statsKey === 'string' && statsKey.length >= 24 ? Buffer.from(statsKey) : null;
  let partners = [], serial = 0;
  const ready = (async () => {
    await mkdir(storage, {recursive:true});
    try {
      const saved = JSON.parse(await readFile(file, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.partners)) throw new Error('Invalid partner storage.');
      partners = saved.partners;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  })();
  ready.catch(() => {});
  let queue = ready;
  const mutate = callback => { const operation = queue.then(callback); queue = operation.catch(() => {}); return operation; };
  async function persist(next) {
    const temporary = path.join(storage, `partners-${process.pid}-${++serial}-${randomBytes(4).toString('hex')}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify({version:1, partners:next}), {flag:'wx', mode:0o600});
      await rename(temporary, file);
      partners = next;
      try { onChange?.(); } catch {}
    } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  }
  // Wrong keys are counted per address and day, like the stats and review keys.
  const failures = new Map(); let failureDay = '';
  function guard(req) {
    const day = now().slice(0, 10), address = req.socket.remoteAddress || 'unknown';
    if (failureDay !== day) { failureDay = day; failures.clear(); }
    if ((failures.get(address) || 0) >= MAX_KEY_FAILURES) fail(429, 'Too many attempts. Try again tomorrow.');
    return () => failures.set(address, (failures.get(address) || 0) + 1);
  }
  function owner(req) {
    const offered = req.headers['x-stats-key'];
    if (typeof offered !== 'string' || !offered) fail(401, 'The owner key is required.');
    const miss = guard(req), given = Buffer.from(offered);
    if (!ownerKey || given.length !== ownerKey.length || !timingSafeEqual(given, ownerKey)) { miss(); fail(403, ownerKey ? 'Key not recognised.' : 'The private view is not set up.'); }
  }
  function partnerFor(req) {
    const offered = req.headers['x-partner-key'];
    if (typeof offered !== 'string' || !offered) fail(401, 'A partner link is required.');
    const miss = guard(req), given = Buffer.from(sha(offered), 'hex');
    const match = partners.find(item => !item.revokedAt && timingSafeEqual(Buffer.from(item.keyHash, 'hex'), given));
    if (!match) { miss(); fail(403, 'This partner link is not valid. Ask the site owner for a new one.'); }
    return match;
  }
  // Replace one partner in the list (mutations work on copies so a failed write changes nothing).
  async function update(id, change) {
    const index = partners.findIndex(item => item.id === id);
    if (index < 0) fail(404, 'Partner not found.');
    const copy = structuredClone(partners[index]);
    const result = change(copy);
    const next = [...partners]; next[index] = copy;
    await persist(next);
    return result;
  }

  return async (req, res, url) => {
    const p = url.pathname;
    if (!(p === '/api/partners' || p.startsWith('/api/partners/') || p === '/api/partner' || p.startsWith('/api/partner/'))) return false;
    try {
      await ready;
      if (req.method !== 'GET') sameOrigin(req);
      // ---- Owner: make, renew, revoke and delete partner links.
      if (p === '/api/partners' || p.startsWith('/api/partners/')) {
        owner(req); await queue;
        if (p === '/api/partners' && req.method === 'GET') return reply(res, 200, {partners:partners.map(summary)}), true;
        if (p === '/api/partners' && req.method === 'POST') {
          const body = await readBody(req), name = text(body?.name, 'Partner name', 2, 80);
          const key = newKey();
          const partner = await mutate(async () => {
            if (partners.length >= MAX_PARTNERS) fail(409, `There can be at most ${MAX_PARTNERS} partners.`);
            if (partners.some(item => item.name.toLowerCase() === name.toLowerCase())) fail(409, 'A partner with this name already exists.');
            const made = {id:randomUUID(), name, keyHash:sha(key), createdAt:now(), linkMadeAt:now(), revokedAt:null, sites:[], reviews:{}, field:[]};
            await persist([...partners, made]);
            return made;
          });
          return reply(res, 201, {partner:summary(partner), key}), true;
        }
        const route = /^\/api\/partners\/([a-f0-9-]{36})$/.exec(p);
        if (route && req.method === 'POST') {
          const body = await readBody(req), action = body?.action;
          if (action === 'new-link') {
            const key = newKey();
            const partner = await mutate(() => update(route[1], item => { item.keyHash = sha(key); item.linkMadeAt = now(); item.revokedAt = null; return item; }));
            return reply(res, 200, {partner:summary(partner), key}), true;
          }
          if (action === 'revoke') {
            const partner = await mutate(() => update(route[1], item => { item.revokedAt = now(); return item; }));
            return reply(res, 200, {partner:summary(partner)}), true;
          }
          if (action === 'delete') {
            if (body.confirmName !== partners.find(item => item.id === route[1])?.name) fail(400, 'Type the partner name to delete its workspace.');
            await mutate(async () => { if (!partners.some(item => item.id === route[1])) fail(404, 'Partner not found.'); await persist(partners.filter(item => item.id !== route[1])); });
            return reply(res, 200, {deleted:true}), true;
          }
          fail(400, 'Action must be new-link, revoke or delete.');
        }
        fail(404, 'Unknown partner endpoint.');
      }
      // ---- Partner workspace.
      await queue;
      const partner = partnerFor(req), id = partner.id;
      if (p === '/api/partner' && req.method === 'GET') return reply(res, 200, workspace(partner)), true;
      if (p === '/api/partner/sites' && req.method === 'POST') {
        const site = {...sitePayload(await readBody(req)), id:randomUUID(), createdAt:now(), updatedAt:now()};
        await mutate(() => update(id, item => {
          if (item.sites.length >= MAX_SITES) fail(409, `A workspace can hold ${MAX_SITES} sites.`);
          if (item.sites.some(other => other.name.toLowerCase() === site.name.toLowerCase())) fail(409, 'A site with this name already exists.');
          item.sites.push(site);
        }));
        return reply(res, 201, {site}), true;
      }
      const siteRoute = /^\/api\/partner\/sites\/([a-f0-9-]{36})$/.exec(p);
      if (siteRoute && ['POST', 'DELETE'].includes(req.method)) {
        const changes = req.method === 'POST' ? sitePayload(await readBody(req)) : null;
        const site = await mutate(() => update(id, item => {
          const index = item.sites.findIndex(other => other.id === siteRoute[1]);
          if (index < 0) fail(404, 'Site not found.');
          if (!changes) { item.sites.splice(index, 1); return null; }
          if (item.sites.some(other => other.id !== siteRoute[1] && other.name.toLowerCase() === changes.name.toLowerCase())) fail(409, 'A site with this name already exists.');
          item.sites[index] = {...item.sites[index], ...changes, updatedAt:now()};
          return item.sites[index];
        }));
        return reply(res, 200, site ? {site} : {deleted:true}), true;
      }
      // Shared review notes on public community reports: one stage and note per report, seen by everyone
      // with this partner's link. They never change the public report.
      const reviewRoute = /^\/api\/partner\/reviews\/([a-f0-9-]{36})$/.exec(p);
      if (reviewRoute && req.method === 'POST') {
        const body = await readBody(req);
        const review = {stage:choice(body?.stage, REVIEW_STAGES, 'Review stage'), note:text(body?.note, 'Note', 1, 1000, true), by:text(body?.by, 'Name', 1, 60, true), updatedAt:now()};
        await mutate(() => update(id, item => {
          if (!item.reviews[reviewRoute[1]] && Object.keys(item.reviews).length >= MAX_REVIEWS) fail(409, `A workspace can hold ${MAX_REVIEWS} review notes.`);
          if (review.stage === 'unreviewed' && !review.note) delete item.reviews[reviewRoute[1]]; else item.reviews[reviewRoute[1]] = review;
        }));
        return reply(res, 200, {review}), true;
      }
      // Field records: a batch from the form (one record) or an imported CSV (up to MAX_IMPORT rows).
      // Each row is checked on its own; good rows are kept, duplicates and errors are reported back.
      if (p === '/api/partner/field' && req.method === 'POST') {
        const body = await readBody(req), rows = body?.records;
        if (!Array.isArray(rows) || !rows.length) fail(400, 'Send records as a list.');
        if (rows.length > MAX_IMPORT) fail(413, `Import at most ${MAX_IMPORT} records at a time.`);
        const result = await mutate(() => update(id, item => {
          const added = [], duplicates = [], errors = [], corrected = [];
          rows.forEach((row, index) => {
            let record;
            try { record = fieldPayload(row); } catch (error) { if (error instanceof RequestError) { errors.push({row:index + 1, message:error.message}); return; } throw error; }
            const all = [...item.field, ...added];
            const sameId = record.recordId && all.find(other => other.recordId === record.recordId);
            if (sameId) { duplicates.push({row:index + 1, existing:sameId.id, reason:'record-id'}); return; }
            let target = null;
            if (record.corrects) {
              target = all.find(other => other.id === record.corrects || other.recordId === record.corrects);
              if (!target) { errors.push({row:index + 1, message:'The record it corrects was not found.'}); return; }
            } else {
              const same = all.find(other => !other.correctedBy && sameObservation(other, record));
              if (same) { duplicates.push({row:index + 1, existing:same.id, reason:'same-observation'}); return; }
            }
            if (item.field.length + added.length >= MAX_FIELD) { errors.push({row:index + 1, message:`A workspace can hold ${MAX_FIELD} field records.`}); return; }
            const saved = {...record, id:randomUUID(), status:'unverified', stage:'unreviewed', note:null, receivedAt:now(), correctedBy:null};
            if (target) { saved.corrects = target.id; target.correctedBy = saved.id; corrected.push(target.id); }
            added.push(saved);
          });
          item.field.push(...added);
          return {added, duplicates, errors, corrected};
        }));
        return reply(res, result.added.length ? 201 : 200, result), true;
      }
      const fieldRoute = /^\/api\/partner\/field\/([a-f0-9-]{36})$/.exec(p);
      if (fieldRoute && req.method === 'POST') {
        const body = await readBody(req);
        const stage = choice(body?.stage, REVIEW_STAGES, 'Review stage'), note = text(body?.note, 'Note', 1, 1000, true);
        const record = await mutate(() => update(id, item => {
          const found = item.field.find(other => other.id === fieldRoute[1]);
          if (!found) fail(404, 'Record not found.');
          Object.assign(found, {stage, note, reviewedAt:now()});
          return found;
        }));
        return reply(res, 200, {record}), true;
      }
      fail(404, 'Unknown partner endpoint.');
    } catch (error) {
      if (!res.headersSent) reply(res, error instanceof RequestError ? error.status : 503, {error:error instanceof RequestError ? error.message : 'Partner storage is temporarily unavailable. Try again later.'});
      else if (!res.writableEnded) res.destroy();
    }
    return true;
  };
}
