import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';

const dist = new URL('./somalia-flood-watch/dist/', import.meta.url);
const names = ['translations-so.js','i18n.js','index.html','cities.js','cities.json','daily.js','planning.js','terrain.js','copernicus.js','alerts.js','flood-outlook.js','rankings.js','mayor-store.js','mayor.js','extra-cities-store.js','extra-cities.js','observed.js'];
const sources = Object.fromEntries(await Promise.all(names.map(async name => [name, await fs.readFile(new URL(name, dist),'utf8')])));
const cities = JSON.parse(sources['cities.json']);
const NOW = Date.parse('2026-10-14T08:10:00Z'), LAST = '2026-10-14T08:05:00Z';
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW; } }
const days = Array.from({length:14},(_,i)=>new Date(Date.parse('2026-10-14T00:00:00Z')+i*86400000).toISOString().slice(0,10));
const decode = value => String(value).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replaceAll('&nbsp;',' ').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
const normalize = value => decode(value).trim().replace(/\s+/g,' ');

// A small HTML-token reader preserves text-node boundaries and honours the same
// protected user/source regions as the interface. It never executes markup.
function fragments(html) {
  const result = [], stack = [];
  const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const protectedTags = new Set(['script','style','textarea','pre','code']);
  for (const match of String(html).matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>]*>|[^<]+/gi)) {
    const token=match[0];
    if(token.startsWith('<!--')||token.startsWith('<!'))continue;
    if(token.startsWith('</')) { const tag=token.match(/^<\/([\w-]+)/)?.[1].toLowerCase();const index=stack.findLastIndex(item=>item.tag===tag);if(index>=0)stack.splice(index);continue; }
    if(token.startsWith('<')) {
      const tag=token.match(/^<([\w-]+)/)?.[1].toLowerCase();
      const attributes=Object.fromEntries([...token.matchAll(/([\w-]+)(?:="([^"]*)"|='([^']*)')?/g)].slice(1).map(m=>[m[1].toLowerCase(),decode(m[2]??m[3]??'')]));
      const classes=new Set((attributes.class||'').split(/\s+/)), parent=stack.at(-1);
      const protectedContent=!!parent?.protected || protectedTags.has(tag) || Object.hasOwn(attributes,'data-i18n-skip') || classes.has('brand-title') || classes.has('community-description') || classes.has('mayor-report-description') || classes.has('mayor-action-owner-value') || classes.has('community-comment') || tag==='strong'&&parent?.classes.has('mayor-action-title') || tag==='h3'&&parent?.classes.has('extra-city-heading') || tag==='b'&&parent?.classes.has('footer-brand');
      const userAttrs=(attributes['data-i18n-user-attrs']||'').split(/\s+/);
      if(!protectedContent)for(const name of ['aria-label','title','placeholder','alt','aria-description'])if(attributes[name]&&!userAttrs.includes(name))result.push({text:normalize(attributes[name]),kind:name,context:attributes.id||tag});
      if(!voidTags.has(tag)&&!token.endsWith('/>'))stack.push({tag,attributes,classes,protected:protectedContent});
    } else if(!stack.at(-1)?.protected) {
      const text=normalize(token);if(text)result.push({text,kind:'text',context:stack.at(-1)?.attributes.id||stack.at(-1)?.tag||'root'});
    }
  }
  return result;
}

const properNames=new Set([...cities.flatMap(city=>[city[0],city[1]]),'El Nino Watch','Mandek Consulting','East Africa Hazards Watch ↗','EL NIÑO / ENSO · NOAA','Galkayo','Mudug','Hobyo','Station Name','Copernicus radar','CEMS GFM','NASA composite','Noor Hassan','fixture-outage']);
const providerWords=['Copernicus CEMS Global Flood Monitoring','Copernicus Data Space','FAO SWALIM','CEMS GFM','Open-Meteo','GloFAS','SWALIM','GDACS','NOAA','ICPAC','East Africa Hazards Watch','WMO','NASA','Sentinel-1','Sentinel-2','Google Earth','Google Maps','Google Street View','meteoblue','Copernicus','Mandek Consulting'];
function requiresTranslation(text) {
  if(properNames.has(text)||/^(?:https?:|mailto:|blob:)/i.test(text)||/^[\w.+-]+@[\w.-]+$/.test(text)||/^elninowatch\.so(?:\s*↗)?$/.test(text))return false;
  let rest=text;
  for(const name of [...properNames,...providerWords].sort((a,b)=>b.length-a.length))rest=rest.split(name).join('');
  rest=rest.replace(/\b(?:EAT|UTC|UTC\+3|GMT|HAND|DEM|GLO-90|CSV|API|STAC|HTTP|UV|hPa|km\/h|km|mm\/day|mm|m|days)\b/g,'');
  // Numeric axes, cardinal compass abbreviations, dates and SI unit labels do
  // not imply missing interface prose. Dates are checked in their own test.
  if(/^(?:[NSEW]{1,3}|[↑↓]?\s*EAT|[–—?\d\s.,:;%°³/≥<>=+−-]+)$/.test(rest))return false;
  return /[A-Za-z]{3}/.test(rest);
}
function translationContext() {
  const values=new Map(),root={location:{href:'http://127.0.0.1:4173/'},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value))},history:{replaceState(){}},setTimeout(){},Date:Clock};
  const context=vm.createContext({window:root,Date:Clock,URL,URLSearchParams,Map,Set,WeakMap,console,Blob,Number,String,Object,Array,JSON,Math});
  vm.runInContext(sources['translations-so.js'],context);vm.runInContext(sources['i18n.js'],context);
  root.SiteLanguage.setLanguage('so');
  return {context,root,api:root.SiteLanguage,translate:text=>root.SiteLanguage.translateText(text)};
}
function untranslated(html,translate) { return fragments(html).filter(item=>requiresTranslation(item.text)&&normalize(translate(item.text))===item.text); }
function assertCoverage(html,translate,label) {
  const missing=untranslated(html,translate);
  assert.deepEqual([...new Set(missing.map(item=>`${item.kind} [${item.context}]: ${item.text}`))],[],`${label}: untranslated interface fragments`);
}
function componentHarness() {
  const h=translationContext(),elements=new Map(),storage=new Map();
  const document={activeElement:null,hidden:false,body:{classList:{add(){},remove(){}}},addEventListener(){},getElementById:id=>node(id),createElement:()=>({click(){},remove(){}})};
  function node(id) {
    if(elements.has(id))return elements.get(id);
    const value={id,value:'',textContent:'',hidden:false,disabled:false,checked:false,options:[],dataset:{},tagName:'DIV',open:false,classList:{add(){},remove(){},toggle(){},contains(){return false}},focus(){document.activeElement=this;},addEventListener(){},removeAttribute(){},setAttribute(){},getAttribute(){return null},querySelector(){return null},querySelectorAll(){return[]},showModal(){this.open=true},close(){this.open=false},selectionStart:0,selectionEnd:0,setSelectionRange(){}};
    let html='';Object.defineProperty(value,'innerHTML',{get:()=>html,set:markup=>{html=String(markup);for(const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g))node(match[1]);}});
    elements.set(id,value);return value;
  }
  h.root.document=document;h.root.crypto={randomUUID};h.root.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))};
  Object.assign(h.root,{addEventListener(){},setInterval(){return 1},clearInterval(){},setTimeout(){},URL,AbortController,AbortSignal});
  Object.assign(h.context,{document,crypto:{randomUUID},location:h.root.location,URL,URLSearchParams,AbortController,AbortSignal,setTimeout(){},setInterval(){return 1},clearInterval(){}});
  for(const name of ['cities.js','daily.js','planning.js','terrain.js','copernicus.js','alerts.js','flood-outlook.js','rankings.js','mayor-store.js','mayor.js','extra-cities-store.js','extra-cities.js'])vm.runInContext(sources[name],h.context);
  return {...h,elements,node,document};
}
const feed=()=>({data:{},lastSuccess:LAST,error:null});
const outlookInput=()=>({cityName:'Galkayo',region:'Mudug',now:new Clock().toISOString(),weatherFeed:feed(),riverFeed:feed(),stationFeed:feed(),weatherRows:days.map((date,i)=>({date,rain:i*4,probability:70,maxTemperature:32})),riverRows:days.map((date,i)=>({date,discharge:200+i*10})),station:{name:'Station Name',observedAt:days[0],levelM:5,moderateM:3,highM:4,bankFullM:6}});

test('public HTML labels, disclaimers, controls and accessibility text have Somali coverage',t=>{
  const h=translationContext();assertCoverage(sources['index.html'],h.translate,'Public interface');
  const inspected=fragments(sources['index.html']).length;assert.ok(inspected>180,'full static interface is inspected');t.diagnostic(`Inspected ${inspected} public text and accessibility fragments`);
});

test('critical terminology preserves missing-data, non-government and safety meaning',()=>{
  const h=translationContext();
  assert.match(h.translate('Rainfall unavailable'),/roob|xog/i);
  assert.match(h.translate('Unknown'),/xog/i);
  assert.match(h.translate('Rainfall screening'),/qiimeyn.*hordhac/i);
  assert.match(h.translate('Unverified'),/aan la xaqiijin/i);
  assert.match(h.translate('Independent, non-government information service.'),/dawlad|dowlad/i);
  assert.match(h.translate('For emergencies and support, contact your local government offices and/or the relevant authority in your area.'),/degdeg|xaalad/i);
  assert.match(h.translate('Daily rainfall and modeled river flow support planning. This outlook does not predict flood extent, depth, casualties or the probability of flooding.'),/ma saadaalinayso|ma saadaaliyo/i);
  assert.match(h.translate('No usable rainfall forecast for today. Missing rainfall is unknown, not zero.'),/ma aha eber/i);
});

test('dates, amounts, identifiers and raw source captures are preserved without damaging exact units',()=>{
  const h=translationContext();
  assert.equal(h.translate('Wednesday 14 October'), 'Arbaco 14 Oktoobar');
  assert.equal(h.translate('14 Oct 2026, 11:05 EAT'),'14 Oktoobar 2026, 11:05 EAT');
  const rain=h.translate('Galkayo · Elevated rainfall');assert.ok(rain.includes('Galkayo'));assert.ok(!rain.includes('Elevated rainfall'));
  const forecast=h.translate('25.4 mm forecast for 2026-10-14 (daily total). App screening thresholds: Watch ≥10 mm/day; Elevated ≥25 mm/day. These are screening rules, not flood probabilities or official warning thresholds.');
  for(const token of ['25.4','2026-10-14','≥10','≥25','mm/day'])assert.ok(forecast.includes(token),token);
  const duplicate=h.translate('These coordinates are within 2 km of Noor Hassan, which is already in the additional-city list. Choose its existing entry or check the location.');
  assert.ok(duplicate.includes('Noor Hassan'));assert.ok(duplicate.includes('2 km'));
  const raw='Original provider response: request-id=S1_TEST_A; HTTP 503';
  assert.ok(h.translate('Detailed weather refresh failed: '+raw).endsWith(raw),'raw failure capture remains intact');
  assert.equal(h.translate('S1_IW_GRDH_20261012T150823_COG'),'S1_IW_GRDH_20261012T150823_COG');
  assert.equal(h.translate('https://example.org/Unknown?city=Galkayo'),'https://example.org/Unknown?city=Galkayo');
  h.api.setLanguage('en');assert.equal(h.api.translateText('All 30 cities'),'All 30 cities');
});

test('14-day planning outlook covers fresh, stale, missing and partial model values',()=>{
  const h=componentHarness();
  for(const mode of ['fresh','stale','missing','partial']) {
    const input=outlookInput();
    if(mode==='stale'){input.weatherFeed.stale=true;input.riverFeed.stale=true;}
    if(mode==='missing'){input.weatherFeed.data=null;input.riverFeed.data=null;input.station=null;}
    if(mode==='partial'){input.weatherRows=input.weatherRows.slice(0,5);input.riverRows=input.riverRows.slice(0,3);}
    assertCoverage(h.root.FloodOutlook.html(input),h.translate,`Outlook ${mode}`);
  }
  const original=h.root.FloodOutlook.csv(outlookInput()),parsed=original.split('\r\n');
  assert.ok(parsed[0].includes('river_discharge_m3_s_UTC'));assert.equal(parsed.length,15);assert.ok(parsed[1].includes('2026-10-14'));
  h.api.setLanguage('en');assert.equal(h.root.FloodOutlook.csv(outlookInput()),original,'machine-readable export schema and values do not change with UI language');
});

test('top-five comparisons cover rainfall, unverified report activity and explicit flood uncertainty',()=>{
  const h=componentHarness(),input={now:new Clock().toISOString(),cities:h.root.SOMALIA_CITIES,weatherFeed:feed(),weatherRowsByCity:cities.map(()=>days.map(date=>({date,rain:20}))),communityFeed:{data:{reports:[]},cityId:null,scope:'all',lastSuccess:LAST}};
  for(const mode of ['verified','indicators'])assertCoverage(h.root.CityRankings.html({...input,floodMode:mode}),h.translate,`Rankings ${mode}`);
  const reports=[{id:'flood-report-1',cityId:'galkayo',category:'flood',observedAt:'2026-10-14T08:00:00Z'},{id:'flood-report-2',cityId:'mogadishu',category:'flood',observedAt:'2026-10-14T07:30:00Z'}];
  assertCoverage(h.root.CityRankings.html({...input,floodMode:'indicators',communityFeed:{...input.communityFeed,data:{reports},total:2}}),h.translate,'Rankings with reports');
});

test('detailed daily forecast covers conditions, hourly tables, screen-reader graph labels and composite status messages',()=>{
  const h=componentHarness(),forecast={timezone:'Africa/Mogadishu',utc_offset_seconds:10800,daily:{time:days},hourly:{time:Array.from({length:24},(_,i)=>days[0]+'T'+String(i).padStart(2,'0')+':00')}};
  for(const field of ['temperature_2m_max','temperature_2m_min','apparent_temperature_max','apparent_temperature_min','precipitation_sum','precipitation_probability_max','wind_speed_10m_max','wind_gusts_10m_max','uv_index_max'])forecast.daily[field]=days.map(()=>10);
  forecast.daily.weather_code=days.map((_,i)=>[0,1,2,3,45,48,51,53,55,61,63,65,80,95][i]);forecast.daily.sunrise=days.map(date=>date+'T05:40');forecast.daily.sunset=days.map(date=>date+'T18:00');
  for(const field of ['temperature_2m','relative_humidity_2m','apparent_temperature','precipitation_probability','precipitation','cloud_cover','wind_speed_10m','wind_direction_10m','wind_gusts_10m','pressure_msl','visibility','dew_point_2m','is_day'])forecast.hourly[field]=Array.from({length:24},()=>10);
  forecast.hourly.weather_code=Array.from({length:24},()=>63);
  for(const code of [0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99,-1])assert.notEqual(h.translate(h.root.DailyWeather.weatherInfo(code).label),h.root.DailyWeather.weatherInfo(code).label,`weather code ${code}`);
  for(const mode of ['fresh','partial','missing']) {
    const data=mode==='missing'?null:structuredClone(forecast);if(mode==='partial'){data.hourly.time=data.hourly.time.slice(0,4);data.hourly.precipitation=[];}
    h.root.DailyWeather.render({city:{name:'Galkayo',region:'Mudug'},date:days[0],days,forecast:data,loadedAt:LAST,loading:mode==='missing',stale:mode==='partial'});
    for(const id of ['daily-summary','daily-date-tabs','hourly-chart','hourly-detail','hourly-table','daily-status'])assertCoverage(h.node(id).innerHTML,h.translate,`Daily ${mode} ${id}`);
  }
});

test('city planning evidence and recommended actions cover live and hypothetical scenarios',()=>{
  const h=componentHarness();
  for(const scenario of ['live','heavy-rain','river-rise','blocked-drains']) {
    h.root.FloodPlanning.render({city:{name:'Galkayo',region:'Mudug',context:'Inland drainage'},scenario,selectedDate:days[0],risk:'Watch',rainMm:20,forecastRetrievedAt:LAST,station:null});
    for(const id of ['planning-summary','planning-actions','planning-limits'])assertCoverage(h.node(id).innerHTML,h.translate,`Planning ${scenario} ${id}`);
  }
});

test('terrain evidence covers mapped potential, point-height limitations and missing overlays',()=>{
  const h=componentHarness();h.root.FloodTerrain.init({cities:h.root.SOMALIA_CITIES,cityIndex:10});
  h.root.FloodTerrain.setSource({layers:{susceptibility:{sourceUrl:'https://example.org/terrain'}}},{active:true,susceptibility:'source tiles loaded'});
  h.root.FloodTerrain.point({lat:6.77,lon:47.43,elevationM:288,relativeM:1,sampleKind:'city-center',cityIndex:10,susceptibility:{value:4,sourceUrl:'https://example.org/terrain'},historical:{intersects:true}});
  for(const id of ['terrain-summary','terrain-evidence'])assertCoverage(h.node(id).innerHTML,h.translate,`Terrain ${id}`);
  h.root.FloodTerrain.clearPoint();h.root.FloodTerrain.setSource(null,{});assertCoverage(h.node('terrain-summary').innerHTML,h.translate,'Terrain unavailable');
});

test('Copernicus metadata labels cover optical clouds, radar and catalogue connection limits',()=>{
  const h=componentHarness(),input={cityName:'Galkayo',now:new Clock().toISOString(),feed:{...feed(),data:{missions:{radar:{available:true,scenes:[{id:'S1_TEST_A',datetime:'2026-10-12T15:08:23Z',browserUrl:'https://browser.dataspace.copernicus.eu/',metadataUrl:'https://stac.dataspace.copernicus.eu/',browserSelectionRequired:true}]},optical:{available:true,scenes:[{id:'S2_TEST_B',datetime:'2026-10-12T07:13:21Z',cloudCoverPercent:79.57,browserUrl:'https://browser.dataspace.copernicus.eu/'}]}},queryWindow:{start:'2026-10-01T00:00:00Z',end:'2026-10-14T08:00:00Z'}}},onInspectRadar(){return true}};
  h.root.CopernicusScenes.render(input);assertCoverage(h.node('scenes').innerHTML,h.translate,'Copernicus scenes');
  assert.notEqual(h.translate(h.node('copernicus-status').textContent),h.node('copernicus-status').textContent);
  h.root.CopernicusScenes.render({...input,clearerOnly:true});assertCoverage(h.node('scenes').innerHTML,h.translate,'Copernicus cloud filter');
});

test('alert screens and browser status translate; source event text stays original and ICPAC forecasts are translated',()=>{
  const h=componentHarness(),rawTitle='Rainfall today',rawDescription='Official source wording: request-id=A_101; preserve this exact notice.';
  const forecast=cities.map(()=>({daily:{time:days,precipitation_sum:days.map(()=>20)}}));
  const official={basis:'event-monitoring',status:'active',id:'GDACS_101',title:rawTitle,description:rawDescription,severity:'moderate',issuedAt:'2026-10-14T08:00:00Z',startsAt:'2026-10-14T07:00:00Z',endsAt:'2026-10-15T08:00:00Z',scope:{country:'Somalia',cities:['Galkayo']},source:'GDACS',sourceUrl:'https://www.gdacs.org/'};
  // GDACS text is the source's own wording and stays as written; ICPAC alerts are written by this app and are translated.
  const icpac={...official,basis:'regional-forecast',id:'ICPAC_1',source:'ICPAC',sourceUrl:'https://www.icpac.net/weekly-forecast/',title:'Galkayo · ICPAC forecast: very heavy rainfall, 13 Oct–20 Oct',description:"ICPAC's weekly forecast puts Galkayo above the 95th percentile of rainfall usually seen in this week of the year (very heavy rainfall), with about 70 mm forecast for the week. This is a regional model forecast at about 11 km resolution, not an official local warning."};
  const notices=[...['model-event','event-monitoring'].map((basis,index)=>({...official,basis,id:'SOURCE_'+index})),icpac];
  h.root.FloodAlerts.render({now:new Clock().toISOString(),cities:h.root.SOMALIA_CITIES,selectedCity:10,scope:'all',type:'all',weatherFeed:{...feed(),data:forecast},stationFeed:{...feed(),data:{stations:[]}},officialFeed:{...feed(),data:{alerts:notices,sources:[]}}});
  for(const id of ['alerts-summary','alerts-list','alerts-status'])assertCoverage(h.node(id).innerHTML,h.translate,`Alerts ${id}`);
  assert.ok(h.node('alerts-list').innerHTML.includes('data-i18n-skip lang="und">'+rawTitle));
  assert.ok(h.node('alerts-list').innerHTML.includes(rawDescription));
  assert.equal([...h.node('alerts-list').innerHTML.matchAll(/data-i18n-skip lang="und">Rainfall today/g)].length,2,'both GDACS bases protect event titles');
  assert.ok(!h.node('alerts-list').innerHTML.includes('data-i18n-skip lang="und">Galkayo · ICPAC'),'ICPAC titles are open to translation');
  assert.equal(h.translate(icpac.title),'Galkayo · Saadaasha ICPAC: roob aad u xooggan, 13 Oct–20 Oct');
  assert.match(h.translate(icpac.description),/^Saadaasha toddobaadlaha ah ee ICPAC waxay Galkayo u saadaalisay .*\(roob aad u xooggan\).*qiyaastii 70 mm/);
  assert.ok(!fragments(h.node('alerts-list').innerHTML).some(item=>item.text===rawTitle||item.text===rawDescription),'raw notices are excluded from translation coverage checks');
});

test('Mayor dashboard and additional-city dialog labels remain bilingual without changing stored identities',()=>{
  const h=componentHarness(),rows=days.map((date,i)=>({date,rain:i===0?10:i===1?25:0,probability:40,maxTemperature:32}));
  const input={cities:h.root.SOMALIA_CITIES,selectedCity:10,selectedDate:days[0],days,weatherRows:rows,weatherFeed:feed(),station:null,stationFeed:{...feed(),data:{stations:[]}},officialFeed:{...feed(),data:{alerts:[],sources:[]}},catalogueFeed:{...feed(),data:{missions:{radar:{available:true,scenes:[]},optical:{available:true,scenes:[]}}}},observedState:{source:'radar',date:'2026-10-13',metadata:{radar:{available:true,provider:'CEMS GFM',resolutionM:20}},lastSuccess:LAST,stale:false},community:{available:true,cityId:'galkayo',records:[],lastSuccess:LAST,total:0,truncated:false},alertModel:{alerts:[],fresh:{official:true},coverageNote:'Forecast and event coverage may be incomplete. No returned signal does not establish safety.',messages:[]},actions:[],now:new Clock().toISOString(),floodOutlook:outlookInput()};
  h.root.CityManager.init({cities:h.root.SOMALIA_CITIES});h.root.CityManager.render(input);
  const added=h.root.ExtraCitiesStore.add({name:'Hobyo',region:'Mudug',lat:5.3505,lon:48.5268});assert.equal(added.name,'Hobyo');
  h.root.ExtraCities.init();h.root.ExtraCities.open();assertCoverage(h.node('extra-cities-root').innerHTML,h.translate,'Additional cities');
  for(const id of ['extra-cities-list','extra-cities-storage','extra-cities-count'])assertCoverage(h.node(id).innerHTML||h.node(id).textContent,h.translate,`Additional city ${id}`);
  assert.equal(h.root.SOMALIA_CITIES.length,30);assert.equal(h.root.ExtraCitiesStore.list()[0].name,'Hobyo');
  assertCoverage(h.node('mayor-root').innerHTML,h.translate,'Mayor interface');
});

test('radar observation status and legend cover dated classifications and unknown water evidence',async()=>{
  const h=componentHarness(),panes=new Map();h.root.location.protocol='http:';h.context.location=h.root.location;
  h.node('layer-observed').checked=true;h.node('layer-observed-coverage').checked=true;h.node('observed-source').options=[{value:'radar'},{value:'nasa'}];
  const layer=()=>({on(){return this},addTo(){return this}}),tileLayer=()=>layer();tileLayer.wms=tileLayer;h.context.L={tileLayer};
  const metadata={fetchedAt:LAST,provider:'CEMS GFM',radar:{available:true,provider:'Copernicus radar',resolutionM:20,availableDates:['2026-10-12','2026-10-13'],timeDefault:'2026-10-13',sourceTimeDefault:'2026-10-13',wmsUrl:'https://example.org/wms',layerId:'flood',coverageLayerId:'coverage',sourceUrl:'https://example.org/'},nasa:{available:false}};
  h.context.fetch=async url=>({ok:true,status:200,json:async()=>String(url).startsWith('/api/observed-point?')?{available:true,coverage:'observed',pixel:{classification:'unknown'},note:'Coverage alone does not establish whether land is flooded. No detection is not proof of safety.'}:metadata});
  vm.runInContext(sources['observed.js'],h.context);h.root.ObservedFlood.init({map:{createPane:name=>panes.set(name,{style:{}}),getPane:name=>panes.get(name),removeLayer(){}},cities:h.root.SOMALIA_CITIES});
  await h.root.ObservedFlood.refresh();await h.root.ObservedFlood.inspect(6.77,47.43);
  for(const id of ['observed-status','observed-legend','observed-point'])assertCoverage(h.node(id).innerHTML||h.node(id).textContent,h.translate,`Observed ${id}`);
});
