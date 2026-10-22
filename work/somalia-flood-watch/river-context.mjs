// River context (owner, 2026-10-21), two model products that help read the Juba and Shabelle:
// - Upstream rain: Open-Meteo's 7-day rainfall forecast at points in the Ethiopian highlands and lowlands
//   that drain into the Shabelle and the Juba (Genale and Dawa). Rain there reaches Somalia days later,
//   so this is early context, not a river forecast. It goes through the forecast relay's cache.
// - Lower Juba river forecast: GEOGLOWS ECMWF Streamflow Service, daily median and middle range of its
//   ensemble at the Juba near Jilib and Jamaame. No return-period thresholds are shown: the service's
//   threshold endpoint was failing when this was built, and a flow number alone is not a flood level.
//   Data CC BY 4.0, "GEOGLOWS ECMWF Streamflow Service"; ECMWF asks that outputs say they are based on
//   ECMWF data.
// Coordinates: GeoNames (Open-Meteo place search). GEOGLOWS river IDs: its getriverid lookup at the
// Jilib and Jamaame city points, checked to be the Juba main stem (hundreds of m3/s).

export const UPSTREAM_POINTS = Object.freeze([
  ['Goba', 'Shabelle', 'Bale highlands, upper Shabelle', 7.01667, 39.98333],
  ['Imi', 'Shabelle', 'Shabelle in Ethiopia', 6.46667, 42.17722],
  ['Gode', 'Shabelle', 'Shabelle in Ethiopia', 5.95056, 43.55186],
  ['Mustahil', 'Shabelle', 'Shabelle near the border', 5.24361, 44.73194],
  ['Kibre Mengist', 'Juba', 'Upper Genale', 5.88333, 38.98333],
  ['Negele', 'Juba', 'Genale', 5.31667, 39.58333],
  ['Filtu', 'Juba', 'Genale and Dawa lowlands', 5.11667, 40.65],
  ['Dolo Odo', 'Juba', 'Genale and Dawa meet, at the border', 4.17861, 42.05889]
].map(([name, river, area, lat, lon]) => Object.freeze({name, river, area, lat, lon})));
// The relay accepts only known places; these rows let it relay the upstream points too.
export const UPSTREAM_RELAY_ROWS = UPSTREAM_POINTS.map(point => [point.name, 'Ethiopia', point.lat, point.lon, 'Upstream point']);
export const LOWER_JUBA = Object.freeze([
  Object.freeze({name: 'Juba near Jilib', city: 'Jilib', riverId: 110483618}),
  Object.freeze({name: 'Juba near Jamaame', city: 'Jamaame', riverId: 110433775})
]);
export const GEOGLOWS = Object.freeze({name: 'GEOGLOWS ECMWF Streamflow Service', site: 'https://geoglows.ecmwf.int/', api: 'https://geoglows.ecmwf.int/api/v2/forecaststats/'});
const GEOGLOWS_TTL = 3 * 60 * 60 * 1000;

export const upstreamQuery = () => `?latitude=${UPSTREAM_POINTS.map(p => p.lat).join(',')}&longitude=${UPSTREAM_POINTS.map(p => p.lon).join(',')}&daily=precipitation_sum&forecast_days=7&timezone=Africa%2FMogadishu`;

export function summariseUpstream(body) {
  const list = Array.isArray(body) ? body : [body];
  if (list.length !== UPSTREAM_POINTS.length) throw new Error('The upstream rainfall forecast did not include every point.');
  return UPSTREAM_POINTS.map((point, index) => {
    const days = list[index]?.daily?.precipitation_sum, dates = list[index]?.daily?.time;
    const complete = Array.isArray(days) && days.length === 7 && days.every(v => typeof v === 'number');
    const peak = complete ? Math.max(...days) : null;
    return {...point, totalMm: complete ? Math.round(days.reduce((a, b) => a + b, 0) * 10) / 10 : null, peakMm: complete ? Math.round(peak * 10) / 10 : null, peakDay: complete ? dates?.[days.indexOf(peak)] ?? null : null};
  });
}

// GEOGLOWS mixes 3- and 6-hourly steps and leaves blanks; each day is the mean of its values.
export function summariseGeoglows(body) {
  const times = body?.datetime, keys = ['flow_med', 'flow_25p', 'flow_75p'];
  if (!Array.isArray(times) || !keys.every(key => Array.isArray(body[key]))) throw new Error('GEOGLOWS returned an unexpected forecast.');
  const days = new Map();
  times.forEach((time, index) => {
    const values = keys.map(key => body[key][index]);
    if (!values.every(Number.isFinite)) return;
    const day = String(time).slice(0, 10), item = days.get(day) || {date: day, n: 0, median: 0, low: 0, high: 0};
    item.n++; item.median += values[0]; item.low += values[1]; item.high += values[2];
    days.set(day, item);
  });
  const daily = [...days.values()].map(({date, n, median, low, high}) => ({date, medianM3s: Math.round(median / n), lowM3s: Math.round(low / n), highM3s: Math.round(high / n)}));
  if (daily.length < 3) throw new Error('GEOGLOWS returned too few forecast days.');
  const first = daily[0].medianM3s, last = daily.at(-1).medianM3s, peak = daily.reduce((a, b) => b.medianM3s > a.medianM3s ? b : a);
  // Rising when the forecast peak is 10% or more above today's flow, even if it falls again later;
  // falling when it only drops by 10% or more; steady otherwise.
  const rise = first ? (peak.medianM3s - first) / first : 0, drop = first ? (last - first) / first : 0;
  const trend = rise >= 0.1 ? 'rising' : drop <= -0.1 ? 'falling' : 'steady';
  return {daily, issuedAt: body.metadata?.gen_date || null, trend, changePercent: Math.round((trend === 'rising' ? rise : drop) * 100), peak: {date: peak.date, medianM3s: peak.medianM3s}};
}

export function createRiverContext({relay, fetchImpl = (...args) => fetch(...args), now = () => Date.now()} = {}) {
  let juba = null, jubaAt = 0, pending = null;
  async function lowerJuba() {
    if (juba && now() - jubaAt < GEOGLOWS_TTL) return juba;
    if (pending) return pending;
    pending = (async () => {
      const points = await Promise.all(LOWER_JUBA.map(async point => {
        try {
          const response = await fetchImpl(`${GEOGLOWS.api}${point.riverId}?format=json`, {signal: AbortSignal.timeout(90000)});
          if (!response.ok) throw new Error(`GEOGLOWS returned HTTP ${response.status}.`);
          return {...point, available: true, ...summariseGeoglows(await response.json())};
        } catch (error) { return {...point, available: false, error: error.message}; }
      }));
      // A failed refresh keeps the last good forecast, marked by its own issue time, and is tried again
      // after 10 minutes rather than the full 3 hours (GEOGLOWS has short outages).
      const good = points.some(point => point.available);
      if (good || !juba) juba = {points, fetchedAt: new Date(now()).toISOString()};
      jubaAt = good ? now() : now() - GEOGLOWS_TTL + 10 * 60 * 1000;
      return juba;
    })().finally(() => { pending = null; });
    return pending;
  }
  async function upstream() {
    try { return {available: true, points: summariseUpstream(await relay.get('forecast', upstreamQuery()))}; }
    catch (error) { return {available: false, error: `Upstream rainfall is unavailable: ${error.message}`}; }
  }
  return async function load() {
    const [rain, river] = await Promise.all([upstream(), lowerJuba()]);
    return {upstream: rain, lowerJuba: {...river, source: GEOGLOWS.name, sourceUrl: GEOGLOWS.site}};
  };
}
