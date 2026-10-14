import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const script=await readFile(new URL('./somalia-flood-watch/dist/observed.js',import.meta.url),'utf8');
let now=Date.parse('2026-10-13T09:00:00Z');
class FakeDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
const elements=new Map(), layers=[],points=[],panes=new Map();
function el(id){
  if(!elements.has(id)) {
    const node={id,_text:'',_html:'',checked:false,disabled:false,hidden:false,value:'',options:[]};
    Object.defineProperties(node,{
      textContent:{get(){return this._text;},set(value){this._text=String(value);this._html='';}},
      innerHTML:{get(){return this._html;},set(value){this._html=String(value);this._text='';}}
    });
    elements.set(id,node);
  }
  return elements.get(id);
}
el('layer-observed').checked=true;
el('layer-observed-coverage').checked=true;
el('layer-observed-exclusion').checked=false;
el('observed-source').options=[{value:'radar'},{value:'nasa'}];
const map={createPane:name=>panes.set(name,{style:{}}),getPane:name=>panes.get(name),removeLayer:layer=>{layer.removed=true;}};
const makeLayer=(url,options)=>{
  const handlers={};
  const layer={url,options,handlers,on(name,fn){handlers[name]=fn;return this;},addTo(){this.added=true;return this;},emit(name){handlers[name]?.();}};
  layers.push(layer);return layer;
};
const tileLayer=(url,options)=>makeLayer(url,options);
tileLayer.wms=tileLayer;
const fixture=()=>({fetchedAt:new FakeDate().toISOString(),provider:'Observation fixture',radar:{available:true,provider:'Copernicus radar',resolutionM:20,
  availableDates:['2026-10-10','2026-10-11','2026-10-12','2026-10-13','2026-10-14','2026-02-30','not-a-date'],timeDefault:'2026-10-12',sourceTimeDefault:'2026-10-13',
  wmsUrl:'https://observed.example.test/wms',layerId:'flood',coverageLayerId:'coverage',exclusionLayerId:'gfm:exclusion_mask',sourceUrl:'https://observed.example.test/'},
  nasa:{available:true,provider:'NASA composite',resolutionM:250,availableDates:['2026-10-11','2026-10-12','2026-10-13'],timeDefault:'2026-10-12',sourceTimeDefault:'2026-10-13',
  wmtsUrlTemplate:'https://observed.example.test/{date}/{z}/{x}/{y}.png',sourceUrl:'https://observed.example.test/',maxNativeZoom:9}});
let metadata=fixture(),failMetadata=false;
const response=data=>({ok:true,status:200,json:async()=>structuredClone(data)});
const context=vm.createContext({window:{},document:{getElementById:el},L:{tileLayer},location:{protocol:'http:'},Date:FakeDate,URLSearchParams,
  AbortSignal:{timeout:()=>({})},fetch:async url=>{
    if(url==='/api/observed-flood'){if(failMetadata)throw Error('offline');return response(metadata);}
    if(String(url).startsWith('/api/observed-point?'))return new Promise(resolve=>points.push({url,resolve:data=>resolve(response(data))}));
    throw Error('Unexpected URL '+url);
  }});
vm.runInContext(script,context);
const observed=context.window.ObservedFlood;
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};
const latestLayer=name=>layers.findLast(layer=>layer.options.layers===name);
observed.init({map,cities:[['Mogadishu','Banaadir',2.0469,45.3182],['Hargeisa','Woqooyi Galbeed',9.5624,44.077]]});
assert.equal(observed.showRadarDate('2026-10-12'),false,'no radar date is selected before live metadata arrives');
observed.selectCity(0);
await observed.refresh();
assert.equal(new URL('http://localhost'+points[0].url).searchParams.get('lat'),'2.0469');
assert.equal(new URL('http://localhost'+points[0].url).searchParams.get('lon'),'45.3182');
assert.equal(observed.getState().date,'2026-10-12');
assert.doesNotMatch(el('observed-date').innerHTML,/2026-10-14/,'future observations excluded');
assert.doesNotMatch(el('observed-date').innerHTML,/2026-02-30|not-a-date/,'malformed calendar dates excluded');
assert.match(el('observed-legend').innerHTML,/coverage · not floodwater/);
assert.match(el('observed-legend').innerHTML,/Exclusion mask:.*not flood extent/);
assert.match(el('observed-status').innerHTML,/Product date does not guarantee this location was observed/);
assert.equal(panes.get('observedMaskPane').style.zIndex,370,'source mask below detected water, above scene coverage');
assert.equal(latestLayer('gfm:exclusion_mask').options.pane,'observedMaskPane');
assert.equal(latestLayer('gfm:exclusion_mask').options.opacity,.45);
assert.equal(latestLayer('gfm:exclusion_mask').options.maxZoom,18);
assert.equal(latestLayer('gfm:exclusion_mask').options.time,'2026-10-12T00:00:00Z/2026-10-12T23:59:59Z');
assert.equal(latestLayer('gfm:exclusion_mask').added,undefined,'mask starts opt-in');
assert.equal(observed.getState().exclusionEnabled,false);
el('layer-observed-exclusion').checked=true;el('layer-observed-exclusion').onchange();
assert.equal(latestLayer('gfm:exclusion_mask').added,true);
assert.equal(observed.getState().exclusionEnabled,true);
const oldLayer=latestLayer('flood'),oldCoverage=latestLayer('coverage'),oldMask=latestLayer('gfm:exclusion_mask'),oldPoint=points[0];
oldLayer.emit('loading');
assert.equal(observed.getState().tiles,'loading');
el('observed-date').onchange({target:{value:'2026-10-11'}});
const newLayer=latestLayer('flood'),newCoverage=latestLayer('coverage'),newMask=latestLayer('gfm:exclusion_mask'),newPoint=points[1];
assert.equal(oldLayer.removed,true);
assert.equal(oldMask.removed,true);
assert.equal(newMask.added,true,'date changes retain an enabled quality mask');
assert.equal(newCoverage.added,true,'date changes retain scene coverage selection');
assert.equal(observed.getState().tiles,'not loaded');
oldLayer.emit('tileerror');oldLayer.emit('load');
oldMask.emit('tileerror');oldMask.emit('load');
oldCoverage.emit('tileerror');oldCoverage.emit('load');
assert.equal(observed.getState().tiles,'not loaded','removed old layer callbacks cannot change current status');
assert.equal(observed.getState().exclusionTiles,'not loaded','removed mask callbacks cannot change current status');
assert.equal(observed.getState().coverageTiles,'not loaded','removed coverage callbacks cannot change current status');
oldPoint.resolve({coverage:'observed',pixel:{classification:'flood-detected'},note:'Old date response'});
await settle();
assert.match(el('observed-point').textContent,/2026-10-11/);
assert.equal(el('observed-point').innerHTML,'','old point response cannot overwrite a newer observation date');
newLayer.emit('loading');newLayer.emit('tileerror');newLayer.emit('load');
assert.equal(observed.getState().tiles,'some tiles unavailable','tile errors survive overall completion');
newMask.emit('loading');newMask.emit('tileerror');newMask.emit('load');
assert.equal(observed.getState().exclusionTiles,'some tiles unavailable','unknown quality-mask errors survive overall completion');
assert.match(el('observed-status').innerHTML,/exclusion mask some tiles unavailable/);
newCoverage.emit('loading');newCoverage.emit('load');
assert.equal(observed.getState().coverageTiles,'source tiles loaded');
newPoint.resolve({coverage:'observed',pixel:{classification:'unknown'},note:'Cloud or radar masks leave the water state unknown.'});
await settle();
assert.match(el('observed-point').innerHTML,/Water status unknown/);
assert.doesNotMatch(el('observed-point').innerHTML,/Satellite flood classification detected/,'coverage does not imply floodwater');

// A city switch must invalidate a pending map-point result.
const mapPointPromise=observed.inspect(2.5,45.8);
const oldMapPoint=points.at(-1);
observed.selectCity(1);
const newCityPoint=points.at(-1);
oldMapPoint.resolve({coverage:'observed',pixel:{classification:'flood-detected'},note:'Old map point'});
await mapPointPromise;await settle();
assert.match(el('observed-point').textContent,/9\.56240, 44\.07700/);
newCityPoint.resolve({coverage:'none',pixel:{classification:'unknown'},note:'No recent scene at city'});
await settle();
assert.match(el('observed-point').innerHTML,/No recent radar scene returned/);

// Product selection invalidates late point requests even when the new product
// has no available acquisition date and therefore exits paint early.
const pendingPromise=observed.inspect(2.0469,45.3182),pendingPoint=points.at(-1);
metadata=fixture();metadata.radar.availableDates=[];metadata.radar.timeDefault='';metadata.nasa.available=false;
await observed.refresh();
assert.match(el('observed-point').textContent,/unavailable for this selection/);
assert.match(el('observed-status').textContent,/dated coverage is unavailable/);
pendingPoint.resolve({coverage:'observed',pixel:{classification:'flood-detected'},note:'Expired UI request'});
await pendingPromise;await settle();
assert.match(el('observed-point').textContent,/unavailable for this selection/);
assert.equal(el('observed-point').innerHTML,'');

metadata=fixture();await observed.refresh();
const sourcePoint=points.at(-1);
el('observed-source').onchange({target:{value:'nasa'}});
sourcePoint.resolve({coverage:'observed',pixel:{classification:'flood-detected'},note:'Old radar product'});
await settle();
assert.match(el('observed-point').textContent,/No point-level flood conclusion/);
assert.match(el('observed-status').innerHTML,/3-day composite ending 2026-10-12/);
assert.equal(observed.getState().source,'nasa');
assert.equal(el('exclusion-toggle').hidden,true,'NASA has a separate insufficient-observation class and does not display radar-mask control');
assert.equal(observed.getState().exclusionEnabled,false,'a preserved radar-mask toggle is inactive on NASA');
assert.equal(el('layer-observed-exclusion').checked,true,'product switches preserve the user radar quality preference');
assert.equal(observed.showRadarDate('2099-10-12'),false);
assert.equal(observed.showRadarDate('2026-02-30'),false);
assert.equal(observed.getState().source,'nasa','failed scene matching does not change the current product');
assert.equal(observed.getState().date,'2026-10-12','failed scene matching does not change the current date');
el('observed-date').onchange({target:{value:'2026-10-13'}});
assert.match(el('observed-status').innerHTML,/current day, coverage incomplete/);
now+=3*3600000;observed.checkFreshness();
assert.equal(observed.getState().stale,true);
assert.match(el('observed-status').innerHTML,/STALE/);
failMetadata=true;await observed.refresh();
assert.match(el('observed-status').innerHTML,/Observation refresh failed/);
assert.equal(observed.getState().metadata.nasa.available,true,'failed refresh retains explicitly stale observations');

// Dated radar selection uses the source-advertised catalog date, never a raw
// Sentinel-1 scene date alone. The selected point remains unknown on an API
// failure, a malformed result, or no scene coverage.
failMetadata=false;metadata=fixture();await observed.refresh();
assert.equal(observed.showRadarDate('2026-10-10'),true);
assert.equal(observed.getState().source,'radar');
assert.equal(observed.getState().datePinned,true);
assert.equal(observed.getState().date,'2026-10-10');
assert.match(el('observed-status').innerHTML,/3 days old; flood conditions may have changed/);
assert.equal(el('exclusion-toggle').hidden,false);
assert.equal(latestLayer('gfm:exclusion_mask').added,true,'programmatic scene-date selection retains quality preferences');
const unavailPoint=points.at(-1);
unavailPoint.resolve({available:false,coverage:'unavailable',pixel:{classification:'flood-detected'},note:'Coverage service temporarily unavailable.'});
await settle();
assert.match(el('observed-point').innerHTML,/Water status unknown · Radar coverage query unavailable/);
assert.doesNotMatch(el('observed-point').innerHTML,/Satellite flood classification detected/,'unavailable metadata cannot imply flooding');
const nullPromise=observed.inspect(2.0469,45.3182);points.at(-1).resolve(null);await nullPromise;
assert.match(el('observed-point').innerHTML,/Water status unknown · Radar coverage query unavailable/,'null JSON remains an explicit unknown');
const noScenePromise=observed.inspect(2.0469,45.3182);points.at(-1).resolve({available:true,coverage:'no-recent-scene',pixel:{classification:'flood-detected'}});await noScenePromise;
assert.doesNotMatch(el('observed-point').innerHTML,/Satellite flood classification detected/,'a pixel classification without scene coverage is not presented as floodwater');
const referencePromise=observed.inspect(2.0469,45.3182);points.at(-1).resolve({available:true,coverage:'observed',pixel:{classification:'reference-water'}});await referencePromise;
assert.match(el('observed-point').innerHTML,/Reference surface water · not evidence of new flooding/);
const dryPromise=observed.inspect(2.0469,45.3182);points.at(-1).resolve({available:true,coverage:'observed',pixel:{classification:'no-flood-detected'}});await dryPromise;
assert.match(el('observed-point').innerHTML,/No flood water classified at this point · verify locally/);
el('layer-observed-exclusion').checked=false;el('layer-observed-exclusion').onchange();
assert.equal(latestLayer('gfm:exclusion_mask').removed,true);
assert.equal(observed.getState().exclusionEnabled,false);
assert.equal(latestLayer('flood').removed,undefined,'disabling the quality mask does not remove detected-water layer');

// Auto-follow the latest completed product after UTC rollover while retaining
// a dated observation the user explicitly chose for historical inspection.
failMetadata=false;metadata=fixture();await observed.refresh();
el('observed-source').onchange({target:{value:'radar'}});
assert.equal(observed.getState().date,'2026-10-12');
assert.equal(observed.getState().datePinned,false,'source change restores automatic date selection');
now=Date.parse('2026-10-14T00:15:00Z');
metadata=fixture();
for(const product of [metadata.radar,metadata.nasa]) {
  product.availableDates=['2026-10-11','2026-10-12','2026-10-13','2026-10-14'];
  product.timeDefault='2026-10-13';product.sourceTimeDefault='2026-10-14';
}
await observed.refresh();
assert.equal(observed.getState().date,'2026-10-13','un-pinned selection advances to the new latest completed date after UTC rollover');
assert.equal(observed.getState().datePinned,false);
assert.doesNotMatch(el('observed-status').innerHTML,/current day, coverage incomplete/,'completed-date default avoids an incomplete current-day selection');
el('observed-date').onchange({target:{value:'2026-10-11'}});
assert.equal(observed.getState().datePinned,true);
now=Date.parse('2026-10-15T00:30:00Z');
metadata.fetchedAt=new FakeDate().toISOString();
for(const product of [metadata.radar,metadata.nasa]) {
  product.availableDates.push('2026-10-15');
  product.timeDefault='2026-10-14';product.sourceTimeDefault='2026-10-15';
}
await observed.refresh();
assert.equal(observed.getState().date,'2026-10-11','explicit historical date survives a later refresh and UTC rollover');
assert.equal(observed.getState().datePinned,true);
assert.match(el('observed-status').innerHTML,/Radar acquisitions on 2026-10-11 UTC/);
metadata.radar.availableDates=['2026-10-13','2026-10-14','2026-10-15'];
await observed.refresh();
assert.equal(observed.getState().date,'2026-10-14','an expired catalog date falls back to the current completed product');
assert.equal(observed.getState().datePinned,false,'removed historical dates release the user pin');
el('observed-date').onchange({target:{value:'2026-10-13'}});
assert.equal(observed.getState().datePinned,true);
el('observed-source').onchange({target:{value:'nasa'}});
assert.equal(observed.getState().date,'2026-10-14','changing product applies the new product default');
assert.equal(observed.getState().datePinned,false,'changing product clears a historical pin');
metadata.radar.available=false;await observed.refresh();
assert.equal(observed.showRadarDate('2026-10-14'),false,'an unavailable radar product cannot be selected despite cached catalog dates');
assert.equal(observed.getState().source,'nasa');
assert.equal(observed.getState().date,'2026-10-14');
metadata=fixture();metadata.nasa.timeDefault='2026-10-13';await observed.refresh();
el('observed-latest').onclick();
assert.equal(observed.getState().date,'2026-10-13','latest follows the last completed available date when the preferred source date is incomplete or old');
console.log('Observed UI checks passed: point/date/product races, unknown/reference classifications, mask pane/toggle/date preservation, independent tile errors, guarded radar date selection, stale/partial/historical labels, UTC rollover and malformed metadata.');
