import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';

const dist = new URL('./somalia-flood-watch/dist/', import.meta.url);
const [uiSource,storeSource,citySource,css] = await Promise.all(['mayor.js','mayor-store.js','cities.js','mayor.css'].map(name=>fs.readFile(new URL(name,dist),'utf8')));
const NOW = '2026-10-13T10:00:00.000Z';
const LAST = '2026-10-13T09:55:00.000Z';
const plain = value => JSON.parse(JSON.stringify(value));
const decode = value => String(value).replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
function target(attributes={},value='') { return {value,textContent:'',id:attributes.id||'',getAttribute(name){return Object.hasOwn(attributes,name)?attributes[name]:null;},closest(selector){const name=selector.slice(1,-1);return Object.hasOwn(attributes,name)?this:null;}}; }
function harness({storageFailure=false}={}) {
  const values=new Map(),elements=new Map(),callbacks={},exports=[];let content='';
  const rootElement={addEventListener(name,callback){callbacks[name]=callback;},get innerHTML(){return content;},set innerHTML(html){content=html;for(const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)){const value=match[0].match(/\bvalue="([^"]*)"/)?.[1] || '';const element={id:match[1],value:decode(value),textContent:'',focus(){document.activeElement=this;},selectionStart:0,selectionEnd:0,setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}};elements.set(match[1],element);}}};
  elements.set('mayor-root',rootElement);
  const document={activeElement:null,getElementById:id=>elements.get(id)||null,createElement(){const link={href:'',download:'',click(){exports.push({href:this.href,download:this.download});}};return link;}};
  const root={document,crypto:{randomUUID},localStorage:{getItem:key=>values.get(key)||null,setItem(key,value){if(storageFailure)throw Error('Quota');values.set(key,value);}},URL:class extends URL{static createObjectURL(){return 'blob:test';}static revokeObjectURL(){}},Blob};
  const context=vm.createContext({window:root,document,console,URL,Date,Number,String,Object,Array,Map,Set,JSON,Math,Blob});
  vm.runInContext(citySource,context);vm.runInContext(storeSource,context);vm.runInContext(uiSource,context);
  const selections=[],dates=[],sections=[];
  root.CityManager.init({cities:root.SOMALIA_CITIES,onSelectCity:value=>selections.push(value),onDay:value=>dates.push(value),onOpenSection:(id,point)=>sections.push({id,point:plain(point||null)})});
  return {api:root.CityManager,store:root.CityManagerStore,cities:root.SOMALIA_CITIES,rootElement,elements,document,selections,dates,sections,exports,values,root,dispatch(type,element){callbacks[type]?.({target:element,preventDefault(){}});}};
}
function input(h,overrides={}) {
  const days=Array.from({length:14},(_,i)=>new Date(Date.parse('2026-10-13T00:00:00Z')+i*86400000).toISOString().slice(0,10));
  const weatherRows=days.map((date,i)=>({date,rain:i===0?10:i===1?25:i===2?0:2,probability:40,maxTemperature:32}));
  return {cities:h.cities,selectedCity:10,selectedDate:days[8],days,weatherRows,weatherFeed:{data:[{}],lastSuccess:LAST,error:null},station:null,stationFeed:{data:{stations:[]},lastSuccess:LAST},officialFeed:{data:{alerts:[],sources:[]},lastSuccess:LAST},catalogueFeed:{data:{missions:{radar:{available:true,scenes:[{datetime:'2026-10-12T15:08:23Z'}]},optical:{available:true,scenes:[{datetime:'2026-10-12T07:13:21Z',cloudCoverPercent:79.57}]}}},lastSuccess:LAST},observedState:{source:'radar',date:'2026-10-12',metadata:{radar:{available:true,provider:'CEMS GFM',resolutionM:20}},lastSuccess:LAST,stale:false},community:{available:true,cityId:'galkayo',records:[],lastSuccess:LAST,total:0,truncated:false},alertModel:{alerts:[],fresh:{official:true},coverageNote:'Coverage may be incomplete.',messages:[]},actions:[],now:NOW,...overrides};
}

test('decision window follows today in EAT rather than selected forecast date, with missing rainfall preserved',()=>{
  const h=harness(), data=input(h), model=h.api.build(data);
  assert.deepEqual(plain(model.next72.map(row=>row.date)),data.days.slice(0,3));
  assert.equal(model.selectedDate,data.days[8]);assert.equal(model.todaysRain,10);assert.equal(model.next72Max,25);
  assert.deepEqual(plain(model.next72.map(row=>row.band)),['watch','elevated','lower']);
  data.weatherRows[1].rain=null;const missing=h.api.build(data);assert.equal(missing.next72Max,null);assert.equal(missing.next72Complete,false);assert.equal(missing.next72[1].band,'unknown');
  data.weatherRows[0].rain=9.9;data.weatherRows[1].rain=24.9;assert.deepEqual(plain(h.api.build(data).next72.map(row=>row.band)),['lower','watch','lower']);
  const eat=h.api.build({...data,now:'2026-10-12T22:00:00.000Z'});assert.equal(eat.today,'2026-10-13');
});

test('satellite metadata never creates a city inundation classification; stale river thresholds cannot become current warnings',()=>{
  const h=harness(),data=input(h,{station:{name:'Example station',levelM:8,observedAt:'2026-10-09',moderateM:5,highM:7,bankFullM:8},observedState:{source:'radar',date:'2026-10-09',metadata:{radar:{available:true,provider:'CEMS GFM',resolutionM:20}},stale:true}}),model=h.api.build(data);
  assert.equal(model.observation.classification,'unknown');assert.equal(model.observation.available,true);assert.equal(model.observation.older,true);assert.equal(model.observation.stale,true);
  assert.equal(model.station.levelM,8);assert.equal(model.station.fresh,false);assert.equal(model.station.reached,null);assert.equal(model.catalogue.cloud,79.57);
  h.api.render(data);assert.match(h.rootElement.innerHTML,/City classification unknown/);assert.match(h.rootElement.innerHTML,/older than 2 days/);assert.match(h.rootElement.innerHTML,/79\.6% scene-wide optical cloud cover · ground may be obscured/);
  data.station.observedAt='2026-10-13';assert.equal(h.api.build(data).station.reached,'Bank full');data.station.moderateM=9;assert.equal(h.api.build(data).station.reached,null);assert.equal(h.api.build(data).station.thresholdsValid,false);
  data.catalogueFeed.data.missions.radar.scenes.push({datetime:'2026-10-14T15:00:00Z'});assert.equal(h.api.build(data).catalogue.radarScene.datetime,'2026-10-12T15:08:23Z');
});

test('city-specific official notices are separate from Somalia-wide notices and model events',()=>{
  const h=harness(),base={basis:'official-warning',status:'active',issuedAt:'2026-10-13T08:00:00Z',endsAt:'2026-10-14T08:00:00Z'};
  const alerts=[{...base,id:'city',title:'City warning',cityNames:['Galkayo']},{...base,id:'country',title:'Somalia-wide warning',cityNames:[]},{...base,id:'other',title:'Another city',cityNames:['Mogadishu']},{...base,id:'expired',cityNames:['Galkayo'],endsAt:'2026-10-13T09:00:00Z'},{...base,id:'model',cityNames:['Galkayo'],basis:'model-event'}];
  const data=input(h,{alertModel:{alerts,fresh:{official:true},coverageNote:'Incomplete coverage.'}}),model=h.api.build(data);
  assert.equal(model.cityWarningCount,1);assert.equal(model.countryWarningCount,1);assert.equal(model.cityWarnings[0].id,'city');assert.equal(model.countryWarnings[0].id,'country');
  h.api.render(data);assert.match(h.rootElement.innerHTML,/1 Somalia-wide official notice/);assert.match(h.rootElement.innerHTML,/city extent unspecified/);assert.ok(!h.rootElement.innerHTML.includes('Another city'));
  data.officialFeed.error='fixture source outage';const stale=h.api.build(data);assert.equal(stale.cityWarningCount,null);assert.equal(stale.countryWarningCount,null);assert.equal(stale.cityWarnings.length,0);
});

test('recent reports are isolated by city and observation date; zero remains distinct from an unknown impact',()=>{
  const h=harness(),records=[{id:'current',cityId:'galkayo',category:'flood',description:'Current reported water in street',observedAt:'2026-10-13T08:00:00Z',deaths:null,injuries:0,damagedProperties:2,latitude:6.77,longitude:47.43},{id:'other-city',cityId:'mogadishu',observedAt:'2026-10-13T08:00:00Z',deaths:5},{id:'old',cityId:'galkayo',observedAt:'2026-10-04T08:00:00Z',deaths:10},{id:'undated',cityId:'galkayo',observedAt:null},{id:'future',cityId:'galkayo',observedAt:'2026-10-15T08:00:00Z'}];
  const data=input(h,{community:{records,available:true,cityId:'galkayo',lastSuccess:LAST,total:1000,truncated:true}}),model=h.api.build(data);
  assert.equal(model.reportCount,1);assert.equal(model.reports[0].deaths,null);assert.equal(model.reports[0].injuries,0);assert.equal(model.communityTruncated,true);
  h.api.render(data);assert.match(h.rootElement.innerHTML,/the recent count includes only returned reports/);assert.match(h.rootElement.innerHTML,/1000 total city reports/);assert.match(h.rootElement.innerHTML,/<b>Unknown<\/b> deaths reported/);assert.match(h.rootElement.innerHTML,/<b>0<\/b> injuries reported/);assert.ok(!h.rootElement.innerHTML.includes('other-city'));
  assert.equal(h.api.build({...data,community:{...data.community,stale:true}}).reportCount,null);
  assert.equal(h.api.build({...data,community:{...data.community,cityId:'mogadishu'}}).reportCount,null);
  assert.equal(h.api.build({...data,community:{...data.community,available:false,error:'source outage'}}).reportCount,null);
});

test('real local store supports action CRUD, persistent per-city drafts, review stages and point navigation',()=>{
  const h=harness(),data=input(h,{community:{available:true,cityId:'galkayo',lastSuccess:LAST,records:[{id:'public-report-1',cityId:'galkayo',category:'flood',description:'Water on the road at the reported location',observedAt:'2026-10-13T08:00:00Z',latitude:6.77,longitude:47.43,deaths:null,injuries:null,damagedProperties:null}]}});
  h.api.render(data);
  h.dispatch('input',target({'data-action-field':'title'},'Check shelter access'));
  h.dispatch('input',target({'data-action-field':'owner'},'Local team'));
  h.dispatch('input',target({'data-action-field':'dueDate'},'2026-10-14'));
  h.dispatch('change',target({'data-action-field':'priority'},'high'));
  h.api.render({...data,weatherFeed:{...data.weatherFeed,lastSuccess:'2026-10-13T09:59:00Z'}});
  assert.equal(h.elements.get('mayor-action-title').value,'Check shelter access','refresh preserves draft');
  h.api.render({...data,selectedCity:0,community:{available:true,cityId:'mogadishu',lastSuccess:LAST,records:[]}});assert.equal(h.elements.get('mayor-action-title').value,'');
  h.dispatch('input',target({'data-action-field':'title'},'Mogadishu draft'));
  h.api.render(data);assert.equal(h.elements.get('mayor-action-title').value,'Check shelter access','city switch restores city draft');
  h.dispatch('submit',target({id:'mayor-action-form'}));let actions=h.store.list('galkayo');assert.equal(actions.length,1);assert.equal(actions[0].title,'Check shelter access');assert.equal(actions[0].owner,'Local team');assert.equal(actions[0].priority,'high');assert.equal(h.store.list('mogadishu').length,0);
  const id=actions[0].id;h.dispatch('change',target({'data-action-status':id},'in-progress'));assert.equal(h.store.list('galkayo')[0].status,'in-progress');
  h.dispatch('click',target({'data-edit-action':id}));assert.equal(h.elements.get('mayor-action-title').value,'Check shelter access');
  h.dispatch('input',target({'data-action-field':'title'},'Confirm shelter access'));h.dispatch('submit',target({id:'mayor-action-form'}));assert.equal(h.store.list('galkayo')[0].title,'Confirm shelter access');
  h.dispatch('change',target({'data-review-report':'public-report-1'},'checked'));assert.equal(h.store.reviewStatus('galkayo','public-report-1'),'checked');assert.equal(h.store.reviewStatus('mogadishu','public-report-1'),'unreviewed');assert.match(h.rootElement.innerHTML,/does not verify a report or change its public status/);
  h.dispatch('click',target({'data-report-map':'public-report-1'}));assert.deepEqual(h.sections.pop(),{id:'map',point:{latitude:6.77,longitude:47.43,reportId:'public-report-1'}});
  h.dispatch('click',target({'data-open-report':'public-report-1'}));assert.equal(h.sections.pop().id,'community');
  h.dispatch('change',target({'data-mayor-city':''},'0'));assert.deepEqual(h.selections,[0]);
  h.dispatch('change',target({'data-mayor-date':''},data.days[2]));assert.deepEqual(h.dates,[data.days[2]]);
  const remove=target({'data-delete-action':id});h.dispatch('click',remove);assert.equal(h.store.list('galkayo').length,1);assert.equal(remove.textContent,'Confirm removal');h.dispatch('click',remove);assert.equal(h.store.list('galkayo').length,0);
  h.dispatch('click',target({'data-export-briefing':''}));h.dispatch('click',target({'data-export-actions':''}));assert.deepEqual(h.exports.map(row=>row.download),['galkayo-2026-10-13-briefing.txt','galkayo-local-actions.csv']);
});

test('source failures and storage failures remain visible and unknown values do not become zero',()=>{
  const h=harness({storageFailure:true}),data=input(h,{weatherFeed:{data:null,error:'weather outage'},officialFeed:{data:null,error:'notice outage'},catalogueFeed:{data:null,error:'catalogue outage'},community:{available:false,records:null,error:'report outage'},observedState:{metadata:null,error:'observation outage'}});
  data.weatherRows=[];const model=h.api.render(data);assert.equal(model.todaysRain,null);assert.equal(model.next72Max,null);assert.equal(model.reportCount,null);assert.equal(model.cityWarningCount,null);assert.equal(model.observation.available,false);
  assert.match(h.rootElement.innerHTML,/Unknown/);assert.match(h.rootElement.innerHTML,/Browser storage is unavailable or full/);assert.match(h.rootElement.innerHTML,/report outage/);assert.match(h.rootElement.innerHTML,/Official notices are unavailable or stale/);
  h.dispatch('input',target({'data-action-field':'title'},'Local memory action'));h.dispatch('submit',target({id:'mayor-action-form'}));assert.equal(h.store.list('galkayo')[0].title,'Local memory action');assert.match(h.rootElement.innerHTML,/may not survive closing this page/);
});

test('partial catalogues, unsafe text and export formula strings are handled without invented evidence',()=>{
  const h=harness(),data=input(h,{community:{available:true,cityId:'galkayo',lastSuccess:LAST,records:[{id:'hostile',cityId:'galkayo',category:'flood',description:'<img src=x onerror=alert(1)>',observedAt:'2026-10-13T08:00:00Z',sourceUrl:'javascript:alert(1)',deaths:0,injuries:null,damagedProperties:null}]}});
  data.catalogueFeed.data.missions.radar={available:false,scenes:[],error:'<script>API failed</script>'};h.api.render(data);
  assert.match(h.rootElement.innerHTML,/Catalogue partly available/);assert.match(h.rootElement.innerHTML,/&lt;script&gt;API failed&lt;\/script&gt;/);assert.match(h.rootElement.innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.ok(!h.rootElement.innerHTML.includes('javascript:'));
  h.store.add('galkayo',{title:'=HYPERLINK("https://example.com")',owner:' +SUM(1,2)',dueDate:'',priority:'normal'});const model=h.api.render(data),csv=h.api.csvText(model),brief=h.api.briefingText(model);
  assert.match(csv,/"'=HYPERLINK/);assert.match(csv,/"'\+SUM/);assert.match(brief,/UNVERIFIED/);assert.match(brief,/City satellite flood classification: unknown/);assert.match(brief,/Individual impact claims may overlap and are not summed/);assert.match(brief,/This is not a government dashboard/);
});

test('mayor workspace uses focused tools, a touch-sized return control and accessible mobile navigation',()=>{
  const h=harness();h.api.render(input(h,{community:{available:true,cityId:'galkayo',lastSuccess:LAST,records:[{id:'mobile',cityId:'galkayo',description:'Reported flooding on the road',observedAt:'2026-10-13T08:00:00Z'}]}}));
  assert.match(css,/@media\(max-width:540px\)/);assert.match(css,/\.mayor-evidence-grid\{grid-template-columns:1fr\}/);
  assert.match(css,/#mayor-home-button\{[^}]*min-height:46px/);
  assert.match(css,/body\.mayor-view main\s*>\s*:not\(\.mayor-shell\):not\(\.mayor-active-tool\)\{display:none\}/);
  assert.match(css,/#mayor-panel\[hidden\],#manager-tool-bar\[hidden\]\{display:none!important\}/);
  assert.match(css,/\.workspace\.mayor-active-tool\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/\.workspace\.mayor-active-tool > \.detail,\.workspace\.mayor-active-tool > \.planning-panel\{display:none\}/);
  assert.match(css,/\.mobile-bottom-nav\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css,/\.mobile-bottom-nav>a:last-child:not\(\[aria-current=page\]\)\{color:#426784;background:transparent\}/);
  assert.match(css,/\.mobile-bottom-nav>a\[aria-current=page\]\{color:#116db6;background:#edf6ff\}/);
  assert.match(css,/#mayor-home-button:focus-visible\{outline:3px solid/);
  assert.ok(!css.includes('workspace-view-switch'));
  assert.match(h.rootElement.innerHTML,/>MAYOR DASHBOARD<\/p>/);
  assert.ok(!h.rootElement.innerHTML.includes('CITY MANAGER / MAYOR DASHBOARD'));
  assert.match(css,/\.mayor-panel button,.mayor-panel a\{font-size:12px;min-height:44px/);
  assert.match(h.rootElement.innerHTML,/role="status" aria-live="polite"/);assert.match(h.rootElement.innerHTML,/aria-label="Local review stage/);assert.match(h.rootElement.innerHTML,/data-mayor-day="2026-10-13" aria-pressed="false"/);
});
