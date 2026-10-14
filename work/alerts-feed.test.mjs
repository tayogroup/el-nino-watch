import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ALERT_SOURCES, ICPAC_LAYERS, parseIcpacDatasets, parseIcpacPoint, icpacPointUrl, icpacAlert, parseGdacsEvents, loadOfficialAlerts} from './somalia-flood-watch/alerts-feed.mjs';

const NOW = new Date('2026-10-13T09:00:00Z');
const gdacs = (extra={}) => ({type:'Feature', properties:{eventtype:'FL', eventid:123, episodeid:1, iso3:'SOM', country:'Somalia', iscurrent:'true', fromdate:'2026-10-12T01:00:00', todate:'2026-10-14T01:00:00', datemodified:'2026-10-13T06:00:00', source:'GLOFAS', alertlevel:'Green', name:'Flood in Somalia', ...extra}});
const collection = (...features) => ({type:'FeatureCollection', features});
const response = body => ({ok:true, status:200, text:async()=>typeof body === 'string' ? body : JSON.stringify(body)});

const model = parseGdacsEvents(collection(gdacs()), {now:NOW});
assert.equal(model.alerts.length, 1);
assert.equal(model.alerts[0].basis, 'model-event');
assert.match(model.alerts[0].title, /model event/);
assert.match(model.alerts[0].description, /not been confirmed/);
assert.equal(model.alerts[0].startsAt, '2026-10-12T01:00:00.000Z', 'GDACS timezone-less timestamps use UTC');
assert.equal(parseGdacsEvents(collection(gdacs({source:'DFO'})), {now:NOW}).alerts[0].basis, 'event-monitoring');
assert.equal(parseGdacsEvents(collection(gdacs({iscurrent:'false'})), {now:NOW}).alerts.length, 0);
assert.equal(parseGdacsEvents(collection(gdacs({todate:'2026-10-12T01:00:00'})), {now:NOW}).rejectedExpired, 1);
assert.equal(parseGdacsEvents(collection(gdacs({datemodified:'n/a'})), {now:NOW}).rejectedInvalid, 1);
assert.equal(parseGdacsEvents(collection(gdacs({iso3:'ETH',country:'Ethiopia',affectedcountries:[{iso3:'SOM',countryname:'Somalia'}]})), {now:NOW}).alerts.length, 1, 'affected country membership matters');
assert.equal(parseGdacsEvents(collection(gdacs({iso3:'ETH',country:'Ethiopia',description:'Nearby Somalia'})), {now:NOW}).alerts.length, 0, 'description is not country membership');
assert.throws(()=>parseGdacsEvents({features:[]}, {now:NOW}), /format/);

// ICPAC weekly exceptional rainfall forecast, against real responses saved on 2026-10-14.
const fixture = name => readFile(new URL('./' + name, import.meta.url), 'utf8');
const cities = JSON.parse(await fixture('somalia-flood-watch/dist/cities.json'));
const datasets = JSON.parse(await fixture('icpac-datasets.json'));
const points = {extreme: await fixture('icpac-point-extreme.gml'), veryHeavy: await fixture('icpac-point-very-heavy.gml'), heavy: await fixture('icpac-point-heavy.gml'), none: await fixture('icpac-point-none.gml'), empty: await fixture('icpac-point-empty.gml')};

const week = parseIcpacDatasets(datasets);
assert.equal(week.time, '2026-10-13', 'the WMS time is the issue date in East Africa time');
assert.equal(week.issuedAt, '2026-10-13T05:00:00.000Z');
assert.equal(week.startsAt, '2026-10-12T21:00:00.000Z', '13 Oct from midnight EAT');
assert.equal(week.endsAt, '2026-10-20T20:59:59.999Z', '20 Oct is included');
assert.equal(week.weekLabel, '13 Oct–20 Oct');
assert.equal(parseIcpacDatasets({results: datasets}).time, '2026-10-13', 'a paginated list is read too');
assert.equal(parseIcpacDatasets(datasets.map(item => ({...item, summary: 'no range given'}))).endsAt, '2026-10-20T04:59:59.999Z', 'without a stated range the week runs seven days from issue');
assert.throws(() => parseIcpacDatasets({nope: true}), /format/);
assert.throws(() => parseIcpacDatasets(datasets.filter(item => item.name !== 'Exceptional Rainfall')), /not listed/);
assert.throws(() => parseIcpacDatasets(datasets.map(item => ({...item, latest_date: 'soon'}))), /date is missing/);

assert.deepEqual(parseIcpacPoint(points.extreme), {category: 'extreme', totalMm: 217.8});
assert.deepEqual(parseIcpacPoint(points.veryHeavy), {category: 'very-heavy', totalMm: 114.8});
assert.deepEqual(parseIcpacPoint(points.heavy), {category: 'heavy', totalMm: 38});
assert.deepEqual(parseIcpacPoint(points.none), {category: null, totalMm: 16.2});
assert.deepEqual(parseIcpacPoint(points.empty), {category: null, totalMm: null}, 'no data is not zero rain');
assert.throws(() => parseIcpacPoint('<html>error</html>'), /not recognized/);

const pointUrl = new URL(icpacPointUrl(2.0469, 45.3182, '2026-10-13'));
assert.equal(pointUrl.origin + pointUrl.pathname, ALERT_SOURCES.icpacWms);
assert.equal(pointUrl.searchParams.get('REQUEST'), 'GetFeatureInfo');
assert.equal(pointUrl.searchParams.get('time'), '2026-10-13');
assert.equal(pointUrl.searchParams.get('QUERY_LAYERS'), Object.values(ICPAC_LAYERS).filter(layer => layer !== ICPAC_LAYERS.total).concat(ICPAC_LAYERS.total).join(','));

const guriceel = cities.find(city => city[0] === 'Guriceel');
const extremeAlert = icpacAlert(guriceel, parseIcpacPoint(points.extreme), week);
assert.equal(extremeAlert.basis, 'regional-forecast');
assert.equal(extremeAlert.sourceId, 'icpac');
assert.equal(extremeAlert.severity, 'severe');
assert.equal(extremeAlert.title, 'Guriceel · ICPAC forecast: extremely heavy rainfall, 13 Oct–20 Oct');
assert.deepEqual(extremeAlert.scope.cities, ['Guriceel']);
assert.match(extremeAlert.description, /above the 99th percentile .* about 218 mm .* not an official local warning/);
assert.equal(icpacAlert(guriceel, {category: 'heavy', totalMm: null}, week).description.includes(' mm '), false, 'an unknown total is left out, not shown as zero');
assert.equal(icpacAlert(guriceel, parseIcpacPoint(points.none), week), null, 'below the heavy threshold: no alert');

const NOW_IN_WEEK = new Date('2026-10-14T09:00:00Z');
const byCity = {Guriceel: points.extreme, Beledweyne: points.veryHeavy, Hargeisa: points.heavy, Laasqoray: points.empty};
function icpacFetch({failCity = null, offline = false} = {}) {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (url === ALERT_SOURCES.icpacDatasets) { if (offline) throw new Error('ICPAC offline'); return response(datasets); }
    if (String(url).startsWith(ALERT_SOURCES.icpacWms)) {
      const u = new URL(url), [minLon, minLat] = u.searchParams.get('BBOX').split(',').map(Number);
      const city = cities.find(c => Math.abs(c[3] - (minLon + 0.05)) < 1e-6 && Math.abs(c[2] - (minLat + 0.05)) < 1e-6);
      if (city?.[0] === failCity) throw new Error('point timeout');
      return response(byCity[city?.[0]] || points.none);
    }
    if (String(url).startsWith(ALERT_SOURCES.gdacs)) return response(collection());
    throw new Error('Unexpected test URL ' + url);
  };
  return {fetchImpl, calls};
}

const live = icpacFetch();
const loaded = await loadOfficialAlerts({now: NOW_IN_WEEK, fetchImpl: live.fetchImpl, cities});
assert.deepEqual(loaded.alerts.map(alert => alert.scope.cities[0]).sort(), ['Beledweyne', 'Guriceel', 'Hargeisa']);
assert.equal(loaded.regionalForecastAvailable, true);
assert.equal(loaded.sources[0].id, 'icpac');
assert.equal(loaded.sources[0].publishedAt, week.issuedAt);
assert.equal(loaded.sources[0].returnedCount, 30);
assert.equal(loaded.sources[0].cityForecasts.find(item => item.city === 'Laasqoray').totalMm, null);
assert.match(loaded.coverageNote, /not an official warning/);
assert.match(loaded.coverageNote, /30 of 30 cities checked for 13 Oct–20 Oct/);
assert.match(loaded.coverageNote, /does not mean there is no flood risk/);
assert.ok(live.calls.find(url => url.includes('fromdate=2026-09-14') && url.includes('todate=2026-10-14')), 'GDACS search dates come from retrieval date');
assert.equal(live.calls.filter(url => url.startsWith(ALERT_SOURCES.icpacWms)).length, 30, 'one point request per city');
await loadOfficialAlerts({now: NOW_IN_WEEK, fetchImpl: live.fetchImpl, cities});
assert.equal(live.calls.filter(url => url.startsWith(ALERT_SOURCES.icpacWms)).length, 30, 'the same forecast week is not asked again');

const gap = await loadOfficialAlerts({now: NOW_IN_WEEK, fetchImpl: icpacFetch({failCity: 'Mogadishu'}).fetchImpl, cities});
assert.equal(gap.sources[0].available, true);
assert.equal(gap.sources[0].partial, true);
assert.equal(gap.sources[0].error, undefined, 'one silent city does not hide the others');
assert.match(gap.sources[0].notice, /1 cities could not be checked/);
assert.equal(gap.alerts.length, 3);
assert.equal(gap.regionalForecastAvailable, false);

const ended = await loadOfficialAlerts({now: new Date('2026-10-22T09:00:00Z'), fetchImpl: icpacFetch().fetchImpl, cities});
assert.equal(ended.alerts.length, 0, 'an ended forecast week raises nothing');
assert.match(ended.sources[0].error, /13 Oct–20 Oct\) has ended/);

const icpacDown = await loadOfficialAlerts({now: NOW_IN_WEEK, fetchImpl: async url => { if (String(url).startsWith(ALERT_SOURCES.gdacs)) return response(collection(gdacs({todate:'2026-10-16T01:00:00'}))); throw new Error('ICPAC offline'); }, cities});
assert.equal(icpacDown.regionalForecastAvailable, false);
assert.equal(icpacDown.eventFeedAvailable, true);
assert.equal(icpacDown.alerts[0].basis, 'model-event');
assert.match(icpacDown.coverageNote, /ICPAC forecast is unavailable/);
await assert.rejects(loadOfficialAlerts({now: NOW_IN_WEEK, fetchImpl: async () => { throw new Error('Offline'); }, cities}), /Offline/);
console.log('Alert feed checks passed: ICPAC forecast week, categories, totals and no-data points; per-week cache; partial, ended and failed sources; GDACS dates and model separation.');
