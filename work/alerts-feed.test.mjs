import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ALERT_SOURCES, parseCapRss, parseCapDocument, parseGdacsEvents, loadOfficialAlerts} from './somalia-flood-watch/alerts-feed.mjs';

const NOW = new Date('2026-10-13T09:00:00Z');
function cap({id='warning-1', status='Actual', scope='Public', type='Alert', sent='2026-10-13T10:00:00+03:00', expires='2026-10-14T18:00:00+03:00', refs='', onset='2026-10-13T15:00:00+03:00'} = {}) {
  return `<?xml version="1.0"?><cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2"><cap:identifier>${id}</cap:identifier><cap:sender>official@example.test</cap:sender><cap:sent>${sent}</cap:sent><cap:status>${status}</cap:status><cap:scope>${scope}</cap:scope><cap:msgType>${type}</cap:msgType><cap:references>${refs}</cap:references><cap:info><cap:language>en</cap:language><cap:event>Rain/Wet Spell</cap:event><cap:severity>Moderate</cap:severity><cap:onset>${onset}</cap:onset><cap:expires>${expires}</cap:expires><cap:headline>Heavy rain &amp; thunderstorms</cap:headline><cap:description>Risk of flash flooding.</cap:description><cap:instruction>Avoid flooded roads.</cap:instruction><cap:area><cap:areaDesc>Benadir</cap:areaDesc></cap:area></cap:info></cap:alert>`;
}
function rss(items=[]) {
  return `<?xml version="1.0"?><rss version="2.0"><channel><lastBuildDate>Tue, 13 Oct 2026 07:00:00 GMT</lastBuildDate><pubDate>Tue, 13 Oct 2026 07:00:00 GMT</pubDate>${items.map(item=>`<item><guid>${item.id}</guid><title>Weather warning</title><pubDate>Tue, 13 Oct 2026 07:00:00 GMT</pubDate><link>${item.url}</link></item>`).join('')}</channel></rss>`;
}
const gdacs = (extra={}) => ({type:'Feature', properties:{eventtype:'FL', eventid:123, episodeid:1, iso3:'SOM', country:'Somalia', iscurrent:'true', fromdate:'2026-10-12T01:00:00', todate:'2026-10-14T01:00:00', datemodified:'2026-10-13T06:00:00', source:'GLOFAS', alertlevel:'Green', name:'Flood in Somalia', ...extra}});
const collection = (...features) => ({type:'FeatureCollection', features});
const response = body => ({ok:true, status:200, text:async()=>typeof body === 'string' ? body : JSON.stringify(body)});

const current = parseCapDocument(cap(), {now:NOW});
assert.equal(current.alert.basis, 'official-warning');
assert.equal(current.alert.sourceId, 'snma');
assert.equal(current.alert.title, 'Heavy rain & thunderstorms');
assert.equal(current.alert.issuedAt, '2026-10-13T07:00:00.000Z');
assert.equal(current.alert.startsAt, '2026-10-13T12:00:00.000Z');
assert.deepEqual(current.alert.scope, {country:'Somalia', cities:[], areaDescription:'Benadir'});
assert.equal(current.alert.instruction, 'Avoid flooded roads.');
assert.equal(parseCapDocument(cap({expires:'2026-10-13T12:00:00+03:00', onset:'2026-10-12T15:00:00+03:00'}), {now:NOW}).reason, 'expired', 'expiry at now is excluded');
assert.equal(parseCapDocument(cap({sent:'2026-10-13T10:00:00'}), {now:NOW}).reason, 'missing-identity-or-date', 'timezone-less CAP dates cannot become current by host timezone');
assert.equal(parseCapDocument(cap({expires:''}), {now:NOW}).reason, 'unknown-validity');
assert.equal(parseCapDocument(cap({status:'Test'}), {now:NOW}).reason, 'not-public-actual');
assert.equal(parseCapDocument(cap({scope:'Private'}), {now:NOW}).reason, 'not-public-actual');
assert.equal(parseCapDocument(cap({type:'Cancel'}), {now:NOW}).reason, 'cancelled');
assert.equal(parseCapDocument(cap({sent:'2026-10-14T10:00:00+03:00'}), {now:NOW}).reason, 'future-issued');
assert.throws(()=>parseCapRss('<html>No feed</html>'), /format/);
assert.throws(()=>parseCapDocument('<!DOCTYPE cap [<!ENTITY x SYSTEM "file://example">]>'+cap(), {now:NOW}), /declarations/);
assert.equal(parseCapRss(rss([{id:'bad',url:'https://example.test/evil.xml'}])).items[0].capUrl, null, 'only official host links are fetched');

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

const urls = ['https://meteosomalia.so/api/cap/active.xml','https://meteosomalia.so/api/cap/cancel.xml'];
const requests=[];
const fakeFetch = async url => {
  requests.push(String(url));
  if (url === ALERT_SOURCES.snma) return response(rss([{id:'warning-1',url:urls[0]},{id:'warning-2',url:urls[1]}]));
  if (url === urls[0]) return response(cap());
  if (url === urls[1]) return response(cap({id:'warning-2',type:'Cancel',refs:'official@example.test,warning-1,2026-10-13T10:00:00+03:00'}));
  if (String(url).startsWith(ALERT_SOURCES.gdacs)) return response(collection());
  throw new Error('Unexpected test URL');
};
const cancelled = await loadOfficialAlerts({now:NOW, fetchImpl:fakeFetch});
assert.equal(cancelled.alerts.length, 0, 'CAP cancellation retires the referenced active warning');
assert.equal(cancelled.officialWarningsAvailable, true);
assert.equal(cancelled.sources[0].publishedAt, '2026-10-13T07:00:00.000Z');
assert.match(cancelled.coverageNote, /does not mean there is no flood risk/);
assert.ok(requests.find(url=>url.includes('fromdate=2026-09-13') && url.includes('todate=2026-10-13')), 'search dates are derived from retrieval date');
const halfFailed = await loadOfficialAlerts({now:NOW, fetchImpl:async url=>{
  if (url === ALERT_SOURCES.snma) throw new Error('Offline CAP source');
  return response(collection(gdacs()));
}});
assert.equal(halfFailed.officialWarningsAvailable, false);
assert.equal(halfFailed.eventFeedAvailable, true);
assert.equal(halfFailed.alerts[0].basis, 'model-event');
assert.match(halfFailed.coverageNote, /unavailable/);
await assert.rejects(loadOfficialAlerts({now:NOW,fetchImpl:async()=>{throw new Error('Offline');}}), /Offline/);
const partial = await loadOfficialAlerts({now:NOW,fetchImpl:async url=>{
  if (url === ALERT_SOURCES.snma) return response(rss([{id:'warning-1',url:urls[0]}]));
  if (url === urls[0]) throw new Error('CAP document failure');
  return response(collection());
}});
assert.equal(partial.officialWarningsAvailable, false);
assert.equal(partial.sources[0].available, true);
assert.equal(partial.sources[0].partial, true);
assert.equal(partial.sources[0].failedCount, 1);

// Actual retrieved RSS is historical: retrieval must not relabel its dates.
const actualRss = parseCapRss(await readFile(new URL('./somalia-cap-feed.xml', import.meta.url), 'utf8'));
assert.equal(actualRss.items.length, 3);
assert.equal(actualRss.lastBuildAt, '2026-05-11T11:21:00.000Z');
console.log('Official warning feed checks passed: CAP dates/status/expiry/cancellation; country scope; model separation; partial and failed sources.');
