import {openMeteoUrl} from './open-meteo.mjs';
// Server relay for the Open-Meteo forecasts every visitor's browser used to fetch
// itself: the 44-city daily forecast, the 44-city GloFAS river discharge, and the
// detailed hourly forecast of one city. Open-Meteo's free service limits requests
// per internet address, and many Somali mobile users share one; here one cached
// copy serves everyone.
//
// The browser still builds the same Open-Meteo URLs (app.js is unchanged in that
// respect); dist/forecast-relay.js swaps the host for /api/open-meteo/<endpoint>
// and falls back to Open-Meteo directly if this relay fails. So this is not an
// open proxy: only the 30 known cities, known fields and bounded values pass.
//
// Freshness: a cached copy is served only while younger than its TTL. On an
// upstream failure the relay answers 502 rather than serving older data, so the
// browser's own fallback and stale labelling stay truthful.
const DAY_MS = 24 * 60 * 60 * 1000;
const UPSTREAM = {
  forecast: {url: 'https://api.open-meteo.com/v1/forecast', ttl: 15 * 60 * 1000},
  flood: {url: 'https://flood-api.open-meteo.com/v1/flood', ttl: 60 * 60 * 1000}
};
const FORECAST_FIELDS = {
  current: ['temperature_2m', 'precipitation'],
  daily: ['precipitation_sum', 'precipitation_probability_max', 'temperature_2m_max', 'weather_code', 'temperature_2m_min',
    'apparent_temperature_max', 'apparent_temperature_min', 'wind_speed_10m_max', 'wind_gusts_10m_max', 'sunrise', 'sunset', 'uv_index_max'],
  hourly: ['temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'precipitation_probability', 'precipitation', 'weather_code',
    'cloud_cover', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'pressure_msl', 'visibility', 'dew_point_2m', 'is_day']
};
const ALLOWED = {
  forecast: {
    latitude: 'coords', longitude: 'coords', current: FORECAST_FIELDS.current, daily: FORECAST_FIELDS.daily, hourly: FORECAST_FIELDS.hourly,
    forecast_days: 'days', timezone: ['Africa/Mogadishu', 'GMT'], temperature_unit: ['celsius'], wind_speed_unit: ['kmh'], precipitation_unit: ['mm']
  },
  flood: {latitude: 'coords', longitude: 'coords', daily: ['river_discharge'], start_date: 'date', end_date: 'date', timezone: ['GMT', 'Africa/Mogadishu']}
};
export const RELAY_FIELDS = Object.freeze(Object.fromEntries(Object.entries(FORECAST_FIELDS).map(([key, value]) => [key, Object.freeze([...value])])));

const reject = message => { const error = new Error(message); error.status = 400; throw error; };

// Returns the canonical query string, or throws a 400.
export function canonicalQuery(endpoint, search, {cities, now = Date.now()}) {
  const rules = ALLOWED[endpoint];
  if (!rules) reject('Unknown forecast endpoint.');
  const params = new URLSearchParams(search);
  const seen = new Set();
  for (const key of params.keys()) {
    if (seen.has(key)) reject(`Repeated parameter: ${key}.`);
    seen.add(key);
    if (!Object.hasOwn(rules, key)) reject(`Unsupported parameter: ${key}.`);
  }
  if (!params.has('latitude') || !params.has('longitude')) reject('Latitude and longitude are required.');
  const lats = params.get('latitude').split(','), lons = params.get('longitude').split(',');
  if (lats.length !== lons.length || !lats.length || lats.length > cities.length) reject('Coordinate lists must pair up.');
  lats.forEach((lat, i) => {
    const la = Number(lat), lo = Number(lons[i]);
    if (!cities.some(city => Math.abs(city[2] - la) < 1e-9 && Math.abs(city[3] - lo) < 1e-9)) reject('Only the monitored cities are relayed.');
  });
  for (const [key, rule] of Object.entries(rules)) {
    if (!params.has(key) || rule === 'coords') continue;
    const value = params.get(key);
    if (Array.isArray(rule)) {
      if (!value.split(',').every(item => rule.includes(item))) reject(`Unsupported value for ${key}.`);
    } else if (rule === 'days') {
      const days = Number(value);
      if (!Number.isInteger(days) || days < 1 || days > 16) reject('forecast_days must be 1 to 16.');
    } else if (rule === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Math.abs(Date.parse(value + 'T12:00:00Z') - now) > 21 * DAY_MS) reject(`${key} must be a nearby date.`);
    }
  }
  return [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
}

export function createForecastRelay({cities, fetchImpl = (...args) => fetch(...args), now = () => Date.now(), maxEntries = 100, env = process.env} = {}) {
  if (!Array.isArray(cities) || !cities.length) throw new Error('The relay needs the monitored cities.');
  const cache = new Map(), pending = new Map();

  async function upstream(endpoint, query) {
    const key = endpoint + '?' + query, hit = cache.get(key);
    if (hit && now() - hit.at < UPSTREAM[endpoint].ttl) return {...hit, cache: 'hit'};
    if (pending.has(key)) return pending.get(key);
    const request = (async () => {
      const response = await fetchImpl(openMeteoUrl(endpoint, query, env), {signal: AbortSignal.timeout(25000), headers: {'User-Agent': 'ElNinoWatch/1.0'}});
      if (!response.ok) { const error = new Error(`Open-Meteo returned HTTP ${response.status}.`); error.status = 502; throw error; }
      const body = await response.text();
      try { JSON.parse(body); } catch { const error = new Error('Open-Meteo returned invalid JSON.'); error.status = 502; throw error; }
      const entry = {body, at: now()};
      cache.delete(key);
      cache.set(key, entry);
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      return {...entry, cache: 'miss'};
    })();
    pending.set(key, request);
    try { return await request; } finally { pending.delete(key); }
  }

  async function handle(req, res, url) {
    const match = /^\/api\/open-meteo\/(forecast|flood)$/.exec(url.pathname);
    if (!match) return false;
    const send = (status, body, extra = {}) => {
      const buffer = Buffer.from(body);
      res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buffer.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra});
      res.end(req.method === 'HEAD' ? undefined : buffer);
    };
    if (!['GET', 'HEAD'].includes(req.method)) { send(405, JSON.stringify({error: 'Only GET and HEAD are supported.'})); return true; }
    try {
      const query = canonicalQuery(match[1], url.search, {cities, now: now()});
      const result = await upstream(match[1], query);
      send(200, result.body, {'X-Retrieved-At': new Date(result.at).toISOString(), 'X-Relay-Cache': result.cache});
    } catch (error) {
      send(error.status || 502, JSON.stringify({error: error.status === 400 ? error.message : `Forecast relay unavailable: ${error.message}`}));
    }
    return true;
  }
  // The server's own pages (the light page, lite.mjs) read through the same cache.
  handle.get = async (endpoint, search) => JSON.parse((await upstream(endpoint, canonicalQuery(endpoint, search, {cities, now: now()}))).body);
  return handle;
}
