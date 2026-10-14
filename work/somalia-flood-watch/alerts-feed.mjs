// Keyless regional rainfall forecasts (ICPAC) and separately labelled GDACS event
// monitoring. Neither is an official national warning.
// ICPAC Weekly Exceptional Rainfall: forecast weekly rainfall compared with the
//   long-term observed rainfall for the same week; above the 90th, 95th and 99th
//   percentiles is heavy, very heavy and exceptional (extremely heavy).
//   https://eahazardswatch.icpac.net/  ·  https://www.icpac.net/weekly-forecast/
// GDACS API: https://gdacs.org/Documents/2025/GDACS_API_quickstart_v1.pdf
export const ALERT_SOURCES = Object.freeze({
  icpac: 'https://www.icpac.net/weekly-forecast/',
  icpacHazardsWatch: 'https://eahazardswatch.icpac.net/',
  icpacDatasets: 'https://eahazardswatch.icpac.net/api/datasets/',
  icpacWms: 'https://eahazardswatch.icpac.net/mapserver/',
  gdacs: 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH'
});
export const ICPAC_LAYERS = Object.freeze({
  extreme: 'weekly_extreme_heavy_rainfall', veryHeavy: 'weekly_very_heavy_rainfall', heavy: 'weekly_heavy_rainfall', total: 'weekly_total_precipitation'
});
// Highest category first.
const ICPAC_CATEGORIES = [
  {key: 'extreme', layer: ICPAC_LAYERS.extreme, label: 'Extremely heavy', percentile: 99, severity: 'severe'},
  {key: 'very-heavy', layer: ICPAC_LAYERS.veryHeavy, label: 'Very heavy', percentile: 95, severity: 'moderate'},
  {key: 'heavy', layer: ICPAC_LAYERS.heavy, label: 'Heavy', percentile: 90, severity: 'minor'}
];
const DAY = 86400000;
const EAT_MS = 3 * 3600 * 1000;
const MONTHS = {jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11};

function safeUrl(value, hosts) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || !hosts.includes(url.hostname.toLowerCase())) return null;
    return url.href;
  } catch { return null; }
}

function plain(value) {
  return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
      if (entity[0] === '#') {
        const value = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
      }
      return ({amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' '})[entity.toLowerCase()];
    }).replace(/\s+/g, ' ').trim();
}

function isoDate(value, {gdacs = false, end = false} = {}) {
  if (!value || typeof value !== 'string') return null;
  let label = value.trim();
  if (gdacs && /^\d{4}-\d\d-\d\d$/.test(label)) label += end ? 'T23:59:59.999Z' : 'T00:00:00Z';
  // GDACS returns UTC ISO values without the Z. Do not apply the host timezone.
  if (gdacs && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?$/.test(label)) label += 'Z';
  const parsed = Date.parse(label);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

// "13 Oct 2026" -> midnight East Africa Time that day, in epoch ms.
function eatDayStart(text) {
  const match = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/.exec(String(text || '').trim());
  if (!match || !Object.hasOwn(MONTHS, match[2].toLowerCase())) return NaN;
  return Date.UTC(Number(match[3]), MONTHS[match[2].toLowerCase()], Number(match[1])) - EAT_MS;
}
const eatDate = ms => new Date(ms + EAT_MS).toISOString().slice(0, 10);
const shortDay = ms => new Date(ms + EAT_MS).toLocaleDateString('en-GB', {day:'numeric', month:'short', timeZone:'UTC'});

// The latest weekly forecast, from the Hazards Watch dataset list.
export function parseIcpacDatasets(payload) {
  const list = Array.isArray(payload) ? payload : payload?.results;
  if (!Array.isArray(list)) throw new Error('ICPAC dataset list format was not recognized.');
  const dataset = list.find(item => (item?.layers || []).some(layer => layer?.layerName === ICPAC_LAYERS.extreme));
  if (!dataset) throw new Error('ICPAC exceptional rainfall forecast is not listed.');
  const issued = Date.parse(dataset.latest_date);
  if (!Number.isFinite(issued)) throw new Error('ICPAC forecast date is missing.');
  // "Latest: 13 Oct 2026 To 20 Oct 2026 (Initialized 13 Oct 2026)"; the end day is included.
  const range = /(\d{1,2} [A-Za-z]{3,9} \d{4})\s+To\s+(\d{1,2} [A-Za-z]{3,9} \d{4})/i.exec(String(dataset.summary || ''));
  let start = range ? eatDayStart(range[1]) : NaN, end = range ? eatDayStart(range[2]) + DAY - 1 : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) { start = issued; end = issued + 7 * DAY - 1; }
  return {time: eatDate(issued), issuedAt: new Date(issued).toISOString(), startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(),
    weekLabel: `${shortDay(start)}–${shortDay(end)}`, totalListed: list.some(item => (item?.layers || []).some(layer => layer?.layerName === ICPAC_LAYERS.total))};
}

// One GetFeatureInfo answer for a city: its highest category and the week's total.
export function parseIcpacPoint(gml) {
  if (typeof gml !== 'string' || !/<msGMLOutput\b/.test(gml) || gml.length > 200_000) throw new Error('ICPAC point response was not recognized.');
  const layers = new Set([...gml.matchAll(/<(weekly_[a-z_]+)_feature>/g)].map(match => match[1]));
  const category = ICPAC_CATEGORIES.find(item => layers.has(item.layer)) || null;
  const total = Number(/<precip>\s*([-\d.eE+]+)\s*<\/precip>/.exec(gml)?.[1]);
  return {category: category?.key || null, totalMm: Number.isFinite(total) && total >= 0 ? Math.round(total * 10) / 10 : null};
}

export function icpacPointUrl(lat, lon, time) {
  const d = 0.05, layers = [ICPAC_LAYERS.extreme, ICPAC_LAYERS.veryHeavy, ICPAC_LAYERS.heavy, ICPAC_LAYERS.total].join(',');
  const url = new URL(ALERT_SOURCES.icpacWms);
  url.search = new URLSearchParams({SERVICE:'WMS', VERSION:'1.1.1', REQUEST:'GetFeatureInfo', LAYERS:layers, QUERY_LAYERS:layers, STYLES:'', SRS:'EPSG:4326',
    BBOX:[lon - d, lat - d, lon + d, lat + d].join(','), WIDTH:'101', HEIGHT:'101', X:'50', Y:'50', INFO_FORMAT:'application/vnd.ogc.gml', FEATURE_COUNT:'4', time}).toString();
  return url.href;
}

export function icpacAlert(city, point, forecast) {
  const category = ICPAC_CATEGORIES.find(item => item.key === point.category);
  if (!category) return null;
  const [name, region] = city;
  const total = point.totalMm === null ? '' : `, with about ${Math.round(point.totalMm)} mm forecast for the week`;
  return {
    id: `icpac:${forecast.time}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, sourceId: 'icpac',
    title: `${name} · ICPAC forecast: ${category.label.toLowerCase()} rainfall, ${forecast.weekLabel}`,
    source: 'ICPAC', sourceUrl: ALERT_SOURCES.icpac, issuedAt: forecast.issuedAt, startsAt: forecast.startsAt, endsAt: forecast.endsAt,
    severity: category.severity, severityText: category.label, status: 'active',
    scope: {country: 'Somalia', cities: [name], areaDescription: region ? `${name} (${region})` : name},
    description: `ICPAC's weekly forecast puts ${name} above the ${category.percentile}th percentile of rainfall usually seen in this week of the year (${category.label.toLowerCase()} rainfall)${total}. This is a regional model forecast at about 11 km resolution, not an official local warning.`,
    basis: 'regional-forecast', forecastTotalMm: point.totalMm, category: category.key
  };
}

// The points answer for a forecast week, kept until ICPAC publishes the next week.
const icpacPoints = {time: null, results: null, fetchImpl: null};

async function loadIcpac(now, fetchImpl, cities) {
  const forecast = parseIcpacDatasets(JSON.parse(await fetchBody(ALERT_SOURCES.icpacDatasets, fetchImpl, 'application/json')));
  const expired = Date.parse(forecast.endsAt) <= new Date(now).getTime();
  let results = icpacPoints.time === forecast.time && icpacPoints.fetchImpl === fetchImpl ? icpacPoints.results : null;
  if (!results) {
    results = [];
    for (let i = 0; i < cities.length; i += 10) {
      results.push(...await Promise.allSettled(cities.slice(i, i + 10).map(async city => parseIcpacPoint(await fetchBody(icpacPointUrl(city[2], city[3], forecast.time), fetchImpl, 'application/vnd.ogc.gml,application/xml')))));
    }
    if (results.every(result => result.status === 'fulfilled')) Object.assign(icpacPoints, {time: forecast.time, results, fetchImpl});
  }
  const cityForecasts = cities.map((city, index) => ({city: city[0], ...(results[index]?.status === 'fulfilled' ? results[index].value : {category: null, totalMm: null, unavailable: true})}));
  const failedCount = cityForecasts.filter(item => item.unavailable).length;
  const alerts = expired ? [] : cities.map((city, index) => results[index]?.status === 'fulfilled' ? icpacAlert(city, results[index].value, forecast) : null).filter(Boolean);
  return {
    alerts, forecast, cityForecasts, publishedAt: forecast.issuedAt, returnedCount: cities.length - failedCount, failedCount, rejectedExpired: expired ? cityForecasts.filter(item => item.category).length : 0, rejectedInvalid: 0,
    partial: failedCount > 0 || expired,
    ...(expired ? {error: `ICPAC's latest weekly forecast (${forecast.weekLabel}) has ended and a newer one is not yet published`}
      // A city that did not answer is a gap, not a reason to hide the other cities' forecasts.
      : failedCount ? {notice: `${failedCount} cities could not be checked against the ICPAC forecast; coverage is incomplete.`} : {})
  };
}

function affectsSomalia(properties) {
  const countries = [properties.iso3, properties.iso2, properties.country];
  for (const country of Array.isArray(properties.affectedcountries) ? properties.affectedcountries : []) {
    if (typeof country === 'string') countries.push(country);
    else if (country && typeof country === 'object') countries.push(country.iso3, country.iso2, country.countryname, country.name);
  }
  return countries.some(value => /(?:^|[,;\s])(?:Somalia|SOM|SO)(?=$|[,;\s])/i.test(String(value || '')));
}

export function parseGdacsEvents(payload, {now = new Date()} = {}) {
  if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features)) throw new Error('GDACS GeoJSON format was not recognized.');
  const currentTime = new Date(now).getTime();
  let returnedCount = 0, rejectedExpired = 0, rejectedInvalid = 0;
  const alerts = [];
  for (const feature of payload.features) {
    const p = feature?.properties || {};
    if (p.eventtype !== 'FL' || !affectsSomalia(p)) continue;
    returnedCount++;
    const issuedAt = isoDate(p.datemodified, {gdacs:true});
    const startsAt = isoDate(p.fromdate, {gdacs:true});
    const endsAt = isoDate(p.todate, {gdacs:true, end:true});
    if (!issuedAt || !startsAt || !endsAt || Date.parse(issuedAt) > currentTime || Date.parse(endsAt) < Date.parse(startsAt)) { rejectedInvalid++; continue; }
    if (Date.parse(endsAt) <= currentTime) { rejectedExpired++; continue; }
    if (!(p.iscurrent === true || p.iscurrent === 'true') || Date.parse(startsAt) > currentTime || !p.eventid) { rejectedInvalid++; continue; }
    const model = /glofas/i.test(String(p.source || ''));
    const report = safeUrl(p.url?.report, ['gdacs.org', 'www.gdacs.org']) || `https://www.gdacs.org/report.aspx?eventtype=FL&eventid=${encodeURIComponent(p.eventid)}`;
    const alertColor = String(p.episodealertlevel || p.alertlevel || '').toLowerCase();
    alerts.push({
      id:`gdacs:FL:${p.eventid}:${p.episodeid || 0}`, sourceId:'gdacs',
      title:`${model ? 'GDACS model event' : 'GDACS flood event'}: ${plain(p.name || 'Somalia')}`,
      source:`GDACS${p.source ? ' / ' + plain(p.source) : ''}`, sourceUrl:report, issuedAt, startsAt, endsAt,
      severity:({red:'severe', orange:'moderate', green:'minor'})[alertColor] || 'unknown', severityText: plain(p.episodealertlevel || p.alertlevel),
      status:'active', scope:{country:'Somalia', cities:[], areaDescription:plain(p.country || 'Somalia')},
      description: `${plain(p.description || p.htmldescription || p.name)}. ${model ? 'Model-based event signal; inundation has not been confirmed by this record.' : 'Country-level event monitoring; this record does not identify flooded neighbourhoods.'}`,
      basis:model ? 'model-event' : 'event-monitoring'
    });
  }
  return {alerts, returnedCount, rejectedExpired, rejectedInvalid};
}

async function fetchBody(url, fetchImpl, type) {
  const response = await fetchImpl(url, {headers:{Accept:type, 'User-Agent':'ElNinoWatch/1.0 (public flood awareness dashboard)'}, signal:AbortSignal.timeout(20000), redirect:'error'});
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
  const body = await response.text();
  if (body.length > 8_000_000) throw new Error('Source response is unexpectedly large.');
  return body;
}

async function loadGdacs(now, fetchImpl) {
  const end = new Date(now);
  const start = new Date(end.getTime() - 30 * DAY);
  const result = {alerts:[], returnedCount:0, rejectedExpired:0, rejectedInvalid:0, windowStart:start.toISOString(), windowEnd:end.toISOString(), partial:false};
  let lastPageCount;
  for (let page = 1; page <= 5; page++) {
    const url = new URL(ALERT_SOURCES.gdacs);
    url.search = new URLSearchParams({eventlist:'FL', fromdate:start.toISOString().slice(0, 10), todate:end.toISOString().slice(0, 10), alertlevel:'red;orange;green', pagesize:'100', pagenumber:String(page)}).toString();
    const payload = JSON.parse(await fetchBody(url.href, fetchImpl, 'application/json'));
    const data = parseGdacsEvents(payload, {now});
    result.alerts.push(...data.alerts);
    result.returnedCount += data.returnedCount;
    result.rejectedExpired += data.rejectedExpired;
    result.rejectedInvalid += data.rejectedInvalid;
    lastPageCount = payload.features.length;
    if (lastPageCount < 100) break;
  }
  result.partial = lastPageCount >= 100;
  result.alerts = [...new Map(result.alerts.map(alert => [alert.id, alert])).values()];
  if (result.partial) result.error = 'GDACS result exceeds the search page limit; coverage is incomplete.';
  return result;
}

export async function loadOfficialAlerts({now = new Date(), fetchImpl = fetch, cities = []} = {}) {
  if (!Number.isFinite(new Date(now).getTime())) throw new Error('Invalid alert retrieval date.');
  const results = await Promise.allSettled([loadIcpac(now, fetchImpl, cities), loadGdacs(now, fetchImpl)]);
  const fetchedAt = new Date().toISOString();
  const sources = results.map((result, index) => {
    const id = index === 0 ? 'icpac' : 'gdacs';
    const data = result.status === 'fulfilled' ? result.value : null;
    return {id, name:index === 0 ? 'ICPAC weekly exceptional rainfall forecast' : 'Global Disaster Alert and Coordination System',
      sourceUrl:ALERT_SOURCES[id], available:!!data, fetchedAt:data ? fetchedAt : null,
      ...(data ? {...data, alerts:undefined} : {error:result.reason?.message || 'Source unavailable.'})};
  });
  // Do not convert total source failure into a successfully retrieved empty feed.
  if (!sources.some(source => source.available)) throw new Error(sources.map(source => `${source.id}: ${source.error}`).join(' '));
  const alerts = results.flatMap(result => result.status === 'fulfilled' ? result.value.alerts : []).sort((a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt));
  const regionalForecastAvailable = sources[0].available && !sources[0].partial;
  const eventFeedAvailable = sources[1].available && !sources[1].partial;
  const icpac = sources[0];
  const coverageNote = `ICPAC's weekly regional forecast is checked at each monitored city: heavy, very heavy and extremely heavy rainfall mean above the 90th, 95th and 99th percentile for that week of the year. It is a model forecast, not an official warning. GDACS is separate country-level flood event monitoring and may include model signals. ${icpac.available ? `${icpac.returnedCount} of ${cities.length} cities checked for ${icpac.forecast.weekLabel}.` : 'The ICPAC forecast is unavailable.'} ${!regionalForecastAvailable || !eventFeedAvailable ? 'Some source coverage is incomplete. ' : ''}An empty active list does not mean there is no flood risk. Retrieval time is distinct from the forecast issue date.`;
  return {alerts, fetchedAt, sources, regionalForecastAvailable, eventFeedAvailable, sourceUrl:ALERT_SOURCES.icpac, coverageNote};
}
