import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const dist = new URL('./somalia-flood-watch/dist/', import.meta.url);
const [terrainSource, mapSource, html, configText, citiesText] = await Promise.all(['terrain.js','map.js','index.html','hazard-sources.json','cities.json'].map(name => fs.readFile(new URL(name,dist),'utf8')));
const config = JSON.parse(configText), cities = JSON.parse(citiesText);
function harness({deferConfig=false, pointFailure=false}={}) {
  const elements = new Map([...html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)].map(match => [match[1], {innerHTML:'',textContent:'',value:'',checked:/\bchecked(?:\s|>|=)/.test(match[0]),disabled:false,style:{}}]));
  for(const id of ['terrain-panel','terrain-summary','terrain-city','terrain-focus','terrain-inspect','terrain-status','terrain-evidence']) if(!elements.has(id)) elements.set(id,{innerHTML:'',textContent:'',value:''});
  let scrolls=0;elements.get('map').scrollIntoView=()=>{scrolls++;};
  const requests=[], layers=[], selections=[];
  const map={panes:{},currentLayers:new Set(),events:{},setView(center,zoom){this.center=center;this.zoom=zoom;return this;},createPane(name){this.panes[name]={style:{}};},getPane(name){return this.panes[name];},on(name,fn){this.events[name]=fn;return this;},removeLayer(layer){this.currentLayers.delete(layer);},fitBounds(){return this;},flyTo(center,zoom){this.center=center;this.zoom=zoom;return this;}};
  const layer=(type,settings)=>{const result={type,settings,events:{},addTo(target){target.currentLayers.add(this);return this;},on(name,fn){this.events[name]=fn;return this;},bindTooltip(){return this;},bindPopup(){return this;},setStyle(){return this;}};layers.push(result);return result;};
  const L={map:()=>map,circleMarker:(coordinates,settings)=>layer('marker',{coordinates,...settings}),tileLayer:()=>layer('base',{})};
  L.tileLayer.wms=(url,settings)=>layer('wms',settings);
  const document={getElementById:id=>elements.get(id)||null},window={L};
  let release;
  const pendingConfig=deferConfig?new Promise(resolve=>{release=resolve;}):null;
  const context=vm.createContext({window,document,L,console,URL,Date,Number,String,Object,Array,Set,Map,location:{protocol:'http:'},AbortSignal:{timeout:()=>undefined},fetch:async url=>{
    requests.push(String(url));
    if(url==='hazard-sources.json'){if(pendingConfig)await pendingConfig;return {ok:true,json:async()=>structuredClone(config)};}
    if(pointFailure)throw Error('fixture source outage');
    return {ok:true,json:async()=>({elevationM:61,susceptibility:{value:1,label:'Low / not indicated',sourceUrl:config.layers.susceptibility.sourceUrl},historical:{intersects:false},errors:[]})};
  }});
  vm.runInContext(terrainSource,context);vm.runInContext(mapSource,context);
  return {terrain:window.FloodTerrain,api:window.FloodExplorer,elements,map,layers,requests,selections,get:id=>elements.get(id),get scrolls(){return scrolls;},release:()=>release?.(),init:()=>window.FloodExplorer.init({cities,onSelectCity:index=>selections.push(index)})};
}

test('terrain evidence preserves no-data and does not infer susceptibility from absolute elevation',()=>{
  const h=harness();
  const missing=h.terrain.pointEvidence({elevationM:-1,susceptibility:{value:null,label:'No mapped class / no data'},historical:{intersects:null}});
  assert.equal(missing.classValue,null);assert.equal(missing.known,false);assert.equal(missing.elevationM,-1);assert.match(missing.description,/No terrain class is inferred/);assert.equal(missing.history,'Historical query unavailable');
  const invalid=h.terrain.pointEvidence({elevationM:NaN,susceptibility:{value:255}});assert.equal(invalid.elevationM,null);assert.equal(invalid.classValue,null);
  const low=h.terrain.pointEvidence({elevationM:61,susceptibility:{value:1},historical:{intersects:false}});assert.equal(low.known,true);assert.equal(low.high,false);assert.match(low.description,/does not establish.*safe/);assert.match(low.history,/flooding is still possible/);
  const high=h.terrain.pointEvidence({elevationM:500,susceptibility:{value:4},historical:{intersects:true}});assert.equal(high.high,true);assert.match(high.description,/higher terrain susceptibility/);assert.match(high.history,/mapped historical/);
});

test('selected cities have drainage context without an invented city-wide class',async()=>{
  const h=harness();await h.init();h.api.update({cityIndex:6,cityStates:[]});
  assert.equal(h.get('terrain-city').value,'6');assert.match(h.get('terrain-summary').innerHTML,/Beledweyne/);assert.match(h.get('terrain-summary').innerHTML,/River corridor/);assert.match(h.get('terrain-summary').innerHTML,/Upstream rainfall/);assert.match(h.get('terrain-summary').innerHTML,/neither layer shows flooding now/);
  h.get('terrain-city').onchange({target:{value:'0'}});assert.deepEqual(h.selections,[0]);assert.match(h.get('terrain-summary').innerHTML,/Coastal drainage/);assert.equal(h.get('terrain-city').value,'0');assert.match(h.get('terrain-evidence').innerHTML,/Inspect a point/);
});

test('show-terrain keeps a pending layer intent during source loading and preserves observed-water choice',async()=>{
  const h=harness({deferConfig:true});h.get('layer-observed') && (h.get('layer-observed').checked=true);
  const start=h.init();h.api.showTerrain(7);assert.equal(h.get('layer-susceptibility').checked,true);assert.equal(h.get('layer-history').checked,true);h.release();await start;
  for(const key of ['susceptibility','history']){const overlay=h.layers.find(item=>item.type==='wms'&&item.settings.layers===config.layers[key].name);assert.ok(h.map.currentLayers.has(overlay));}
  if(h.get('layer-observed'))assert.equal(h.get('layer-observed').checked,true);
  assert.equal(h.map.zoom,11);assert.deepEqual(Array.from(h.map.center),[2.7809,45.5005]);assert.ok(h.scrolls>=1);
  const susceptibility=h.layers.find(item=>item.settings.layers===config.layers.susceptibility.name);susceptibility.events.tileerror();assert.match(h.get('terrain-status').textContent,/unavailable/);
});

test('city-centre inspector queries exact coordinates and labels the result as one point',async()=>{
  const h=harness();await h.init();h.api.update({cityIndex:0,cityStates:[]});h.get('terrain-inspect').onclick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(h.requests.includes('/api/hazard-point?lat=2.0469&lon=45.3182'));
  const evidence=h.get('terrain-evidence').innerHTML;
  assert.match(evidence,/Mogadishu city centre · one sampled point/);assert.match(evidence,/61\.0 m above sea level/);assert.match(evidence,/Low \/ not indicated/);assert.match(evidence,/does not establish.*safe/);
  h.api.clearPoint();assert.match(h.get('terrain-evidence').innerHTML,/Inspect a point/);
});

test('point-source failures are shown as unknown, and point content is escaped',async()=>{
  const h=harness({pointFailure:true});await h.init();await h.api.inspect(4.7,45.2);
  assert.match(h.get('terrain-evidence').innerHTML,/Mapped terrain class unavailable/);assert.match(h.get('terrain-evidence').innerHTML,/fixture source outage/);assert.match(h.get('terrain-evidence').innerHTML,/Historical query unavailable/);
  h.terrain.point({lat:4.7,lon:45.2,susceptibility:{value:null},errors:['<script>bad</script>']});assert.match(h.get('terrain-evidence').innerHTML,/&lt;script&gt;bad/);assert.ok(!h.get('terrain-evidence').innerHTML.includes('<script>'));
});
