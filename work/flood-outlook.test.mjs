import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('./somalia-flood-watch/dist/flood-outlook.js',import.meta.url),'utf8');
function harness() {
  const container={innerHTML:'',onclick:null},document={getElementById:id=>id==='mayor-flood-outlook'?container:null};
  const context=vm.createContext({window:{document},document,console,URL,Date,setTimeout});
  vm.runInContext(source,context);return {api:context.window.FloodOutlook,container};
}
const api=harness().api, now='2026-10-13T09:00:00Z',dates=Array.from({length:14},(_,index)=>new Date(Date.parse('2026-10-13T00:00:00Z')+index*86400000).toISOString().slice(0,10));
function input(overrides={}) {
  return {cityName:'Galkayo',region:'Mudug',now,days:dates,weatherRows:dates.map((date,index)=>({date,rain:index===0?0:index===1?10:index===2?25:5,probability:60,maxTemperature:31})),riverRows:dates.map((date,index)=>({date,discharge:100+index})),weatherFeed:{data:{daily:{}},lastSuccess:now},riverFeed:{data:{daily:{}},lastSuccess:now},station:null,stationFeed:{data:null},...overrides};
}

test('two weeks always contain fourteen consecutive EAT dates including midnight and month rollover',()=>{
  const first=api.build(input());assert.equal(first.daily.length,14);assert.deepEqual(Array.from(first.dates),dates);
  const rollover=api.build(input({now:'2026-10-31T21:15:00Z',days:['2026-10-31','not-a-date']}));
  assert.equal(rollover.today,'2026-11-01');assert.equal(rollover.dates[0],'2026-11-01');assert.equal(rollover.dates.at(-1),'2026-11-14');
});

test('rainfall and river records match calendar dates rather than positions',()=>{
  const model=api.build(input({weatherRows:[{date:dates[2],rain:18},{date:dates[0],rain:9}],riverRows:[{date:dates[6],discharge:270},{date:dates[0],discharge:88}]}));
  assert.equal(model.daily[0].rain,9);assert.equal(model.daily[1].rain,null);assert.equal(model.daily[2].rain,18);
  assert.equal(model.daily[0].discharge,88);assert.equal(model.daily[1].discharge,null);assert.equal(model.daily[6].discharge,270);
  assert.equal(model.weeks[0].rainTotal,null);assert.equal(model.weeks[0].peakDischarge,null);
});

test('invalid, missing and unavailable sources remain unknown without converting zero values',()=>{
  const rows=[{date:dates[0],rain:0,probability:0,maxTemperature:0},{date:dates[1],rain:-2,probability:101,maxTemperature:NaN},{date:dates[2],rain:'25',probability:null},{date:'2026-02-30',rain:50}];
  const model=api.build(input({weatherRows:rows,riverRows:[{date:dates[0],discharge:0},{date:dates[1],discharge:-5},{date:dates[2],discharge:'90'}]}));
  assert.equal(model.daily[0].rain,0);assert.equal(model.daily[0].probability,0);assert.equal(model.daily[0].maxTemperature,0);assert.equal(model.daily[0].discharge,0);
  assert.equal(model.daily[1].rain,null);assert.equal(model.daily[1].probability,null);assert.equal(model.daily[2].rain,null);assert.equal(model.daily[1].discharge,null);assert.equal(model.daily[2].discharge,null);
  const missing=api.build(input({weatherFeed:{data:null,error:'Weather source failed'},riverFeed:{data:null,error:'River source failed'}}));
  assert.ok(missing.daily.every(row=>row.rain===null&&row.discharge===null&&row.band==='unknown'));
  const html=api.html(missing);assert.match(html,/Rainfall · Unavailable/);assert.match(html,/River model · Unavailable/);assert.match(html,/data-flood-export disabled/);
});

test('weekly totals and counts require seven daily values and use ≥10 and ≥25 rainfall screening',()=>{
  const model=api.build(input());assert.equal(model.weeks[0].rainTotal,55);assert.equal(model.weeks[0].watchDays,2);assert.equal(model.weeks[0].elevatedDays,1);assert.equal(model.weeks[0].peakDischarge,106);
  assert.equal(model.weeks[1].rainTotal,35);assert.equal(model.weeks[1].watchDays,0);assert.equal(model.weeks[1].lowerConfidence,true);
  assert.equal(model.daily[0].band,'lower');assert.equal(model.daily[1].band,'watch');assert.equal(model.daily[2].band,'elevated');
  const incomplete=api.build(input({weatherRows:input().weatherRows.filter(row=>row.date!==dates[5])}));
  assert.equal(incomplete.weeks[0].rainTotal,null);assert.equal(incomplete.weeks[0].watchDays,null);assert.equal(incomplete.weeks[1].rainTotal,35);assert.match(api.html(incomplete),/Rainfall available for 6\/7 days; total unknown/);
});

test('healthy API responses with zero or partial values expose forecast coverage separately from availability',()=>{
  const zero=api.build(input({riverRows:dates.map(date=>({date,discharge:null}))}));
  assert.equal(zero.river.available,true);assert.equal(zero.river.fresh,true);assert.equal(zero.river.coveredDays,0);assert.equal(zero.weather.coveredDays,14);
  const zeroHtml=api.html(zero);assert.match(zeroHtml,/River model · No usable forecast values/);assert.match(zeroHtml,/Rainfall · Refreshed model data/);assert.doesNotMatch(zeroHtml,/River model · Refreshed model data/);assert.match(zeroHtml,/13 Oct 2026, 12:00 EAT/);
  const partial=api.build(input({weatherRows:[{date:dates[0],rain:0},{date:dates[1],rain:10}],riverRows:[{date:dates[0],discharge:0}]}));
  assert.equal(partial.weather.coveredDays,2);assert.equal(partial.river.coveredDays,1);assert.equal(partial.daily[0].rain,0);assert.equal(partial.daily[0].discharge,0);
  const partialHtml=api.html(partial);assert.match(partialHtml,/Rainfall · Partial forecast coverage 2\/14/);assert.match(partialHtml,/River model · Partial forecast coverage 1\/14/);
  const retained=api.build(input({weatherRows:[{date:dates[0],rain:2}],riverRows:[],weatherFeed:{data:{},lastSuccess:now,error:'Refresh failed'},riverFeed:{data:{},lastSuccess:now,error:'Refresh failed'}}));
  const retainedHtml=api.html(retained);assert.match(retainedHtml,/Rainfall · Partial forecast coverage 1\/14 · last known data/);assert.match(retainedHtml,/River model · No usable forecast values · last known data/);assert.equal(retained.river.available,true);
});

test('river model trends compare only with day one and do not invent city-specific discharge warning thresholds',()=>{
  const model=api.build(input({riverRows:[{date:dates[0],discharge:100},{date:dates[1],discharge:80},{date:dates[2],discharge:300}]}));
  assert.equal(model.daily[0].flowTrend,'same');assert.equal(model.daily[1].flowTrend,'lower');assert.equal(model.daily[2].flowTrend,'higher');assert.equal(model.daily[3].flowTrend,'unknown');
  const noBaseline=api.build(input({riverRows:[{date:dates[1],discharge:200}]}));assert.equal(noBaseline.daily[1].flowTrend,'unknown');
  assert.match(api.html(model),/Below day-one model flow/);assert.match(api.html(model),/without city-wide flood thresholds/);assert.doesNotMatch(api.html(model),/high flood risk|flood warning issued|flood probability:|flood depth|population flooded/i);
});

test('stale retained model values are visible and source failure never makes a live alert',()=>{
  const model=api.build(input({weatherFeed:{data:{daily:{}},lastSuccess:'2026-10-13T06:00:00Z'},riverFeed:{data:{daily:{}},lastSuccess:now,error:'Upstream refresh failed'}}));
  assert.equal(model.weather.stale,true);assert.equal(model.river.stale,true);assert.equal(model.daily[2].rain,25);assert.equal(model.daily[0].discharge,100);
  const html=api.html(model);assert.match(html,/Rainfall · Last known data/);assert.match(html,/River model · Last known data/);assert.match(html,/Upstream refresh failed/);assert.match(html,/last known/);assert.doesNotMatch(html,/Live alert/);
  const future=api.build(input({weatherFeed:{data:{},lastSuccess:'2026-10-14T09:00:00Z'}}));assert.equal(future.weather.stale,true);
});

test('charts preserve model gaps and distinguish rain EAT from river UTC without predicted inundation',()=>{
  const model=api.build(input({riverRows:[{date:dates[0],discharge:30},{date:dates[1],discharge:40},{date:dates[3],discharge:50},{date:dates[4],discharge:60}]})),html=api.html(model);
  assert.equal((html.match(/<polyline /g)||[]).length,2);assert.match(html,/Rain mm · EAT/);assert.match(html,/River m³\/s · UTC/);assert.match(html,/Days 8–14 · lower confidence/);assert.match(html,/does not predict flood extent, depth, casualties or the probability of flooding/);assert.match(html,/Rain chance is a weather probability, not flood probability/);assert.match(html,/Retrieval times are when data were fetched, not model-run times/);
  assert.equal((html.match(/data-flood-day=/g)||[]).length,14);assert.doesNotMatch(html,/\bid=/);
});

test('matched gauge observations are separate and require today’s observation and a fresh source',()=>{
  const station={name:'Source gauge',levelM:8,moderateM:6,highM:7,bankFullM:9,observedAt:'2026-10-13',code:'G1'},stationFeed={data:{stations:[]},lastSuccess:now};
  const current=api.build(input({station,stationFeed}));assert.equal(current.gauge.current,true);assert.equal(current.gauge.reached,'High');assert.equal(current.daily[0].discharge,100);assert.match(api.html(current),/source threshold reached: High/);assert.match(api.html(current),/Observed thresholds are not forecast river heights/);
  const yesterday=api.build(input({station:{...station,observedAt:'2026-10-12'},stationFeed}));assert.equal(yesterday.gauge.current,false);assert.equal(yesterday.gauge.reached,null);assert.match(api.html(yesterday),/Current gauge status unknown/);
  const stale=api.build(input({station,stationFeed:{...stationFeed,error:'Refresh failed'}}));assert.equal(stale.gauge.current,false);
  const reversed=api.build(input({station:{...station,moderateM:8,highM:6},stationFeed}));assert.equal(reversed.gauge.reached,null);assert.match(api.html(reversed),/Supplied threshold order is invalid/);
  const noThresholds=api.build(input({station:{name:'Gauge',levelM:8,observedAt:'2026-10-13'},stationFeed}));assert.match(api.html(noThresholds),/no usable source thresholds supplied/);
});

test('HTML escapes location and source content; raw inputs and models use the same HTML interface',()=>{
  const raw=input({cityName:'<img src=x onerror=alert(1)>',region:'<script>unsafe</script>',weatherFeed:{data:{},lastSuccess:now,error:'<svg onload=x>'}});
  const html=api.html(raw);assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.match(html,/&lt;script&gt;unsafe&lt;\/script&gt;/);assert.match(html,/&lt;svg onload=x&gt;/);assert.doesNotMatch(html,/<script>|<img|<svg onload/);assert.equal(html,api.html(api.build(raw)));
});

test('CSV exports fourteen source-aligned days with blank unknowns, retrieval dates and confidence',()=>{
  const model=api.build(input({cityName:'Test "place", Somalia',weatherRows:[{date:dates[0],rain:0,probability:0,maxTemperature:31}],riverRows:[{date:dates[1],discharge:50}]}));
  const text=api.csv(model),rows=text.split('\r\n');assert.equal(rows.length,15);assert.match(rows[0],/rain_mm_EAT/);assert.match(rows[0],/river_discharge_m3_s_UTC/);assert.match(rows[1],/"Test ""place"", Somalia"/);assert.match(rows[1],/"0","0","31",""/);assert.match(rows[8],/"lower"/);assert.match(text,/2026-10-13T09:00:00Z/);
});

test('renderer and binding use date callbacks and enable local dialog selection without an external callback',()=>{
  const h=harness(),selected=[],exports=[];h.api.render(input({onDay:date=>selected.push(date),onExport:csv=>exports.push(csv)}));
  assert.match(h.container.innerHTML,/14-day flood planning outlook/);
  const dayNode={dataset:{floodDay:dates[8]}};h.container.onclick({target:{closest:selector=>selector==='[data-flood-day]'?dayNode:null}});assert.deepEqual(selected,[dates[8]]);
  h.container.onclick({target:{closest:selector=>selector==='[data-flood-export]'?{}:null}});assert.equal(exports.length,1);assert.equal(exports[0].split('\r\n').length,15);
  const local={innerHTML:''},model=h.api.build(input());h.api.bind(local,model);local.onclick({target:{closest:selector=>selector==='[data-flood-day]'?dayNode:null}});
  assert.equal(model.selectedDate,dates[8]);assert.match(local.innerHTML,/Selected forecast day 9 · lower confidence/);assert.match(local.innerHTML,new RegExp('data-flood-day="'+dates[8]+'" aria-pressed="true"'));
});
