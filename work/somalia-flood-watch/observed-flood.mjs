import {readFile} from 'node:fs/promises';

const GFM = 'https://geoserver.gfm.eodc.eu/geoserver/gfm/wms';
const GFM_CAP = `${GFM}?service=WMS&request=GetCapabilities&version=1.3.0`;
const NASA_CAP = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml';
const NASA_LAYER = 'MODIS_Combined_Flood_3-Day';
const DAY = 86400000;
export const OBSERVED_SOURCE_URL = 'https://extwiki.eodc.eu/GFM/PUM';

async function get(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, {signal: AbortSignal.timeout(20000), headers: {'User-Agent': 'SomaliaFloodWatch/1.0', Accept: 'application/json, application/xml, text/xml, */*'}});
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
  return response;
}

function blockFor(xml, marker) {
  const offset = String(xml).indexOf(marker);
  if (offset < 0) throw new Error('Expected imagery layer is missing from service capabilities.');
  const start = xml.lastIndexOf('<Layer', offset);
  const end = xml.indexOf('</Layer>', offset);
  if (start < 0 || end < offset) throw new Error('Imagery layer metadata could not be read.');
  return xml.slice(start, end + 8);
}

function dayLabel(value) {
  const match = String(value ?? '').match(/^\d{4}-\d{2}-\d{2}/);
  if (!match || !Number.isFinite(Date.parse(match[0])) || new Date(`${match[0]}T00:00:00Z`).toISOString().slice(0, 10) !== match[0]) return null;
  return match[0];
}

function recentDays(end, now) {
  const latestCompleted = new Date(now.getTime() - DAY).toISOString().slice(0, 10);
  const chosen = end < latestCompleted ? end : latestCompleted;
  return {chosen, candidates: Array.from({length: 15}, (_, n) => new Date(Date.parse(`${end}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10))};
}

export function parseRadarCapabilities(xml, now = new Date()) {
  const layer = blockFor(String(xml), '<Name>observed_flood_extent</Name>');
  const dimension = layer.match(/<Dimension\b(?=[^>]*\bname="time")[^>]*>([\s\S]*?)<\/Dimension>/i);
  const sourceTimeDefault = dayLabel(dimension?.[0].match(/\bdefault="([^"]+)"/)?.[1]);
  if (!dimension || !sourceTimeDefault) throw new Error('Radar observation dates are unavailable.');
  const advertised = new Set(dimension[1].split(',').map(dayLabel).filter(Boolean));
  const {chosen, candidates} = recentDays(sourceTimeDefault, now);
  const availableDates = candidates.filter(date => advertised.has(date));
  const timeDefault = availableDates.find(date => date <= chosen) ?? availableDates.at(-1);
  if (!timeDefault) throw new Error('No recent radar observation dates were advertised.');
  return {sourceTimeDefault, timeDefault, availableDates, timeWindow: {start: `${timeDefault}T00:00:00Z`, end: `${timeDefault}T23:59:59Z`}, partial: timeDefault === now.toISOString().slice(0, 10)};
}

export function parseNasaCapabilities(xml, now = new Date()) {
  const layer = blockFor(String(xml), `<ows:Identifier>${NASA_LAYER}</ows:Identifier>`);
  const sourceTimeDefault = dayLabel(layer.match(/<Default>([^<]+)<\/Default>/)?.[1]);
  if (!sourceTimeDefault || !layer.includes('GoogleMapsCompatible_Level9')) throw new Error('NASA observation dates or tile matrix are unavailable.');
  const availableRange = [...layer.matchAll(/<Value>([^<]+)<\/Value>/g)].map(match => match[1]);
  const available = date => availableRange.some(range => {
    const [start, end, period] = range.split('/');
    return period === 'P1D' ? date >= dayLabel(start) && date <= dayLabel(end) : date === dayLabel(start);
  });
  const {chosen, candidates} = recentDays(sourceTimeDefault, now);
  const availableDates = candidates.filter(available);
  const timeDefault = availableDates.find(date => date <= chosen) ?? availableDates.at(-1);
  if (!timeDefault) throw new Error('No recent NASA observation dates were advertised.');
  return {sourceTimeDefault, timeDefault, availableDates, availableRange, compositeStart: new Date(Date.parse(`${timeDefault}T00:00:00Z`) - 2 * DAY).toISOString().slice(0, 10), partial: timeDefault === now.toISOString().slice(0, 10)};
}

export async function loadObservedFlood({fetchImpl = fetch, now = new Date()} = {}) {
  const config = JSON.parse(await readFile(new URL('./dist/observed-flood-source.json', import.meta.url), 'utf8'));
  const results = await Promise.allSettled([
    get(GFM_CAP, fetchImpl).then(response => response.text()).then(xml => parseRadarCapabilities(xml, now)),
    get(NASA_CAP, fetchImpl).then(response => response.text()).then(xml => parseNasaCapabilities(xml, now))
  ]);
  const radar = {...config.gfm, available: results[0].status === 'fulfilled'};
  const nasa = {provider: config.provider, layerId: config.layerId, wmtsUrlTemplate: config.wmtsUrlTemplate, capabilitiesUrl: NASA_CAP,
    sourceUrl: config.sourceUrl, resolutionM: config.resolutionM, maxNativeZoom: config.maxNativeZoom, compositeDays: 3, legend: config.legend, limits: config.limits, available: results[1].status === 'fulfilled'};
  if (radar.available) Object.assign(radar, results[0].value);
  else radar.error = results[0].reason.message;
  if (nasa.available) Object.assign(nasa, results[1].value);
  else nasa.error = results[1].reason.message;
  return {available: radar.available || nasa.available, provider: radar.available ? radar.provider : nasa.provider, primary: radar.available ? 'radar' : 'nasa', sourceUrl: OBSERVED_SOURCE_URL,
    fetchedAt: now.toISOString(), radar, nasa,
    note: 'Observation dates describe satellite acquisitions, not a live ground confirmation. Forecast risk and historical flood-prone areas are separate evidence.'};
}

function featureInfoUrl(layer, lat, lon, date) {
  const url = new URL(GFM);
  const delta = .002;
  const size = 101;
  for (const [key, value] of Object.entries({SERVICE:'WMS', VERSION:'1.3.0', REQUEST:'GetFeatureInfo', LAYERS:`gfm:${layer}`, QUERY_LAYERS:`gfm:${layer}`,
    STYLES:'', FORMAT:'image/png', INFO_FORMAT:'application/json', CRS:'EPSG:4326', BBOX:[lat-delta,lon-delta,lat+delta,lon+delta].join(','),
    WIDTH:size, HEIGHT:size, I:50, J:50, FEATURE_COUNT:30, TIME:`${date}T00:00:00Z/${date}T23:59:59Z`})) url.searchParams.set(key, value);
  return url;
}

export function classifyRadarPixel(value, excluded, referenceWater, hasScene) {
  if (!hasScene) return 'unknown';
  if (excluded !== 0 || ![0,1].includes(referenceWater) || ![0,1].includes(value)) return 'unknown';
  if (value === 1) return 'flood-detected';
  if (referenceWater === 1) return 'reference-water';
  return value === 0 ? 'no-flood-detected' : 'unknown';
}

export async function loadRadarPoint(lat, lon, date, {fetchImpl = fetch, now = new Date()} = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -2 || lat > 13 || lon < 40 || lon > 52) throw new Error('Coordinates must be within the Somalia region.');
  const queryDate = date === undefined || date === null || date === '' ? new Date(now.getTime()-DAY).toISOString().slice(0,10) : dayLabel(date);
  if (!queryDate || date && queryDate !== date || queryDate > now.toISOString().slice(0, 10) || Date.parse(`${queryDate}T00:00:00Z`) < now.getTime() - 31 * DAY) throw new Error('Choose an observation date within the last 30 days.');
  const layers = ['observed_flood_extent_footprint', 'observed_flood_extent', 'exclusion_mask', 'reference_water_mask'];
  const results = await Promise.allSettled(layers.map(layer => get(featureInfoUrl(layer,lat,lon,queryDate),fetchImpl).then(response=>response.json())));
  const timeWindow = {start:`${queryDate}T00:00:00Z`,end:`${queryDate}T23:59:59Z`};
  const base = {provider:'Copernicus CEMS GFM / Sentinel-1',sourceUrl:OBSERVED_SOURCE_URL,lat,lon,date:queryDate,timeWindow,fetchedAt:now.toISOString()};
  if (results[0].status !== 'fulfilled') return {...base,available:false,coverage:'unavailable',scenes:[],latestSensingDate:null,pixel:{classification:'unknown',value:null},note:'Radar scene coverage could not be checked.',error:results[0].reason.message};
  if (!Array.isArray(results[0].value?.features)) return {...base,available:false,coverage:'unavailable',scenes:[],latestSensingDate:null,pixel:{classification:'unknown',value:null},note:'Radar scene coverage returned unrecognized metadata.'};
  const seen = new Set();
  let invalidSceneCount = 0;
  const scenes = (results[0].value.features ?? []).flatMap(feature => {
    const sensingDate = feature.properties?.sensing_date;
    if (!sensingDate || !Number.isFinite(Date.parse(sensingDate))) { invalidSceneCount++; return []; }
    if (sensingDate.slice(0,10) !== queryDate || Date.parse(sensingDate) > now.getTime() || seen.has(sensingDate)) return [];
    seen.add(sensingDate);
    return [{sensingDate,anomalyDetected:feature.properties.anomaly_detected === true}];
  }).sort((a,b)=>b.sensingDate.localeCompare(a.sensingDate));
  if (invalidSceneCount > 0 && !scenes.length) return {...base,available:false,coverage:'unavailable',scenes:[],latestSensingDate:null,pixel:{classification:'unknown',value:null},note:'Radar scene coverage returned unrecognized acquisition dates.'};
  const values = results.slice(1).map(result => {
    if (result.status !== 'fulfilled') return null;
    const raw = result.value.features?.[0]?.properties?.GRAY_INDEX;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  });
  const [value,excluded,referenceWater] = values;
  // A footprint covers a whole scene. It does not guarantee that this pixel was classifiable.
  const classification = classifyRadarPixel(value,excluded,referenceWater,scenes.length > 0);
  const note = !scenes.length ? 'No Sentinel-1 scene covers this point on the selected date; flood conditions are unknown.'
    : excluded === 1 ? 'This point is inside the radar exclusion mask; the product cannot reliably classify flooding here.'
    : classification === 'flood-detected' ? 'Flood water was classified at this point in the dated satellite scene; it may have changed since acquisition.'
    : classification === 'reference-water' ? 'This point is in the normal reference-water mask; it is not evidence of new flooding.'
    : classification === 'no-flood-detected' ? 'No flood water was classified at this point in this scene. This is not an all-clear; verify local reports and nearby conditions.'
    : 'A scene covers this point, but the pixel could not be reliably classified.';
  return {...base,available:true,coverage:scenes.length?'observed':'no-recent-scene',scenes,latestSensingDate:scenes[0]?.sensingDate ?? null,
    pixel:{classification,value,excluded:excluded === null ? null : excluded === 1,referenceWater:referenceWater === null ? null : referenceWater === 1},note,
    limits:['This query describes one map point, not the whole city or its population.','Satellite scene footprints include unclassifiable and excluded pixels.','Never interpret a transparent map area alone as flood-free.']};
}
