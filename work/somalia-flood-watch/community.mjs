import path from 'node:path';
import {mkdir, readFile, writeFile, rename, unlink, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {randomUUID, randomBytes, createHash, timingSafeEqual} from 'node:crypto';

const MAX_MEDIA = 50 * 1024 * 1024;
const MAX_BODY = MAX_MEDIA + 128 * 1024;
const MIME = Object.freeze({'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'image/gif':'gif', 'video/mp4':'mp4', 'video/webm':'webm'});
const ID = /^[a-f0-9-]{36}$/;
const MEDIA_ID = /^[a-f0-9]{40}$/;
class RequestError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new RequestError(status, message); };
const slug = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sha = value => createHash('sha256').update(value).digest('hex');

function reply(res, status, body, head = false) {
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Content-Length':bytes.length, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
  res.end(head ? undefined : bytes);
}

function text(value, name, min, max, optional = false) {
  if ((value === undefined || value === null || value === '') && optional) return '';
  if (typeof value !== 'string') fail(400, `${name} must be text.`);
  const result = value.trim();
  if (result.length < min || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)) fail(400, `${name} must contain ${min}–${max} characters.`);
  return result;
}

function coordinate(value, name, min, max) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(400, `${name} must be a number from ${min} to ${max}.`);
  return Number(value.toFixed(6));
}

function count(value, name) {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 100000) fail(400, `${name} must be a whole number from 0 to 100000, or unknown.`);
  return value;
}

function validObservationTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second = '0', zoneHour = '0', zoneMinute = '0'] = match;
  const calendar = new Date(Date.UTC(+year, +month - 1, +day));
  return calendar.getUTCFullYear() === +year && calendar.getUTCMonth() === +month - 1 && calendar.getUTCDate() === +day && +hour <= 23 && +minute <= 59 && +second <= 59 && +zoneHour <= 23 && +zoneMinute <= 59 && Number.isFinite(Date.parse(value));
}

function reportPayload(input, cities) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Report payload must be an object.');
  const cityId = text(input.cityId, 'City', 1, 80);
  const city = cities.get(cityId);
  if (!city) fail(400, 'Select a supported city.');
  if (!['flood', 'rain', 'damage'].includes(input.category)) fail(400, 'Select flood, rain or damage.');
  const observedAt = text(input.observedAt, 'Observation time', 10, 40);
  if (!validObservationTime(observedAt) || Date.parse(observedAt) > Date.now() + 3600000 || Date.parse(observedAt) < Date.parse('2000-01-01T00:00:00Z')) fail(400, 'Use a valid observation time with timezone, no more than one hour ahead.');
  const latitude = coordinate(input.latitude, 'Latitude', -2, 13);
  const longitude = coordinate(input.longitude, 'Longitude', 40, 52);
  if ((latitude === null) !== (longitude === null)) fail(400, 'Provide both latitude and longitude, or leave both unknown.');
  let sourceUrl = null;
  if (input.sourceUrl) {
    const raw = text(input.sourceUrl, 'Source link', 1, 1000);
    let source;
    try { source = new URL(raw); } catch { fail(400, 'Source link must be a valid HTTP or HTTPS URL.'); }
    if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password) fail(400, 'Source link must be a valid HTTP or HTTPS URL without login details.');
    sourceUrl = source.href;
  }
  return {cityId, cityName:city.name, category:input.category, observedAt:new Date(observedAt).toISOString(), description:text(input.description, 'Description', 10, 3000), author:text(input.author, 'Display name', 1, 60, true) || 'Anonymous', latitude, longitude, deaths:count(input.deaths, 'Deaths'), injuries:count(input.injuries, 'Injuries'), damagedProperties:count(input.damagedProperties, 'Damaged properties'), sourceUrl};
}

async function readBody(req, max) {
  if (Number(req.headers['content-length']) > max) { req.resume(); fail(413, 'Request exceeds the upload size limit.'); }
  const pieces = []; let size = 0, exceeded = false;
  // Stop retaining bytes at the limit while draining the request, so a 413 response
  // reaches the client instead of an unexplained broken connection.
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) { exceeded = true; pieces.length = 0; } else if (!exceeded) pieces.push(chunk);
  }
  if (exceeded) fail(413, 'Request exceeds the upload size limit.');
  return Buffer.concat(pieces);
}

async function jsonBody(req) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) fail(415, 'Use application/json for this request.');
  try { return JSON.parse((await readBody(req, 16384)).toString('utf8')); } catch (error) { if (error instanceof RequestError) throw error; fail(400, 'Invalid JSON request.'); }
}

function disposition(header) {
  const result = {};
  for (const match of header.matchAll(/(?:^|;)\s*([a-z]+)="((?:[^"\\]|\\.)*)"/gi)) result[match[1].toLowerCase()] = match[2].replace(/\\(["\\])/g, '$1');
  return result;
}

function multipart(body, contentType) {
  const boundary = /boundary=(?:"([^"\r\n]+)"|([^;\s\r\n]+))/i.exec(contentType);
  const value = boundary?.[1] || boundary?.[2];
  if (!value || value.length > 100) fail(400, 'Invalid multipart boundary.');
  const delimiter = Buffer.from(`\r\n--${value}`), first = Buffer.from(`--${value}\r\n`);
  if (!body.subarray(0, first.length).equals(first)) fail(400, 'Invalid multipart body.');
  const files = []; let payload = null, position = first.length, parts = 0, total = 0;
  while (position < body.length) {
    if (++parts > 8) fail(400, 'Too many multipart fields.');
    const headersEnd = body.indexOf('\r\n\r\n', position);
    if (headersEnd < 0 || headersEnd - position > 8192) fail(400, 'Invalid multipart headers.');
    const headers = Object.create(null);
    for (const line of body.subarray(position, headersEnd).toString('utf8').split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon < 1) fail(400, 'Invalid multipart header.');
      const key = line.slice(0, colon).toLowerCase();
      if (headers[key] !== undefined) fail(400, 'Duplicate multipart header.');
      headers[key] = line.slice(colon + 1).trim();
    }
    if (!/^form-data\s*;/i.test(headers['content-disposition'] || '')) fail(400, 'Invalid form data.');
    const fields = disposition(headers['content-disposition']);
    const start = headersEnd + 4, end = body.indexOf(delimiter, start);
    if (end < 0) fail(400, 'Incomplete multipart body.');
    const bytes = body.subarray(start, end);
    if (fields.name === 'payload' && fields.filename === undefined) {
      if (payload !== null || bytes.length > 16384) fail(400, 'A single report payload is required.');
      try { payload = JSON.parse(bytes.toString('utf8')); } catch { fail(400, 'Invalid report JSON.'); }
    } else if (fields.name === 'media' && fields.filename !== undefined) {
      if (files.length >= 4) fail(400, 'Upload at most four photos or videos.');
      total += bytes.length;
      if (total > MAX_MEDIA) fail(413, 'Photos and videos must total 50 MiB or less.');
      const type = (headers['content-type'] || '').toLowerCase();
      if (!MIME[type]) fail(415, 'Supported uploads: JPEG, PNG, WebP, GIF, MP4 and WebM.');
      if (!validMagic(bytes, type)) fail(415, 'Upload contents do not match the declared image or video type.');
      const name = path.basename(fields.filename.replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120) || `upload.${MIME[type]}`;
      files.push({bytes, type, name});
    } else fail(400, 'Unknown multipart field. Use payload and media.');
    position = end + delimiter.length;
    if (body.subarray(position, position + 2).toString() === '--') {
      const tail = body.subarray(position + 2).toString();
      if (tail && tail !== '\r\n') fail(400, 'Unexpected trailing multipart data.');
      break;
    }
    if (body.subarray(position, position + 2).toString() !== '\r\n') fail(400, 'Invalid multipart separator.');
    position += 2;
  }
  if (!payload) fail(400, 'Report payload is required.');
  return {payload, files};
}

function validMagic(bytes, type) {
  if (type === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/png') return bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.subarray(12, 16).toString() === 'IHDR';
  if (type === 'image/gif') return bytes.length >= 13 && ['GIF87a','GIF89a'].includes(bytes.subarray(0, 6).toString());
  if (type === 'image/webp') return bytes.length >= 20 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (type === 'video/mp4') return bytes.length >= 16 && bytes.subarray(4, 8).toString() === 'ftyp' && bytes.readUInt32BE(0) >= 16 && bytes.readUInt32BE(0) <= bytes.length;
  if (type === 'video/webm') return bytes.length >= 12 && bytes.subarray(0, 4).equals(Buffer.from([26,69,223,163])) && bytes.subarray(0, Math.min(bytes.length, 4096)).includes(Buffer.from('webm'));
  return false;
}

function publicReport(report) {
  const {receiptHash, ...result} = report;
  return result;
}

function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Community writes must come from this app.');
  if (!req.headers.origin) return;
  let origin;
  try { origin = new URL(req.headers.origin); } catch { fail(403, 'Invalid request origin.'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) fail(403, 'Community writes must come from this app.');
}

export function createCommunityHandler({dataDir, cities} = {}) {
  if (!dataDir || !Array.isArray(cities) || !cities.length) throw new Error('Community storage and supported cities are required.');
  const supported = new Map(cities.map(city => {
    const name = Array.isArray(city) ? city[0] : city.name;
    const id = Array.isArray(city) ? slug(name) : (city.id || slug(name));
    return [id, {id, name}];
  }));
  const storage = path.resolve(dataDir), mediaDir = path.join(storage, 'media'), database = path.join(storage, 'reports.json');
  let records = [], serial = 0;
  const rate = new Map();
  const ready = (async () => {
    await mkdir(mediaDir, {recursive:true});
    try {
      const saved = JSON.parse(await readFile(database, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.reports)) throw new Error('Invalid community database.');
      records = saved.reports;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  })();
  // Initialization can fail before the first community request. Observe the
  // rejection now without changing ready: requests still await it and return
  // the existing storage-unavailable response while other app routes work.
  ready.catch(() => {});
  let queue = ready;
  const mutate = callback => {
    const operation = queue.then(callback);
    queue = operation.catch(() => {});
    return operation;
  };
  async function persist(next) {
    const temporary = path.join(storage, `reports-${process.pid}-${++serial}-${randomBytes(4).toString('hex')}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify({version:1, reports:next}), {flag:'wx', mode:0o600});
      await rename(temporary, database);
      records = next;
    } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  }
  function limit(req) {
    const key = req.socket.remoteAddress || 'unknown', now = Date.now(), item = rate.get(key);
    if (!item || item.until <= now) {
      if (rate.size > 1000) for (const [ip, state] of rate) if (state.until <= now) rate.delete(ip);
      rate.set(key, {until:now + 600000, count:1});
    } else if (++item.count > 120) fail(429, 'Too many submissions. Please wait before trying again.');
  }
  async function serveMedia(req, res, id) {
    await ready; await queue;
    const media = records.flatMap(report => report.media).find(item => item.id === id);
    if (!media) fail(404, 'Media not found.');
    const target = path.join(mediaDir, `${id}.${MIME[media.type]}`), info = await stat(target);
    let start = 0, end = info.size - 1, status = 200;
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) { res.writeHead(416, {'Content-Range':`bytes */${info.size}`}); return res.end(); }
      if (!match[1]) { start = Math.max(0, info.size - Number(match[2])); } else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= info.size) { res.writeHead(416, {'Content-Range':`bytes */${info.size}`}); return res.end(); }
      status = 206;
    }
    const headers = {'Content-Type':media.type, 'Content-Length':end-start+1, 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"default-src 'none'; sandbox", 'Cache-Control':'private, max-age=300', 'Accept-Ranges':'bytes', 'Content-Disposition':`inline; filename="${id}.${MIME[media.type]}"`};
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(target, {start, end});
    stream.on('error', () => res.destroy());
    res.on('close', () => { if (!res.writableEnded) stream.destroy(); });
    stream.pipe(res);
  }
  return async (req, res, url) => {
    if (!url.pathname.startsWith('/api/community/')) return false;
    try {
      await ready;
      const mediaRoute = /^\/api\/community\/media\/([a-f0-9]+)$/.exec(url.pathname);
      if (mediaRoute && MEDIA_ID.test(mediaRoute[1])) {
        if (!['GET','HEAD'].includes(req.method)) fail(405, 'Use GET or HEAD for media.');
        await serveMedia(req, res, mediaRoute[1]); return true;
      }
      if (url.pathname === '/api/community/reports' && ['GET','HEAD'].includes(req.method)) {
        await queue;
        const cityId = url.searchParams.get('city');
        if (cityId && !supported.has(cityId)) fail(400, 'Unknown city.');
        const limitValue = url.searchParams.get('limit');
        const maximum = limitValue === null ? 200 : Number(limitValue);
        if (!Number.isInteger(maximum) || maximum < 1 || maximum > 500) fail(400, 'Limit must be from 1 to 500.');
        const matching = records.filter(report => !cityId || report.cityId === cityId).sort((a,b) => b.receivedAt.localeCompare(a.receivedAt));
        reply(res, 200, {reports:matching.slice(0, maximum).map(publicReport), total:matching.length, truncated:matching.length > maximum, cityId:cityId || null, fetchedAt:new Date().toISOString(), status:'unverified', coverageNote:'Community reports are unverified and may overlap. Reported impact counts must not be added into verified totals.'}, req.method === 'HEAD');
        return true;
      }
      if (!['POST','DELETE'].includes(req.method)) fail(405, 'Unsupported community request method.');
      sameOrigin(req); limit(req);
      if (url.pathname === '/api/community/reports' && req.method === 'POST') {
        const contentType = req.headers['content-type'] || '';
        if (!/^multipart\/form-data\s*;/i.test(contentType)) fail(415, 'Submit reports as multipart/form-data with payload and optional media.');
        const form = multipart(await readBody(req, MAX_BODY), contentType);
        const payload = reportPayload(form.payload, supported), receiptToken = randomBytes(32).toString('hex');
        const report = {...payload, id:randomUUID(), receivedAt:new Date().toISOString(), status:'unverified', media:[], comments:[], receiptHash:sha(receiptToken)};
        await mutate(async () => {
          if (records.length >= 10000) fail(503, 'Community storage is full. Contact the site administrator.');
          const written = [];
          try {
            for (const file of form.files) {
              const id = randomBytes(20).toString('hex'), target = path.join(mediaDir, `${id}.${MIME[file.type]}`);
              await writeFile(target, file.bytes, {flag:'wx', mode:0o600}); written.push(target);
              report.media.push({id, url:`/api/community/media/${id}`, type:file.type, name:file.name, size:file.bytes.length});
            }
            await persist([...records, report]);
          } catch (error) { await Promise.all(written.map(file => unlink(file).catch(() => {}))); throw error; }
        });
        reply(res, 201, {report:publicReport(report), receiptToken, receipt:receiptToken}); return true;
      }
      const commentRoute = /^\/api\/community\/reports\/([^/]+)\/comments$/.exec(url.pathname);
      if (commentRoute && ID.test(commentRoute[1]) && req.method === 'POST') {
        const body = await jsonBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Comment must be an object.');
        const comment = {id:randomUUID(), author:text(body.author, 'Display name', 1, 60, true) || 'Anonymous', body:text(body.body, 'Comment', 2, 2000), receivedAt:new Date().toISOString()};
        await mutate(async () => {
          const index = records.findIndex(report => report.id === commentRoute[1]);
          if (index < 0) fail(404, 'Report not found.');
          if (records[index].comments.length >= 250) fail(429, 'This report has reached its comment limit.');
          const next = [...records]; next[index] = {...records[index], comments:[...records[index].comments, comment]};
          await persist(next);
        });
        reply(res, 201, {comment}); return true;
      }
      const deleteRoute = /^\/api\/community\/reports\/([^/]+)$/.exec(url.pathname);
      if (deleteRoute && ID.test(deleteRoute[1]) && req.method === 'DELETE') {
        const header = /^Bearer ([a-f0-9]{64})$/i.exec(req.headers.authorization || '');
        const body = header ? null : await jsonBody(req);
        const receiptToken = header?.[1] || body?.receiptToken || body?.receipt;
        if (typeof receiptToken !== 'string' || !/^[a-f0-9]{64}$/.test(receiptToken)) fail(403, 'The original report receipt is required to remove a report.');
        await mutate(async () => {
          const report = records.find(record => record.id === deleteRoute[1]);
          if (!report) fail(404, 'Report not found.');
          const expected = Buffer.from(report.receiptHash, 'hex'), actual = Buffer.from(sha(receiptToken), 'hex');
          if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) fail(403, 'The original report receipt is required to remove a report.');
          await persist(records.filter(record => record.id !== report.id));
          await Promise.all(report.media.map(media => unlink(path.join(mediaDir, `${media.id}.${MIME[media.type]}`)).catch(() => {})));
        });
        reply(res, 200, {removed:true}); return true;
      }
      fail(404, 'Unknown community endpoint.');
    } catch (error) {
      if (!res.headersSent) reply(res, error instanceof RequestError ? error.status : 503, {error:error instanceof RequestError ? error.message : 'Community storage is temporarily unavailable. Try again later.'});
      else if (!res.writableEnded) res.destroy();
    }
    return true;
  };
}
