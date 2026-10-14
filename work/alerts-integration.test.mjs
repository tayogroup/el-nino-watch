import {readFile} from 'node:fs/promises';
import {harness, weatherFixture, riverFixture, copernicusFixture, detailedFixture, BASE, DAY, assert} from './somalia-flood-watch/verify.mjs';

const [alertScript, html] = await Promise.all([
  readFile(new URL('./somalia-flood-watch/dist/alerts.js', import.meta.url), 'utf8'),
  readFile(new URL('./somalia-flood-watch/dist/index.html', import.meta.url), 'utf8')
]);
assert.ok(html.indexOf('src="alerts.js"') < html.indexOf('src="app.js"'), 'alert module loads before the controller');
for (const id of ['alerts-panel','alerts-list','alerts-summary','alerts-status','alerts-scope','alerts-type']) assert.ok(html.includes(`id="${id}"`), `${id} exists`);
const NOW = new Date(BASE).toISOString();
const notice = (id, city, extra={}) => ({id, sourceId:'icpac', title:`${city || 'Somalia'} official warning`, source:'ICPAC', sourceUrl:'https://www.icpac.net/weekly-forecast/',
  issuedAt:new Date(BASE-3600000).toISOString(), startsAt:new Date(BASE).toISOString(), endsAt:new Date(BASE+DAY).toISOString(),
  severity:'severe', status:'active', scope:{country:'Somalia',cities:city ? [city] : []}, description:'Fixture official rain notice', basis:'regional-forecast', ...extra});
const official = {available:true, fetchedAt:NOW, alerts:[
  notice('mogadishu','Mogadishu'), notice('hargeisa','Hargeisa'), notice('expired','Mogadishu',{endsAt:new Date(BASE-1).toISOString(),title:'Expired CAP notice'}),
  notice('model',null,{sourceId:'gdacs', title:'GDACS model-based event', source:'GDACS / GLOFAS', basis:'model-event',severity:'minor'}),
  notice('nonactive','Mogadishu',{status:'cancelled',title:'Cancelled CAP notice'})
], sources:[
  {id:'icpac', name:'ICPAC weekly forecast', available:true, fetchedAt:NOW, publishedAt:new Date(BASE-3600000).toISOString(), returnedCount:4, rejectedExpired:1},
  {id:'gdacs', name:'GDACS', available:true, fetchedAt:NOW}
], coverageNote:'No returned warning establishes safety.'};
const weather = weatherFixture();
weather[0].daily.precipitation_sum.fill(30);
weather[1].daily.precipitation_sum.fill(11);
const river = riverFixture(), requests=[], observed=[];
const apiResponse = data => ({ok:true,status:200,json:async()=>structuredClone(data)});
const h = harness({globals:{fetch:async url=>{
  const u=String(url);requests.push(u);
  if (u==='/api/alerts') return apiResponse(official);
  if (u==='/api/enso') return apiResponse({available:true,fetchedAt:NOW,issuedAt:'2026-10-08',alertStatus:'Fixture NOAA status'});
  if (u==='/api/stations') return apiResponse({available:true,fetchedAt:NOW,stations:[{code:'SH001',name:'Beledweyne',river:'Shabelle',levelM:6.8,moderateM:6.5,highM:7.3,bankFullM:8.3,observedAt:'2026-10-12',status:'Functional',sourceUrl:'https://snrfa.faoswalim.org/stations/sh001/'}]});
  if(u.includes('api.open-meteo.com/v1/forecast')) {
    const p=new URL(u).searchParams;
    if(p.has('hourly')) return apiResponse(detailedFixture(weather.findIndex(c=>c.latitude===Number(p.get('latitude')))));
    return apiResponse(weather);
  }
  if(u.includes('flood-api.open-meteo.com')) return apiResponse(river);
  if(u.includes('gdacs.org/')) return apiResponse({features:[]});
  if(u.startsWith('/api/copernicus?')) return apiResponse(copernicusFixture(new URL(u,'http://localhost').searchParams.get('city'), BASE));
  throw new Error('Unexpected test URL '+u);
}}, windowGlobals:{ObservedFlood:{selectCity:i=>observed.push(i),refresh:()=>Promise.resolve(),checkFreshness(){} }},explorerMock:{}});
// Attach the real rendering module before the pending feed promises settle.
h.evaluate('window.document=document;'+alertScript);
await h.settle();
assert.equal(h.snapshot('selected'),0);
assert.equal(h.get('citytitle').textContent,'Mogadishu');
assert.equal(Number(h.get('city').value),0);
assert.equal(observed[0],0,'observation city defaults to Mogadishu');
const detailedRequest=requests.find(u=>u.includes('api.open-meteo.com/v1/forecast')&&new URL(u).searchParams.has('hourly'));
assert.equal(new URL(detailedRequest).searchParams.get('latitude'),'2.0469');
assert.equal(new URL(detailedRequest).searchParams.get('longitude'),'45.3182');
assert.ok(requests.includes('/api/alerts'),'controller retrieves official warning API');
assert.equal(h.snapshot('feeds.alerts.lastSuccess'),NOW);
assert.match(h.get('alerts-list').innerHTML,/Mogadishu official warning/,'feed completion renders actual alert cards');
assert.match(h.get('alerts-list').innerHTML,/GDACS model-based signal/,'model events retain their distinct badge');
assert.match(h.get('alerts-list').innerHTML,/App rainfall screening/);
assert.equal(h.get('alerts-scope').value,'all');
assert.match(h.get('alerts-list').innerHTML,/Hargeisa official warning/);
assert.doesNotMatch(h.get('alerts-list').innerHTML,/Expired CAP notice|Cancelled CAP notice/);
const beforeScenario=h.get('alerts-list').innerHTML;
const feedsBefore=h.snapshot('feeds');
for (const scenario of ['heavy-rain','river-rise','blocked-drains']) {
  h.evaluate(`setScenario('${scenario}')`);
  assert.equal(h.get('alerts-list').innerHTML,beforeScenario,'hypothetical exercises do not create or change live alerts');
  assert.deepEqual(h.snapshot('feeds'),feedsBefore);
}
h.get('alerts-type').onchange({target:{value:'source'}});
assert.match(h.get('alerts-list').innerHTML,/Mogadishu official warning/);
assert.doesNotMatch(h.get('alerts-list').innerHTML,/App rainfall screening/);
h.get('alerts-scope').onchange({target:{value:'all'}});
assert.match(h.get('alerts-list').innerHTML,/Hargeisa official warning/);
assert.match(h.get('alerts-list').innerHTML,/SWALIM observation/,'all cities includes fresh source gauge threshold');
h.get('alerts-type').onchange({target:{value:'screen'}});
assert.match(h.get('alerts-list').innerHTML,/App rainfall screening/);
assert.doesNotMatch(h.get('alerts-list').innerHTML,/Official warning|GDACS model-based signal|SWALIM observation/);
h.get('alerts-scope').onchange({target:{value:'city'}});
assert.doesNotMatch(h.get('alerts-list').innerHTML,/Hargeisa/);

// Source freshness is evaluated independently of weather; failed source status
// must not turn old official notices into live alerts or suppress other feeds.
h.get('alerts-type').onchange({target:{value:'all'}});
h.evaluate("feeds.alerts.data.sources.find(s=>s.id==='icpac').fetchedAt=new Date(Date.now()-3*3600000).toISOString();renderAlerts()");
assert.doesNotMatch(h.get('alerts-list').innerHTML,/Mogadishu official warning/);
assert.match(h.get('alerts-list').innerHTML,/GDACS model-based signal/);
assert.match(h.get('alerts-list').innerHTML,/App rainfall screening/);
assert.match(h.get('alerts-status').innerHTML,/Coverage is incomplete/);
h.evaluate("feeds.alerts.stale=true;renderAlerts()");
assert.doesNotMatch(h.get('alerts-list').innerHTML,/GDACS model-based signal|Mogadishu official warning/);
assert.match(h.get('alerts-list').innerHTML,/App rainfall screening/);
h.evaluate("feeds.alerts.stale=false;feeds.alerts.error='Refresh failed';renderAlerts()");
assert.doesNotMatch(h.get('alerts-list').innerHTML,/GDACS model-based signal|Mogadishu official warning/);
assert.match(h.get('alerts-status').innerHTML,/Refresh failed/);
h.evaluate("feeds.alerts.error=null;feeds.alerts.data.sources.find(s=>s.id==='icpac').fetchedAt=new Date().toISOString();feeds.alerts.data.alerts.forEach(a=>a.endsAt=new Date(Date.now()-1).toISOString());renderAlerts()");
assert.doesNotMatch(h.get('alerts-list').innerHTML,/GDACS model-based signal|Mogadishu official warning/,'expired responses are never active even with a fresh retrieval');
h.setTime(BASE+3*3600000);
h.evaluate('renderAlerts()');
assert.doesNotMatch(h.get('alerts-list').innerHTML,/App rainfall screening/,'stale forecast retrieval also suppresses live screening');
assert.match(h.get('alerts-list').innerHTML,/does not confirm that an area is safe/);
console.log('Alerts integration checks passed: default Mogadishu APIs, post-feed render, scenario independence, source/type/city filters, expiry and stale-source suppression.');
