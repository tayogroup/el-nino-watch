/* Curated English/Somali interface translations; source and user content stay original. */
(function(global){
 'use strict';
 const doc=global.document,KEY='somalia-language-v1',languages=new Set(['en','so']);
 const catalog=global.SOMALIA_TRANSLATIONS_SO||{messages:{},patterns:[]};
 const normalize=value=>String(value??'').trim().replace(/\s+/g,' ');
 const messages=new Map(Object.entries(catalog.messages||{}).map(([en,so])=>[normalize(en),so]));
 const folded=new Map([...messages].map(([en,so])=>[en.toLocaleLowerCase('en'),so]));
 const textState=new WeakMap(),attributeState=new WeakMap();
 const attrs=['aria-label','title','placeholder','alt','aria-description'];
 const protectedSelector='script,style,textarea,pre,code,[data-i18n-skip],.brand-title,.footer-brand>b,.community-description,.community-comment>p,.community-media:not(.community-previews) figcaption,.mayor-report-description,.mayor-action-title>strong,.mayor-action-owner-value,.extra-city-heading h3,#log .logitem>p,.event>b,.leaflet-control-attribution';
 const attributeProtectedSelector=protectedSelector.replace('textarea,','');
 let language='en',scheduled=false,observer=null,sourceTitle=null,lastTitle=null;
 const escapeRegex=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const patterns=(catalog.patterns||[]).map(pattern=>{
  let at=0,expression='^',groups=[],dateGroups=[];const en=normalize(pattern.en),tokens=/\{(\d+)\}/g;let match;
  while((match=tokens.exec(en))){expression+=escapeRegex(en.slice(at,match.index));expression+='([\\s\\S]*?)';const id=Number(match[1]);groups.push(id);if(/(?:retrieved|retrieval|generated|observed|expires|issued|fetched|updated|due|starts|ends|(?:selected|forecast|planning)?\s*date|(?:selected|forecast|planning)\s+day)\s*(?:(?:at|on)\s*)?:?\s*$/i.test(en.slice(0,match.index)))dateGroups.push(id);at=match.index+match[0].length;}
  expression+=escapeRegex(en.slice(at))+'$';
  return {...pattern,en,regex:new RegExp(expression,'i'),groups,dateGroups,weight:en.replace(/\{\d+\}/g,'').length};
 }).filter(pattern=>pattern.weight>=4).sort((a,b)=>b.weight-a.weight);
 const months={Jan:'Janaayo',Feb:'Febraayo',Mar:'Maarso',Apr:'Abriil',May:'Maajo',Jun:'Juun',Jul:'Luulyo',Aug:'Agoosto',Sep:'Sebtembar',Sept:'Sebtembar',Oct:'Oktoobar',Nov:'Nofeembar',Dec:'Diseembar',January:'Janaayo',February:'Febraayo',March:'Maarso',April:'Abriil',June:'Juun',July:'Luulyo',August:'Agoosto',September:'Sebtembar',October:'Oktoobar',November:'Nofeembar',December:'Diseembar'};
 const weekdays={Mon:'Isniin',Tue:'Talaado',Wed:'Arbaco',Thu:'Khamiis',Fri:'Jimce',Sat:'Sabti',Sun:'Axad',Monday:'Isniin',Tuesday:'Talaado',Wednesday:'Arbaco',Thursday:'Khamiis',Friday:'Jimce',Saturday:'Sabti',Sunday:'Axad'};
 function dateText(value){
  const text=normalize(value);if(!/\d/.test(text)||/[\/\\]/.test(text))return value;
  const names=Object.keys(months).join('|'),days=Object.keys(weekdays).join('|');
  const date='(?:'+days+')?,?\\s*\\d{1,2}(?:[–-]\\d{1,2})?\\s*(?:'+names+')(?:\\s+\\d{4})?';
  const regex=new RegExp('^'+date+'(?:\\s*[–-]\\s*'+date+')?(?:[, ]+\\d{2}:\\d{2}(?::\\d{2})?)?(?:\\s+(?:EAT|UTC))?$','i');
  if(!regex.test(text))return value;
  return text.replace(new RegExp('\\b('+names+'|'+days+')\\b','g'),word=>months[word]||weekdays[word]||word);
 }
 function core(text,depth=0){
  if(messages.has(text))return messages.get(text);
  const lower=text.toLocaleLowerCase('en');if(folded.has(lower)){const value=folded.get(lower);return /[A-Z]/.test(text)&&text===text.toLocaleUpperCase('en')?value.toLocaleUpperCase('so'):value;}
  const punctuation=/^(.*\S)([.!?:])$/.exec(text);if(punctuation){const key=punctuation[1],value=messages.get(key)||folded.get(key.toLocaleLowerCase('en'));if(value)return value.replace(/[.!?:]$/,'')+punctuation[2];}
  for(const pattern of patterns){
   const match=pattern.regex.exec(text);if(!match)continue;
   const values=new Map();let consistent=true;
   pattern.groups.forEach((id,index)=>{const value=match[index+1];if(values.has(id)&&values.get(id)!==value)consistent=false;else values.set(id,value);});
   if(!consistent)continue;
   const recursive=Array.isArray(pattern.translate)?pattern.translate:[];
   return pattern.so.replace(/\{(\d+)\}/g,(_,id)=>{
    const value=values.get(Number(id))??'';
    if(depth<3&&recursive.includes(Number(id)))return translate(value,'so',depth+1);
    return pattern.dateGroups.includes(Number(id))?dateText(value):value;
   });
  }
  if(depth<3){
   const leading=/^([·|—→↗↑↓]+\s*)(.+)$/.exec(text);if(leading)return leading[1]+translate(leading[2],'so',depth+1);
   const trailing=/^(.+?)(\s*[↗↑↓→]+)$/.exec(text);if(trailing)return translate(trailing[1],'so',depth+1)+trailing[2];
   for(const separator of [/(\s+[·|—→]\s+|\n+)/,/(?<=[.!?])(\s+)(?=[A-Z])/]){
    const pieces=text.split(separator);if(pieces.length<3)continue;
    const result=pieces.map((piece,index)=>index%2?piece:translate(piece,'so',depth+1)).join('');
    if(result!==text)return result;
   }
  }
  return dateText(text);
 }
 function translate(value,selected=language,depth=0){
  const original=String(value??'');if(selected!=='so'||!original.trim())return original;
  const prefix=original.match(/^\s*/)[0],suffix=original.match(/\s*$/)[0];
  return prefix+core(normalize(original),depth)+suffix;
 }
 function protectedNode(element){return !!element?.closest?.(protectedSelector);}
 function updateText(node){
  if(protectedNode(node.parentElement))return;
  const actual=node.nodeValue;if(!actual?.trim())return;
  let state=textState.get(node);if(!state||actual!==state.last)state={source:actual,last:actual};
  const wanted=translate(state.source);if(actual!==wanted)node.nodeValue=wanted;
  state.last=wanted;textState.set(node,state);
 }
 function updateAttributes(element){
  if(element?.closest?.(attributeProtectedSelector))return;
  let states=attributeState.get(element);if(!states){states=new Map();attributeState.set(element,states);}
  const userAttrs=(element.getAttribute?.('data-i18n-user-attrs')||'').split(/\s+/);
  for(const name of attrs){
   if(userAttrs.includes(name)||!element.hasAttribute?.(name))continue;
   const actual=element.getAttribute(name);let state=states.get(name);if(!state||actual!==state.last)state={source:actual,last:actual};
   const wanted=translate(state.source);if(actual!==wanted)element.setAttribute(name,wanted);
   state.last=wanted;states.set(name,state);
  }
 }
 function apply(root=doc?.body){
  if(!doc||!root)return;
  const walk=node=>{if(node.nodeType===3){updateText(node);return;}if(node.nodeType===1){updateAttributes(node);if(protectedNode(node))return;}for(const child of Array.from(node.childNodes||[]))walk(child);};
  walk(root);
  doc.documentElement?.setAttribute?.('lang',language);
  if(typeof doc.title==='string'){
   if(sourceTitle===null||doc.title!==lastTitle)sourceTitle=doc.title;
   const wanted=translate(sourceTitle);if(doc.title!==wanted)doc.title=wanted;lastTitle=wanted;
  }
  for(const button of Array.from(doc.querySelectorAll?.('[data-site-language]')||[]))button.setAttribute('aria-pressed',String(button.dataset.siteLanguage===language));
 }
 function readPreference(){
  try{const value=new URL(global.location?.href||'http://localhost/').searchParams.get('lang');if(languages.has(value))return value;}catch{}
  try{const value=global.localStorage?.getItem(KEY);if(languages.has(value))return value;}catch{}
  return 'en';
 }
 function setLanguage(value){
  if(!languages.has(value))return false;language=value;let saved=true;
  try{if(!global.localStorage)throw Error('Storage unavailable');global.localStorage.setItem(KEY,value);if(global.localStorage.getItem(KEY)!==value)throw Error('Storage unavailable');}catch{saved=false;}
  try{const url=new URL(global.location?.href);if(/^https?:$/.test(url.protocol)&&global.history?.replaceState){url.searchParams.set('lang',value);global.history.replaceState(null,'',url.pathname+url.search+url.hash);}}catch{}
  const status=doc?.getElementById?.('language-status');if(status){status.setAttribute('class',saved?'language-sr-only':'language-status-error');status.textContent=saved?(value==='so'?'Showing the site in Somali.':'Showing the site in English.'):'Language preference could not be saved on this device.';}
  apply();return true;
 }
 function init(){
  if(!doc)return;language=readPreference();
  for(const button of Array.from(doc.querySelectorAll?.('[data-site-language]')||[]))button.addEventListener('click',()=>setLanguage(button.dataset.siteLanguage));
  apply();
  if(typeof global.MutationObserver==='function'){
   observer=new global.MutationObserver(()=>{if(scheduled)return;scheduled=true;const schedule=global.queueMicrotask||((fn)=>global.setTimeout(fn,0));schedule(()=>{scheduled=false;apply();});});
   observer.observe(doc.documentElement||doc.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:attrs});
  }
 }
 global.SiteLanguage={getLanguage:()=>language,translateText:translate,apply,setLanguage,locale:()=>language==='so'?'so-SO':'en-GB'};
 if(doc?.readyState==='loading')doc.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(typeof window!=='undefined'?window:globalThis);
