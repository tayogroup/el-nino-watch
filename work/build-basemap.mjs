import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Offline regional reference data. Geometry comes from Natural Earth, not a tile
// server. Country polygons remain uncut; river segments are clipped at the bbox.
const work = path.dirname(fileURLToPath(import.meta.url));
const bounds = [35, -5, 54, 18]; // west, south, east, north in WGS84 degrees
const sourceFolder = path.join(work, 'basemap-source');
const output = path.join(work, 'somalia-flood-watch', 'dist', 'basemap-data.js');

const sources = await Promise.all(['countries', 'rivers'].map(async name => {
  const parsed = JSON.parse(await readFile(path.join(sourceFolder, `${name}.geojson`), 'utf8'));
  assert.equal(parsed.type, 'FeatureCollection', `${name}: expected GeoJSON`);
  assert.ok(parsed.features.length, `${name}: no source features`);
  return parsed;
}));

const rounded = value => Math.round(value * 100000) / 100000;
function roundCoordinates(value) {
  if (typeof value[0] === 'number') {
    assert.ok(value.every(Number.isFinite), 'Non-finite coordinate');
    return value.map(rounded);
  }
  return value.map(roundCoordinates);
}
function properties(feature, names) {
  return Object.fromEntries(names.filter(key => feature.properties[key] !== undefined)
    .map(key => [key, feature.properties[key]]));
}
function inBounds([x, y]) {
  return x >= bounds[0] && x <= bounds[2] && y >= bounds[1] && y <= bounds[3];
}

// Liang-Barsky clips one actual source segment to the rectangle; it only inserts
// precise edge intersections. No extra river course or connecting line is added.
function clipSegment(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - bounds[0], bounds[2] - a[0], a[1] - bounds[1], bounds[3] - a[1]];
  let start = 0, end = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) start = Math.max(start, t);
    else end = Math.min(end, t);
    if (start > end) return null;
  }
  if (start === end) return null; // A tangential point is not a river segment.
  return [[a[0] + start * dx, a[1] + start * dy],
    [a[0] + end * dx, a[1] + end * dy]];
}
function samePoint(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}
function clipLine(line) {
  const result = [];
  let active = null;
  for (let i = 1; i < line.length; i++) {
    const segment = clipSegment(line[i - 1], line[i]);
    if (!segment) { active = null; continue; }
    if (active && samePoint(active.at(-1), segment[0])) {
      active.push(segment[1]);
    } else {
      active = [segment[0], segment[1]];
      result.push(active);
    }
  }
  return result;
}
function inRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (((a[1] > point[1]) !== (b[1] > point[1])) &&
      point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}
function inPolygon(point, polygon) {
  return inRing(point, polygon[0]) && !polygon.slice(1).some(ring => inRing(point, ring));
}
function polygonIntersects(polygon) {
  for (const ring of polygon) {
    if (ring.some(inBounds)) return true;
    for (let i = 1; i < ring.length; i++) {
      if (clipSegment(ring[i - 1], ring[i])) return true;
    }
  }
  return [[bounds[0], bounds[1]], [bounds[0], bounds[3]],
    [bounds[2], bounds[1]], [bounds[2], bounds[3]]].some(point => inPolygon(point, polygon));
}

const countries = sources[0].features.filter(feature => {
  assert.ok(['Polygon', 'MultiPolygon'].includes(feature.geometry.type), 'Unexpected country geometry');
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  return polygons.some(polygonIntersects);
}).map(feature => ({
  type: 'Feature',
  properties: properties(feature, ['NAME', 'ADMIN', 'SOVEREIGNT', 'ADM0_A3', 'ISO_A3', 'LABEL_X', 'LABEL_Y', 'NE_ID']),
  geometry: { type: feature.geometry.type, coordinates: roundCoordinates(feature.geometry.coordinates) }
}));

const rivers = sources[1].features.flatMap(feature => {
  assert.ok(['LineString', 'MultiLineString'].includes(feature.geometry.type), 'Unexpected river geometry');
  const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const coordinates = lines.flatMap(clipLine);
  if (!coordinates.length) return [];
  return [{ type: 'Feature', properties: properties(feature,
    ['name', 'name_en', 'name_alt', 'scalerank', 'featurecla', 'min_zoom', 'min_label']),
  geometry: { type: 'MultiLineString', coordinates: roundCoordinates(coordinates) } }];
});

const requestedLabels = ['Somalia', 'Ethiopia', 'Kenya', 'Djibouti', 'Yemen', 'Eritrea'];
const countryLabels = requestedLabels.flatMap(name => {
  const feature = countries.find(feature => feature.properties.ADMIN === name);
  if (!feature || !Number.isFinite(feature.properties.LABEL_X) || !Number.isFinite(feature.properties.LABEL_Y)) return [];
  return [{ name, coordinates: [rounded(feature.properties.LABEL_X), rounded(feature.properties.LABEL_Y)],
    sourceFields: ['LABEL_X', 'LABEL_Y'] }];
});

const data = {
  metadata: {
    title: 'Horn of Africa regional reference',
    provider: 'Natural Earth',
    scale: '1:10 million',
    bbox: bounds,
    crs: 'EPSG:4326',
    license: 'Public domain',
    licenseUrl: 'https://www.naturalearthdata.com/about/terms-of-use/',
    attribution: 'Made with Natural Earth',
    description: 'Generalized 1:10 million reference geography; not for navigation, local drainage design, or delineating flood extent.',
    geometryProcessing: 'Full intersecting country geometries retained; river segments clipped to bbox with Liang-Barsky; coordinates rounded to five decimals.',
    sources: [
      { dataset: 'ne_10m_admin_0_countries', url: 'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/' },
      { dataset: 'ne_10m_rivers_lake_centerlines', url: 'https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-rivers-lake-centerlines/' }
    ],
    countryLabels
  },
  countries: { type: 'FeatureCollection', features: countries },
  rivers: { type: 'FeatureCollection', features: rivers }
};

// Data-integrity checks protect the selected region, source-derived positions,
// precision and clipping rather than merely reproducing UI implementation.
assert.ok(countries.some(feature => feature.properties.ADMIN === 'Somalia'), 'Somalia geometry missing');
assert.ok(countries.length < sources[0].features.length / 4, 'Unintended worldwide geometry');
assert.equal(countryLabels.length, requestedLabels.length, 'Source-derived country labels missing');
assert.ok(rivers.length, 'Regional river geometry missing');
for (const feature of rivers) {
  for (const line of feature.geometry.coordinates) {
    assert.ok(line.length >= 2, 'Degenerate river line');
    assert.ok(line.every(inBounds), 'Unclipped river coordinate');
  }
}
// If a source has either major Somali river by name, the regional extraction
// must preserve it. These names are never added when absent from source.
for (const pattern of [/juba|jubba|giuba/i, /shabelle|shebele|shabelli/i]) {
  const sourceNamed = sources[1].features.filter(feature => pattern.test(JSON.stringify(feature.properties)));
  if (sourceNamed.length) assert.ok(rivers.some(feature => pattern.test(JSON.stringify(feature.properties))), 'Named Somali river omitted');
}

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `/* Bundled public-domain Natural Earth geography; build with work/build-basemap.mjs. */\nwindow.REGIONAL_BASEMAP = ${JSON.stringify(data)};\n`, 'utf8');
console.log(JSON.stringify({ output, countries: countries.map(feature => feature.properties.NAME),
  rivers: rivers.length, riverNames: rivers.map(feature => feature.properties.name).filter(Boolean),
  countryLabels: countryLabels.length }, null, 2));
