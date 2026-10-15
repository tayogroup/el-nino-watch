import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source=await fs.readFile(new URL('./somalia-flood-watch/dist/rankings.js',import.meta.url),'utf8');
function harness(withRoot=true){
  const root={innerHTML:'',onclick:null},document={getElementById:id=>withRoot&&id==='city-rankings-root'?root:null};
  const context=vm.createContext({window:{document},document,Date,console});vm.runInContext(source,context);
  return {api:context.window.CityRankings,root};
}
const api=harness().api,now='2026-10-14T09:00:00Z',today='2026-10-14';
const dates=Array.from({length:8},(_,i)=>new Date(Date.parse(today+'T00:00:00Z')+i*86400000).toISOString().slice(0,10));
const cities=[['Mogadishu','Banaadir'],['Galkayo','Mudug'],['Baidoa','Bay'],['Jowhar','Middle Shabelle'],['Hargeisa','Woqooyi Galbeed'],['Bosaso','Bari']];
const report=(id,cityId,overrides={})=>({id,cityId,category:'flood',observedAt:'2026-10-14T08:00:00Z',...overrides});
const rows=values=>dates.map((date,i)=>({date,rain:values[i]??0}));
function input(overrides={}){
  return {cities,now,floodMode:'indicators',weatherFeed:{data:[{}],lastSuccess:now},weatherRowsByCity:[rows([5,20,10,0,0,0,0,0]),rows([20,30,0,0,0,0,0,0]),rows([10,5,5,5,5,5,5,5]),rows([10,0,0,0,0,0,0,0]),rows([0,0,0,0,0,0,0,0]),rows([3,3,3,3,3,3,3,3])],communityFeed:{data:{reports:[],cityId:null,total:0,truncated:false},scope:'all',cityId:null,lastSuccess:now},...overrides};
}

test('EAT date drives today; next seven days strictly exclude today at UTC midnight boundary',()=>{
  const model=api.build(input({now:'2026-10-13T21:00:00Z'}));
  assert.equal(model.today,'2026-10-14');assert.deepEqual(Array.from(model.weekDates),dates.slice(1));
  const before=api.build(input({now:'2026-10-13T20:59:59Z'}));assert.equal(before.today,'2026-10-13');assert.equal(before.weekDates[0],'2026-10-14');
  const rollover=api.build(input({now:'2026-12-31T21:00:00Z'}));assert.equal(rollover.today,'2027-01-01');assert.equal(rollover.weekDates.at(-1),'2027-01-08');
});

test('rainfall ranks full-day forecast and complete seven-day sums; five rows maximum with alphabetical ties',()=>{
  const model=api.build(input());
  assert.deepEqual(Array.from(model.rainToday.rows,r=>r.name),['Galkayo','Baidoa','Jowhar','Mogadishu','Bosaso']);
  assert.equal(model.rainToday.coverage,6);assert.equal(model.rainToday.rows[0].rain,20);
  assert.deepEqual(Array.from(model.rainWeek.rows,r=>r.name),['Baidoa','Galkayo','Mogadishu','Bosaso','Hargeisa']);
  assert.equal(model.rainWeek.rows[0].total,35);assert.equal(model.rainWeek.rows[1].total,30);assert.equal(model.rainWeek.rows[2].total,30);
  assert.match(api.html(model),/Forecast full-day rainfall/);assert.match(api.html(model),/not rainfall already observed today/);
});

test('source date keys align unordered rows; selected-day UI does not change today rankings',()=>{
  const supplied=input(),normal=api.build(supplied),shuffled=api.build({...supplied,selectedDate:'2026-10-21',weatherRowsByCity:supplied.weatherRowsByCity.map(series=>series.slice().reverse())});
  assert.deepEqual(Array.from(shuffled.rainToday.rows,r=>[r.name,r.rain]),Array.from(normal.rainToday.rows,r=>[r.name,r.rain]));
  assert.deepEqual(Array.from(shuffled.rainWeek.rows,r=>[r.name,r.total]),Array.from(normal.rainWeek.rows,r=>[r.name,r.total]));
});

test('missing, null, negative, strings and infinite rain are excluded, genuine zero is retained',()=>{
  const supplied=input();supplied.weatherRowsByCity[0][0].rain=null;supplied.weatherRowsByCity[1][0].rain=-1;supplied.weatherRowsByCity[2][0].rain='10';supplied.weatherRowsByCity[3][0].rain=Infinity;
  const model=api.build(supplied);assert.equal(model.rainToday.coverage,2);assert.deepEqual(Array.from(model.rainToday.rows,r=>r.rain),[3,0]);
  const missing=api.build(input({weatherRowsByCity:[]}));assert.equal(missing.rainToday.coverage,0);assert.match(api.html(missing),/Missing rainfall is unknown, not zero/);
});

test('partial future week is excluded from rainfall sums and flood watch; no missing values become zero',()=>{
  const supplied=input();supplied.weatherRowsByCity[1][5].rain=null;supplied.weatherRowsByCity[0].splice(4,1);
  const model=api.build(supplied);assert.equal(model.rainWeek.coverage,4);assert.ok(!model.rainWeek.rows.some(r=>r.name==='Galkayo'||r.name==='Mogadishu'));assert.equal(model.floodWeek.rows.length,0);
  const html=api.html(model);assert.match(html,/4\/6/);assert.match(html,/No complete city forecast reaches/);
});

test('overflowing sums cannot become comparable seven-day totals',()=>{
  const supplied=input();supplied.weatherRowsByCity[0]=rows(Array(8).fill(Number.MAX_VALUE));
  const model=api.build(supplied);assert.equal(model.rainWeek.coverage,5);assert.ok(!model.rainWeek.rows.some(r=>r.name==='Mogadishu'));assert.ok(!api.html(model).includes('width:NaN'));
});

test('weather outages suppress data without a source; retained data is visibly stale with genuine timestamps and errors',()=>{
  const missing=api.build(input({weatherFeed:{data:null,loading:false,error:'HTTP 503'}}));assert.equal(missing.rainToday.rows.length,0);assert.equal(missing.rainWeek.coverage,0);assert.equal(missing.weather.stale,false);assert.match(api.html(missing),/Weather forecast · Unavailable/);assert.match(api.html(missing),/HTTP 503/);
  const retained=api.build(input({weatherFeed:{data:[{}],lastSuccess:'2026-10-14T07:00:00Z',error:'Service overloaded'}}));assert.equal(retained.rainToday.rows.length,5);assert.equal(retained.weather.stale,true);assert.match(api.html(retained),/Last known data · stale/);assert.match(api.html(retained),/14 Oct 2026, 10:00 EAT/);assert.match(api.html(retained),/Service overloaded/);
  assert.equal(api.build(input({weatherFeed:{data:[{}],lastSuccess:'2026-10-14T06:59:59Z'}})).weather.stale,true);
  assert.equal(api.build(input({weatherFeed:{data:[{}]}})).weather.stale,true);assert.match(api.html(input({weatherFeed:{data:null,loading:true}})),/Connecting…/);
  assert.match(api.html(input({weatherFeed:{data:[{}],lastSuccess:now,loading:true}})),/Updating · previous retrieval shown/);
});

test('rainfall watch screen ranks peak, then screen-day count, then total, then name',()=>{
  const series=[rows([0,20,10,0,0,0,0,0]),rows([0,20,10,1,0,0,0,0]),rows([0,20,10,1,0,0,0,0]),rows([0,20,0,0,0,0,0,0]),rows([0,21,0,0,0,0,0,0]),rows([0,9.9,9.9,9.9,9.9,9.9,9.9,9.9])];
  const model=api.build(input({weatherRowsByCity:series}));
  assert.deepEqual(Array.from(model.floodWeek.rows,r=>r.name),['Hargeisa','Baidoa','Galkayo','Mogadishu','Jowhar']);assert.equal(model.floodWeek.eligibleCities,5);assert.equal(model.floodWeek.rows[1].watchDays,2);assert.equal(model.floodWeek.rows[1].total,31);
  const html=api.html(model);assert.match(html,/Rainfall-based planning priorities/);assert.match(html,/≥10 mm\/day/);assert.match(html,/Not predicted inundation or calibrated flood probability/);assert.ok(!model.floodWeek.rows.some(r=>r.name==='Bosaso'));
});

test('today report activity uses distinct flood IDs, known cities, EAT observations and no future records',()=>{
  const reports=[report('m1','mogadishu'),report('m2','mogadishu'),report('m1','mogadishu'),report('b1','baidoa'),report('g1','galkayo'),report('rain','galkayo',{category:'rain'}),report('damage','galkayo',{category:'damage',deaths:10}),report('future','galkayo',{observedAt:'2026-10-14T10:00:00Z'}),report('yesterday','galkayo',{observedAt:'2026-10-13T20:59:59Z'}),report('startday','jowhar',{observedAt:'2026-10-13T21:00:00Z'}),report('extra','hobyo'),report('invalid','baidoa',{observedAt:'not-a-date'}),report('local','baidoa',{observedAt:'2026-10-14T11:00:00'}),report('bare','baidoa',{observedAt:'2026-10-14'}),report('','baidoa')];
  const model=api.build(input({communityFeed:{data:{reports,cityId:null,total:reports.length},cityId:null,lastSuccess:now}}));
  assert.equal(model.floodToday.eligibleReports,5);assert.deepEqual(Array.from(model.floodToday.rows,r=>[r.name,r.count]),[['Mogadishu',2],['Baidoa',1],['Galkayo',1],['Jowhar',1]]);
  assert.equal(model.floodToday.rows.length,4);assert.match(api.html(model),/Counts measure submitted report activity, not flood severity/);assert.match(api.html(model),/Community report activity · unverified/);
});

test('all-city report scope is required and misleading selected-city or wrong-category feeds are rejected',()=>{
  const reports=[report('one','galkayo')];
  for(const feed of [{data:{reports,cityId:'galkayo'},cityId:'galkayo',scope:'city'},{data:{reports},scope:'city',cityId:null},{data:{reports},cityId:'galkayo',scope:'all'},{data:{reports}}]) {
    const model=api.build(input({communityFeed:{...feed,lastSuccess:now}}));assert.equal(model.floodToday.rows.length,0);assert.equal(model.floodToday.scopeValid,false);assert.match(api.html(model),/An all-city report feed is required/);
  }
  assert.equal(api.build(input({communityFeed:{data:{reports},scope:'all',lastSuccess:now}})).floodToday.rows.length,1);
  const filtered=api.build(input({communityFeed:{data:{reports},scope:'all',category:'rain',lastSuccess:now}}));assert.equal(filtered.floodToday.rows.length,0);assert.equal(filtered.floodToday.categoryValid,false);
});

test('empty reports do not create zero-city ranks; stale/outage and truncated feeds remain explicit',()=>{
  const empty=api.build(input());assert.equal(empty.floodToday.rows.length,0);assert.match(api.html(empty),/No eligible flood reports observed today/);
  const stale=api.build(input({communityFeed:{data:{reports:[report('one','galkayo')],cityId:null},lastSuccess:now,error:'Offline',cityId:null}}));assert.equal(stale.floodToday.rows.length,1);assert.equal(stale.floodToday.stale,true);assert.match(api.html(stale),/Offline/);
  const unavailable=api.build(input({communityFeed:{data:null,cityId:null,error:'Report source failed'}}));assert.equal(unavailable.floodToday.available,false);assert.equal(unavailable.floodToday.rows.length,0);
  for(const detail of [{total:20,truncated:false},{total:1,truncated:true}]){
    const model=api.build(input({communityFeed:{data:{reports:[report('one','galkayo')],cityId:null,...detail},lastSuccess:now,cityId:null}}));
    assert.equal(model.floodToday.truncated,true);assert.equal(model.floodToday.comparisonAvailable,false);assert.equal(model.floodToday.rows.length,0);assert.match(api.html(model),/Incomplete report feed; city totals cannot be compared/);assert.match(api.html(model),/ranking is withheld/);
  }
});

test('verified-only is the default and leaves both flood rankings unavailable without proxy ranks',()=>{
  const supplied=input();delete supplied.floodMode;
  const model=api.build(supplied),html=api.html(model);assert.equal(model.floodMode,'verified');assert.match(html,/Verified flooded-area ranking/);assert.match(html,/Verified flood forecast/);assert.match(html,/calibrated city flood-extent or severity forecast is not available/);assert.ok(!html.includes('data-ranking-kind="watch"'));assert.ok(!html.includes('data-ranking-kind="reports"'));assert.match(html,/data-ranking-map/);
});

test('city duplication never generates duplicate ranks or more than the original thirty city slots',()=>{
  const supplied=input({cities:[...cities,cities[0],...Array.from({length:30},(_,i)=>['Other '+i,''])],weatherRowsByCity:Array.from({length:40},()=>rows([1,2,2,2,2,2,2,2]))});
  const model=api.build(supplied);assert.equal(model.totalCities,29);assert.equal(new Set(Array.from(model.rainToday.rows,r=>r.id)).size,model.rainToday.rows.length);assert.ok(model.rainToday.rows.every(r=>r.index<30));
});

test('all source text and city names are escaped and rank binding validates index/kind pairs',()=>{
  const {api,root}=harness();const calls=[],maps=[],supplied=input({cities:[['<img src=x onerror=alert(1)>','<script>'],...cities.slice(1)],weatherFeed:{data:[{}],lastSuccess:now,error:'<script>bad()</script>'},onSelectCity:(...args)=>calls.push(args),onOpenMap:()=>maps.push(true)});
  const model=api.render(supplied);assert.equal(root.innerHTML,api.html(model));assert.ok(!root.innerHTML.includes('<img src=x'));assert.ok(!root.innerHTML.includes('<script>bad'));assert.match(root.innerHTML,/&lt;img src=x/);assert.match(root.innerHTML,/&lt;script&gt;bad/);assert.ok(!root.innerHTML.includes(' data-city='));
  const click=(index,kind)=>root.onclick({target:{closest:selector=>selector==='[data-ranking-city]'?{dataset:{rankingCity:String(index),rankingKind:kind}}:null}});
  click(1,'rain-today');click(2,'rain-week');click(1,'watch');click(1,'reports');click(99,'watch');click(0,'unknown');
  assert.deepEqual(calls,[[1,'rain-today'],[2,'rain-week'],[1,'watch']]);
  let prevented=false;root.onclick({target:{closest:selector=>selector==='[data-ranking-map]'?{}:null},preventDefault(){prevented=true;}});assert.equal(maps.length,1);assert.equal(prevented,true);
  assert.equal(harness(false).api.render(supplied).kind,'city-rankings');
});

test('each non-empty forecast top-5 list carries a share row with its cities; an empty list carries none',async()=>{
  const share=await fs.readFile(new URL('./somalia-flood-watch/dist/share.js',import.meta.url),'utf8');
  const document={getElementById:()=>null,addEventListener(){}};
  const context=vm.createContext({window:{document},document,Date,console,URL,URLSearchParams});
  vm.runInContext(share,context);vm.runInContext(source,context);
  const decode=value=>value.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
  const texts=html=>[...html.matchAll(/data-share-lines="([^"]+)"/g)].map(match=>context.window.SiteShare.textOf(JSON.parse(decode(match[1]))));
  const shared=texts(context.window.CityRankings.html(input()));
  assert.equal(shared.length,3,'Rainfall today, Rainfall next 7 days and Flood watch');
  assert.match(shared[0],/^El Nino Watch · Rainfall today · /);assert.match(shared[0],/\n1\. Galkayo — 20\.0 mm\n/);
  assert.match(shared[1],/^El Nino Watch · Rainfall · next 7 days · /);
  assert.match(shared[2],/^El Nino Watch · Flood watch · next 7 days · /);assert.match(shared[2],/mm\/day/);assert.match(shared[2],/not a flood forecast or an official warning\.$/);
  for(const text of shared)assert.ok(text.split('\n').filter(line=>/^\d\. /.test(line)).length<=5,'Five cities at most');
  assert.equal(texts(context.window.CityRankings.html(input({weatherRowsByCity:[]}))).length,0,'No list, no share row');
});

test('the Flooding today list shares its cities and report counts, with the unverified note; a truncated feed shares nothing',async()=>{
  const share=await fs.readFile(new URL('./somalia-flood-watch/dist/share.js',import.meta.url),'utf8');
  const document={getElementById:()=>null,addEventListener(){}};
  const context=vm.createContext({window:{document},document,Date,console,URL,URLSearchParams});
  vm.runInContext(share,context);vm.runInContext(source,context);
  const decode=value=>value.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
  const texts=html=>[...html.matchAll(/data-share-lines="([^"]+)"/g)].map(match=>context.window.SiteShare.textOf(JSON.parse(decode(match[1]))));
  const reports=[report('m1','mogadishu'),report('m2','mogadishu'),report('b1','baidoa')];
  const feed=truncated=>({communityFeed:{data:{reports,cityId:null,total:reports.length,truncated},scope:'all',cityId:null,lastSuccess:now}});
  const shared=texts(context.window.CityRankings.html(input(feed(false))));
  assert.equal(shared.length,4,'all four top-5 lists can be shared');
  const flooding=shared.find(text=>text.startsWith('El Nino Watch · Flooding today · '));
  assert.ok(flooding);assert.match(flooding,/\n1\. Mogadishu — 2 reports\n2\. Baidoa — 1 report\n/);
  assert.match(flooding,/Unverified community reports: counts show report activity, not flood severity or an official warning\.$/);
  assert.equal(texts(context.window.CityRankings.html(input(feed(true)))).some(text=>text.includes('Flooding today')),false,'a withheld ranking is not shared');
});
