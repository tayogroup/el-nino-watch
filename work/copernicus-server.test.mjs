import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from './somalia-flood-watch/server.mjs';

const cityRows=JSON.parse(await readFile(new URL('./somalia-flood-watch/dist/cities.json',import.meta.url),'utf8'));
const slug=name=>name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const expectedCity=id=>cityRows.find(city=>slug(city[0])===id);
const fixedSource='https://stac.dataspace.copernicus.eu/v1/search';

test('Copernicus city relay combines safe mission metadata, coalesces city requests and retains stale evidence on failure',{timeout:12000},async()=>{
  const nativeFetch=globalThis.fetch,nativeNow=Date.now;
  let now=nativeNow(),gateRelease;
  const calls=[],failures=new Map();
  let gate=new Promise(resolve=>{gateRelease=resolve;});
  Date.now=()=>now;
  globalThis.fetch=async(rawUrl,options)=>{
    assert.equal(String(rawUrl),fixedSource,'the relay contacts only the fixed Copernicus catalogue API');
    assert.equal(options.method,'POST');
    assert.equal(options.headers['Content-Type'],'application/json');
    assert.ok(options.signal instanceof AbortSignal,'upstream requests have an abort deadline');
    const query=JSON.parse(options.body);
    assert.equal(query.collections.length,1);
    const collection=query.collections[0];
    assert.ok(['sentinel-1-grd','sentinel-2-l2a'].includes(collection));
    const lon=(query.bbox[0]+query.bbox[2])/2,lat=(query.bbox[1]+query.bbox[3])/2;
    const city=cityRows.find(row=>Math.abs(row[2]-lat)<1e-6&&Math.abs(row[3]-lon)<1e-6);
    assert.ok(city,'bounds must come from a supported server-side city');
    const cityId=slug(city[0]),mission=collection==='sentinel-1-grd'?'radar':'optical';
    const [start,end]=query.datetime.split('/');
    assert.ok(Number.isFinite(Date.parse(start))&&Number.isFinite(Date.parse(end))&&Date.parse(start)<Date.parse(end));
    const call={cityId,mission,url:String(rawUrl),query};calls.push(call);
    if(cityId==='galkayo'&&gate)await gate;
    if(failures.get(cityId)?.includes(mission))throw Error('Fixture catalogue is temporarily unavailable');
    const datetime=new Date(Date.parse(end)-(mission==='radar'?2:1)*3600000).toISOString();
    assert.ok(Date.parse(datetime)>=Date.parse(start));
    return Response.json({type:'FeatureCollection',features:[{type:'Feature',collection,
      id:`${cityId}_${mission}_fixture`,bbox:query.bbox,
      properties:{datetime,platform:mission==='radar'?'sentinel-1a':'sentinel-2a','eo:cloud_cover':79.6,
        'sat:orbit_state':'ascending','sar:polarizations':['VV','VH'],gsd:mission==='radar'?20:10},
      // Catalogue assets are untrusted and must not become app navigation URLs.
      assets:{thumbnail:{href:'https://untrusted.example.test/thumbnail.png'}},links:[{rel:'self',href:'https://untrusted.example.test/product'}]}]});
  };
  const server=createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=path=>nativeFetch(base+path,{signal:AbortSignal.timeout(3000)});
  const json=async path=>{const response=await request(path);return{status:response.status,data:await response.json()};};
  const count=id=>calls.filter(call=>call.cityId===id).length;
  const waitFor=async check=>{const deadline=nativeNow()+1500;while(!check()){if(nativeNow()>deadline)throw Error('Timed out waiting for mocked source requests');await new Promise(resolve=>setTimeout(resolve,10));}};
  try{
    const first=await json('/api/copernicus');
    assert.equal(first.status,200);
    assert.equal(first.data.available,true);
    assert.equal(first.data.stale,false);
    assert.deepEqual(first.data.city,{id:'mogadishu',name:'Mogadishu',lat:expectedCity('mogadishu')[2],lon:expectedCity('mogadishu')[3]});
    assert.equal(first.data.missions.optical.available,true);
    assert.equal(first.data.missions.radar.available,true);
    assert.equal(first.data.missions.optical.scenes[0].cloudCoverPercent,79.6);
    assert.equal(first.data.missions.radar.scenes[0].cloudCoverPercent,null);
    assert.equal(first.data.processing.available,false,'catalogue connectivity does not invent an authenticated imagery processor');
    assert.equal(first.data.processing.requiresCredentials,true);
    assert.match(first.data.coverageNote,/does not identify flooded streets/);
    assert.match(first.data.coverageNote,/cannot establish that an area is dry/);
    for(const mission of Object.values(first.data.missions))for(const scene of mission.scenes){
      assert.equal(new URL(scene.metadataUrl).origin,'https://stac.dataspace.copernicus.eu');
      assert.equal(new URL(scene.browserUrl).origin,'https://browser.dataspace.copernicus.eu');
      assert.equal(new URL(scene.browserUrl).searchParams.get('lat'),String(expectedCity('mogadishu')[2]));
      assert.equal(new URL(scene.browserUrl).searchParams.get('fromTime').slice(0,10),scene.datetime.slice(0,10));
      assert.doesNotMatch(JSON.stringify(scene),/untrusted\.example/);
    }
    assert.equal(count('mogadishu'),2,'one query for each satellite mission');
    const cached=await json('/api/copernicus?city=mogadishu&url=https%3A%2F%2Funtrusted.example.test%2Fsearch&lat=0&lon=0');
    assert.equal(cached.data.fetchedAt,first.data.fetchedAt);
    assert.equal(count('mogadishu'),2,'query parameters cannot redirect source requests or replace whitelisted coordinates');
    for(const city of ['unknown-city','https://untrusted.example.test/search','galkayo&url=https://untrusted.example.test']){
      const invalid=await json('/api/copernicus?city='+encodeURIComponent(city));
      assert.equal(invalid.status,400);
      assert.equal(invalid.data.available,false);
    }
    assert.equal(calls.length,2,'unsupported city requests never contact an upstream source');

    const concurrentA=json('/api/copernicus?city=galkayo'),concurrentB=json('/api/copernicus?city=galkayo');
    await waitFor(()=>count('galkayo')===2);
    // Allow both loopback handlers to enter while the first source pair waits.
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(count('galkayo'),2,'concurrent requests for one city share a single mission-query pair');
    gateRelease();gate=null;
    const [galkayoA,galkayoB]=await Promise.all([concurrentA,concurrentB]);
    assert.equal(galkayoA.status,200);assert.equal(galkayoB.status,200);
    assert.equal(galkayoA.data.city.id,'galkayo');
    assert.equal(galkayoA.data.fetchedAt,galkayoB.data.fetchedAt);
    assert.deepEqual(galkayoA.data.missions,galkayoB.data.missions);
    assert.equal(count('galkayo'),2);

    const hargeisa=await json('/api/copernicus?city=hargeisa');
    assert.equal(hargeisa.status,200);
    assert.equal(hargeisa.data.city.id,'hargeisa');
    assert.equal(count('hargeisa'),2,'a different city has an independent source-query cache');
    assert.notDeepEqual(hargeisa.data.bbox,galkayoA.data.bbox);
    assert.match(hargeisa.data.missions.radar.scenes[0].id,/^hargeisa_/);
    assert.match(galkayoA.data.missions.radar.scenes[0].id,/^galkayo_/);
    await json('/api/copernicus?city=galkayo');
    assert.equal(count('galkayo'),2,'other-city retrievals do not evict a valid city cache');

    failures.set('kismayo',['optical']);
    const partial=await json('/api/copernicus?city=kismayo');
    assert.equal(partial.status,200);
    assert.equal(partial.data.available,true);
    assert.equal(partial.data.missions.optical.available,false);
    assert.deepEqual(partial.data.missions.optical.scenes,[]);
    assert.match(partial.data.missions.optical.error,/temporarily unavailable/);
    assert.equal(partial.data.missions.radar.available,true);
    assert.equal(partial.data.missions.radar.scenes.length,1,'the working mission remains usable after a partial failure');

    failures.set('bosaso',['optical','radar']);
    const failed=await json('/api/copernicus?city=bosaso');
    assert.equal(failed.status,503);
    assert.equal(failed.data.available,false);
    assert.equal(failed.data.fetchedAt,null);
    assert.equal(failed.data.missions,undefined,'no mission evidence is synthesized when both queries fail');
    assert.match(failed.data.error,/Both Copernicus catalogue mission queries are unavailable/);
    assert.doesNotMatch(failed.data.error,/dry|no flood|safe|all.clear/i,'unavailable catalogue data is not an all-clear');
    const totalFailed=count('bosaso');
    await json('/api/copernicus?city=bosaso');
    assert.equal(count('bosaso'),totalFailed,'failed sources respect the retry delay');

    now+=11*60*1000;
    failures.set('galkayo',['optical','radar']);
    const stale=await json('/api/copernicus?city=galkayo');
    assert.equal(stale.status,200,'last-known valid data remains available with an explicit stale flag');
    assert.equal(stale.data.available,true);
    assert.equal(stale.data.stale,true);
    assert.equal(stale.data.fetchedAt,galkayoA.data.fetchedAt);
    assert.deepEqual(stale.data.missions,galkayoA.data.missions,'failed refresh never replaces observed acquisition evidence with empty missions');
    assert.match(stale.data.error,/Latest refresh failed/);
    assert.ok(stale.data.lastAttemptAt);
    assert.equal(count('galkayo'),4,'expired city cache attempted both mission refreshes');
    await json('/api/copernicus?city=galkayo');
    assert.equal(count('galkayo'),4,'stale failed refresh respects the retry delay');
    assert.ok(calls.every(call=>call.url===fixedSource),'arbitrary request parameters never become upstream URLs');
  }finally{
    gateRelease();globalThis.fetch=nativeFetch;Date.now=nativeNow;
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
});
