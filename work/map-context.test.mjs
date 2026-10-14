import fs from 'node:fs/promises';import vm from 'node:vm';import assert from 'node:assert/strict';
const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',scrollIntoView(){this.scrolled=true}});return elements.get(id)};
const positions=[],copies=[],navigation=[];const location={href:'http://127.0.0.1:4173/#map-panel'};
const ctx=vm.createContext({window:{CommunityReports:{setLocation:p=>positions.push(p)},MayorNavigation:{open:section=>navigation.push(section)}},document:{getElementById:get},location,navigator:{clipboard:{writeText:async value=>copies.push(value)}},URL,URLSearchParams,Number,String,Date});
vm.runInContext(await fs.readFile(new URL('./somalia-flood-watch/dist/map-context.js',import.meta.url),'utf8'),ctx);const api=ctx.window.MapContext;
const city=['Mogadishu','Banaadir',2.0469,45.3182],now=new Date('2026-10-13T12:00:00.000Z');api.render({city,point:null,date:'2026-10-18',hour:8,scenario:'live',now});
get('report-map-location').onclick();assert.equal(positions.length,0,'A city center is not silently assigned as the observed report location');assert.equal(get('community-report-form').scrolled,true);
await get('copy-city-link').onclick();const route=new URLSearchParams(new URL(copies[0]).hash.slice(1));assert.equal(route.get('city'),'Mogadishu');assert.equal(route.get('day'),'2026-10-18');assert.equal(route.get('hour'),'8');
api.render({city,point:{lat:2.06123,lon:45.29123}});get('report-map-location').onclick();assert.equal(positions[0].latitude,2.06123);assert.equal(positions[0].longitude,45.29123);
const links=api.links({city,point:{lat:2.06123,lon:45.29123}});assert.equal(new URL(links.street).searchParams.get('map_action'),'pano');assert.equal(new URL(links.street).searchParams.get('viewpoint'),'2.06123,45.29123');assert.ok(links.earth.endsWith('2.06123%2C45.29123'));
assert.equal(navigation[0],'community');assert.equal(navigation[1],'community','Reporting still opens the mayor community tool');

function imagery(observationDatetime,options={}){return new URL(api.buildCopernicusBrowserUrl({lat:6.7697,lon:47.4308,now,observationDatetime,...options}));}
function dates(url){return[url.searchParams.get('fromTime'),url.searchParams.get('toTime')];}
const recent=['2026-09-29T12:00:00.000Z',now.toISOString()];
for(const absent of [undefined,null,'','YYYY-MM-DD','2026-10-32','2026-02-30','2026-09-31T07:00:00Z','2026-10-14','2026-10-13T12:00:01Z','2026-10-12T24:00:00Z','2026-10-12T07:13:00']){
  assert.deepEqual(dates(imagery(absent)),recent,'Missing, invalid and future observation timestamps use a complete recent window');
}
assert.deepEqual(dates(imagery('2026-10-12T07:13:00Z')),['2026-10-12T00:00:00.000Z','2026-10-12T23:59:59.999Z']);
assert.deepEqual(dates(imagery('2026-10-12')),['2026-10-12T00:00:00.000Z','2026-10-12T23:59:59.999Z']);
assert.deepEqual(dates(imagery('2026-10-13T08:00:00Z')),['2026-10-13T00:00:00.000Z',now.toISOString()],'Today’s observation end is capped at the retrieval time');
assert.deepEqual(dates(imagery('2026-10-13T00:30:00+03:00')),['2026-10-12T00:00:00.000Z','2026-10-12T23:59:59.999Z'],'Observation day is derived in UTC, not from the timestamp prefix');
assert.deepEqual(dates(imagery('2026-10-12T23:30:00-03:00')),['2026-10-13T00:00:00.000Z',now.toISOString()]);
assert.deepEqual(dates(imagery('2026-10-13T00:00:00Z',{now:new Date('2026-10-13T00:00:00Z')})),['2026-10-13T00:00:00.000Z','2026-10-13T00:00:00.000Z'],'UTC midnight has two explicit equal bounds');
assert.deepEqual(dates(imagery('2024-02-29',{now:new Date('2024-03-01T12:00:00Z')})),['2024-02-29T00:00:00.000Z','2024-02-29T23:59:59.999Z']);
const clean=imagery('2026-10-12T07:13:00Z');
assert.equal(clean.hostname,'browser.dataspace.copernicus.eu');assert.equal(clean.protocol,'https:');
for(const[key,value]of Object.entries({themeId:'DEFAULT-THEME',dateMode:'TIME RANGE',datasetId:'S2_L2A_CDAS',layerId:'1_TRUE_COLOR',cloudCoverage:'100',panel:'layers',lat:'6.7697',lng:'47.4308'}))assert.equal(clean.searchParams.get(key),value);
for(const key of ['visualizationUrl','evalscript','processGraph','from','to'])assert.equal(clean.searchParams.has(key),false,'No saved visualization/process state is inherited');
const radar=imagery('2026-10-12T15:08:23Z',{mission:'radar',panel:'search'});assert.equal(radar.searchParams.get('panel'),'search');assert.equal(radar.searchParams.has('datasetId'),false);assert.equal(radar.searchParams.has('layerId'),false);assert.deepEqual(dates(radar),dates(clean));
assert.throws(()=>imagery(null,{lat:NaN}),/coordinates/);assert.throws(()=>imagery(null,{lon:181}),/coordinates/);assert.throws(()=>imagery(null,{now:'invalid'}),/retrieval time/);

const cityRows=JSON.parse(await fs.readFile(new URL('./somalia-flood-watch/dist/cities.json',import.meta.url),'utf8'));assert.equal(cityRows.length,30);
for(const watchedCity of cityRows){const l=api.links({city:watchedCity,date:'2026-10-25',now});const u=new URL(l.copernicus);assert.equal(u.searchParams.get('lat'),String(watchedCity[2]));assert.equal(u.searchParams.get('lng'),String(watchedCity[3]));assert.deepEqual(dates(u),recent,'Future forecast date cannot be used as satellite observation date');assert.equal(l.fromTime,recent[0]);assert.equal(l.toTime,recent[1]);}
const selectedPoint={lat:6.78123,lon:47.44234};const dated=api.links({city:cityRows[10],point:selectedPoint,date:'2026-10-25',observationDatetime:'2026-10-12T07:13:00Z',now});assert.equal(new URL(dated.copernicus).searchParams.get('lat'),'6.78123');assert.equal(new URL(dated.copernicus).searchParams.get('lng'),'47.44234');assert.equal(dated.imageryDateLabel,'2026-10-12 UTC');assert.deepEqual(dates(new URL(dated.copernicus)),dates(clean));
api.render({city:cityRows[10],point:selectedPoint,observationDatetime:'2026-10-12T07:13:00Z',now});assert.match(get('map-context-links').innerHTML,/Inspect dated optical scenes/);assert.match(get('map-context-links').innerHTML,/2026-10-12 UTC/);assert.match(get('map-context-links').innerHTML,/All cloud-cover levels/);
api.render({city,point:{lat:91,lon:45.3},observationDatetime:null,now});const priorPositions=positions.length;get('report-map-location').onclick();assert.equal(positions.length,priorPositions,'An invalid map point does not silently report the city centre');assert.equal(get('report-map-location').textContent,'Report for this city');assert.equal(new URL(api.links({city,point:{lat:91,lon:45.3},now}).copernicus).searchParams.get('lat'),String(city[2]));
console.log('Map context passed: bounded Copernicus observation dates, invalid/future-date fallback, timezone/midnight handling, all 30 city and selected-point links, independent forecast sharing, and no invented report coordinates.');
