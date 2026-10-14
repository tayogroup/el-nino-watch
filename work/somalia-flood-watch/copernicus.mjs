const DAY = 86400000;
const API_URL = 'https://stac.dataspace.copernicus.eu/v1/search';
export const COPERNICUS_SOURCE_URL = 'https://documentation.dataspace.copernicus.eu/APIs/STAC.html';
const COLLECTIONS = Object.freeze({optical: 'sentinel-2-l2a', radar: 'sentinel-1-grd'});

function isoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  // Date.parse accepts some impossible calendar days by rolling them forward.
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  return date.toISOString();
}

function positiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function shortString(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 100 ? value.trim() : null;
}

function validateCity(city) {
  if (!city || typeof city.name !== 'string' || !city.name.trim() || city.name.length > 100 ||
      typeof city.lat !== 'number' || !Number.isFinite(city.lat) || Math.abs(city.lat) > 90 ||
      typeof city.lon !== 'number' || !Number.isFinite(city.lon) || Math.abs(city.lon) > 180) {
    throw new Error('A valid city name and coordinates are required.');
  }
  return {id: typeof city.id === 'string' || Number.isSafeInteger(city.id) ? city.id : city.name, name: city.name.trim(), lat: city.lat, lon: city.lon};
}

function cityBbox(city) {
  return [Math.max(-180, city.lon - 0.1), Math.max(-90, city.lat - 0.1), Math.min(180, city.lon + 0.1), Math.min(90, city.lat + 0.1)].map(number => Number(number.toFixed(6)));
}

function intersectsBbox(featureBbox, bbox) {
  if (featureBbox === undefined) return true;
  if (!Array.isArray(featureBbox) || featureBbox.length !== 4 || !featureBbox.every(Number.isFinite)) return false;
  const [west, south, east, north] = featureBbox;
  return west <= east && south <= north && west <= bbox[2] && east >= bbox[0] && south <= bbox[3] && north >= bbox[1];
}

function browserUrl(city, datetime, mission) {
  const url = new URL('https://browser.dataspace.copernicus.eu/');
  url.searchParams.set('zoom', '11');
  url.searchParams.set('lat', String(city.lat));
  url.searchParams.set('lng', String(city.lon));
  url.searchParams.set('fromTime', `${datetime.slice(0, 10)}T00:00:00.000Z`);
  url.searchParams.set('toTime', `${datetime.slice(0, 10)}T23:59:59.999Z`);
  url.searchParams.set('dateMode', 'TIME RANGE');
  url.searchParams.set('panel', 'search');
  if (mission === 'optical') {
    url.searchParams.set('datasetId', 'S2_L2A_CDAS');
    url.searchParams.set('layerId', '1_TRUE_COLOR');
    // Show all scene cloud percentages; a high value is a filter, not an observation.
    url.searchParams.set('cloudCoverage', '100');
  }
  // A radar Browser dataset identifier is not assumed. Users can select Sentinel-1.
  return url.href;
}

export function parseCopernicusScenes(payload, {city, mission, start, end, bbox} = {}) {
  const collectionId = COLLECTIONS[mission];
  if (!collectionId) throw new Error('The requested satellite mission is unsupported.');
  if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features)) throw new Error('Copernicus catalogue response was not recognized.');
  const lower = Date.parse(start), upper = Date.parse(end);
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) throw new Error('The catalogue query dates are invalid.');
  const knownCity = validateCity(city);
  const bounds = bbox ?? cityBbox(knownCity);
  const scenes = [];
  const seen = new Set();
  for (const feature of payload.features) {
    const properties = feature?.properties;
    const id = feature?.id;
    if (feature?.type !== 'Feature' || feature.collection !== collectionId || typeof id !== 'string' || !/^[A-Za-z0-9_.-]{1,500}$/.test(id) || !properties || !intersectsBbox(feature.bbox, bounds)) continue;
    const datetime = isoDate(properties.datetime);
    if (!datetime || Date.parse(datetime) < lower || Date.parse(datetime) > upper || seen.has(id)) continue;
    seen.add(id);
    const cloudCover = properties['eo:cloud_cover'];
    const cloudCoverPercent = mission === 'optical' && typeof cloudCover === 'number' && Number.isFinite(cloudCover) && cloudCover >= 0 && cloudCover <= 100 ? cloudCover : null;
    const orbit = shortString(properties['sat:orbit_state']);
    const rawPolarizations = properties['sar:polarizations'];
    const polarizations = mission === 'radar' && Array.isArray(rawPolarizations) ? [...new Set(rawPolarizations.filter(value => ['VV', 'VH', 'HH', 'HV'].includes(value)))] : null;
    const pixelSpacingM = mission === 'radar' ? positiveNumber(properties['sar:pixel_spacing_range']) : positiveNumber(properties.gsd);
    scenes.push({id, datetime, cloudCoverPercent, platform: shortString(properties.platform),
      orbitDirection: orbit && ['ascending', 'descending'].includes(orbit.toLowerCase()) ? orbit.toLowerCase() : null,
      polarizations: polarizations?.length ? polarizations : null,
      resolutionM: positiveNumber(properties.gsd), pixelSpacingM,
      metadataUrl: `https://stac.dataspace.copernicus.eu/v1/collections/${collectionId}/items/${encodeURIComponent(id)}`,
      browserUrl: browserUrl(knownCity, datetime, mission), browserSelectionRequired: mission === 'radar'});
  }
  return scenes.sort((a, b) => Date.parse(b.datetime) - Date.parse(a.datetime)).slice(0, 8);
}

async function loadMission(city, mission, context, fetchImpl) {
  const collectionId = COLLECTIONS[mission];
  const response = await fetchImpl(API_URL, {method: 'POST', signal: AbortSignal.timeout(20000),
    headers: {'Content-Type': 'application/json', Accept: 'application/geo+json, application/json', 'User-Agent': 'SomaliaElNinoWatch/1.0'},
    body: JSON.stringify({collections: [collectionId], bbox: context.bbox, datetime: `${context.start}/${context.end}`, limit: 8, sortby: [{field: 'datetime', direction: 'desc'}]})});
  if (!response.ok) throw new Error(`Copernicus catalogue returned HTTP ${response.status}.`);
  const scenes = parseCopernicusScenes(await response.json(), {city, mission, ...context});
  return {available: true, collectionId, scenes, error: null};
}

export async function loadCopernicusCity(city, {fetchImpl = fetch, now = new Date()} = {}) {
  const knownCity = validateCity(city);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('A valid retrieval time is required.');
  const context = {bbox: cityBbox(knownCity), start: new Date(now.getTime() - 14 * DAY).toISOString(), end: now.toISOString()};
  const results = await Promise.allSettled(Object.keys(COLLECTIONS).map(mission => loadMission(knownCity, mission, context, fetchImpl)));
  const missions = Object.fromEntries(Object.keys(COLLECTIONS).map((mission, index) => {
    const result = results[index];
    return [mission, result.status === 'fulfilled' ? result.value : {available: false, collectionId: COLLECTIONS[mission], scenes: [], error: result.reason?.message || 'Copernicus catalogue is unavailable.'}];
  }));
  if (!missions.optical.available && !missions.radar.available) throw new Error('Both Copernicus catalogue mission queries are unavailable.');
  return {available: true, city: knownCity, bbox: context.bbox, queryWindow: {start: context.start, end: context.end}, fetchedAt: now.toISOString(),
    missions, sourceUrl: COPERNICUS_SOURCE_URL, authenticationRequired: false,
    processing: {available: false, requiresCredentials: true, note: 'Catalogue metadata is public. Rendering new Sentinel-1 or Sentinel-2 imagery through the Sentinel Hub Processing API requires Copernicus Data Space OAuth credentials configured securely on the server.'},
    coverageNote: 'These are acquisitions intersecting the city’s surrounding ±0.1° area within the last 14 days. Acquisition metadata does not identify flooded streets. Optical cloud percentages describe the whole scene; radar acquisitions do not prove usable flood classification. Empty results, cloud cover and excluded pixels cannot establish that an area is dry.'};
}
