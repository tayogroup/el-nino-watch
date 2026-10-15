import http from 'node:http';
import path from 'node:path';
import {readFile, lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {loadEnso, loadStations, SOURCES} from './feeds.mjs';
import {loadHazardPoint} from './hazards.mjs';
import {createCommunityHandler} from './community.mjs';
import {loadOfficialAlerts, ALERT_SOURCES} from './alerts-feed.mjs';
import {loadObservedFlood, loadRadarPoint, OBSERVED_SOURCE_URL} from './observed-flood.mjs';
import {loadCopernicusCity} from './copernicus.mjs';
import {backupFromEnv} from './backup.mjs';
import {createForecastRelay} from './forecast-relay.mjs';
import {createVisits} from './visits.mjs';
import {loadNews, NEWS_SOURCES} from './news-feed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const CITY_DATA = JSON.parse(await readFile(new URL('./dist/cities.json', import.meta.url), 'utf8'));
const COMMUNITY_CITIES = CITY_DATA.map(c=>({id:c[0].toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),name:c[0]}));
const CACHE_MS = 10 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const cache = new Map();
const pending = new Map();
const feeds = Object.freeze({'/api/enso': {load: loadEnso, sourceUrl: SOURCES.enso}, '/api/stations': {load: loadStations, sourceUrl: SOURCES.stations}, '/api/alerts': {load: () => loadOfficialAlerts({cities: CITY_DATA}), sourceUrl: ALERT_SOURCES.icpac}, '/api/observed-flood': {load: loadObservedFlood, sourceUrl: OBSERVED_SOURCE_URL}, '/api/news': {load: async () => loadNews({app: {enso: await feed('/api/enso'), alerts: await feed('/api/alerts')}}), sourceUrl: NEWS_SOURCES.sodma.site}});
const types = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon', '.woff2':'font/woff2', '.pdf':'application/pdf'};

async function feed(name, loader = feeds[name]?.load, sourceUrl = feeds[name]?.sourceUrl) {
  const entry = cache.get(name);
  if (entry?.retryAt > Date.now()) return entry.result;
  if (entry?.result?.available && !entry.result.stale && Date.parse(entry.result.fetchedAt) + CACHE_MS > Date.now()) return entry.result;
  if (pending.has(name)) return pending.get(name);
  const request = (async () => {
    try {
      const data = await loader();
      if (data.available === false) throw new Error('No observation product is available.');
      const fetchedAt = new Date().toISOString();
      const result = {available: true, stale: false, fetchedAt, cacheExpiresAt: new Date(Date.now() + CACHE_MS).toISOString(), ...data};
      cache.set(name, {result});
      return result;
    } catch (error) {
      const result = entry?.result?.available
        ? {...entry.result, stale: true, error: `Latest refresh failed: ${error.message}`, lastAttemptAt: new Date().toISOString()}
        : {available: false, stale: false, fetchedAt: null, sourceUrl, error: `Live source is unavailable: ${error.message}`, lastAttemptAt: new Date().toISOString()};
      cache.set(name, {result, retryAt: Date.now() + RETRY_MS});
      return result;
    } finally { pending.delete(name); }
  })();
  pending.set(name, request);
  return request;
}

function reply(res, status, body, contentType = 'text/plain; charset=utf-8', head = false) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {'Content-Type': contentType, 'Content-Length': buffer.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'});
  res.end(head ? undefined : buffer);
}

export function createServer({dataDir = process.env.COMMUNITY_DATA_DIR || path.resolve(ROOT, '..', 'data'), backup = null, statsKey = process.env.STATS_KEY || ''} = {}) {
  // A report change asks for a backup within minutes rather than the next 6-hour run.
  const community = createCommunityHandler({dataDir, cities:COMMUNITY_CITIES, onChange:() => backup?.soon?.()});
  const visits = createVisits({dataDir, cities:CITY_DATA, statsKey});
  const forecasts = createForecastRelay({cities:CITY_DATA});
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (await community(req,res,url)) return;
      if (await visits.handle(req,res,url)) return;
      if (!['GET', 'HEAD'].includes(req.method)) return reply(res, 405, 'Only GET and HEAD are supported.');
      if (url.pathname === '/api/copernicus') {
        const cityId = url.searchParams.get('city') || 'mogadishu';
        const index = COMMUNITY_CITIES.findIndex(city => city.id === cityId);
        if (index < 0) return reply(res, 400, JSON.stringify({available:false,error:'Select a supported city.'}), 'application/json; charset=utf-8', req.method === 'HEAD');
        const c = CITY_DATA[index], city = {id:cityId,name:c[0],lat:c[2],lon:c[3]};
        const data = await feed('/api/copernicus/'+cityId, () => loadCopernicusCity(city), 'https://stac.dataspace.copernicus.eu/v1/');
        return reply(res, data.available ? 200 : 503, JSON.stringify(data), 'application/json; charset=utf-8', req.method === 'HEAD');
      }
      if (url.pathname === '/api/observed-point') {
        const lat = url.searchParams.has('lat') ? Number(url.searchParams.get('lat')) : NaN;
        const lon = url.searchParams.has('lon') ? Number(url.searchParams.get('lon')) : NaN;
        const data = await loadRadarPoint(lat, lon, url.searchParams.get('date'));
        return reply(res, data.available ? 200 : 503, JSON.stringify(data), 'application/json; charset=utf-8', req.method === 'HEAD');
      }
      if (url.pathname === '/api/hazard-point') {
        const lat = url.searchParams.has('lat') ? Number(url.searchParams.get('lat')) : NaN;
        const lon = url.searchParams.has('lon') ? Number(url.searchParams.get('lon')) : NaN;
        const data = await loadHazardPoint(lat, lon);
        return reply(res, 200, JSON.stringify(data), 'application/json; charset=utf-8', req.method === 'HEAD');
      }
      if (Object.hasOwn(feeds, url.pathname)) {
        const data = await feed(url.pathname);
        return reply(res, data.available ? 200 : 503, JSON.stringify(data), 'application/json; charset=utf-8', req.method === 'HEAD');
      }
      if (await forecasts(req, res, url)) return;
      if (url.pathname === '/api/backup-status') return reply(res, 200, JSON.stringify(backup ? backup.status() : {enabled:false}), 'application/json; charset=utf-8', req.method === 'HEAD');
      if (url.pathname.startsWith('/api/')) return reply(res, 404, 'Unknown data endpoint.');
      const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname === '/stats' ? '/stats.html' : url.pathname === '/sources' ? '/sources.html' : url.pathname);
      if (requested.includes('\0')) return reply(res, 400, 'Invalid path.');
      // A backslash is a separator on Windows but a filename character on Linux;
      // refuse it everywhere so traversal attempts get the same 403 on both.
      if (requested.includes('\\')) return reply(res, 403, 'Path is outside the app.');
      const target = path.resolve(ROOT, `.${requested}`);
      if (!target.startsWith(ROOT + path.sep)) return reply(res, 403, 'Path is outside the app.');
      // Reject links in each path component without relying on realpath, which
      // is unavailable in some Windows app sandboxes.
      let current = ROOT;
      if ((await lstat(current)).isSymbolicLink()) return reply(res, 403, 'Linked paths are not served.');
      for (const part of path.relative(ROOT, target).split(path.sep)) {
        current = path.join(current, part);
        if ((await lstat(current)).isSymbolicLink()) return reply(res, 403, 'Linked paths are not served.');
      }
      if (!(await lstat(target)).isFile()) return reply(res, 404, 'File not found.');
      return reply(res, 200, await readFile(target), types[path.extname(target).toLowerCase()] || 'application/octet-stream', req.method === 'HEAD');
    } catch (error) {
      reply(res, error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 400, 'File not found or invalid request.');
    }
  });
  server.flushVisits = visits.flush;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const host = process.env.HOST || '127.0.0.1';
  if (!['127.0.0.1','0.0.0.0'].includes(host)) throw new Error('HOST must be 127.0.0.1 or 0.0.0.0.');
  const dataDir = process.env.COMMUNITY_DATA_DIR || path.resolve(ROOT, '..', 'data');
  const backup = backupFromEnv({dataDir});
  if (backup) await backup.restoreIfEmpty();
  const server = createServer({dataDir, backup});
  // Bunny stops the container with SIGTERM on every deploy (Ctrl+C locally); save the visit counts first.
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { Promise.resolve(server.flushVisits?.()).finally(() => process.exit(0)); });
  server.listen(port, host, () => {
    console.log(`El Nino Watch: http://127.0.0.1:${port}\nKeep this process running for the live data relays.`);
    backup?.start();
  });
}
