import test from 'node:test';
import fs from 'node:fs/promises';
import {harness, assert, BASE, citiesFixture, weatherFixture, days} from './somalia-flood-watch/verify.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const timestamp = now => new Date(now).toISOString();
const report = (cityIndex, id = 'report-'+cityIndex, observedAt = timestamp(BASE)) => ({
  id, cityId:slug(citiesFixture[cityIndex][0]), cityName:citiesFixture[cityIndex][0],
  category:'flood', observedAt, receivedAt:observedAt, status:'unverified',
  description:'Test flood report requiring local verification.', latitude:null, longitude:null,
  deaths:null, injuries:null, damagedProperties:null, comments:[], media:[]
});
const response = (reports = [report(10),report(6)], now = BASE) => ({
  reports:plain(reports), total:reports.length, truncated:false, cityId:null,
  fetchedAt:timestamp(now), status:'unverified', coverageNote:'Reports are unverified and may overlap.'
});

async function setup(options = {}) {
  const rankingCalls = [], reportRequests = [], communityCalls = [];
  let communityInit = null, payload = options.reportPayload ?? response(), reportError = null;
  const location = {href:'http://localhost/'+(options.hash ?? ''), protocol:'http:', hash:options.hash ?? ''};
  const history = {replaceState(_state,_title,hash) { location.hash=String(hash); location.href='http://localhost/'+hash; }};
  const CityRankings = {render(input) { rankingCalls.push(input); return input; }};
  const CommunityReports = {
    init(input) { communityInit=input; }, refresh() {},
    selectCity(index) { communityCalls.push({method:'selectCity',index}); },
    showCity(index) { communityCalls.push({method:'showCity',index}); }
  };
  const rankingsTestFetch = async url => {
    const address=new URL(String(url),'http://localhost'), city=address.searchParams.get('city');
    reportRequests.push(address.pathname+address.search);
    if (city) return {ok:true,status:200,json:async()=>response([],BASE)};
    if (reportError) throw Error(reportError);
    return {ok:true,status:200,json:async()=>plain(payload)};
  };
  const h=harness({...options,explorerMock:{},globals:{location,rankingsTestFetch},
    windowGlobals:{location,history,CityRankings,CommunityReports}});
  await h.settle();
  // Keep verify.mjs source stubs intact and replace only the independent community relay.
  h.evaluate("const rankingsOriginalFetch=fetch;fetch=(url,options)=>String(url).startsWith('/api/community/reports')?rankingsTestFetch(url,options):rankingsOriginalFetch(url,options)");
  const initial=rankingCalls.slice();
  await h.evaluate('load()'); await h.settle();
  return {h,location,rankingCalls,initial,reportRequests,communityCalls,
    latest:()=>rankingCalls.at(-1),
    setReports(value) { payload=plain(value); }, setReportError(value) { reportError=value; },
    filteredReports(records,meta={}) { communityInit.onChange(records,{available:true,loading:false,fetchedAt:timestamp(BASE),scope:'city',cityId:'galkayo',...meta}); }
  };
}

test('rankings receive the original 30 cities and date-aligned source rows independently of the selected day and scenario', async () => {
  const weather=weatherFixture();
  weather.forEach((city,index)=>{
    city.daily.precipitation_sum=days().map((_,day)=>index*100+day);
    Object.values(city.daily).forEach(values=>values.reverse());
  });
  const s=await setup({weather,hash:'#city=Galkayo&day=2026-10-26&scenario=heavy-rain'}), input=s.latest();
  assert.deepEqual(plain(input.cities),citiesFixture);
  assert.equal(input.cities.length,30);
  assert.equal(input.weatherRowsByCity.length,30);
  assert.deepEqual(plain(input.weatherRowsByCity[10].map(row=>row.date)),days());
  assert.equal(input.weatherRowsByCity[10][0].rain,1000);
  assert.equal(input.weatherRowsByCity[10][7].rain,1007);
  assert.equal(input.now,timestamp(BASE));
  assert.equal(s.h.evaluate('selected'),10);
  assert.equal(s.h.evaluate('selectedDay'),13);
  s.h.evaluate("setScenario('blocked-drains');setDay(5)");
  const later=s.latest();
  assert.deepEqual(plain(later.weatherRowsByCity),plain(input.weatherRowsByCity));
  assert.equal(later.now,input.now);
  assert.equal(s.h.evaluate('cities === window.SOMALIA_CITIES'),true);
});

test('the initial ranking input carries unavailable source data without inventing city measurements', async () => {
  const s=await setup();
  assert.ok(s.initial.length,'the new section renders during initialization');
  const first=s.initial[0];
  assert.equal(first.weatherFeed.data,null);
  assert.equal(first.communityFeed.data,null);
  assert.equal(first.cities.length,30);
  assert.ok(first.weatherRowsByCity.every(rows=>rows.every(row=>row.rain===null)));
});

test('global reports use an independent all-city request and preserve total, truncation and the source retrieval time', async () => {
  const body=response([report(10),report(6)]); body.total=620; body.truncated=true;
  const s=await setup({reportPayload:body}), input=s.latest();
  assert.ok(s.reportRequests.includes('/api/community/reports?limit=500'));
  assert.equal(input.communityFeed.data.cityId,null);
  assert.equal(input.communityFeed.data.total,620);
  assert.equal(input.communityFeed.data.truncated,true);
  assert.equal(input.communityFeed.data.reports.length,2);
  assert.equal(input.communityFeed.lastSuccess,body.fetchedAt);
  assert.equal(input.communityFeed.stale,false);
});

test('community city/category filters do not replace the independent all-city ranking feed', async () => {
  const s=await setup(), before=plain(s.latest().communityFeed);
  s.filteredReports([report(10)],{category:'flood',total:1});
  s.h.evaluate('render()');
  assert.deepEqual(plain(s.latest().communityFeed),before);
  s.filteredReports([],{category:'rain',total:0});
  s.h.evaluate('render()');
  assert.deepEqual(plain(s.latest().communityFeed),before);
  s.h.evaluate('selectCity(6)'); await s.h.settle();
  assert.deepEqual(plain(s.latest().communityFeed),before);
});

test('a failed global-report refresh retains its last data and timestamp and explicitly marks it stale', async () => {
  const s=await setup(), previous=plain(s.latest().communityFeed);
  s.h.setTime(BASE+16*60000); s.setReportError('ranking report relay offline');
  await s.h.evaluate('load()'); await s.h.settle();
  const input=s.latest();
  assert.deepEqual(plain(input.communityFeed.data),previous.data);
  assert.equal(input.communityFeed.lastSuccess,previous.lastSuccess);
  assert.equal(input.communityFeed.stale,true);
  assert.match(input.communityFeed.error,/ranking report relay offline/);
  assert.equal(input.weatherFeed.stale,false);
  assert.equal(input.weatherFeed.lastSuccess,timestamp(BASE+16*60000));
});

test('a city-scoped or malformed response cannot be accepted as a fresh 30-city report feed', async () => {
  const s=await setup(), previous=plain(s.latest().communityFeed);
  for (const invalid of [
    {...response([report(10)],BASE+16*60000),cityId:'galkayo'},
    {...response([report(10)],BASE+16*60000),reports:'not an array'},
    {...response([report(10)],BASE+16*60000),total:-1},
    {...response([report(10)],BASE+16*60000),truncated:'no'}
  ]) {
    s.h.setTime(BASE+16*60000); s.setReports(invalid);
    await s.h.evaluate('load()'); await s.h.settle();
    const feed=s.latest().communityFeed;
    assert.deepEqual(plain(feed.data),previous.data);
    assert.equal(feed.lastSuccess,previous.lastSuccess);
    assert.ok(feed.error,'invalid global metadata is surfaced');
    assert.equal(feed.stale,true);
  }
});

test('a weather outage leaves the independent global report feed fresh with its own timestamp', async () => {
  const s=await setup(), old=s.latest().weatherFeed.lastSuccess;
  s.h.setTime(BASE+16*60000); s.h.setErrors('rainfall provider overloaded',null);
  s.setReports(response([report(10),report(6),report(0)],BASE+16*60000));
  await s.h.evaluate('load()'); await s.h.settle();
  const input=s.latest();
  assert.equal(input.weatherFeed.lastSuccess,old);
  assert.equal(input.weatherFeed.stale,true);
  assert.match(input.weatherFeed.error,/rainfall provider overloaded/);
  assert.equal(input.communityFeed.lastSuccess,timestamp(BASE+16*60000));
  assert.equal(input.communityFeed.stale,false);
  assert.equal(input.communityFeed.data.reports.length,3);
});

test('rankings refresh with the 15-minute schedule and roll their date window at EAT midnight', async () => {
  const s=await setup(), before=s.reportRequests.length;
  const timer=s.h.timers.find(item=>item.kind==='interval'&&item.ms===15*60000);
  assert.ok(timer);
  s.h.setTime(BASE+16*60000); s.setReports(response([],BASE+16*60000));
  await timer.fn(); await s.h.settle();
  assert.ok(s.reportRequests.length>before);
  assert.equal(s.latest().communityFeed.lastSuccess,timestamp(BASE+16*60000));
  s.h.setTime('2026-10-13T21:01:00Z');
  const minute=s.h.timers.find(item=>item.kind==='interval'&&item.ms===60000);
  assert.ok(minute); await minute.fn(); await s.h.settle();
  const input=s.latest();
  assert.equal(input.now,'2026-10-13T21:01:00.000Z');
  assert.equal(input.weatherRowsByCity[0][0].date,'2026-10-14');
  assert.equal(input.weatherRowsByCity[0].at(-1).date,'2026-10-27');
  assert.equal(input.weatherRowsByCity[0].at(-1).rain,null,'old source data cannot supply the new final day');
  assert.equal(input.weatherFeed.stale,true);
  assert.equal(input.communityFeed.stale,true);
});

test('ranking selections open the correct city tool and anchor today or the next-day forecast', async () => {
  const s=await setup();
  for (const [kind,city,day,tool] of [
    ['rain-today',10,0,'daily-panel'], ['rain-week',6,1,'daily-panel'],
    ['reports',0,0,'community-panel'], ['watch',7,1,'map-panel']
  ]) {
    s.latest().onSelectCity(city,kind); await s.h.settle();
    assert.equal(s.h.evaluate('selected'),city);
    assert.equal(s.h.evaluate('selectedDay'),day);
    assert.equal(s.h.evaluate('managerTool'),tool);
    assert.equal(s.h.evaluate('dashboardView'),'mayor');
    const query=new URLSearchParams(s.location.hash.replace(/^#/,''));
    assert.equal(query.get('city'),citiesFixture[city][0]);
    if (day) assert.equal(query.get('day'),days()[day]);
    if (kind==='reports') assert.ok(s.communityCalls.some(call=>call.method==='showCity'&&call.index===city));
  }
});

test('rankings are mounted outside city-only content and their scripts and styles are included in packaging', async () => {
  const base=new URL('./somalia-flood-watch/',import.meta.url);
  const [html,packageSource]=await Promise.all([
    fs.readFile(new URL('dist/index.html',base),'utf8'),fs.readFile(new URL('./package-flood-app.mjs',import.meta.url),'utf8')
  ]);
  const host=html.match(/<[^>]*id="([^"]*rankings[^"]*)"[^>]*>/);
  assert.ok(host,'static rankings host exists');
  assert.match(host[0],/mayor-shell/,'shared section stays visible in both default and mayor views');
  assert.ok(html.indexOf(host[0])>html.indexOf('class="stats"'),'summary is placed after the all-city stats');
  assert.ok(html.indexOf(host[0])<html.indexOf('</main>'));
  const scripts=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match=>match[1]);
  const rankingScript=scripts.find(name=>/rankings.*\.js$/.test(name));
  assert.ok(rankingScript,'rankings module is included');
  assert.ok(scripts.indexOf(rankingScript)<scripts.indexOf('app.js'));
  const rankingCss=[...html.matchAll(/<link\b[^>]*href="([^"]+)"/g)].map(match=>match[1]).find(name=>/rankings.*\.css$/.test(name));
  assert.ok(rankingCss,'rankings styles are included');
  // The portable page inlines what index.html loads (package-files.mjs), so rankings are embedded with it.
  const {pageAssets}=await import('./package-files.mjs');
  assert.match(packageSource,/pageAssets\(html\)/,'the portable build reads its assets from index.html');
  assert.ok(pageAssets(html).scripts.includes(rankingScript),'portable artifact embeds rankings code');
  assert.ok(pageAssets(html).styles.includes(rankingCss),'portable artifact embeds rankings styles');
  for (const hash of ['', '#view=mayor&city=Galkayo']) {
    const s=await setup({hash});
    assert.ok(s.latest(),'rankings render in '+(hash?'mayor':'all-city')+' view');
    assert.equal(s.latest().cities.length,30);
  }
});
