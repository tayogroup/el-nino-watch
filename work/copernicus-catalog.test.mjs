import assert from 'node:assert/strict';
import {loadCopernicusCity, parseCopernicusScenes} from './somalia-flood-watch/copernicus.mjs';

const city = {id: 'Galkayo', name: 'Galkayo', lat: 6.7697, lon: 47.4308};
const now = new Date('2026-10-13T12:00:00Z');
const start = '2026-09-29T12:00:00.000Z', end = now.toISOString();
const bounds = [47.3308, 6.6697, 47.5308, 6.8697];
const feature = (id, datetime, properties = {}, mission = 'sentinel-2-l2a') => ({type: 'Feature', id, collection: mission, bbox: [47, 6, 48, 7], properties: {datetime, ...properties}});
const collection = (...features) => ({type: 'FeatureCollection', features});
const context = {city, mission: 'optical', start, end, bbox: bounds};

const scenes = parseCopernicusScenes(collection(
  feature('older', '2026-10-10T07:13:00Z', {'eo:cloud_cover': 0}),
  feature('latest', '2026-10-12T07:13:00.123456Z', {'eo:cloud_cover': 79.6, platform: 'sentinel-2a', gsd: 10}),
  feature('future', '2026-10-14T07:13:00Z', {'eo:cloud_cover': 0}),
  feature('expired-window', '2026-09-29T11:59:59Z'),
  feature('impossible-date', '2026-09-31T07:00:00Z'),
  feature('local-no-zone', '2026-10-12T07:13:00'),
  feature('path/escape', '2026-10-12T07:13:00Z'),
  feature('wrong-collection', '2026-10-12T07:13:00Z', {}, 'sentinel-1-grd'),
  {...feature('outside-city', '2026-10-12T07:13:00Z'), bbox: [1, 1, 2, 2]},
  {...feature('malformed-bbox', '2026-10-12T07:13:00Z'), bbox: [47, 6, '48', 7]},
  feature('latest', '2026-10-12T07:13:00Z', {'eo:cloud_cover': 10})
), context);
assert.deepEqual(scenes.map(scene => scene.id), ['latest', 'older']);
assert.equal(scenes[0].datetime, '2026-10-12T07:13:00.123Z');
assert.equal(scenes[0].cloudCoverPercent, 79.6);
assert.equal(scenes[1].cloudCoverPercent, 0);
assert.equal(scenes[0].resolutionM, 10);
assert.match(scenes[0].metadataUrl, /^https:\/\/stac\.dataspace\.copernicus\.eu\/v1\/collections\/sentinel-2-l2a\/items\/latest$/);
const opticalBrowser = new URL(scenes[0].browserUrl);
assert.equal(opticalBrowser.hostname, 'browser.dataspace.copernicus.eu');
assert.equal(opticalBrowser.searchParams.get('datasetId'), 'S2_L2A_CDAS');
assert.equal(opticalBrowser.searchParams.get('cloudCoverage'), '100');
assert.equal(opticalBrowser.searchParams.get('lat'), '6.7697');
assert.equal(opticalBrowser.searchParams.get('fromTime'), '2026-10-12T00:00:00.000Z');

for (const cloud of [undefined, null, -1, 101, '0', NaN, Infinity]) {
  assert.equal(parseCopernicusScenes(collection(feature('unknown-cloud', '2026-10-12T07:13:00Z', {'eo:cloud_cover': cloud})), context)[0].cloudCoverPercent, null);
}
const radar = parseCopernicusScenes(collection(feature('radar-id', '2026-10-12T15:08:23Z', {'eo:cloud_cover': 0, 'sat:orbit_state': 'ascending', 'sar:polarizations': ['VV', 'VH', 'VV', 'fake'], 'sar:pixel_spacing_range': 10}, 'sentinel-1-grd')), {...context, mission: 'radar'})[0];
assert.equal(radar.cloudCoverPercent, null);
assert.equal(radar.orbitDirection, 'ascending');
assert.deepEqual(radar.polarizations, ['VV', 'VH']);
assert.equal(radar.resolutionM, null, 'Radar pixel spacing must not be presented as physical spatial resolution.');
assert.equal(radar.pixelSpacingM, 10);
assert.equal(radar.browserSelectionRequired, true);
assert.equal(new URL(radar.browserUrl).searchParams.has('datasetId'), false);
assert.equal(parseCopernicusScenes(collection(feature('offset-date', '2026-10-12T18:08:23+03:00')), context)[0].datetime, '2026-10-12T15:08:23.000Z');
assert.equal(parseCopernicusScenes(collection(...Array.from({length: 12}, (_, n) => feature(`many-${n}`, `2026-10-${String(n + 1).padStart(2, '0')}T07:00:00Z`))), context).length, 8);
assert.throws(() => parseCopernicusScenes({features: []}, context), /not recognized/);
assert.throws(() => parseCopernicusScenes(collection(), {...context, mission: 'wrong'}), /unsupported/);

const requests = [];
const fetchImpl = async (url, options) => {
  const query = JSON.parse(options.body);
  requests.push({url, options, query});
  return {ok: true, json: async () => collection(feature(query.collections[0] === 'sentinel-1-grd' ? 'live-radar' : 'live-optical', '2026-10-12T07:00:00Z', {'eo:cloud_cover': 35}, query.collections[0]))};
};
const result = await loadCopernicusCity(city, {now, fetchImpl});
assert.equal(requests.length, 2);
assert.equal(result.available, true);
assert.equal(result.authenticationRequired, false);
assert.deepEqual(result.city, city);
assert.deepEqual(result.bbox, bounds);
assert.deepEqual(result.queryWindow, {start, end});
assert.equal(result.fetchedAt, now.toISOString());
assert.equal(result.missions.optical.scenes[0].id, 'live-optical');
assert.equal(result.missions.radar.scenes[0].id, 'live-radar');
assert.equal(result.processing.available, false);
assert.equal(result.processing.requiresCredentials, true);
assert.match(result.coverageNote, /whole scene/);
for (const request of requests) {
  assert.equal(request.url, 'https://stac.dataspace.copernicus.eu/v1/search');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, undefined);
  assert.deepEqual(request.query.bbox, bounds);
  assert.equal(request.query.limit, 8);
  assert.deepEqual(request.query.sortby, [{field: 'datetime', direction: 'desc'}]);
  assert.equal(request.query.datetime, `${start}/${end}`);
}
const partial = await loadCopernicusCity(city, {now, fetchImpl: async (_url, options) => {
  if (JSON.parse(options.body).collections[0] === 'sentinel-2-l2a') return {ok: false, status: 503};
  return {ok: true, json: async () => collection()};
}});
assert.equal(partial.available, true);
assert.equal(partial.missions.optical.available, false);
assert.match(partial.missions.optical.error, /503/);
assert.equal(partial.missions.radar.available, true);
assert.deepEqual(partial.missions.radar.scenes, []);
assert.match(partial.coverageNote, /cannot establish that an area is dry/);
await assert.rejects(loadCopernicusCity(city, {now, fetchImpl: async () => ({ok: true, json: async () => ({error: 'bad response'})})}), /Both Copernicus/);
for (const invalid of [{...city, lat: NaN}, {...city, lon: 181}, {...city, lat: '6.7'}, {...city, name: ''}]) {
  await assert.rejects(loadCopernicusCity(invalid, {now, fetchImpl: () => { throw new Error('must not fetch'); }}), /valid city/);
}
await assert.rejects(loadCopernicusCity(city, {now: new Date('bad'), fetchImpl}), /retrieval time/);
console.log('Copernicus catalogue tests passed: bounded dated imagery, unknown cloud, radar metadata, safe links and independent failures.');
