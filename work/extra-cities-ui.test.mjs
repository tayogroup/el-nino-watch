import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const dist = new URL('./somalia-flood-watch/dist/',import.meta.url);
const [source,storeSource,cities] = await Promise.all([fs.readFile(new URL('extra-cities.js',dist),'utf8'),fs.readFile(new URL('extra-cities-store.js',dist),'utf8'),fs.readFile(new URL('cities.json',dist),'utf8').then(JSON.parse)]);
const NOW = Date.parse('2026-10-13T11:00:00Z');
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW; } }
const camel = value => value.replace(/-([a-z])/g,(_,char) => char.toUpperCase());
function harness({native = true, storageFails = false, response} = {}) {
  const elements = new Map(), memory = new Map(), documentEvents = {}, calls = [], models = [], bindings = [], intervals = [];
  let currentTime = NOW;
  class HarnessClock extends Date { constructor(...args) { super(...(args.length ? args : [currentTime])); } static now() { return currentTime; } }
  let doc;
  class Element {
    constructor(id = '') { this.id = id; this.value = ''; this.textContent = ''; this.hidden = false; this.disabled = false; this.events = {}; this.dataset = {}; this.classes = new Set(); this.children = []; this.isConnected = true; this.html = ''; this.classList = {add:(...items) => items.forEach(item => this.classes.add(item)),remove:(...items) => items.forEach(item => this.classes.delete(item)),contains:item => this.classes.has(item),toggle:(item,force) => { const add = force ?? !this.classes.has(item); add ? this.classes.add(item) : this.classes.delete(item); return add; }}; }
    set innerHTML(markup) {
      this.html = markup; this.children = [];
      for (const match of markup.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
        const attributes = Object.fromEntries([...match[2].matchAll(/([a-z-]+)="([^"]*)"/gi)].map(item => [item[1],item[2]]));
        let child;
        if (attributes.id) { child = node(attributes.id); }
        else if (Object.keys(attributes).some(key => key.startsWith('data-'))) child = new Element();
        else continue;
        for (const [name,value] of Object.entries(attributes)) if (name.startsWith('data-')) child.dataset[camel(name.slice(5))] = value;
        child.disabled = /\bdisabled(?:\s|$)/.test(match[2]); child.hidden = /\bhidden(?:\s|$)/.test(match[2]);
        this.children.push(child);
        if (this.id === 'extra-cities-root' && child.id !== 'extra-cities-dialog') node('extra-cities-dialog').children.push(child);
      }
    }
    get innerHTML() { return this.html; }
    addEventListener(type,handler) { this.events[type] = handler; }
    setAttribute(name,value) { this[name] = value; }
    focus() { doc.activeElement = this; }
    reportValidity() { return true; }
    reset() { for (const id of ['extra-city-name','extra-city-region','extra-city-lat','extra-city-lon']) node(id).value = ''; }
    scrollIntoView() {}
    contains(value) { return value === this || this.children.includes(value) || elements.has(value?.id) && this.innerHTML.includes('id="'+value.id+'"'); }
    querySelectorAll(selector) {
      if (selector.startsWith('[data-')) { const name = camel(selector.slice(6,-1)); return this.children.filter(child => Object.hasOwn(child.dataset,name)); }
      return this.children.filter(child => !child.disabled && !child.hidden);
    }
  }
  const node = id => { if (!elements.has(id)) elements.set(id,new Element(id)); return elements.get(id); };
  doc = {getElementById:id => elements.get(id) || null,body:node('body'),activeElement:node('extra-cities-open'),addEventListener:(type,handler) => { documentEvents[type] = handler; }};
  node('extra-cities-root');
  if (native) {
    node('extra-cities-dialog').showModal = function () { this.open = true; };
    node('extra-cities-dialog').close = function () { this.open = false; this.events.close?.(); };
  }
  const storage = {getItem:key => memory.get(key) || null,setItem:(key,value) => { if (storageFails) throw Error('fixture browser storage disabled'); memory.set(key,value); }};
  const window = {document:doc,SOMALIA_CITIES:structuredClone(cities),localStorage:storage,AbortController,setInterval:(handler,period) => { intervals.push({handler,period}); return intervals.length; },fetch:async (url,options) => {
    calls.push({url:String(url),options}); const data = response ? await response(String(url),options,calls.length) : forecast(String(url).includes('flood-api') ? 'river' : 'weather');
    return {ok:true,status:200,json:async () => structuredClone(data)};
  },FloodOutlook:{build:input => input,html:input => { models.push(input); return '<section class="fixture-outlook"><p>'+input.cityName+'</p><button data-flood-day="2026-10-14">Select tomorrow</button><button data-flood-export>Export</button></section>'; },bind:(container,input) => { bindings.push({container,input}); container.onclick = event => { const date = event.target?.dataset?.floodDay; if (date) input.onDay(date); }; }}};
  const context = vm.createContext({window,document:doc,localStorage:storage,URL,Date:HarnessClock,AbortController,setTimeout,clearTimeout,console,Number,String,Object,Array,Set,Map});
  vm.runInContext(storeSource,context); vm.runInContext(source,context);
  const api = window.ExtraCities; api.init();
  return {api,store:window.ExtraCitiesStore,window,doc,elements,node,calls,models,bindings,memory,documentEvents,intervals,advance:milliseconds => { currentTime += milliseconds; },core:window.SOMALIA_CITIES};
}
function forecast(kind,start = '2026-10-13') {
  const time = Array.from({length:14},(_,i) => new Date(Date.parse(start + 'T00:00:00Z') + i*86400000).toISOString().slice(0,10));
  return kind === 'weather' ? {utc_offset_seconds:10800,daily_units:{precipitation_sum:'mm'},daily:{time,precipitation_sum:[null,0,10,25,...Array(10).fill(1)],precipitation_probability_max:Array(14).fill(70),temperature_2m_max:Array(14).fill(30)}} : {utc_offset_seconds:0,daily_units:{river_discharge:'m³/s'},daily:{time,river_discharge:[null,0,...Array(12).fill(23)]}};
}
const deferred = () => { let resolve,reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fill(h,{name = 'Hobyo',region = 'Mudug',lat = '5.3505',lon = '48.526'} = {}) {
  for (const [key,value] of Object.entries({name,region,lat,lon})) h.node('extra-city-'+key).value = value;
}

test('dialog opens, closes and restores focus without modifying the 44 cities',() => {
  const h = harness(), before = JSON.stringify(h.core); assert.equal(h.api.open(),true); assert.equal(h.node('extra-cities-dialog').open,true); assert.equal(h.doc.activeElement.id,'extra-cities-close');
  h.api.close(); assert.equal(h.node('extra-cities-dialog').hidden,true); assert.equal(h.doc.activeElement.id,'extra-cities-open'); assert.equal(JSON.stringify(h.core),before); assert.equal(h.core.length,44);
  assert.match(h.node('extra-cities-list').innerHTML,/No additional cities yet/); assert.match(h.node('extra-cities-root').innerHTML,/aria-labelledby="extra-cities-title"/);
});

test('fallback dialog traps keyboard focus and Escape closes it',() => {
  const h = harness({native:false}); h.api.open(); assert.equal(h.node('extra-cities-dialog').role,'dialog'); assert.ok(h.node('extra-cities-dialog').classList.contains('extra-fallback'));
  const focusable = h.node('extra-cities-dialog').querySelectorAll('button, input, a[href], select, textarea, [tabindex="0"]'); const first = focusable[0],last = focusable.at(-1); last.focus(); let prevented = 0;
  h.documentEvents.keydown({key:'Tab',shiftKey:false,preventDefault:() => prevented++}); assert.equal(h.doc.activeElement,first); assert.equal(prevented,1);
  h.documentEvents.keydown({key:'Escape',preventDefault:() => prevented++}); assert.equal(h.node('extra-cities-dialog').hidden,true); assert.equal(h.doc.activeElement.id,'extra-cities-open');
});

test('name-only additions remain unknown until paired coordinates are saved',async() => {
  const h = harness(); fill(h,{lat:'',lon:''}); const city = h.api.submit({preventDefault(){}}); assert.notEqual(city,false,h.node('extra-cities-message').textContent); assert.equal(city.name,'Hobyo'); assert.equal(city.lat,null); assert.equal(city.lon,null);
  assert.match(h.node('extra-cities-list').innerHTML,/Coordinates not supplied/); assert.match(h.node('extra-cities-list').innerHTML,/Add coordinates to load an outlook/); assert.equal(await h.api.loadForecast(city.id),false); assert.equal(h.calls.length,0);
  h.api.edit(city.id); assert.equal(h.node('extra-city-add').textContent,'Save changes'); h.node('extra-city-lat').value = '5.3505'; assert.equal(h.api.submit({preventDefault(){}}),false); assert.match(h.node('extra-cities-message').textContent,/both latitude and longitude/);
  h.node('extra-city-lon').value = '48.526'; const updated = h.api.submit({preventDefault(){}}); assert.equal(updated.id,city.id); assert.equal(updated.lat,5.3505); assert.equal(h.store.list().length,1); assert.equal(h.core.length,44);
});

test('duplicate aliases and nearby coordinates produce friendly errors and retain drafts',() => {
  const h = harness(); fill(h,{name:'Gaalkacyo',lat:'',lon:''}); assert.equal(h.api.submit({preventDefault(){}}),false); assert.match(h.node('extra-cities-message').textContent,/Galkayo/); assert.equal(h.node('extra-city-name').value,'Gaalkacyo'); assert.equal(h.store.list().length,0);
  fill(h); const city = h.api.submit({preventDefault(){}}); fill(h,{name:'Hobyo district',lat:'5.35051',lon:'48.52601'}); assert.equal(h.api.submit({preventDefault(){}}),false); assert.match(h.node('extra-cities-message').textContent,/Hobyo/); assert.equal(h.store.list()[0].id,city.id);
});

test('storage failure is explicit and successful additions remain usable in memory',() => {
  const h = harness({storageFails:true}); fill(h); const city = h.api.submit({preventDefault(){}}); assert.equal(city.name,'Hobyo'); assert.equal(h.store.list().length,1); assert.match(h.node('extra-cities-storage').textContent,/Memory only/); assert.match(h.node('extra-cities-storage').textContent,/lost after reload/);
});

test('forecast requests use new city coordinates, 14 days and separate EAT / UTC days',async() => {
  const h = harness(); fill(h); const city = h.api.submit({preventDefault(){}}); fill(h,{name:'Draft city',lat:'',lon:''}); await h.api.loadForecast(city.id);
  assert.equal(h.calls.length,2); const weather = new URL(h.calls.find(call => call.url.includes('api.open-meteo')).url), river = new URL(h.calls.find(call => call.url.includes('flood-api')).url);
  assert.equal(weather.searchParams.get('latitude'),'5.3505'); assert.equal(weather.searchParams.get('longitude'),'48.526'); assert.equal(weather.searchParams.get('forecast_days'),'14'); assert.equal(weather.searchParams.get('timezone'),'Africa/Mogadishu'); assert.equal(river.searchParams.get('timezone'),'GMT'); assert.equal(river.searchParams.get('start_date'),'2026-10-13'); assert.equal(river.searchParams.get('end_date'),'2026-10-26');
  const model = h.models.at(-1); assert.equal(model.days.length,14); assert.equal(model.weatherRows[0].rain,null); assert.equal(model.weatherRows[1].rain,0); assert.equal(model.riverRows[0].discharge,null); assert.equal(model.riverRows[1].discharge,0); assert.equal(model.station,null); assert.equal(h.node('extra-city-name').value,'Draft city'); assert.ok(h.bindings.length > 0);
  model.onDay('2026-10-16'); assert.equal(h.models.at(-1).selectedDate,'2026-10-16'); assert.equal(h.node('extra-city-name').value,'Draft city');
});

test('forecast source failure does not block the other source, and retry retains stale values',async() => {
  let failWeather = false, failRiver = true;
  const h = harness({response:async url => { if (url.includes('flood-api') && failRiver) throw Error('fixture river outage'); if (!url.includes('flood-api') && failWeather) throw Error('fixture weather outage'); return forecast(url.includes('flood-api') ? 'river' : 'weather'); }});
  fill(h); const city = h.api.submit({preventDefault(){}}); await h.api.loadForecast(city.id); let model = h.models.at(-1); assert.ok(model.weatherFeed.data); assert.equal(model.riverFeed.data,null); assert.match(model.riverFeed.error,/river outage/); assert.equal(model.weatherRows[2].rain,10);
  failRiver = false; failWeather = true; await h.api.loadForecast(city.id); model = h.models.at(-1); assert.ok(model.riverFeed.data); assert.ok(model.weatherFeed.data); assert.equal(model.weatherFeed.stale,true); assert.match(model.weatherFeed.error,/weather outage/); assert.equal(model.weatherRows[2].rain,10);
  failWeather = false; await h.api.loadForecast(city.id); model = h.models.at(-1); assert.equal(model.weatherFeed.stale,false); assert.equal(model.weatherFeed.error,null);
});

test('only viewed outlooks refresh, using cache while current and pausing when dialog is closed',async() => {
  const h = harness(); fill(h); const first = h.api.submit({preventDefault(){}}); fill(h,{name:'Ceel Buur',lat:'4.685',lon:'46.617'}); h.api.submit({preventDefault(){}}); h.api.open();
  await h.api.loadForecast(first.id); assert.equal(h.calls.length,2); assert.equal(h.intervals.length,1); assert.equal(h.intervals[0].period,900000);
  h.intervals[0].handler(); await tick(); assert.equal(h.calls.length,2);
  h.api.close(); h.advance(16*60000); h.intervals[0].handler(); await tick(); assert.equal(h.calls.length,2);
  h.api.open(); await tick(); await tick(); assert.equal(h.calls.length,4); assert.equal(h.calls.filter(call => new URL(call.url).searchParams.get('latitude') === '6.142').length,0); h.api.close();
});

test('EAT midnight refreshes a recent cache that lacks the new fourteenth date',async() => {
  let start = '2026-10-13';
  const h = harness({response:async url => forecast(url.includes('flood-api') ? 'river' : 'weather',start)});
  h.advance(Date.parse('2026-10-13T20:59:00Z') - NOW); fill(h); const city = h.api.submit({preventDefault(){}}); h.api.open(); await h.api.loadForecast(city.id); h.api.close();
  assert.equal(h.calls.length,2); assert.equal(h.models.at(-1).days[0],'2026-10-13'); assert.equal(h.models.at(-1).days.at(-1),'2026-10-26');
  h.advance(60000); start = '2026-10-14'; h.api.open(); await tick(); await tick();
  assert.equal(h.calls.length,4,'A cache retrieved only one minute ago must refresh when its calendar coverage is incomplete.');
  const riverUrl = new URL(h.calls.findLast(call => call.url.includes('flood-api')).url);
  assert.equal(riverUrl.searchParams.get('start_date'),'2026-10-14'); assert.equal(riverUrl.searchParams.get('end_date'),'2026-10-27');
  const model = h.models.at(-1); assert.equal(model.days[0],'2026-10-14'); assert.equal(model.days.at(-1),'2026-10-27');
  assert.ok(model.weatherRows.some(row => row.date === '2026-10-27')); assert.ok(model.riverRows.some(row => row.date === '2026-10-27')); h.api.close();
});

test('complete unordered source dates can still reuse the point-forecast cache',async() => {
  const h = harness({response:async url => {
    const data = forecast(url.includes('flood-api') ? 'river' : 'weather');
    for (const values of Object.values(data.daily)) values.reverse();
    return data;
  }});
  fill(h); const city = h.api.submit({preventDefault(){}}); h.api.open(); await h.api.loadForecast(city.id); h.api.close(); h.api.open(); await tick();
  assert.equal(h.calls.length,2); const model = h.models.at(-1); assert.equal(model.weatherRows.find(row => row.date === '2026-10-15').rain,10); assert.equal(model.riverRows.find(row => row.date === '2026-10-14').discharge,0); h.api.close();
});

test('deleting a city guards against late forecast updates and requires a second click',async() => {
  const wait = deferred(); const h = harness({response:async url => { await wait.promise; return forecast(url.includes('flood-api') ? 'river' : 'weather'); }}); fill(h); const city = h.api.submit({preventDefault(){}}); const pending = h.api.loadForecast(city.id);
  assert.equal(h.api.remove(city.id),false); assert.equal(h.store.list().length,1); assert.match(h.node('extra-cities-list').innerHTML,/Confirm removal/); assert.equal(h.api.remove(city.id),true); assert.equal(h.store.list().length,0);
  wait.resolve(); await pending; assert.equal(h.store.list().length,0); assert.match(h.node('extra-cities-list').innerHTML,/No additional cities yet/); assert.equal(h.models.filter(model => model.weatherFeed.data || model.riverFeed.data).length,0);
});

test('editing coordinates invalidates in-flight old-city forecasts',async() => {
  const wait = deferred(); let waiting = true; const h = harness({response:async url => { if (waiting) await wait.promise; return forecast(url.includes('flood-api') ? 'river' : 'weather'); }}); fill(h); const city = h.api.submit({preventDefault(){}}); const pending = h.api.loadForecast(city.id);
  h.api.edit(city.id); h.node('extra-city-lat').value = '5.36'; h.node('extra-city-lon').value = '48.55'; const updated = h.api.submit({preventDefault(){}}); assert.equal(updated.id,city.id); wait.resolve(); await pending; assert.ok(!h.node('extra-cities-list').innerHTML.includes('fixture-outlook'));
  waiting = false; await h.api.loadForecast(city.id); assert.equal(new URL(h.calls.at(-1).url).searchParams.get('latitude'),'5.36');
});

test('geocoder accepts only Somali populated places and requires explicit candidate selection',async() => {
  const h = harness({response:async() => ({results:[{name:'Hobyo',admin1:'Mudug',country_code:'SO',feature_code:'PPL',latitude:5.3505,longitude:48.526},{name:'Foreign town',country_code:'KE',feature_code:'PPL',latitude:5,longitude:45},{name:'River',country_code:'SO',feature_code:'STM',latitude:5,longitude:45},{name:'<Bad>',country_code:'SO',feature_code:'PPL',latitude:99,longitude:45}]})}); fill(h,{name:'Hobyo',lat:'',lon:''}); await h.api.lookup();
  assert.equal(new URL(h.calls[0].url).searchParams.get('countryCode'),'SO'); assert.equal(h.store.list().length,0); assert.equal(h.node('extra-city-lat').value,''); assert.match(h.node('extra-city-candidates').innerHTML,/Hobyo/); assert.ok(!h.node('extra-city-candidates').innerHTML.includes('Foreign town')); assert.ok(!h.node('extra-city-candidates').innerHTML.includes('River'));
  assert.equal(h.api.selectCandidate(0),true); assert.equal(h.node('extra-city-lat').value,'5.3505'); assert.equal(h.node('extra-city-region').value,'Mudug'); assert.equal(h.store.list().length,0); assert.match(h.node('extra-cities-message').textContent,/select Add city/);
});

test('late coordinate lookup cannot overwrite a changed form or a closed dialog',async() => {
  const wait = deferred(); const h = harness({response:async() => { await wait.promise; return {results:[{name:'Hobyo',country_code:'SO',feature_code:'PPL',latitude:5.3505,longitude:48.526}]}; }}); h.api.open(); fill(h,{lat:'',lon:''}); const pending = h.api.lookup(); h.node('extra-city-name').value = 'Adado'; h.node('extra-city-name').events.input(); wait.resolve(); await pending;
  assert.equal(h.node('extra-city-name').value,'Adado'); assert.equal(h.node('extra-city-candidates').innerHTML,''); assert.equal(h.node('extra-city-lat').value,''); assert.equal(h.node('extra-city-find').disabled,false);
});

test('coordinate lookup failure keeps manual entries and names are escaped in saved cards',async() => {
  const h = harness({response:async() => { throw Error('fixture geocoder outage'); }}); fill(h); await h.api.lookup(); assert.match(h.node('extra-city-candidates').textContent,/enter coordinates manually/); assert.equal(h.node('extra-city-lat').value,'5.3505'); assert.equal(h.node('extra-city-find').disabled,false);
  fill(h,{name:"Hobyo 'town'",region:'Mudug & district'}); const city = h.api.submit({preventDefault(){}}); assert.equal(city.name,"Hobyo 'town'"); assert.match(h.node('extra-cities-list').innerHTML,/Hobyo &#39;town&#39;/); assert.match(h.node('extra-cities-list').innerHTML,/Mudug &amp; district/);
  h.window.ExtraCitiesStore = {...h.store,list:() => [{...city,name:'Hobyo <town>'}]}; h.api.refreshList(); assert.match(h.node('extra-cities-list').innerHTML,/Hobyo &lt;town&gt;/); assert.ok(!h.node('extra-cities-list').innerHTML.includes('<town>'));
});

test('invalid source values, units and day boundaries remain unavailable',() => {
  const h = harness(); const weather = forecast('weather'); assert.equal(h.api.validateForecast(weather,'weather'),weather);
  assert.throws(() => h.api.validateForecast({...weather,utc_offset_seconds:0},'weather'),/Somalia time/); assert.throws(() => h.api.validateForecast({...weather,daily_units:{precipitation_sum:'inch'}},'weather'),/millimetres/);
  const negative = structuredClone(weather); negative.daily.precipitation_sum[0] = -1; assert.throws(() => h.api.validateForecast(negative,'weather'),/Invalid forecast field/);
  const badDate = structuredClone(weather); badDate.daily.time[0] = '2026-02-30'; assert.throws(() => h.api.validateForecast(badDate,'weather'),/invalid/);
  const probability = structuredClone(weather); probability.daily.precipitation_probability_max[0] = 101; assert.throws(() => h.api.validateForecast(probability,'weather'),/Invalid forecast field/);
  assert.equal(h.api.daysAt(Date.parse('2026-10-13T22:00:00Z'))[0],'2026-10-14'); assert.equal(h.api.daysAt(NOW).length,14);
});
