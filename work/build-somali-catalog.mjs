import fs from 'node:fs/promises';
const common={
 'Language / Luqad':'Language / Luqad','Showing the site in Somali.':'Bogga waxaa lagu soo bandhigayaa af-Soomaali.','Showing the site in English.':'Bogga waxaa lagu soo bandhigayaa af-Ingiriisi.','Language preference could not be saved on this device.':'Doorashada luqadda laguma kaydin karin qalabkan.',
 'Source notices and submitted text keep their original language.':'Ogeysiisyada ilaha xogta iyo qoraallada la soo gudbiyey waxay ku sii jiraan luqaddoodii asalka ahayd.',
 'Mayor dashboard':'Bogga duqa magaalada','MAYOR DASHBOARD':'BOGGA DUQA MAGAALADA','matched':'ku habboon goobtan','Add a city':'Ku dar magaalo',
 'Lower Shabelle':'Shabeellaha Hoose','Middle Shabelle':'Shabeellaha Dhexe','Lower Juba':'Jubbada Hoose','Somalia':'Soomaaliya','Ethiopia':'Itoobiya','Kenya':'Kiiniya','Djibouti':'Jabuuti','Yemen':'Yaman','Gulf of Aden':'Gacanka Cadmeed','Indian Ocean':'Badweynta Hindiya',
 'Coastal / urban drainage':'Xeebta / marinnada biyaha ee magaalada','Inland / flash runoff':'Dhulka gudaha / qulqulka degdegga ah ee biyaha roobka','Coastal / flash runoff':'Xeebta / qulqulka degdegga ah ee biyaha roobka','Coastal / lower Juba region':'Xeebta / gobolka Jubbada Hoose','Inland / urban drainage':'Dhulka gudaha / marinnada biyaha ee magaalada','Inland / seasonal channels':'Dhulka gudaha / togagga xilliyeed','Shabelle river corridor':'Aagga ku teedsan webiga Shabeelle','Coastal / lower Shabelle region':'Xeebta / gobolka Shabeellaha Hoose','Juba river corridor':'Aagga ku teedsan webiga Jubba','Juba / Dawa river confluence':'Halka ay webiyada Jubba iyo Daawa ku kulmaan','Coastal / seasonal channels':'Xeebta / togagga xilliyeed',
 'Zoom in':'Soo dhowee','Zoom out':'Fogee','Responsible:':'Cidda masuulka ka ah:','Owner / team':'Qofka masuulka ah / kooxda','Observed':'La arkay','Reported deaths':'Dhimashada la soo sheegay','Reported injuries':'Dhaawacyada la soo sheegay','Properties damaged':'Hantida waxyeelladu gaartay','Due date':'Taariikhda kama dambaysta ah','Priority':'Mudnaanta','No due date':'Taariikh kama dambays ah lama cayimin','Expires':'Wuxuu ku eg yahay'
};
const decode=text=>String(text).replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:\d+|x[0-9a-f]+);/gi,entity=>{const names={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '};if(names[entity])return names[entity];const n=entity.startsWith('&#x')?parseInt(entity.slice(3,-1),16):parseInt(entity.slice(2,-1),10);return Number.isFinite(n)?String.fromCodePoint(n):entity;});
const clean=value=>decode(value).trim().replace(/\s+/g,' '),messages={},patterns=new Map(),conflicts=[];
for(const name of ['public','weather','mayor']){
 const pack=JSON.parse(await fs.readFile(new URL('./i18n-'+name+'.json',import.meta.url),'utf8'));
 for(const [en,so]of Object.entries(pack.messages)){const key=clean(en);if(messages[key]&&messages[key]!==decode(so))conflicts.push({key,chosenPack:name});messages[key]=decode(so);}
 for(const entry of pack.patterns||[]){const en=clean(entry.en),so=decode(entry.so),ids=s=>[...new Set([...s.matchAll(/\{(\d+)\}/g)].map(m=>Number(m[1])))].sort((a,b)=>a-b);if(JSON.stringify(ids(en))!==JSON.stringify(ids(so)))throw Error('Placeholder mismatch: '+en);if(entry.translate&&!entry.translate.every(id=>ids(en).includes(id)))throw Error('Invalid recursive capture: '+en);patterns.set(en,{...entry,en,so});}
}
Object.assign(messages,common);
// These captures contain generated availability/date labels, never source quotations or user text.
for(const [en,indices]of [
 ['Latest Copernicus radar acquisition: {0}',[0]],
 ['Latest Copernicus optical acquisition: {0}; scene-wide cloud cover {1}',[0,1]],
 ['Dated water product: {0}; selected date {1} UTC',[1]]
]){const entry=patterns.get(en);if(!entry)throw Error('Missing export pattern: '+en);entry.translate=indices;}
patterns.set('Created by {0}',{en:'Created by {0}',so:'Waxaa sameeyay {0}'});
const catalog={messages,patterns:[...patterns.values()]};
await fs.writeFile(new URL('./somalia-flood-watch/dist/translations-so.js',import.meta.url),'/* Curated standard Somali interface catalog. Source and user data are not machine-translated. */\nwindow.SOMALIA_TRANSLATIONS_SO='+JSON.stringify(catalog)+';\n');
await fs.writeFile(new URL('./i18n-catalog-conflicts.json',import.meta.url),JSON.stringify(conflicts,null,2));
console.log(JSON.stringify({messages:Object.keys(messages).length,patterns:patterns.size,sharedPhrasesReviewed:conflicts.length}));
