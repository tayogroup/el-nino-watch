import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const dist=new URL('./somalia-flood-watch/dist/',import.meta.url);
const source=Object.fromEntries(await Promise.all(['planning.js','translations-so.js','i18n.js'].map(async name=>[name,await fs.readFile(new URL(name,dist),'utf8')])));
const NOW=Date.parse('2026-10-14T08:10:00Z');
class Clock extends Date {constructor(...args){super(...(args.length?args:[NOW]));}static now(){return NOW;}}
function harness({withoutLanguage=false}={}) {
  const store=new Map(),downloads=[],root={location:{href:'http://127.0.0.1:4173/'},localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,String(value))},history:{replaceState(){}}};
  const objectUrls=new Map();let urlIndex=0;
  class ExportURL extends URL {static createObjectURL(blob){const value='blob:export-'+(++urlIndex);objectUrls.set(value,blob);return value;}static revokeObjectURL(){} }
  const context=vm.createContext({window:root,Date:Clock,URL:ExportURL,Blob,setTimeout(){},console});
  if(!withoutLanguage){vm.runInContext(source['translations-so.js'],context);vm.runInContext(source['i18n.js'],context);}
  vm.runInContext(source['planning.js'],context);
  const elements=Object.fromEntries(['planning-summary','planning-actions','planning-limits','plan-download'].map(id=>[id,{}]));
  root.document={getElementById:id=>elements[id]||null,body:{appendChild(){}},createElement:()=>({href:'',download:'',click(){downloads.push({name:this.download,blob:objectUrls.get(this.href)})},remove(){}})};
  return {root,api:root.FloodPlanning,language:root.SiteLanguage,elements,downloads};
}
const base=()=>({city:{name:'Jowhar',region:'Middle Shabelle',context:'Shabelle river corridor'},scenario:'live',selectedDate:'2026-10-14',risk:'Watch',rainMm:11.25,forecastRetrievedAt:'2026-10-14T08:05:00Z',station:{name:'Jowhar',observedAt:'2026-10-14',levelM:5.4,highM:5.25,sourceUrl:'https://frrims.faoswalim.org/?id=SH004&label=Unknown'},terrain:{available:true,lowCells:8,sampleCount:49},selectedPoint:{lat:2.78,lon:45.5,elevationM:98.75,relativeM:-2,susceptibility:{label:'Very high potential',sourceUrl:'https://spatial.faoswalim.org/catalogue/#/dataset/609'},historical:{intersects:true},sourceNote:'Provider note: Unknown · High | Lower. Preserve  two spaces\nand this source quotation.'}});

test('English export is byte-for-byte the existing plan.text, with no model mutation',()=>{
  const h=harness(),plan=h.api.build(base()),snapshot=JSON.stringify(plan);
  assert.equal(h.api.checklistText(plan),plan.text);
  h.language.setLanguage('so');assert.notEqual(h.api.checklistText(plan),plan.text);
  assert.equal(JSON.stringify(plan),snapshot,'localising the export never changes model fields or English text');
  h.language.setLanguage('en');assert.equal(h.api.checklistText(plan),plan.text);
  const fallback=harness({withoutLanguage:true});const fallbackPlan=fallback.api.build(base());assert.equal(fallback.api.checklistText(fallbackPlan),fallbackPlan.text);
});

test('Somali export translates structured labels, actions and safety limits while preserving numbers, dates and source URLs',()=>{
  const h=harness();h.language.setLanguage('so');const plan=h.api.build(base()),text=h.api.checklistText(plan);
  for(const label of ['QORSHAYNTA','XOGTA CADDEYNTA','TALLAABOOYINKA','XADDIDAADAHA','ILAHA XOGTA','Cidda masuulka ah:','Tilmaamaha:'])assert.ok(text.includes(label),label);
  assert.ok(text.includes('Jowhar, Middle Shabelle'));
  assert.ok(text.includes('11.3 mm'));assert.ok(text.includes('5.4 m'));assert.ok(text.includes('5.3 m'));assert.ok(text.includes('8 ka mid ah 49'));assert.ok(text.includes('-2.0 m'));
  for(const token of [plan.generatedAt,plan.selectedDate,'2026-10-14T08:05:00Z',...plan.dataSources.map(s=>s.url),...plan.actions.map(a=>a.source.url)])assert.ok(text.includes(token),token);
  assert.match(text,/ma aha naqshad biyo-mareen/);assert.match(text,/ma soo saaro digniin fatahaad/);assert.match(text,/Ha jarin difaacyada webiga/);
  assert.ok(!text.includes('PLANNING CHECKLIST'));assert.ok(!text.includes('Responsible:'));
});

test('proper city and region labels, station names and quoted source notes are never translated as UI words',()=>{
  const h=harness();h.language.setLanguage('so');const input=base();input.city={name:'Rainfall',region:'Unknown',context:'Shabelle river corridor'};input.station.name='High';
  const plan=h.api.build(input),text=h.api.checklistText(plan);
  assert.ok(text.split('\n').includes('Rainfall, Unknown'),'city and region remain original proper labels');
  assert.ok(text.includes('High · 5.4 m'),'station name remains original in gauge evidence');
  assert.match(text,/Cabbirka webiga ee High,/,'station name remains original in the high-gauge protective action');
  assert.ok(text.includes(input.selectedPoint.sourceNote),'provider quotation, separators, whitespace and newline remain exact');
  assert.ok(text.includes('https://frrims.faoswalim.org/?id=SH004&label=Unknown'));
  input.station.name='14 October';const dateNameText=h.api.checklistText(h.api.build(input));assert.ok(dateNameText.includes('14 October · 5.4 m'),'a date-shaped proper station name remains original');assert.ok(!dateNameText.includes('14 Oktoobar · 5.4 m'));
});

test('old observations, missing evidence and hypothetical scenarios retain their limits in Somali',()=>{
  const h=harness();h.language.setLanguage('so');
  const old=h.api.build({...base(),station:{...base().station,observedAt:'2008-12-31'},stationFeedStale:true,forecastStale:true});const oldText=h.api.checklistText(old);
  assert.ok(oldText.includes('2008-12-31'));assert.ok(oldText.includes('CABBIR HORE'));assert.ok(oldText.includes('XOGTA ISHA WAY DUUGOOWDAY'));assert.ok(!oldText.includes('OLD OBSERVATION'));
  const missing=h.api.checklistText(h.api.build({city:{name:'Jowhar'},scenario:'live'}));assert.match(missing,/lama hayo/);assert.ok(!missing.includes('rainfall model: 0'));assert.ok(!missing.includes('no inundation inferred'));
  for(const scenario of ['heavy-rain','river-rise','blocked-drains']){const plan=h.api.build({...base(),scenario}),text=h.api.checklistText(plan);assert.match(text,/mala-awaal/i);assert.match(text,/Saadaasha hadda jirta.*lama beddelin/);assert.equal(plan.hypothetical,true);}
});

test('fallback city and gauge placeholders translate without changing explicitly supplied names',()=>{
  const h=harness();h.language.setLanguage('so');assert.equal(h.api.checklistText(h.api.build({})).split('\n')[1],'Magaalada la doortay');
  const input=base();delete input.station.name;const text=h.api.checklistText(h.api.build(input));assert.ok(text.includes('magaca lama hayo'));assert.ok(!text.includes('name unavailable'));assert.ok(!text.includes('matched gauge'));assert.match(text,/ku habboon goobtan/);
});

test('actual download follows the chosen language at click time, keeping filename and factual model identities stable',async()=>{
  const h=harness(),plan=h.api.render(base());
  h.language.setLanguage('so');h.elements['plan-download'].onclick();assert.equal(h.downloads.length,1);assert.equal(await h.downloads[0].blob.text(),h.api.checklistText(plan));
  assert.equal(h.downloads[0].name,'Somalia-Flood-Plan-Jowhar-2026-10-14.txt');
  h.language.setLanguage('en');h.elements['plan-download'].onclick();assert.equal(await h.downloads[1].blob.text(),plan.text);assert.equal(h.downloads[1].name,h.downloads[0].name);
});
