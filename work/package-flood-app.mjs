import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {serverModules, pageAssets} from './package-files.mjs';
const base=new URL('./somalia-flood-watch/',import.meta.url);
// PACKAGE_OUT moves all three outputs under one folder (the tests build there); the default is as before.
const root=process.env.PACKAGE_OUT?pathToFileURL(process.env.PACKAGE_OUT.replace(/[\\/]?$/,'/')):null;
const out=root?new URL('El-Nino-Watch/',root):new URL('../outputs/El-Nino-Watch/',import.meta.url);
const stage=root?new URL('package-stage/El-Nino-Watch/',root):new URL('./package-stage/El-Nino-Watch/',import.meta.url);
const portable=root?new URL('El-Nino-Watch.html',root):new URL('../outputs/El-Nino-Watch.html',import.meta.url);
// server.mjs and everything it imports, followed through the code so a new module is never left behind.
const runtime=[...await serverModules(base),'Start-Live-App.ps1','README.md'];
for(const folder of [out,stage]){
 await fs.mkdir(folder,{recursive:true});
 await fs.cp(new URL('dist/',base),new URL('dist/',folder),{recursive:true});
 for(const file of runtime)await fs.copyFile(new URL(file,base),new URL(file,folder));
}
let html=await fs.readFile(new URL('dist/index.html',base),'utf8');
// Every stylesheet and script the page loads from itself, read from index.html.
const {styles,scripts}=pageAssets(html);
for(const file of styles){
 const content=await fs.readFile(new URL('dist/'+file,base),'utf8');
 html=html.replace(`<link rel="stylesheet" href="${file}">`,()=>`<style>${content}</style>`);
}
const hazardSources=await fs.readFile(new URL('dist/hazard-sources.json',base),'utf8');
html=html.replace('</head>',()=>`<script>window.HAZARD_SOURCES=${hazardSources};</script></head>`);
for(const file of scripts){
 const content=(await fs.readFile(new URL('dist/'+file,base),'utf8')).replace(/<\/script/gi,'<\\/script');
 html=html.replace(`<script src="${file}"></script>`,()=>`<script>${content}</script>`);
}
await fs.writeFile(portable,html);
console.log(`Updated runtime (${runtime.length} files) and portable HTML (${styles.length} stylesheets, ${scripts.length} scripts inlined). Use the server package for all live relays.`);
