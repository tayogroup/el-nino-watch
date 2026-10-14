import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const base=new URL('./somalia-flood-watch/dist/',import.meta.url);
const [catalog,engine]=await Promise.all(['translations-so.js','i18n.js'].map(name=>fs.readFile(new URL(name,base),'utf8')));
class Text {
  nodeType=3;
  constructor(value){this.nodeValue=value;this.parentElement=null;}
  get textContent(){return this.nodeValue;}
  set textContent(value){this.nodeValue=value;}
}
class Element {
  nodeType=1; childNodes=[]; handlers=new Map();
  constructor(tag='div',attrs={}){this.tagName=tag.toUpperCase();this.attributes=new Map(Object.entries(attrs));this.parentElement=null;this.value='';this.selectionStart=0;this.selectionEnd=0;}
  get id(){return this.getAttribute('id')||'';}
  get dataset(){return Object.fromEntries([...this.attributes].filter(([name])=>name.startsWith('data-')).map(([name,value])=>[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value]));}
  getAttribute(name){return this.attributes.has(name)?this.attributes.get(name):null;}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  hasAttribute(name){return this.attributes.has(name);}
  removeAttribute(name){this.attributes.delete(name);}
  append(...nodes){for(let node of nodes){if(typeof node==='string')node=new Text(node);node.parentElement=this;this.childNodes.push(node);}return this;}
  get textContent(){return this.childNodes.map(node=>node.textContent).join('');}
  set textContent(value){this.childNodes=[];this.append(String(value));}
  matches(selector){
    const classes=(this.getAttribute('class')||'').split(/\s+/);
    if(selector.includes('>')){const [left,right]=selector.split('>');return this.matches(right.trim())&&this.parentElement?.closest(left.trim())===this.parentElement;}
    if(selector.includes(' ')){const bits=selector.split(/\s+/),right=bits.pop();return this.matches(right)&&!!this.parentElement?.closest(bits.join(' '));}
    if(selector.includes(':not(')){const match=/^(.*?)\:not\((.*?)\)(.*)$/.exec(selector);return this.matches(match[1]+match[3])&&!this.matches(match[2]);}
    if(selector.startsWith('['))return this.hasAttribute(selector.slice(1,-1));
    if(selector.startsWith('.'))return classes.includes(selector.slice(1));
    if(selector.startsWith('#'))return this.id===selector.slice(1);
    return this.tagName===selector.toUpperCase();
  }
  closest(selectors){for(let element=this;element;element=element.parentElement)if(selectors.split(',').some(selector=>element.matches(selector.trim())))return element;return null;}
  addEventListener(type,fn){this.handlers.set(type,fn);}
  click(){this.handlers.get('click')?.({target:this});}
}
function harness({stored,href='http://127.0.0.1:4173/?coverage=all#city=Galkayo&view=mayor&day=2026-10-20',failStorage=false,loading=false}={}){
  const html=new Element('html'),body=new Element('body');html.append(body);
  const en=new Element('button',{'data-site-language':'en','data-i18n-skip':''}).append('EN');
  const so=new Element('button',{'data-site-language':'so','data-i18n-skip':''}).append('SO');
  const status=new Element('span',{id:'language-status'});
  body.append(en,so,status);
  const heading=new Element('h2').append('Rainfall today');
  const unavailable=new Element('span').append('Rainfall unavailable');
  const input=new Element('input',{placeholder:'Name or team','aria-label':'City','data-action-field':'owner',id:'mayor-action-owner'});
  input.value='Rainfall today';input.selectionStart=3;input.selectionEnd=8;
  const textarea=new Element('textarea',{placeholder:'Name or team','aria-label':'City'}).append('Rainfall today');textarea.value='Unknown';
  const select=new Element('select',{'data-scope':'all'});select.value='all';
  const option=new Element('option',{value:'all'}).append('All 30 cities');select.append(option);
  const protectedText=new Element('p',{'data-i18n-skip':'',lang:'und'}).append('Rainfall today');
  const brand=new Element('b',{class:'brand-title'}).append('El Nino Watch');
  body.append(heading,unavailable,input,textarea,select,protectedText,brand);
  const listeners=new Map();
  const document={body,documentElement:html,title:'Rainfall today',readyState:loading?'loading':'complete',activeElement:input,querySelectorAll:selector=>selector==='[data-site-language]'?[en,so]:[],getElementById:id=>id==='language-status'?status:null,addEventListener:(name,fn)=>listeners.set(name,fn)};
  const storage=new Map(stored?[['somalia-language-v1',stored]]:[]);let observer;
  const root={document,location:{href},localStorage:{getItem:key=>{if(failStorage)throw Error('Denied');return storage.get(key)||null;},setItem:(key,value)=>{if(failStorage)throw Error('Denied');storage.set(key,value);}},history:{replaceState(_state,_title,url){root.location.href=new URL(url,root.location.href).href;}},queueMicrotask:fn=>fn(),MutationObserver:class{constructor(fn){observer=fn;}observe(target,options){root.observed={target,options};}}};
  const context=vm.createContext({window:root,URL,console});vm.runInContext(catalog,context);vm.runInContext(engine,context);
  return {root,document,body,en,so,status,heading,unavailable,input,textarea,select,option,protectedText,brand,storage,api:root.SiteLanguage,mutate:()=>observer?.([]),ready:()=>listeners.get('DOMContentLoaded')?.()};
}
test('English default and Somali preference initialize without altering city/view/date/filter state',()=>{
  const english=harness();assert.equal(english.api.getLanguage(),'en');assert.equal(english.heading.textContent,'Rainfall today');
  const saved=harness({stored:'so'});assert.equal(saved.api.getLanguage(),'so');assert.equal(saved.heading.textContent,'Roobka maanta');
  assert.equal(saved.document.documentElement.getAttribute('lang'),'so');assert.equal(saved.document.title,'Roobka maanta');
  assert.equal(saved.select.value,'all');assert.equal(saved.option.getAttribute('value'),'all');assert.match(saved.root.location.href,/#city=Galkayo&view=mayor&day=2026-10-20$/);
  assert.equal(saved.storage.size,1);assert.equal(saved.api.locale(),'so-SO');
});
test('explicit share-link language overrides preference; unsupported language leaves a valid preference',()=>{
  assert.equal(harness({stored:'so',href:'https://example.org/?lang=en#city=Galkayo'}).api.getLanguage(),'en');
  assert.equal(harness({stored:'en',href:'https://example.org/?lang=so'}).heading.textContent,'Roobka maanta');
  assert.equal(harness({stored:'so',href:'https://example.org/?lang=fr'}).api.getLanguage(),'so');
  assert.equal(harness({stored:'invalid'}).api.getLanguage(),'en');
});
test('language buttons persist choice, preserve complete deep link and restore original English text/attributes',()=>{
  const h=harness();h.so.click();assert.equal(h.heading.textContent,'Roobka maanta');assert.equal(h.unavailable.textContent,'Xogta roobka lama hayo');
  assert.equal(h.input.getAttribute('placeholder'),'Magaca qofka ama kooxda');assert.equal(h.input.getAttribute('aria-label'),'Magaalada');
  assert.equal(h.so.getAttribute('aria-pressed'),'true');assert.equal(h.en.getAttribute('aria-pressed'),'false');assert.equal(h.storage.get('somalia-language-v1'),'so');
  const url=new URL(h.root.location.href);assert.equal(url.searchParams.get('coverage'),'all');assert.equal(url.searchParams.get('lang'),'so');assert.equal(url.hash,'#city=Galkayo&view=mayor&day=2026-10-20');
  assert.equal(h.status.textContent,'Bogga waxaa lagu soo bandhigayaa af-Soomaali.');
  h.en.click();assert.equal(h.heading.textContent,'Rainfall today');assert.equal(h.input.getAttribute('placeholder'),'Name or team');assert.equal(h.input.getAttribute('aria-label'),'City');assert.equal(h.document.title,'Rainfall today');assert.equal(h.api.locale(),'en-GB');
  assert.equal(h.so.getAttribute('aria-pressed'),'false');assert.equal(h.api.setLanguage('xx'),false);assert.equal(h.api.getLanguage(),'en');
});
test('form drafts, selected codes, focus and text selections survive either language',()=>{
  const h=harness();const attrs=new Map(h.input.attributes);h.so.click();
  assert.equal(h.input.value,'Rainfall today');assert.equal(h.textarea.value,'Unknown');assert.equal(h.textarea.textContent,'Rainfall today');assert.equal(h.select.value,'all');
  assert.equal(h.document.activeElement,h.input);assert.equal(h.input.selectionStart,3);assert.equal(h.input.selectionEnd,8);
  assert.equal(h.input.getAttribute('id'),attrs.get('id'));assert.equal(h.input.getAttribute('data-action-field'),attrs.get('data-action-field'));
  assert.equal(h.textarea.getAttribute('placeholder'),'Magaca qofka ama kooxda');assert.equal(h.textarea.getAttribute('aria-label'),'Magaalada');h.en.click();assert.equal(h.textarea.getAttribute('placeholder'),'Name or team');
});
test('live-rendered text and labels are retranslated then restored from their latest original',()=>{
  const h=harness({stored:'so'});h.heading.textContent='Flood map';h.input.setAttribute('aria-label','Unknown');h.mutate();
  assert.equal(h.heading.textContent,'Khariidadda fatahaadda');assert.equal(h.input.getAttribute('aria-label'),'Xog aan la hayn');
  const number=new Element('span').append('25.7 mm');h.body.append(number);h.mutate();assert.equal(number.textContent,'25.7 mm');
  h.api.setLanguage('en');assert.equal(h.heading.textContent,'Flood map');assert.equal(h.input.getAttribute('aria-label'),'Unknown');
  assert.equal(h.root.observed.options.attributeFilter.includes('data-action-field'),false);
});
test('official/source and user content remains original even if it exactly equals UI wording',()=>{
  const h=harness();const report=new Element('p',{class:'community-description'}).append('Unknown');const author=new Element('strong',{'data-i18n-skip':'',lang:'und'}).append('Rainfall today');
  const comment=new Element('div',{class:'community-comment'}).append(new Element('p').append('Flood map'));
  const action=new Element('div',{class:'mayor-action-title'}).append(new Element('strong').append('Rainfall today'));
  const owner=new Element('span',{class:'mayor-action-owner-value'}).append('Unknown');
  h.body.append(report,author,comment,action,owner);h.so.click();
  assert.equal(h.protectedText.textContent,'Rainfall today');assert.equal(report.textContent,'Unknown');assert.equal(author.textContent,'Rainfall today');assert.equal(comment.textContent,'Flood map');assert.equal(action.textContent,'Rainfall today');assert.equal(owner.textContent,'Unknown');assert.equal(h.brand.textContent,'El Nino Watch');
  const anonymous=new Element('strong').append('Anonymous');h.body.append(anonymous);h.mutate();assert.notEqual(anonymous.textContent,'Anonymous');
});
test('media filename attributes are protected while preview controls translate',()=>{
  const h=harness();const preview=new Element('div',{class:'community-media community-previews'});
  const figure=new Element('figure');
  const img=new Element('img',{alt:'Rainfall today','aria-label':'Unknown','data-i18n-user-attrs':'alt aria-label'});
  const caption=new Element('figcaption').append(new Element('span',{'data-i18n-skip':''}).append('Rainfall today'),new Element('button').append('Remove'));
  figure.append(img,caption);preview.append(figure);h.body.append(preview);h.so.click();
  assert.equal(img.getAttribute('alt'),'Rainfall today');assert.equal(img.getAttribute('aria-label'),'Unknown');assert.equal(caption.childNodes[0].textContent,'Rainfall today');assert.notEqual(caption.childNodes[1].textContent,'Remove');
});
test('dynamic patterns preserve people, filenames, IDs and numbers while translating their labels',()=>{
  const h=harness({stored:'so'}),t=h.api.translateText;
  assert.equal(t('Edit Rainfall today'),'Wax ka beddel Rainfall today');assert.equal(t('Status for Unknown'),'Xaaladda Unknown');
  assert.match(t('Open report · 17 media'),/17/);assert.ok(!t('Open report · 17 media').includes(' media'));
  assert.equal(t('Report ID_A_101'),'Warbixinta ID_A_101');
  const title='Edit 14 October 2026';assert.equal(t(title),'Wax ka beddel 14 October 2026');
  const gauge=t('Matched gauge: 14 Oct 2026 · 3.50 m · observed 14 Oct 2026. Gauge stage is not flood depth at this city or map point.');
  assert.ok(gauge.includes('14 Oct 2026 · 3.50 m'),'Date-looking station name remains original');assert.ok(gauge.includes('14 Oktoobar 2026'),'Generated observation date is localized');
  assert.equal(t('6.76970, 47.43080'),'6.76970, 47.43080');assert.equal(t('3.50 m³/s'),'3.50 m³/s');assert.equal(t('—'),'—');
});
test('unknown rainfall and missing acquisition do not become zero, safety or flood absence',()=>{
  const h=harness({stored:'so'}),t=h.api.translateText;
  assert.equal(t('Rainfall unavailable'),'Xogta roobka lama hayo');assert.equal(t('Unknown'),'Xog aan la hayn');
  assert.equal(t(' · No acquisition returned'),' · Sawir la qaaday lama helin');
  assert.equal(t('Inside a mapped historical footprint.'),'Waxay ku dhex taallaa dhul khariidaddu muujinayso inuu hore u fatahay.');
  assert.ok(!t('— sunset ↓ EAT').includes('sunset'));assert.ok(t('— sunset ↓ EAT').startsWith('—'));assert.ok(t('— sunset ↓ EAT').endsWith('EAT'));
});
test('denied preference storage still switches language and shows a localized limitation',()=>{
  const h=harness({failStorage:true});assert.equal(h.api.setLanguage('so'),true);assert.equal(h.api.getLanguage(),'so');assert.equal(h.heading.textContent,'Roobka maanta');
  assert.equal(h.status.textContent,'Doorashada luqadda laguma kaydin karin qalabkan.');assert.equal(h.storage.size,0);
  assert.equal(h.status.getAttribute('class'),'language-status-error');
});
test('DOMContentLoaded initializes once; source placeholders translate before source arrives',()=>{
  const h=harness({stored:'so',loading:true});assert.equal(h.api.getLanguage(),'en');assert.equal(h.heading.textContent,'Rainfall today');h.ready();assert.equal(h.heading.textContent,'Roobka maanta');
  const enso=new Element('p',{id:'enso-body'}).append('Connecting to the current NOAA advisory.');h.body.append(enso);h.mutate();assert.notEqual(enso.textContent,'Connecting to the current NOAA advisory.');
  enso.setAttribute('data-i18n-skip','');enso.textContent='Official source says: Rainfall today';h.mutate();assert.equal(enso.textContent,'Official source says: Rainfall today');
  enso.removeAttribute('data-i18n-skip');enso.textContent='Advisory unavailable';h.mutate();assert.notEqual(enso.textContent,'Advisory unavailable');
});
