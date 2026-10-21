import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const base = new URL('./somalia-flood-watch/dist/', import.meta.url);
const scripts = Object.fromEntries(await Promise.all(['translations-so.js','i18n.js','community.js'].map(async name=>[name,await fs.readFile(new URL(name,base),'utf8')])));
const NOW = Date.parse('2026-10-14T08:10:00Z');
class Clock extends Date { constructor(...args){super(...(args.length?args:[NOW]));} static now(){return NOW;} }
const decode = value=>String(value).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
const normalize = value=>String(value??'').trim().replace(/\s+/g,' ');

// This token-only DOM adapter does not execute supplied markup. It retains real
// text-node boundaries and implements selector protection used by the actual
// i18n module, so content collisions (e.g. an author called "Weather") are tested.
class TextNode {
  constructor(value,parent){this.nodeType=3;this.nodeValue=decode(value);this.parentElement=parent;}
  get textContent(){return this.nodeValue;}
  set textContent(value){this.nodeValue=String(value);}
}
function selectorParts(selector){
  const result=[];let current='',level=0;
  for(const char of selector){if(char==='(')level++;if(char===')')level--;if(level===0&&(char==='>'||/\s/.test(char))){if(current){result.push(current);current='';}if(char==='>')result.push('>');}else current+=char;}
  if(current)result.push(current);return result;
}
function simpleMatch(node,selector){
  if(node?.nodeType!==1)return false;
  const not=[...selector.matchAll(/:not\(([^)]+)\)/g)].map(match=>match[1]);
  if(not.some(value=>simpleMatch(node,value)))return false;
  selector=selector.replace(/:not\([^)]+\)/g,'');
  const tag=/^[\w-]+/.exec(selector)?.[0];if(tag&&node.tagName.toLowerCase()!==tag.toLowerCase())return false;
  for(const match of selector.matchAll(/#([\w-]+)/g))if(node.id!==match[1])return false;
  for(const match of selector.matchAll(/\.([\w-]+)/g))if(!node.classList.contains(match[1]))return false;
  for(const match of selector.matchAll(/\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]/g)){if(!node.hasAttribute(match[1]))return false;if(match[2]!==undefined&&node.getAttribute(match[1])!==match[2])return false;}
  return true;
}
function matches(node,selector){
  return selector.split(',').some(part=>{
    const parts=selectorParts(part.trim());let current=node,i=parts.length-1;
    if(!simpleMatch(current,parts[i--]||''))return false;
    while(i>=0){
      if(parts[i]==='>'){i--;current=current.parentElement;if(!simpleMatch(current,parts[i--]))return false;}
      else{const wanted=parts[i--];current=current.parentElement;while(current&&!simpleMatch(current,wanted))current=current.parentElement;if(!current)return false;}
    }
    return true;
  });
}
class Element {
  constructor(tag='div',attrs={},parent=null){
    this.nodeType=1;this.tagName=tag.toUpperCase();this.attributes={...attrs};this.parentElement=parent;this.childNodes=[];this.events={};this.disabled=false;this.checked=false;this.value=attrs.value||'';this.name=attrs.name||'';this.type=attrs.type||'';this.open=false;this.dataset={};
    for(const [key,value]of Object.entries(attrs))if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
    this.classList={contains:value=>(this.attributes.class||'').split(/\s+/).includes(value),add(){},remove(){},toggle(){}};
  }
  get id(){return this.attributes.id||'';}
  get elements(){if(this._elements)return this._elements;const list=this.querySelectorAll('input,select,textarea,button');for(const input of list)if(input.name)list[input.name]=input;return list;}
  set elements(value){this._elements=value;}
  get className(){return this.attributes.class||'';}
  set className(value){this.attributes.class=String(value);}
  get textContent(){return this.childNodes.map(child=>child.textContent).join('');}
  set textContent(value){this.childNodes=[new TextNode(String(value),this)];}
  get innerHTML(){return this._sourceHtml||'';}
  set innerHTML(value){this._sourceHtml=String(value);this.childNodes=parse(value,this).childNodes;}
  hasAttribute(name){return Object.hasOwn(this.attributes,name);}
  getAttribute(name){return this.attributes[name]??null;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  removeAttribute(name){delete this.attributes[name];}
  addEventListener(name,handler){this.events[name]=handler;}
  closest(selector){for(let item=this;item;item=item.parentElement)if(matches(item,selector))return item;return null;}
  querySelectorAll(selector){const list=[];const walk=node=>{for(const child of node.childNodes||[])if(child.nodeType===1){if(matches(child,selector))list.push(child);walk(child);}};walk(this);return list;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  insertAdjacentHTML(_where,markup){const root=parse(markup,this.parentElement);if(!this.parentElement)return;const index=this.parentElement.childNodes.indexOf(this);this.parentElement.childNodes.splice(index+1,0,...root.childNodes);}
  scrollIntoView(){}
  focus(){}
}
const voidTags=new Set(['br','img','input','source','hr','meta','link']);
function parse(html,parent=null){
  const root=new Element('fragment',{},parent),stack=[root];
  for(const match of String(html).matchAll(/<!--[^]*?-->|<\/?[a-z][^>]*>|[^<]+/gi)){
    const value=match[0];if(value.startsWith('<!--'))continue;
    if(value.startsWith('</')){const tag=value.match(/^<\/([\w-]+)/)?.[1].toUpperCase();const at=stack.findLastIndex(node=>node.tagName===tag);if(at>0)stack.splice(at);continue;}
    if(value.startsWith('<')){const tag=value.match(/^<([\w-]+)/)[1];const attrs=Object.fromEntries([...value.matchAll(/([\w-]+)(?:="([^"]*)"|='([^']*)')?/g)].slice(1).map(m=>[m[1],decode(m[2]??m[3]??'')]));const node=new Element(tag,attrs,stack.at(-1));stack.at(-1).childNodes.push(node);if(!voidTags.has(tag)&&!value.endsWith('/>'))stack.push(node);}
    else stack.at(-1).childNodes.push(new TextNode(value,stack.at(-1)));
  }
  for(const child of root.childNodes)child.parentElement=parent||root;return root;
}
const protectedSelector='script,style,textarea,pre,code,[data-i18n-skip],.community-description,.community-comment>p,.community-media:not(.community-previews) figcaption';
const attributeProtectedSelector=protectedSelector.replace('textarea,','');
const ignored = value=>!/[A-Za-z]{3}/.test(value)||/^(?:Mogadishu|Galkayo|Mudug|EAT|UTC|CSV|Located GeoJSON|https:\/\/\.\.\.)$/.test(value)||/^\d.*EAT$/.test(value)||/^https?:/.test(value);
function fragments(root){
  const items=[];const walk=node=>{
    if(node.nodeType===3){if(!node.parentElement?.closest(protectedSelector)&&normalize(node.nodeValue))items.push({node,text:normalize(node.nodeValue),kind:'text'});return;}
    if(!node.closest(attributeProtectedSelector))for(const name of ['aria-label','title','placeholder','alt','aria-description'])if(node.hasAttribute(name)&&!(node.getAttribute('data-i18n-user-attrs')||'').split(/\s+/).includes(name))items.push({node,text:normalize(node.getAttribute(name)),kind:name});
    for(const child of node.childNodes)walk(child);
  };walk(root);return items;
}
function coverage(root,language,label){const missing=fragments(root).filter(item=>!ignored(item.text)&&normalize(language.translateText(item.text))===item.text).map(item=>`${item.kind}: ${item.text}`);assert.deepEqual([...new Set(missing)],[],label+' has untranslated generated UI');}
function setup(){
  const doc={body:new Element('body'),documentElement:new Element('html'),readyState:'loading',title:'El Nino Watch',addEventListener(){},querySelectorAll(selector){return this.body.querySelectorAll(selector);},getElementById(id){return this.body.id===id?this.body:this.body.querySelector('#'+id);}};
  doc.body.innerHTML='<div id="community-root"></div><span id="language-status"></span>';
  const storage=new Map([['somalia-community-report-receipts-v1',JSON.stringify({'report-1':'saved-receipt-test'})]]),calls=[],confirms=[];
  let reports=[],fail=false;
  const root={document:doc,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))},location:{href:'http://127.0.0.1:4173/',origin:'http://127.0.0.1:4173',protocol:'http:'},history:{replaceState(){}},Date:Clock,setTimeout,addEventListener(){},confirm(value){confirms.push(value);return false;}};
  const sandbox={window:root,document:doc,localStorage:root.localStorage,location:root.location,navigator:{},Date:Clock,URL,URLSearchParams,Map,Set,WeakMap,AbortController,FormData,Blob,CSS:{escape:value=>value},setTimeout,clearTimeout,console,fetch:async(url,options)=>{calls.push({url,options});return fail?{ok:false,status:503,json:async()=>({error:'Source returned HTTP 503'})}:{ok:true,status:200,json:async()=>({reports,fetchedAt:'2026-10-14T08:05:00Z',total:reports.length})};}};
  const context=vm.createContext(sandbox);for(const name of ['translations-so.js','i18n.js','community.js'])vm.runInContext(scripts[name],context);
  const language=root.SiteLanguage;language.setLanguage('so');
  const api=root.CommunityReports,cities=[['Mogadishu'],['Galkayo']];api.init({cities});
  const form=doc.getElementById('community-report-form');const inputs=form.querySelectorAll('input,select,textarea,button');form.elements=inputs;for(const input of inputs)if(input.name)form.elements[input.name]=input;
  form.reset=()=>{for(const input of inputs){input.value='';input.checked=false;}};
  return {context,root,doc,language,api,form,cities,calls,confirms,storage,node:id=>doc.getElementById(id),setReports:value=>{reports=value;},setFailure:value=>{fail=value;},apply:()=>language.apply(doc.body)};
}
const sample={id:'report-1',cityId:'mogadishu',category:'flood',author:'Weather',description:'All 44 cities',observedAt:'2026-10-14T07:00:00Z',receivedAt:'2026-10-14T08:00:00Z',deaths:null,injuries:0,damagedProperties:2,latitude:2.04,longitude:45.31,sourceUrl:'https://example.org/Unknown?label=Weather',media:[{url:'/api/community/media/photo-test.jpg',type:'image/jpeg',name:'Unknown'},{url:'/api/community/media/video-test.mp4',type:'video/mp4',name:'Rainfall'}],comments:[{id:'comment-1',author:'Alerts',body:'Rainfall',receivedAt:'2026-10-14T08:00:00Z'}]};

test('generated report form translates labels, placeholders, impact, privacy and public consent completely',async t=>{
  const h=setup();await h.api.refresh();coverage(h.node('community-root'),h.language,'Report form');
  const before=fragments(h.node('community-root'));assert.ok(before.length>55,'whole generated form and feed are inspected');h.apply();
  for(const phrase of ['City','What happened?','Describe your observation','Deaths','Injuries','Properties damaged','Latitude','Longitude','Publish report','Report type','All observations'])assert.ok(h.node('community-root').textContent.includes(h.language.translateText(phrase)),phrase);
  const description=h.form.elements.description,author=h.form.elements.author;
  assert.notEqual(description.getAttribute('placeholder'),'Describe water levels, rain, affected roads or damage. Include a nearby landmark if useful.');
  assert.equal(author.getAttribute('placeholder'),h.language.translateText('Anonymous'));
  for(const phrase of ['Leave a count blank if unknown. Enter 0 only if you know there were none. Avoid names or identifying details of victims.','Device location is used only when you tap the button. Coordinates you submit will be public; choose a safe location to share.','I have permission to share this media and understand that this report will be public and unverified.'])assert.ok(h.node('community-root').textContent.includes(h.language.translateText(phrase)),phrase);
  t.diagnostic(`Inspected ${before.length} generated UI text and attribute fragments`);
});

test('report/comment labels translate while colliding author, body and media values stay exact',()=>{
  const h=setup(),article=parse(h.api.renderReport(sample,{own:true}));coverage(article,h.language,'Report card');
  h.language.apply(article);
  assert.equal(article.querySelector('.community-description').textContent,sample.description);
  assert.equal(article.querySelector('.community-comment>p').textContent,sample.comments[0].body);
  assert.deepEqual(article.querySelectorAll('[data-i18n-skip]').map(node=>node.textContent),['Weather','Alerts']);
  assert.deepEqual(article.querySelectorAll('.community-media figcaption').map(node=>node.textContent),['Unknown','Rainfall']);
  assert.equal(article.querySelector('img').getAttribute('alt'),'Unknown');
  assert.equal(article.querySelector('video').getAttribute('aria-label'),'Rainfall');
  assert.equal(article.querySelector('.community-source').getAttribute('href'),sample.sourceUrl);
  assert.equal(article.querySelector('.community-map-link').getAttribute('data-report-location'),'report-1');
  for(const phrase of ['Reported deaths','Reported injuries','Properties damaged','Unverified community report','Post comment'])assert.ok(article.textContent.includes(h.language.translateText(phrase)),phrase);
  assert.match(article.querySelector('.community-comments>summary').textContent,/faallo/i);
  assert.equal(article.querySelector('.community-metric>strong').textContent,h.language.translateText('Unknown'));
  h.language.setLanguage('en');h.language.apply(article);
  assert.equal(article.querySelector('.community-badge').textContent,'Unverified community report');
  assert.equal(article.querySelector('.community-description').textContent,sample.description);
});

test('anonymous fallbacks translate while a real author named Anonymous stays protected',()=>{
  const h=setup();
  const unnamed=parse(h.api.renderReport({...sample,author:'',comments:[{...sample.comments[0],author:''}]}));h.language.apply(unnamed);
  assert.ok(unnamed.querySelector('.community-card-meta').textContent.includes(h.language.translateText('Anonymous')));
  assert.equal(unnamed.querySelector('.community-comment strong').textContent,h.language.translateText('Anonymous'));
  const named=parse(h.api.renderReport({...sample,author:'Anonymous',comments:[{...sample.comments[0],author:'Anonymous'}]}));h.language.apply(named);
  assert.deepEqual(named.querySelectorAll('[data-i18n-skip]').map(node=>node.textContent),['Anonymous','Anonymous']);
});

test('all validation branches and combined upload errors have Somali coverage without changing counts or file names',()=>{
  const h=setup(),now=new Clock(),valid={cityId:'mogadishu',category:'flood',author:'Observer',description:'Observation near the bridge.',observedAt:'2026-10-14T10:00',latitude:'',longitude:'',deaths:'',injuries:'0',damagedProperties:'2',sourceUrl:''};
  const mutations=[{cityId:'unknown'},{category:'storm'},{author:'x'.repeat(61)},{description:'short'},{observedAt:'bad'},{observedAt:'2026-10-15T10:00'},{observedAt:'1999-12-31T10:00'},{latitude:'2.0'},{latitude:'90',longitude:'45'},{deaths:'1.5'},{sourceUrl:'javascript:alert(1)'}];
  const errors=mutations.flatMap(delta=>h.api.validateDraft({...valid,...delta},h.cities,now).errors);
  const files=[{name:'Weather',type:'text/html',size:0}];errors.push(...h.api.validateFiles(files).errors,...h.api.validateFiles(Array.from({length:5},()=>({name:'Unknown',type:'image/png',size:1}))).errors,...h.api.validateFiles([{name:'big.mp4',type:'video/mp4',size:60*1024*1024}]).errors);
  for(const message of errors)assert.notEqual(h.language.translateText(message),message,'Untranslated validation: '+message);
  const joined=errors.join(' '),translated=h.language.translateText(joined);assert.ok(!translated.includes('Choose a city from the list.'),'concatenated validation errors also translate');assert.ok(!translated.includes('Use a name or alias'),'concatenated name validation translates');
  assert.ok(h.language.translateText(errors.find(value=>value.startsWith('Weather:'))).startsWith('Weather:'),'uploaded name is preserved inside validation');
  const result=h.api.validateDraft(valid,h.cities,now);assert.equal(result.payload.author,'Observer');assert.equal(result.payload.description,valid.description);assert.equal(result.payload.injuries,0);assert.equal(result.payload.deaths,null);
});

test('native deletion confirmation follows the selected language and never sends a declined deletion',async()=>{
  const h=setup();h.setReports([sample]);await h.api.refresh();const button=new Element('button',{'data-delete-report':'report-1'});
  const target={closest:selector=>selector==='[data-delete-report]'?button:null};h.node('community-root').events.click({target});
  const original='Delete your report, uploaded media and its comments? This cannot be undone.';
  assert.equal(h.confirms.at(-1),h.language.translateText(original));assert.notEqual(h.confirms.at(-1),original);
  assert.equal(h.calls.some(call=>call.options?.method==='DELETE'),false);
  h.language.setLanguage('en');h.node('community-root').events.click({target});assert.equal(h.confirms.at(-1),original);
});

test('model identifiers, source URLs, exported bodies and public report status remain machine-readable',()=>{
  const h=setup();const englishCsv=h.api.buildExport([sample],'csv'),englishGeo=h.api.buildExport([sample],'geojson');h.language.setLanguage('en');
  assert.equal(h.api.buildExport([sample],'csv').content,englishCsv.content);assert.equal(h.api.buildExport([sample],'geojson').content,englishGeo.content);
  const feature=JSON.parse(englishGeo.content).features[0];assert.equal(feature.properties.author,sample.author);assert.equal(feature.properties.description,sample.description);assert.equal(feature.properties.sourceUrl,sample.sourceUrl);assert.equal(feature.properties.status,'unverified');assert.equal(feature.properties.deaths,null);assert.deepEqual(feature.geometry.coordinates,[45.31,2.04]);
});

test('service and geolocation failures translate clearly without inventing reports',async()=>{
  const h=setup();h.setReports([sample]);await h.api.refresh();h.setFailure(true);await h.api.refresh();h.apply();
  assert.ok(!h.node('community-status').textContent.includes('Community reports unavailable:'));assert.ok(h.node('community-status').textContent.includes('HTTP 503'));assert.equal(h.node('community-feed-list').querySelectorAll('.community-card').length,0);
  h.node('community-use-location').events.click();h.apply();assert.equal(h.node('community-location-status').textContent,h.language.translateText('Device location is unavailable. Enter coordinates manually.'));
});
