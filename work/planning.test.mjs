import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./somalia-flood-watch/dist/planning.js', import.meta.url), 'utf8');
const context = vm.createContext({ window: {}, URL, Date, Blob, setTimeout });
vm.runInContext(source, context);
const { build, render } = context.window.FloodPlanning;
const input = { city: { name: 'Jowhar', region: 'Middle Shabelle', context: 'Shabelle river corridor' }, scenario: 'live', risk: 'Watch', rainMm: 11, selectedDate: '2026-10-13' };

test('missing evidence stays unavailable and never becomes a verified flood', () => {
  const plan = build();
  assert.equal(plan.liveRisk, 'Unavailable');
  assert.equal(plan.selectedDate, null);
  assert.match(plan.text, /rainfall model: unavailable/);
  assert.match(plan.text, /retrieval timestamp unavailable/);
  assert.match(plan.text, /Matched river observation: unavailable/);
  assert.match(plan.text, /Point susceptibility query: unavailable/);
  assert.match(plan.text, /Scenario was missing/);
  assert.equal(build({ selectedDate: '2026-02-30' }).selectedDate, null);
});

test('hypothetical scenarios do not inflate live rainfall evidence', () => {
  for (const scenario of ['heavy-rain', 'river-rise', 'blocked-drains']) {
    const plan = build({ ...input, scenario, risk: 'Lower', rainMm: 0 });
    assert.equal(plan.hypothetical, true);
    assert.equal(plan.liveRisk, 'Lower');
    assert.match(plan.assumption, /Hypothetical exercise/);
    assert.match(plan.text, /rainfall model: 0\.0 mm/);
    assert.match(plan.text, /live forecast and live rainfall screen have not been altered/);
  }
});

test('physical diversion requires agency and engineer review, survey and modelling', () => {
  const plan = build(input);
  const diversion = plan.actions.find(a => a.id === 'diversion');
  assert.equal(diversion.urgency.label, 'Agency / engineer review');
  for (const phrase of ['site survey', 'hydraulic modelling', 'agency and engineer review', 'required permits', 'downstream impacts', 'Do not cut embankments']) assert.ok(diversion.text.includes(phrase));
  assert.match(plan.text, /not a drainage design/);
  assert.match(plan.text, /do not establish flood depth/);
  assert.ok(plan.actions.every(a => a.source.url.startsWith('https://')));
  assert.ok(plan.text.includes('WMO / APFM'));
});

test('old river gauge evidence is dated and cannot be equated to flood depth', () => {
  const plan = build({ ...input, station: { name: 'Afgooye', observedAt: '2008-12-31', levelM: 4.2, sourceUrl: 'javascript:alert(1)' }, forecastStale: true });
  assert.match(plan.text, /2008-12-31 · OLD OBSERVATION/);
  assert.match(plan.text, /Gauge stage is not flood depth/);
  assert.match(plan.text, /stale \/ last known response/);
  assert.ok(!plan.dataSources.some(s => s.url.includes('javascript:')));
});

test('terrain evidence does not derive inundation and impossible counts are rejected', () => {
  const plan = build({ ...input, terrain: { available: true, lowCells: 8, sampleCount: 49 }, selectedPoint: { lat: 2.78, lon: 45.5, elevationM: 99, relativeM: -2, terrainClass: 'Relative low' } });
  assert.match(plan.text, /8 of 49 sampled locations/);
  assert.match(plan.text, /no inundation is inferred/);
  assert.match(plan.text, /relative elevation -2\.0 m/);
  const invalid = build({ ...input, terrain: { available: true, lowCells: 80, sampleCount: 49 } });
  assert.match(invalid.text, /Point susceptibility query: unavailable/);
});

test('SWALIM mapped point evidence is static susceptibility, not unavailable terrain or current water', () => {
  const plan = build({ ...input, selectedPoint: { lat: 2.78, lon: 45.5, elevationM: 98, terrainClass: 'Very high potential', susceptibility: { label: 'Very high potential', sourceUrl: 'https://spatial.faoswalim.org/catalogue/#/dataset/609' }, historical: { intersects: true }, sourceNote: 'GLO-90 point elevation; GLO-30-derived national susceptibility.' } });
  assert.match(plan.text, /SWALIM mapped flood susceptibility.*Very high potential/);
  assert.match(plan.text, /static HAND \/ DEM-derived screening layer is not current floodwater/);
  assert.match(plan.text, /intersects a mapped past flood extent/);
  assert.match(plan.text, /GLO-90 point elevation/);
  assert.ok(!plan.text.includes('relative elevation unavailable'));
  assert.ok(!plan.text.includes('Point susceptibility query: unavailable'));
  assert.ok(plan.dataSources.some(s => s.title.includes('30 m HAND')));
});

test('only recent, non-stale dated high gauge evidence prioritises agency contact', () => {
  const observedAt = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Mogadishu' });
  const station = { name: 'Jowhar', observedAt, levelM: 5.4, highM: 5.25, sourceUrl: 'https://frrims.faoswalim.org/' };
  const reliable = build({ ...input, risk: 'Lower', station });
  assert.equal(reliable.stationReliableHigh, true);
  assert.equal(reliable.actions[0].id, 'contact');
  assert.match(reliable.actions[0].text, /not a city-wide evacuation order/);
  for (const settings of [{ stationFeedStale: true }, { station: { ...station, observedAt: '2008-12-31' } }, { station: { ...station, observedAt: null } }]) {
    const plan = build({ ...input, station, ...settings });
    assert.equal(plan.stationReliableHigh, false);
    assert.ok(!plan.actions.some(a => a.id === 'contact'));
    assert.match(plan.text, /freshness is insufficient/);
  }
});

test('render escapes city and observation fields and works without a document', () => {
  assert.equal(render(input).city, 'Jowhar');
  const nodes = Object.fromEntries(['planning-summary', 'planning-actions', 'planning-limits', 'plan-download'].map(id => [id, {}]));
  context.window.document = { getElementById: id => nodes[id] };
  render({ ...input, city: { name: '<img src=x onerror=alert(1)>', context: 'Shabelle river corridor' }, station: { name: '<script>alert(1)</script>', levelM: 1, observedAt: '2026-10-13' } });
  assert.ok(!nodes['planning-summary'].innerHTML.includes('<img'));
  assert.ok(!nodes['planning-summary'].innerHTML.includes('<script'));
  assert.match(nodes['planning-summary'].innerHTML, /&lt;img/);
  assert.equal(typeof nodes['plan-download'].onclick, 'function');
});
