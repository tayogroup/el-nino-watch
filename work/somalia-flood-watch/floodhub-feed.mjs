// Google Flood Hub river forecasts, from Google's Flood Forecasting API
// (https://developers.google.com/flood-forecasting; data under CC BY 4.0, free of charge).
//
// The API needs a key from a Google Cloud project that Google has approved for the API (a waitlist).
// The key is GOOGLE_FLOOD_API_KEY on the server; without it this source is switched off and the app
// reads nothing from Google. It is sent in a header, never in a URL, so it cannot reach a log.
//
// Each gauge Google forecasts in Somalia has a latest flood status: extreme, severe, above normal,
// no flooding or unknown; Flood Hub's map calls the first three Extreme, Danger and Warning. A gauge
// at Warning or higher within GAUGE_RADIUS_KM of a monitored city becomes an alert for that city (the
// worst gauge per city). These are AI model forecasts at river gauges, not official warnings; the
// official national forecast is MOEWR's (hydro-feed.mjs).
const API = 'https://floodforecasting.googleapis.com/v1/';
const SITE = 'https://sites.research.google/floods/';
const DAY = 86400000;
const MAX_AGE_MS = 3 * DAY;
export const GAUGE_RADIUS_KM = 25;
export const FLOODHUB_SOURCE = Object.freeze({id: 'floodhub', name: 'Google Flood Hub river forecast', url: SITE, api: API});

// Google's severities, highest first, shown with the words Flood Hub's own map uses for the same three
// gauge thresholds (owner, 2026-10-16): Extreme, Danger and Warning. Extreme and Danger are both the
// app's top level. "level" keeps Flood Hub's Warning apart from MOEWR's national warning.
const SEVERITIES = {
  EXTREME: {severity: 'severe', word: 'Extreme', order: 3},
  SEVERE: {severity: 'severe', word: 'Danger', order: 2},
  ABOVE_NORMAL: {severity: 'minor', word: 'Warning', order: 1}
};
const TRENDS = {RISE: 'The forecast river level is rising.', FALL: 'The forecast river level is falling.', NO_CHANGE: 'The forecast river level is steady.'};

const radians = degrees => degrees * Math.PI / 180;
export function distanceKm(a, b) {
  const dLat = radians(b.latitude - a.latitude), dLon = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// The monitored city nearest the gauge, if it is within the radius.
export function nearestCity(location, cities) {
  if (!Number.isFinite(location?.latitude) || !Number.isFinite(location?.longitude)) return null;
  let best = null;
  for (const city of cities) {
    const km = distanceKm(location, {latitude: city[2], longitude: city[3]});
    if (km <= GAUGE_RADIUS_KM && (!best || km < best.km)) best = {name: city[0], region: city[1], km};
  }
  return best;
}

const clean = value => String(value || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
// "Belet Weyne gauge (Shabelle)", or as much of it as Google names.
export function gaugeLabel(gauge) {
  const site = clean(gauge?.siteName), river = clean(gauge?.river);
  return site && river ? `${site} gauge (${river})` : site ? `${site} gauge` : river ? `${river} river gauge` : 'River gauge';
}
const metres = value => `${value > 0 ? '+' : ''}${value.toFixed(1)}`;

// One gauge's status as an alert for its city, or null when it is not a flood signal.
export function floodHubAlert(status, gauge, city) {
  const meta = SEVERITIES[status?.severity];
  const issuedAt = Date.parse(status?.issuedTime), startsAt = Date.parse(status?.forecastTimeRange?.start), endsAt = Date.parse(status?.forecastTimeRange?.end);
  if (!meta || !city || !status.gaugeId || ![issuedAt, startsAt, endsAt].every(Number.isFinite) || endsAt < startsAt) return null;
  const place = gaugeLabel(gauge), change = status.forecastChange?.valueChange;
  const lat = status.gaugeLocation?.latitude, lon = status.gaugeLocation?.longitude;
  // Fixed sentence shapes, so the page can translate them (i18n-public.json). The gauge leads its
  // sentence: a pattern ending in a name would also match every sentence after it.
  const sentences = [`At the ${place === 'River gauge' ? 'river gauge' : place}, Google Flood Hub forecasts the river at its ${meta.word} level.`];
  if (TRENDS[status.forecastTrend]) sentences.push(TRENDS[status.forecastTrend]);
  if (Number.isFinite(change?.lowerBound) && Number.isFinite(change?.upperBound)) sentences.push(`Forecast change from the last known level: ${metres(change.lowerBound)} to ${metres(change.upperBound)} m.`);
  sentences.push('This is an AI model forecast from Google, not an official warning.');
  return {
    id: `floodhub:${status.gaugeId}:${new Date(issuedAt).toISOString()}`, sourceId: 'floodhub',
    title: `${city.name} · Google Flood Hub: river forecast at ${meta.word} level`,
    source: 'Google Flood Hub', sourceUrl: Number.isFinite(lat) && Number.isFinite(lon) ? `${SITE}l/${lat.toFixed(4)}/${lon.toFixed(4)}/10` : SITE,
    issuedAt: new Date(issuedAt).toISOString(), startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(),
    severity: meta.severity, severityText: `${meta.word} level`, status: 'active',
    scope: {country: 'Somalia', cities: [city.name], gauge: place, areaDescription: place},
    description: sentences.join(' '),
    basis: 'river-forecast', gaugeId: String(status.gaugeId), googleSeverity: status.severity, distanceKm: Math.round(city.km), qualityVerified: status.qualityVerified === true
  };
}

// Gauge names and rivers, kept for the life of the process (they do not change between forecasts).
const gauges = new Map();

export async function loadFloodHubAlerts({now = new Date(), fetchImpl = fetch, cities = [], apiKey = process.env.GOOGLE_FLOOD_API_KEY} = {}) {
  if (!apiKey) throw new Error('GOOGLE_FLOOD_API_KEY is not set.');
  const call = async (path, body) => {
    const response = await fetchImpl(API + path, {method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: {'X-Goog-Api-Key': apiKey, Accept: 'application/json', ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
    // Google's error body can repeat request details; report the status only.
    if (!response.ok) throw new Error(`Google Flood Forecasting API returned HTTP ${response.status}.`);
    return response.json();
  };
  const statuses = [];
  let pageToken;
  for (let page = 0; page < 5; page++) {
    const data = await call('floodStatus:searchLatestFloodStatusByArea', {regionCode: 'SO', pageSize: 5000, ...(pageToken ? {pageToken} : {})});
    statuses.push(...(Array.isArray(data?.floodStatuses) ? data.floodStatuses : []));
    pageToken = data?.nextPageToken;
    if (!pageToken) break;
  }
  const time = new Date(now).getTime();
  const counts = {EXTREME: 0, SEVERE: 0, ABOVE_NORMAL: 0, NO_FLOODING: 0, UNKNOWN: 0};
  let rejectedExpired = 0, awayFromCities = 0;
  const signals = [];
  for (const status of statuses) {
    if (Object.hasOwn(counts, status?.severity)) counts[status.severity]++;
    if (!SEVERITIES[status?.severity]) continue;
    const issued = Date.parse(status.issuedTime), ends = Date.parse(status.forecastTimeRange?.end);
    if (!Number.isFinite(issued) || time - issued > MAX_AGE_MS || !Number.isFinite(ends) || ends <= time) { rejectedExpired++; continue; }
    const city = nearestCity(status.gaugeLocation, cities);
    if (!city) { awayFromCities++; continue; }
    signals.push({status, city});
  }
  const missing = [...new Set(signals.map(signal => String(signal.status.gaugeId)).filter(id => id && !gauges.has(id)))];
  if (missing.length) {
    try {
      const params = new URLSearchParams();
      for (const id of missing) params.append('names', `gauges/${id}`);
      const data = await call(`gauges:batchGet?${params}`);
      for (const gauge of Array.isArray(data?.gauges) ? data.gauges : []) if (gauge?.gaugeId) gauges.set(String(gauge.gaugeId), gauge);
    } catch { /* Names are a nicety: a gauge without one is still "River gauge". */ }
  }
  // The worst gauge for each city, then the most recent.
  const byCity = new Map();
  for (const {status, city} of signals) {
    const alert = floodHubAlert(status, gauges.get(String(status.gaugeId)), city);
    const held = byCity.get(city.name);
    if (alert && (!held || SEVERITIES[alert.googleSeverity].order > SEVERITIES[held.googleSeverity].order
      || (SEVERITIES[alert.googleSeverity].order === SEVERITIES[held.googleSeverity].order && alert.issuedAt > held.issuedAt))) byCity.set(city.name, alert);
  }
  const alerts = [...byCity.values()];
  const issued = statuses.map(status => Date.parse(status?.issuedTime)).filter(Number.isFinite);
  return {alerts, gauges: statuses.length, severities: counts, rejectedExpired, awayFromCities,
    publishedAt: issued.length ? new Date(Math.max(...issued)).toISOString() : null,
    ...(awayFromCities ? {notice: `${awayFromCities} gauges with a flood signal are more than ${GAUGE_RADIUS_KM} km from a monitored city; see Google Flood Hub for them.`} : {})};
}
