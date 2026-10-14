// Anonymous visit counts, kept by this server: no cookies, no third party, and
// no internet address or user agent stored. Every visit (page load) is counted;
// visitors are not identified or deduplicated. To stop one machine inflating
// the counts, events are capped per connection per day using a one-way hash with
// a random salt that lives only in memory for that day; it is never saved.
//
// The page reports a view on load and when the tab or city changes
// (dist/visits.js, POST /api/visit). Totals per day are public at
// GET /api/visits and on /stats once the site has had PUBLISH_AFTER visits;
// until then only that threshold is shown.
// Stored in <dataDir>/visits.json.
import {readFile, writeFile, rename, unlink} from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';

export const VISIT_TABS = ['overview', 'weather', 'map', 'alerts', 'community', 'sources', 'mayor'];
const BOT = /bot|crawl|spider|slurp|curl|wget|python|httpclient|headless|lighthouse|monitor|preview|facebookexternalhit|bunny/i;
const KEEP_DAYS = 400;
const MAX_EVENTS_PER_VISITOR_DAY = 200;
export const PUBLISH_AFTER = 3000;
// The audience is in East Africa, so a "day" is an East Africa Time day.
const eatDay = ms => new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10);
const bump = (bucket, key) => { if (key) bucket[key] = (bucket[key] || 0) + 1; };

export function deviceOf(userAgent = '') {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(userAgent)) return 'tablet';
  if (/mobi|iphone|android/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

export function createVisits({dataDir, cities = [], now = () => Date.now(), log = console, publishAfter = PUBLISH_AFTER} = {}) {
  const file = path.join(path.resolve(dataDir), 'visits.json');
  const cityNames = new Set(cities.map(city => Array.isArray(city) ? city[0] : city.name));
  let days = {}, dirty = false, salt = null, saltDay = null, seen = new Map(), saveTimer = null;
  const ready = readFile(file, 'utf8').then(text => {
    const saved = JSON.parse(text);
    if (saved && saved.version === 1 && saved.days && typeof saved.days === 'object') days = saved.days;
  }).catch(error => { if (error.code !== 'ENOENT') log.error(`Visit counts not loaded: ${error.message}`); });

  function connectionKey(req, day) {
    if (saltDay !== day) { salt = randomBytes(32); saltDay = day; seen = new Map(); }
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const address = forwarded || req.headers['x-real-ip'] || req.socket?.remoteAddress || '';
    return createHash('sha256').update(salt).update(String(address)).update('\0').update(String(req.headers['user-agent'] || '')).digest('hex').slice(0, 32);
  }

  function dayBucket(day) {
    return days[day] ||= {views: 0, tabs: {}, cities: {}, countries: {}, languages: {}, devices: {}};
  }

  async function save() {
    saveTimer = null;
    if (!dirty) return;
    dirty = false;
    const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({version: 1, days}), {flag: 'wx', mode: 0o600});
      await rename(temporary, file);
    } catch (error) {
      dirty = true;
      await unlink(temporary).catch(() => {});
      log.error(`Visit counts not saved: ${error.message}`);
    }
  }
  const scheduleSave = () => { if (!saveTimer) { saveTimer = setTimeout(save, 30000); saveTimer.unref?.(); } };

  // Returns true when the event was counted.
  async function record(req, event) {
    await ready;
    const agent = String(req.headers['user-agent'] || '');
    if (!agent || BOT.test(agent)) return false;
    const at = now(), day = eatDay(at), key = connectionKey(req, day), bucket = dayBucket(day);
    const count = (seen.get(key) || 0) + 1;
    if (count > MAX_EVENTS_PER_VISITOR_DAY) return false;
    seen.set(key, count);
    const tab = VISIT_TABS.includes(event.tab) ? event.tab : null;
    const city = cityNames.has(event.city) ? event.city : (event.city ? 'other' : null);
    if (event.type === 'view') {
      bucket.views++;
      bump(bucket.languages, event.lang === 'so' ? 'so' : event.lang === 'en' ? 'en' : null);
      bump(bucket.devices, deviceOf(agent));
      const country = String(req.headers['cdn-requestcountrycode'] || '').toUpperCase();
      bump(bucket.countries, /^[A-Z]{2}$/.test(country) ? country : 'unknown');
    }
    if (event.type === 'view' || event.type === 'tab') bump(bucket.tabs, tab);
    if (event.type === 'view' || event.type === 'city') bump(bucket.cities, city);
    for (const old of Object.keys(days).sort().slice(0, Math.max(0, Object.keys(days).length - KEEP_DAYS))) delete days[old];
    dirty = true;
    scheduleSave();
    return true;
  }

  const allVisits = () => Object.values(days).reduce((sum, d) => sum + (d.views || 0), 0);
  const published = () => allVisits() >= publishAfter;

  function summary(dayCount) {
    if (!published()) return {published: false, threshold: publishAfter, note: `Visitor statistics are published once the site has had ${publishAfter.toLocaleString('en')} visits.`};
    const keys = Object.keys(days).sort().slice(-dayCount);
    const total = {views: 0, tabs: {}, cities: {}, countries: {}, languages: {}, devices: {}};
    for (const key of keys) {
      const d = days[key];
      total.views += d.views;
      for (const group of ['tabs', 'cities', 'countries', 'languages', 'devices']) for (const [name, n] of Object.entries(d[group] || {})) total[group][name] = (total[group][name] || 0) + n;
    }
    return {published: true, threshold: publishAfter, allTimeVisits: allVisits(), generatedAt: new Date(now()).toISOString(), timezone: 'Africa/Mogadishu', days: keys.map(key => ({date: key, views: days[key].views})), totals: total,
      note: 'Anonymous counts of visits (page loads), not of people: one person visiting twice counts twice. No cookies; no addresses stored. Browsers asking not to be tracked are not counted.'};
  }

  async function handle(req, res, url) {
    if (url.pathname !== '/api/visit' && url.pathname !== '/api/visits') return false;
    const send = (status, body) => {
      const buffer = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buffer.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
      res.end(req.method === 'HEAD' ? undefined : buffer);
    };
    if (url.pathname === '/api/visits') {
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, {error: 'Only GET is supported.'}), true;
      await ready;
      const dayCount = Math.min(400, Math.max(1, Math.trunc(Number(url.searchParams.get('days')) || 30)));
      return send(200, summary(dayCount)), true;
    }
    if (req.method !== 'POST') return send(405, {error: 'Only POST is supported.'}), true;
    // Same-site beacons only: a foreign page cannot inflate the counts from a visitor's browser.
    const origin = req.headers.origin;
    if (req.headers['sec-fetch-site'] === 'cross-site') return send(403, {error: 'Visits must come from this site.'}), true;
    if (origin) { try { if (new URL(origin).host !== req.headers.host) return send(403, {error: 'Visits must come from this site.'}), true; } catch { return send(403, {error: 'Invalid origin.'}), true; } }
    let text = '';
    for await (const chunk of req) { text += chunk; if (text.length > 2048) return send(413, {error: 'Too large.'}), true; }
    let event;
    try { event = JSON.parse(text || '{}'); } catch { return send(400, {error: 'Invalid JSON.'}), true; }
    if (!event || !['view', 'tab', 'city'].includes(event.type)) return send(400, {error: 'Unknown visit event.'}), true;
    const counted = await record(req, event);
    return send(202, {counted, published: published()}), true;
  }

  return {handle, record, summary, published, flush: save};
}
