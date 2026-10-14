import fs from 'node:fs/promises';
const base=new URL('./somalia-flood-watch/',import.meta.url),out=new URL('../outputs/El-Nino-Watch/',import.meta.url);
const stage=new URL('./package-stage/El-Nino-Watch/',import.meta.url);
await fs.mkdir(out,{recursive:true});
await fs.cp(new URL('dist/',base),new URL('dist/',out),{recursive:true});
for(const file of ['server.mjs','feeds.mjs','hazards.mjs','alerts-feed.mjs','observed-flood.mjs','copernicus.mjs','community.mjs','backup.mjs','Start-Live-App.ps1','README.md'])await fs.copyFile(new URL(file,base),new URL(file,out));
await fs.mkdir(stage,{recursive:true});
await fs.cp(new URL('dist/',base),new URL('dist/',stage),{recursive:true});
for(const file of ['server.mjs','feeds.mjs','hazards.mjs','alerts-feed.mjs','observed-flood.mjs','copernicus.mjs','community.mjs','backup.mjs','Start-Live-App.ps1','README.md'])await fs.copyFile(new URL(file,base),new URL(file,stage));
let html=await fs.readFile(new URL('dist/index.html',base),'utf8');
for(const file of ['vendor/leaflet.css','style.css','alerts.css','design.css','enhancements.css','terrain.css','watchlist.css','copernicus.css','mayor.css','flood-outlook.css','extra-cities.css','rankings.css','i18n.css','tabs.css']){
 const content=await fs.readFile(new URL('dist/'+file,base),'utf8');
 html=html.replace(`<link rel="stylesheet" href="${file}">`,()=>`<style>${content}</style>`);
}
const hazardSources=await fs.readFile(new URL('dist/hazard-sources.json',base),'utf8');
html=html.replace('</head>',()=>`<script>window.HAZARD_SOURCES=${hazardSources};</script></head>`);
for(const file of ['vendor/leaflet.js','planning.js','basemap-data.js','cities.js','observed.js','map-context.js','terrain.js','map.js','daily.js','copernicus.js','alerts.js','community.js','flood-outlook.js','extra-cities-store.js','extra-cities.js','mayor-store.js','mayor.js','rankings.js','tabs.js','home-city.js','translations-so.js','i18n.js','app.js']){
 const content=(await fs.readFile(new URL('dist/'+file,base),'utf8')).replace(/<\/script/gi,'<\\/script');
 html=html.replace(`<script src="${file}"></script>`,()=>`<script>${content}</script>`);
}
await fs.writeFile(new URL('../outputs/El-Nino-Watch.html',import.meta.url),html);
console.log('Updated runtime and portable HTML. Use the server package for all live relays.');
