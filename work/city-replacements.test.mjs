import test from 'node:test';
import {harness,assert,citiesFixture} from './somalia-flood-watch/verify.mjs';
const replacements=[{index:27,old:'Badhan',next:'Adado'},{index:28,old:'Zeila',next:'Guriceel'},{index:18,old:'Wanlaweyn',next:'Cabudwaaq'},{index:25,old:'Eyl',next:'Buulobarde'}];
const slug=name=>name.toLowerCase().replace(/[^a-z0-9]+/g,'-');
const plain=value=>JSON.parse(JSON.stringify(value));

test('all 30-city selectors, weather requests, route selection and map city data use replacement identities',async()=>{
 const h=harness({explorerMock:{}});await h.settle();
 assert.equal(citiesFixture.length,30);assert.equal(new Set(citiesFixture.map(c=>c[0])).size,30);
 for(const {index,old,next}of replacements){
  for(const id of ['city','daily-city','reportcity']){assert.ok(h.get(id).innerHTML.includes('>'+next+'</option>'));assert.ok(!h.get(id).innerHTML.includes('>'+old+'</option>'));}
  assert.equal(h.snapshot('cities')[index][0],next);
  h.evaluate('selectCity('+index+')');await h.settle();
  assert.equal(h.get('citytitle').textContent,next);
  assert.ok(h.requests.some(url=>url.startsWith('/api/copernicus?')&&new URL(url,'http://localhost').searchParams.get('city')===slug(next)));
  const detail=h.requests.findLast(url=>url.includes('api.open-meteo.com')&&new URL(url).searchParams.has('hourly'));
  assert.equal(Number(new URL(detail).searchParams.get('latitude')),citiesFixture[index][2]);
  assert.equal(Number(new URL(detail).searchParams.get('longitude')),citiesFixture[index][3]);
 }
 const weather=h.requests.find(url=>url.includes('api.open-meteo.com')&&!new URL(url).searchParams.has('hourly'));
 assert.deepEqual(new URL(weather).searchParams.get('latitude').split(',').map(Number),citiesFixture.map(c=>c[2]));
 assert.deepEqual(new URL(weather).searchParams.get('longitude').split(',').map(Number),citiesFixture.map(c=>c[3]));
 assert.equal(h.evaluate('matchedStation(25)'),null,'Buulobarde is not assigned another city’s gauge');
});

test('legacy numeric impact notes remain attached to retired cities rather than their replacements',async()=>{
 const legacy=replacements.map(({index,old})=>({city:index,date:'2026-10-13',source:'https://example.org/'+slug(old),summary:'Historic private note for '+old}));
 legacy.push({city:0,date:'2026-10-13',source:'https://example.org/mogadishu',summary:'Historic Mogadishu note'});
 const memory=new Map([['somalia-impact-log',JSON.stringify(legacy)]]),localStorage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)};
 const h=harness({globals:{localStorage}});await h.settle();
 const reports=h.snapshot('reports');assert.equal(reports.length,5);
 for(const {index,old,next}of replacements){
  const note=reports.find(r=>r.cityId===slug(old));assert.equal(note.cityName,old);assert.equal(note.city,-1);assert.equal(note.summary,'Historic private note for '+old);
  assert.ok(h.get('log').innerHTML.includes(old+' · 2026-10-13'));
  assert.equal(reports.filter(r=>r.cityId===slug(next)).length,0);
  assert.equal(h.evaluate('reports.filter(r=>r.cityId===managerCityId('+index+')).length'),0);
 }
 assert.equal(reports.find(r=>r.cityId==='mogadishu').city,0);
 h.get('reportcity').value='18';h.get('reportdate').value='2026-10-13';h.get('source').value='https://example.org/new-cabudwaaq';h.get('summary').value='New private Cabudwaaq note';
 h.get('reportform').onsubmit({preventDefault(){}});await h.settle();
 const saved=JSON.parse(memory.get('somalia-impact-log'));assert.equal(saved[0].cityId,'cabudwaaq');assert.equal(saved[0].cityName,'Cabudwaaq');assert.equal(saved[0].city,18);
 for(const {old}of replacements)assert.ok(saved.some(r=>r.cityId===slug(old)&&r.cityName===old&&r.city===-1));
 const again=harness({globals:{localStorage}});await again.settle();assert.deepEqual(plain(again.snapshot('reports')),saved);
 assert.equal(again.evaluate('reports.filter(r=>r.cityId===managerCityId(18)).length'),1,'the new city receives only its newly created note');
});
