import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {parseStations} from './somalia-flood-watch/feeds.mjs';

const work=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(work);
const app=path.join(work,'somalia-flood-watch'),out=path.join(root,'outputs');
const staging=path.join(work,'portable-release');
const releaseDate='2026-10-14';
const runtime=['server.mjs','feeds.mjs','hazards.mjs','alerts-feed.mjs','observed-flood.mjs','copernicus.mjs','community.mjs','Start-Live-App.ps1','README.md'];
const appChecks=['verify.mjs','verify-daily.mjs','verify-interaction.mjs','verify-map.mjs'];
const write=async(base,file,value)=>{const target=path.join(base,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,value);};
const copy=async(source,base,file)=>{await fs.mkdir(path.dirname(path.join(base,file)),{recursive:true});await fs.copyFile(source,path.join(base,file));};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function files(folder,prefix=''){
 const result=[];
 for(const item of (await fs.readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  if(item.isSymbolicLink())throw Error('Links are not packaged: '+item.name);
  const relative=prefix+item.name;
  if(item.isDirectory())result.push(...await files(path.join(folder,item.name),relative+'/'));
  else if(item.isFile())result.push(relative);
 }
 return result;
}
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return(crc^0xffffffff)>>>0;};
async function zip(folder,destination){
 const entries=await files(folder),parts=[],directory=[];let offset=0;
 const time=12<<11,date=((2026-1980)<<9)|(10<<5)|14;
 for(const relative of entries){
  const name=Buffer.from(path.basename(folder)+'/'+relative),bytes=await fs.readFile(path.join(folder,relative)),compressed=deflateRawSync(bytes,{level:9});
  const crc=crc32(bytes),local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(time,10);local.writeUInt16LE(date,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(0x314,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(8,10);central.writeUInt16LE(time,12);central.writeUInt16LE(date,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE((0o100644<<16)>>>0,38);central.writeUInt32LE(offset,42);
  parts.push(local,name,compressed);directory.push(central,name);offset+=local.length+name.length+compressed.length;
 }
 const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
 await fs.writeFile(destination,Buffer.concat([...parts,central,end]));
 return {files:entries.length,bytes:(await fs.stat(destination)).size,sha256:digest(await fs.readFile(destination))};
}
function packageJson(source){
 return JSON.stringify({name:'el-nino-watch'+(source?'-source':''),version:'1.0.0',private:true,type:'module',description:'English/Somali weather awareness, flood observations and community reporting for Somalia.',engines:{node:'>=22'},scripts:{start:'node '+(source?'work/somalia-flood-watch/':'')+'server.mjs',check:'node scripts/check-files.mjs',...(source?{'build:translations':'node work/build-somali-catalog.mjs','build:basemap':'node work/build-basemap.mjs',bundle:'node work/package-flood-app.mjs',test:'node scripts/run-tests.mjs',release:'node work/make-source-bundles.mjs'}:{})}},null,2)+'\n';
}
function deployment(source){
 const entry=(source?'work/somalia-flood-watch/':'')+'server.mjs';
 return `# Deploy El Nino Watch

This package is a complete Node application, with its frontend, server modules, maps, English/Somali catalog, library assets and notices. No npm runtime dependencies, compilation step or API keys are required for the existing features. Use Node.js 24 LTS (Node 22 or newer is supported). Release snapshot: ${releaseDate}, East Africa date.

## Local use / another development environment

Extract the ZIP into a new folder. Open a terminal in the folder containing package.json.

    npm start

Open http://127.0.0.1:4173. Ctrl+C stops the server. You can also run \`node ${entry}\`, \`Start-Live-App.ps1\` on Windows, or \`sh start.sh\` on Linux/macOS. Install Node separately; this archive does not contain an operating-system-specific Node binary.

\`.env.example\` documents the available variables; it is not loaded by npm start automatically. Supply them in your hosting dashboard/shell, or copy it to .env and run:

    node --env-file=.env ${entry}

## Node-compatible hosting

Deploy this entire package at the domain root. Set the start command to \`npm start\`; no build command is needed. Set HOST=0.0.0.0. Use the PORT supplied by the hosting platform, or 4173 behind your own reverse proxy. Set COMMUNITY_DATA_DIR to an absolute, writable persistent directory outside the public dist folder. Use one Node process/replica per data directory: this version keeps JSON records in memory and is not a shared-database cluster.

Use the platform's HTTPS/domain configuration. For your own HTTPS reverse proxy, preserve the original public Host header. Community writes compare the request Origin host with Host; a proxy that replaces Host with localhost can reject valid uploads and comments. The sample deploy/nginx-location.conf belongs inside an already configured HTTPS virtual host; it contains no TLS certificate or domain setup. Allow request bodies of at least 52 MiB and outbound HTTPS to the source providers. The server's submission limiter sees the proxy connection address; use host/edge rate controls when exposing the service publicly.

Use / as the health-check path. An unavailable upstream feed is labelled by the app and does not make the static page unavailable. Invalid community storage returns 503 for that service while the other page routes remain available.

Static-only hosts can serve the frontend, but cannot run reports/uploads/comments or the server data relays. The full app requires Node hosting or the Docker option below. This package does not configure hosting accounts, DNS or deploy anything automatically.

## Docker

    docker compose up --build -d

Open http://127.0.0.1:4173. Compose uses a named volume for report data and a single non-root Node container. To choose a different external port, set PORT before the command. The container's internal port remains 4173. The first image build requires internet access to obtain the official Node image. Docker configuration is included; validate it on your Docker host before publication.

## Data and migration

The ZIP deliberately contains no existing reports, uploads, deletion receipt hashes, credentials, logs, .git state or local hosting identity. A fresh deployment starts with an empty report board. To move actual shared records separately, stop writes/the old server, back up its complete data directory (reports.json and media/ together), restore it on the new server, set COMMUNITY_DATA_DIR to that location, and give the Node process read/write access. Keep backups private and outside dist.

Language preferences, additional-city lists, Mayor actions, private notes and browser deletion receipts belong to each browser's local storage. They do not migrate with the code ZIP. Moving to a different origin can leave those records and receipt access in the old browser origin.

Live weather, warnings, river readings, satellite observations and external Earth/Street View links need internet access and remain subject to their providers' availability and terms. The bundled Natural Earth geography is offline reference context, not live satellite imagery. No current flood event data are fabricated or bundled as sample community reports.

## Verify the package

    npm run check

This checks the file manifest, byte counts and SHA-256 hashes. ${source?'Run npm test for the included regression suite, npm run build:translations and npm run build:basemap to rebuild generated resources, and npm run bundle to regenerate the runtime folder and standalone HTML under outputs/. The work/ layout is retained so all test and fixture imports work.':'The source ZIP additionally contains the regression suite and resource builders.'}

Node support: https://nodejs.org/en/about/previous-releases
Full application behavior and source limitations: ${source?'work/somalia-flood-watch/README.md':'APP-GUIDE.md'}
`;
}
const notices=`# Third-party resources and source terms

- Leaflet 1.9.4: BSD 2-Clause. Original license is included at dist/vendor/LICENSE-Leaflet.txt (in the source package, under work/somalia-flood-watch/). JS/CSS and standard image assets are bundled. Source: https://github.com/Leaflet/Leaflet/tree/v1.9.4
- Natural Earth country polygons and river centerlines: public-domain reference geography. Generated regional geometry is bundled; the source ZIP includes the GeoJSON build inputs. Terms: https://www.naturalearthdata.com/about/terms-of-use/
- The logo and interface icons are code-native SVG in the application; the fonts are the operating system's Segoe UI/Arial/sans-serif. No external font or icon account is needed.
- Weather, river models, alerts, terrain services and satellite products remain provider services with their own terms; public access does not mean every source is public domain. Existing attribution and independent-service notices are retained in the app and app guide. Community media keep contributors' rights.
- Developer-only test fixtures are dated parser examples, not live advisories or operational measurements. The SWALIM HTML fixture is a compact reconstruction of the published factual station table, without the source site's scripts or page design. The SNMA RSS fixture declares public domain. WMS/WMTS XML fixtures describe public service metadata. They are never shown as current community reports.

This file records third-party terms; it does not assign a new licence to the custom application code.
`;
const checkScript=`import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const manifest=JSON.parse(await fs.readFile(path.join(root,'MANIFEST.json'),'utf8'));
for(const entry of manifest.files){const target=path.resolve(root,entry.path);assert.ok(target.startsWith(root+path.sep));const bytes=await fs.readFile(target);assert.equal(bytes.length,entry.bytes,entry.path+' size');assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,entry.path+' hash');}
console.log(manifest.files.length+' packaged files match the SHA-256 manifest.');
`;
const testRunner=`import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),work=path.join(root,'work');
const testFiles=(await fs.readdir(work)).filter(file=>file.endsWith('.test.mjs')).sort().map(file=>'work/'+file);
const checks=['verify.mjs','verify-daily.mjs','verify-interaction.mjs','verify-map.mjs'].map(file=>['work/somalia-flood-watch/'+file]);checks.push(['work/verify-observed-flood.mjs']);
for(const args of [...checks,['--test','--test-concurrency=1',...testFiles]]){const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);}
console.log('All source checks and '+testFiles.length+' regression test files passed.');
`;
function dockerfile(source){return `FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 COMMUNITY_DATA_DIR=/app/data
COPY --chown=node:node ${source?'work/somalia-flood-watch/':''}*.mjs ./
COPY --chown=node:node ${source?'work/somalia-flood-watch/':''}dist/ ./dist/
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
`;}
const compose=`services:
  web:
    build: .
    ports:
      - "\${PORT:-4173}:4173"
    environment:
      HOST: 0.0.0.0
      PORT: 4173
      COMMUNITY_DATA_DIR: /app/data
    volumes:
      - somalia_reports:/app/data
    restart: unless-stopped
volumes:
  somalia_reports:
`;
const nginx=`# Include this inside your existing HTTPS server {} block.
# TLS certificates and server_name are configured by your host separately.
client_max_body_size 52m;
location / {
    proxy_pass http://127.0.0.1:4173;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 60s;
}
`;
async function make(source){
 const name='El-Nino-Watch-'+(source?'Source':'Hosting'),folder=path.join(staging,name),appRelative=source?'work/somalia-flood-watch':'';
 await fs.mkdir(folder,{recursive:true});
 const appFolder=path.join(folder,appRelative);await fs.mkdir(appFolder,{recursive:true});
 await fs.cp(path.join(app,'dist'),path.join(appFolder,'dist'),{recursive:true});
 for(const file of runtime)await copy(path.join(app,file),folder,path.join(appRelative,file==='README.md'&&!source?'APP-GUIDE.md':file));
 if(source){
  for(const file of appChecks)await copy(path.join(app,file),folder,path.join(appRelative,file));
  const developer=['build-somali-catalog.mjs','i18n-public.json','i18n-weather.json','i18n-mayor.json','build-basemap.mjs','package-flood-app.mjs','make-source-bundles.mjs','verify-portable-release.mjs','verify-observed-flood.mjs','somalia-cap-feed.xml','observed-gfm-capabilities.xml','observed-gibs-capabilities.xml'];
  for(const file of [...developer,...(await fs.readdir(work)).filter(name=>name.endsWith('.test.mjs'))])await copy(path.join(work,file),folder,'work/'+file);
  await fs.cp(path.join(work,'basemap-source'),path.join(folder,'work/basemap-source'),{recursive:true});
  const records=parseStations(await fs.readFile(path.join(work,'swalim-stations.html'),'utf8'));
  const escape=value=>String(value??'—').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const rows=records.map(row=>[row.code,row.name,row.river,row.status,'',row.observedLabel,row.levelM,row.moderateM,row.highM,row.bankFullM].map(value=>'<td>'+escape(value)+'</td>').join('')).map(row=>'<tr>'+row+'</tr>').join('\n');
  await write(folder,'work/swalim-stations.html','<!doctype html><html><body><!-- Dated, reconstructed station-table regression fixture; not live data. --><table><tbody>\n'+rows+'\n</tbody></table></body></html>\n');
  await write(folder,'scripts/run-tests.mjs',testRunner);
 }
 const packageText=packageJson(source),packageInfo=JSON.parse(packageText);
 await write(folder,'package.json',packageText);await write(folder,'package-lock.json',JSON.stringify({name:packageInfo.name,version:packageInfo.version,lockfileVersion:3,requires:true,packages:{'':{name:packageInfo.name,version:packageInfo.version,engines:packageInfo.engines}}},null,2)+'\n');await write(folder,'.nvmrc','24\n');await write(folder,'.node-version','24\n');
 await write(folder,'.env.example','# Hosting example; npm start does not load this file automatically.\nHOST=0.0.0.0\nPORT=4173\n# Set an absolute writable persistent directory in your hosting environment.\n# COMMUNITY_DATA_DIR=/var/lib/el-nino-watch\n');
 await write(folder,'.gitignore','node_modules/\n.env\n.env.*\n!.env.example\ndata/\nwork/somalia-flood-watch/data/\nwork/package-stage/\nwork/portable-release/\noutputs/\n*.log\n*.pid\n');
 await write(folder,'.dockerignore','**/data/\n**/node_modules/\n**/.git/\n**/.openai/\n.env\n.env.*\noutputs/\nwork/package-stage/\nwork/portable-release/\nwork/basemap-source/\nwork/*.test.mjs\nwork/i18n-*.json\n*.log\n*.pid\n');
 await write(folder,'Dockerfile',dockerfile(source));await write(folder,'compose.yaml',compose);await write(folder,'deploy/nginx-location.conf',nginx);
 await write(folder,'README.md',`# El Nino Watch — ${source?'complete source':'hosting'} package\n\n${source?'Full application code, assets, translation and basemap rebuild inputs, test fixtures and regression tests. The current work/ directory layout is retained for reproducibility.':'Complete deployable frontend and Node server, including English/Somali translations, offline reference geography and library assets.'}\n\nExtract this ZIP, install Node.js 24, open a terminal in this folder and run:\n\n    npm start\n\nOpen http://127.0.0.1:4173. No npm install or API keys are required.\n\nRead [DEPLOYMENT.md](DEPLOYMENT.md) for Node hosting, Docker, persistent report storage, migration, HTTPS proxy settings and validation. Read [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for resource attribution.\n\n${source?'App files: work/somalia-flood-watch/. Frontend files under dist/ are editable source. Run npm test for the checks; npm run build:translations and npm run build:basemap regenerate resources; npm run bundle regenerates the runtime/standalone HTML under outputs/.':'The source ZIP adds developer tools, regression tests and original resource inputs.'}\n\nCurrent private reports, uploads, browser state and credentials are excluded. Live data still require internet access. This is an independent, non-government app; for emergency support contact your local government or relevant authority.\n`);
 await write(folder,'DEPLOYMENT.md',deployment(source));await write(folder,'THIRD-PARTY-NOTICES.md',notices);await write(folder,'scripts/check-files.mjs',checkScript);
 const entry=(source?'work/somalia-flood-watch/':'')+'server.mjs';
 await write(folder,'Start-Live-App.ps1',`$ErrorActionPreference = 'Stop'\nSet-Location -LiteralPath $PSScriptRoot\nif (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24, then retry.' }\nWrite-Host 'El Nino Watch: http://127.0.0.1:4173'\n& node (Join-Path $PSScriptRoot '${entry}')\n`);
 await write(folder,'start.sh',`#!/bin/sh\nset -eu\ncd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec node '${entry}'\n`);
 const all=await files(folder);for(const file of all)if(/(?:^|\/)(?:data|node_modules|\.git|\.openai)\/|(?:\.log|\.pid)$|(?:^|\/)\.env$/.test(file))throw Error('Private/runtime file in bundle: '+file);
 const manifest={clientDate:releaseDate,package:name,runtime:'Node.js 22+; Node 24 recommended',files:await Promise.all(all.filter(file=>file!=='MANIFEST.json').map(async file=>{const bytes=await fs.readFile(path.join(folder,file));return{path:file,bytes:bytes.length,sha256:digest(bytes)};}))};
 await write(folder,'MANIFEST.json',JSON.stringify(manifest,null,2)+'\n');
 await fs.mkdir(out,{recursive:true});const archive=path.join(out,name+'.zip');const result=await zip(folder,archive);return {name,folder,archive,...result};
}
const results=[];for(const source of [false,true])results.push(await make(source));
await fs.writeFile(path.join(out,'El-Nino-Watch-SHA256.txt'),results.map(item=>item.sha256+'  '+path.basename(item.archive)).join('\n')+'\n');
console.log(JSON.stringify(results.map(({name,folder,archive,files,bytes,sha256})=>({name,folder,archive,files,bytes,sha256})),null,2));
