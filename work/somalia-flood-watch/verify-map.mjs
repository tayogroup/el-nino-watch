import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const base = new URL('./dist/', import.meta.url);
const mapSource = await fs.readFile(new URL('map.js', base), 'utf8');
const planningSource = await fs.readFile(new URL('planning.js', base), 'utf8');
const html = await fs.readFile(new URL('index.html', base), 'utf8');
const config = JSON.parse(await fs.readFile(new URL('hazard-sources.json', base), 'utf8'));
const baseSource = await fs.readFile(new URL('basemap-data.js', base), 'utf8');
const baseHolder={};vm.runInNewContext(baseSource,{window:baseHolder});
const cities = JSON.parse(await fs.readFile(new URL('cities.json', base), 'utf8'));
const calls = [];
const test = async (name, fn) => { await fn(); calls.push(name); console.log(`PASS ${name}`); };

function mapHarness(options = {}) {
  const elements = new Map([...html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)].map(match => [match[1], {
    textContent: '', innerHTML: '', checked: /\bchecked(?:\s|>|=)/.test(match[0]), disabled: false, style: {}, value: '',
    addEventListener(type, fn) { this.events ??= {}; this.events[type] = fn; }
  }]));
  const layers = [], markerLayers = [], requests = [], selected = [], points = [];
  const map = { currentLayers: new Set(), events: {}, panes: {},
    setView(center, zoom) { this.center = center; this.zoom = zoom; return this; },
    createPane(name) { this.panes[name] = { style: {} }; }, getPane(name) { return this.panes[name]; },
    fitBounds(bounds, settings) { this.bounds = bounds; this.boundsSettings = settings; return this; },
    flyTo(center, zoom) { this.center = center; this.zoom = zoom; return this; },
    on(type, fn) { this.events[type] = fn; return this; }, removeLayer(layer) { this.currentLayers.delete(layer); return this; }
  };
  function makeLayer(type, url, settings = {}) {
    const layer = { type, url, settings, events: {},
      addTo(target) { target.currentLayers.add(this); return this; },
      on(type, fn) { this.events[type] = fn; return this; },
      bindTooltip(value) { this.tooltip = value; return this; }, bindPopup(value) { this.popup = value; return this; },
      setStyle(value) { Object.assign(this.settings, value); return this; }
    }; layers.push(layer); if (type === 'marker') markerLayers.push(layer); return layer;
  }
  const L = { map: () => map, tileLayer: (url, settings) => makeLayer('base', url, settings), circleMarker: (coordinates, settings) => { const layer = makeLayer('marker', null, settings); layer.coordinates = coordinates; return layer; } };
  L.geoJSON=(data,settings)=>{const layer=makeLayer('geography',null,settings);layer.data=data;return layer};
  L.tileLayer.wms = (url, settings) => makeLayer('wms', url, settings);
  const document = { getElementById: id => elements.get(id) || null };
  const window = { L, document,REGIONAL_BASEMAP:options.basemapMissing?undefined:baseHolder.REGIONAL_BASEMAP };
  const context = vm.createContext({ window, document, L, console, URL, Date, Number, String, Object, Array, Set, Map,
    location: { protocol: 'http:' }, AbortSignal: { timeout: () => undefined },
    fetch: async url => { requests.push(String(url));
      if (url === 'hazard-sources.json') { if (options.configError) throw new Error(options.configError); return { ok: true, json: async () => structuredClone(config) }; }
      const point = options.pointResponse ? await options.pointResponse(String(url)) : { elevationM: 18, susceptibility: { label: 'High potential' }, historical: { intersects: false }, sourceNote: 'Fixture terrain screening; not observed flooding.' };
      return { ok: true, json: async () => structuredClone(point) };
    }
  });
  vm.runInContext(mapSource, context);
  const api = window.FloodExplorer;
  return { api, elements, map, layers, markerLayers, requests, selected, points,
    async init() { await api.init({ cities, onSelectCity: i => selected.push(i), onPoint: point => points.push(point) }); },
    get: id => elements.get(id), snapshot: () => JSON.parse(JSON.stringify(api.getState()))
  };
}

function planningHarness() {
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-13T08:00:00Z'])); } static now() { return Date.parse('2026-10-13T08:00:00Z'); } }
  const window = {};
  const context = vm.createContext({ window, Date: FixedDate, URL, Number, String, Object, Array, Set, JSON });
  vm.runInContext(planningSource, context);
  return window.FloodPlanning;
}

await test('map has 30 geographic city markers and marker click selects the matching city', async () => {
  const h = mapHarness(); await h.init();
  assert.equal(h.markerLayers.length, 30);
  assert.equal(h.map.bounds.length, 30);
  h.markerLayers[6].events.click();
  assert.deepEqual(h.selected, [6]);
  h.api.focus(6);
  assert.deepEqual(Array.from(h.map.center), [4.7358, 45.2036]);
  assert.equal(h.map.zoom, 11);
});

await test('bundled geography draws without any blocked OSM or other basemap tile requests',async()=>{const h=mapHarness();await h.init();assert.equal(h.layers.filter(l=>l.type==='base').length,0);assert.equal(h.layers.filter(l=>l.type==='geography').length,2);assert.equal(h.snapshot().basemap.ready,true);assert.ok(h.layers.find(l=>l.type==='geography').data.features.some(f=>f.properties.ADMIN==='Somalia'));assert.match(h.get('basemap-status').textContent,/no street-level detail/);assert.ok(!mapSource.includes('tile.openstreetmap.org'));assert.ok(!h.requests.some(u=>u.includes('tile.openstreetmap.org')))});

await test('missing local geography leaves city navigation and hazard overlays usable',async()=>{const h=mapHarness({basemapMissing:true});await h.init();assert.equal(h.snapshot().basemap.ready,false);assert.equal(h.markerLayers.length,30);assert.ok(h.layers.some(l=>l.type==='wms'));assert.match(h.get('basemap-status').textContent,/unavailable/)});

await test('satellite context is opt-in and returns to the regional reference when tiles fail', async () => {
  const h = mapHarness(); await h.init();
  assert.equal(h.layers.filter(layer => layer.type === 'base').length, 0);
  h.get('basemap-select').onchange({ target: { value: 'satellite' } });
  const imagery = h.layers.find(layer => layer.type === 'base');
  assert.ok(imagery.url.startsWith('https://server.arcgisonline.com/'));
  assert.ok(h.map.currentLayers.has(imagery));
  assert.equal(h.snapshot().basemap.mode, 'satellite-context');
  imagery.events.load();
  assert.match(h.get('map-imagery-status').textContent, /dates vary.*not current flooding/);
  imagery.events.tileerror();
  assert.equal(h.snapshot().basemap.mode, 'regional-reference');
  assert.equal(h.get('basemap-select').value, 'reference');
  assert.ok(!h.map.currentLayers.has(imagery));
  assert.match(h.get('map-imagery-status').textContent, /reference map restored/);
});

await test('located community reports are separate unverified pins and their layer can be hidden', async () => {
  const h = mapHarness(); await h.init();
  const city = cities[29];
  h.api.communityReports([
    { id: 'fixture-report', cityId: city[0].toLowerCase(), category: 'flood', latitude: city[2], longitude: city[3], observedAt: '2026-10-13T08:00:00Z', description: '<script>Fixture text</script>' },
    { id: 'unlocated', cityId: 'mogadishu', latitude: null, longitude: null },
    { id: 'outside-region', cityId: 'mogadishu', latitude: 50, longitude: 100 }
  ]);
  assert.equal(h.snapshot().communityPins, 1);
  const report = h.markerLayers.at(-1);
  assert.match(report.popup, /unverified/);
  assert.match(report.popup, /not a mapped flood boundary/);
  assert.match(report.popup, /&lt;script&gt;/);
  assert.ok(!report.popup.includes('<script>'));
  assert.ok(h.map.currentLayers.has(report));
  h.get('layer-community').checked = false; h.get('layer-community').onchange();
  assert.ok(!h.map.currentLayers.has(report));
  assert.equal(h.markerLayers.length, 31, 'city and community markers remain distinct');
  h.api.communityReports([]);
  assert.equal(h.snapshot().communityPins, 0);
});

await test('selected-date marker colors and popup values follow live city states', async () => {
  const h = mapHarness(); await h.init();
  const state = { cityIndex: 6, selectedDate: '2026-10-14', scenario: 'heavy-rain', cityStates: cities.map((_, i) => ({ code: i === 6 ? 'High' : 'Lower', label: i === 6 ? 'Agency review' : 'Lower rain', rainMm: i + 1 })) };
  h.api.update(state);
  assert.equal(h.markerLayers[6].settings.fillColor, '#c3353b');
  assert.equal(h.markerLayers[6].settings.radius, 11);
  assert.match(h.markerLayers[6].popup, /2026-10-14/);
  assert.match(h.markerLayers[6].popup, /7\.0 mm/);
  assert.match(h.markerLayers[6].popup, /Scenarios do not change these live source values/);
  assert.equal(h.snapshot().scenario, 'heavy-rain');
  assert.equal((h.get('citynav').innerHTML.match(/data-city=/g) || []).length, 30);
});

await test('official overlays retain provider layers, dated legends and visible tile-failure states', async () => {
  const h = mapHarness(); await h.init();
  const susceptibility = h.layers.find(layer => layer.type === 'wms' && layer.settings.layers === config.layers.susceptibility.name);
  assert.equal(susceptibility.url, config.wmsUrl);
  assert.match(susceptibility.settings.attribution, /FAO SWALIM/);
  const toggle = h.get('layer-susceptibility'); toggle.checked = true; toggle.onchange();
  assert.ok(h.map.currentLayers.has(susceptibility));
  assert.match(h.get('map-legend').innerHTML, /Static terrain screening/);
  assert.match(h.get('map-legend').innerHTML, /not observed flooding/);
  const encodedLegend = config.layers.susceptibility.legendUrl.replaceAll('&', '&amp;');
  assert.ok(h.get('map-legend').innerHTML.includes(encodedLegend));
  susceptibility.events.tileerror();
  assert.match(h.get('map-status').textContent, /unavailable/);
  susceptibility.events.loading(); susceptibility.events.load();
  assert.match(h.get('map-status').textContent, /source tiles loaded/);
  toggle.checked = false; toggle.onchange();
  assert.ok(!h.map.currentLayers.has(susceptibility));
  assert.ok(!h.get('map-legend').innerHTML.includes(encodedLegend));
});

await test('official overlay configuration outage leaves toggles disabled and states unavailable', async () => {
  const h = mapHarness({ configError: 'source unreachable' }); await h.init();
  assert.match(h.get('map-status').textContent, /unavailable: source unreachable/);
  for (const name of ['susceptibility', 'history', 'breakages']) assert.equal(h.get('layer-' + name).disabled, true);
  assert.equal(h.layers.filter(layer => layer.type === 'wms').length, 0);
});

await test('point inspector does not interpret an absent historical feature as safe', async () => {
  const h = mapHarness(); await h.init(); await h.api.inspect(4.73, 45.2);
  assert.match(h.get('point-info').innerHTML, /flooding is still possible/);
  assert.equal(h.points[0].terrainClass, 'High potential');
  h.api.clearPoint();
  assert.match(h.get('point-info').textContent, /Click a map point/);
});

await test('latest clicked map point wins when point-source requests return out of order', async () => {
  let release; const slow = new Promise(resolve => { release = resolve; });
  const h = mapHarness({ pointResponse: url => url.includes('lat=4&') ? slow : { elevationM: 5, susceptibility: { label: 'Very high potential' }, historical: { intersects: true } } });
  await h.init(); const first = h.api.inspect(4, 45); await h.api.inspect(5, 46); release({ elevationM: 300, susceptibility: { label: 'Low / not indicated' } }); await first;
  assert.equal(h.points.length, 1);
  assert.equal(h.points[0].terrainClass, 'Very high potential');
  assert.match(h.get('point-info').innerHTML, /5\.00000, 46\.00000/);
});

await test('missing planning data remains unknown and requires verification', async () => {
  const api = planningHarness(); const plan = api.build({ city: { name: 'Mogadishu', context: 'Coastal / urban drainage' }, selectedDate: '2026-10-13', scenario: 'live' });
  assert.equal(plan.liveRisk, 'Unavailable');
  assert.ok(plan.evidence.some(line => /Selected-day rainfall model: unavailable/.test(line)));
  assert.ok(plan.evidence.some(line => /Matched river observation: unavailable/.test(line)));
  assert.equal(plan.actions.find(action => action.id === 'prepare').urgency.label, 'Prepare and verify');
  assert.ok(plan.actions.find(action => action.id === 'diversion').text.includes('Do not cut embankments or dig an unplanned canal'));
  assert.match(plan.text, /No dimensions, water depths, construction alignment or design approval/);
});

await test('planning exercise preserves live rainfall, gauge units and scenario provenance', async () => {
  const api = planningHarness(); const input = { city: { name: 'Beledweyne', context: 'Shabelle river corridor' }, selectedDate: '2026-10-20', scenario: 'river-rise', risk: 'Lower', rainMm: 1, station: { name: 'Beledweyne gauge', levelM: 4.2, observedAt: '2026-10-01', sourceUrl: 'https://frrims.faoswalim.org/' } };
  const before = JSON.stringify(input); const plan = api.build(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(plan.hypothetical, true);
  assert.equal(plan.liveRisk, 'Lower');
  assert.ok(plan.evidence.some(line => line.includes('1.0 mm')));
  assert.ok(plan.evidence.some(line => line.includes('4.2 m') && line.includes('OLD OBSERVATION')));
  assert.ok(plan.limits.some(line => /live forecast and live rainfall screen have not been altered/.test(line)));
  assert.equal(plan.actions.find(action => action.id === 'prepare').urgency.label, 'Prepare and verify');
});

await test('invalid scenario and invalid planning date fall back to transparent unknown states', async () => {
  const plan = planningHarness().build({ scenario: 'invented', selectedDate: '2026-02-31', rainMm: NaN, risk: 'bogus' });
  assert.equal(plan.scenario, 'live'); assert.equal(plan.selectedDate, null); assert.equal(plan.liveRisk, 'Unavailable');
  assert.match(plan.limits[0], /unrecognised/);
  assert.ok(!plan.text.includes('NaN'));
});

await test('a hidden map defers city and overview moves until it is shown again', async () => {
  // Leaflet's flyTo/fitBounds throw "Invalid LatLng (NaN, NaN)" on a 0x0 map; the
  // section tabs hide the map, and that throw used to abort app.js selectCity.
  const h = mapHarness(); await h.init();
  const box = { clientWidth: 0, clientHeight: 0 };
  h.map.getContainer = () => box; h.map.invalidateSize = () => h.map;
  let flights = 0, fits = 0; const fly = h.map.flyTo, fit = h.map.fitBounds;
  h.map.flyTo = function (...args) { flights++; return fly.apply(this, args); };
  h.map.fitBounds = function (...args) { fits++; return fit.apply(this, args); };
  const before = h.map.center;
  h.api.focus(3); h.api.overview(); h.api.focus(6);
  assert.equal(flights, 0, 'nothing may fly while the map is hidden');
  assert.equal(fits, 0);
  assert.equal(JSON.stringify(h.map.center), JSON.stringify(before));
  box.clientWidth = 900; box.clientHeight = 560;
  h.api.resize();
  assert.deepEqual(Array.from(h.map.center), [cities[6][2], cities[6][3]], 'the last requested view is applied when shown');
  assert.equal(h.map.zoom, 11);
  h.api.focus(3);
  assert.equal(flights, 1, 'a visible map flies as before');
});

console.log(`Verified ${calls.length} map and planning checks.`);
