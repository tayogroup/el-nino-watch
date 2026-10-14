import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import http from 'node:http';
const root=path.resolve(process.argv[2]||'');
assert.ok(root.includes(path.sep+'work'+path.sep+'release-validation-'),'Use an extracted release-validation scratch folder.');
const variants=['Somalia-El-Nino-Watch-Hosting','Somalia-El-Nino-Watch-Source'];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const results=[];
async function proxyRequest(url,options){
 const request=new Request(url,options),body=Buffer.from(await request.arrayBuffer());
 return new Promise((resolve,reject)=>{const call=http.request(url,{method:options.method,headers:{...Object.fromEntries(request.headers),'Host':options.headers.Host,'Content-Length':body.length}},response=>{const parts=[];response.on('data',part=>parts.push(part));response.on('end',()=>{const bytes=Buffer.concat(parts);resolve({status:response.statusCode,json:async()=>JSON.parse(bytes.toString('utf8'))});});});call.on('error',reject);call.end(body);});
}
for(const name of variants){
 const folder=path.join(root,name),app=path.join(folder,name.endsWith('Source')?'work/somalia-flood-watch':''),dist=path.join(app,'dist');
 const {createServer}=await import(pathToFileURL(path.join(app,'server.mjs')).href);
 const dataDir=path.join(root,'test-data-'+name),server=createServer({dataDir});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let active=server;
 const origin='http://127.0.0.1:'+server.address().port;const headers={Host:'elninowatch.example.test',Origin:'https://elninowatch.example.test'};
 let assetCount=0;
 try{
  const html=await(await fetch(origin+'/')).text();assert.ok(html.includes('watchlist-add-city')&&html.includes('data-site-language="so"'));
  const paths=new Set([...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m=>m[1]).filter(value=>!/^\w+:/.test(value)));
  for(const local of [...paths])if(local.endsWith('.css')){const css=await fs.readFile(path.join(dist,local),'utf8');for(const m of css.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g))if(!/^\w+:|^#/.test(m[1]))paths.add(path.posix.join(path.posix.dirname(local),m[1]));}
  paths.add('vendor/leaflet.js.map');paths.add('vendor/LICENSE-Leaflet.txt');for(const file of ['marker-icon-2x.png','marker-shadow.png'])paths.add('vendor/images/'+file);
  for(const file of paths){const response=await fetch(origin+'/'+file);assert.equal(response.status,200,file);assert.equal(Buffer.compare(Buffer.from(await response.arrayBuffer()),await fs.readFile(path.join(dist,file))),0,file+' bytes');assetCount++;}
  const cities=await(await fetch(origin+'/cities.json')).json();assert.equal(cities.length,30);assert.ok(cities.some(row=>row[0]==='Adado'));
  const empty=await(await fetch(origin+'/api/community/reports')).json();assert.equal(empty.total,0);
  const form=new FormData();form.set('payload',JSON.stringify({cityId:'mogadishu',category:'rain',observedAt:new Date(Date.now()-60000).toISOString(),description:'Synthetic package smoke test only; this is not a real weather report.',deaths:null,injuries:0,damagedProperties:null}));form.append('media',new Blob([png],{type:'image/png'}),'bundle-check.png');
  const posted=await proxyRequest(origin+'/api/community/reports',{method:'POST',headers,body:form});assert.equal(posted.status,201,'HTTPS public Origin with preserved Host is accepted');const {report,receiptToken}=await posted.json();assert.equal(report.deaths,null);assert.equal(report.injuries,0);assert.equal(report.status,'unverified');
  const photo=await fetch(origin+report.media[0].url);assert.equal(photo.status,200);assert.equal(Buffer.compare(Buffer.from(await photo.arrayBuffer()),png),0);
  const comment=await proxyRequest(origin+'/api/community/reports/'+report.id+'/comments',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({body:'Synthetic ZIP test comment, not a real flood report.'})});assert.equal(comment.status,201);
  const denied=await proxyRequest(origin+'/api/community/reports/'+report.id+'/comments',{method:'POST',headers:{...headers,Origin:'https://foreign.example.test','Content-Type':'application/json'},body:JSON.stringify({body:'Must be rejected.'})});assert.equal(denied.status,403);
  assert.equal((await fetch(origin+'/data/reports.json')).status,404);
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));active=null;
  const restarted=createServer({dataDir});await new Promise(resolve=>restarted.listen(0,'127.0.0.1',resolve));active=restarted;const next='http://127.0.0.1:'+restarted.address().port;
  const retained=await(await fetch(next+'/api/community/reports')).json();assert.equal(retained.total,1);assert.equal(retained.reports[0].comments.length,1);
  const removed=await proxyRequest(next+'/api/community/reports/'+report.id,{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({receipt:receiptToken})});assert.equal(removed.status,200);assert.equal((await(await fetch(next+'/api/community/reports')).json()).total,0);
  results.push({package:name,assetsVerified:assetCount,cities:30,reportMediaCommentDelete:'passed',restartPersistence:'passed',httpsProxyOrigin:'passed',privateStorage:'not served'});
 }finally{if(active){active.closeAllConnections();await new Promise(resolve=>active.close(resolve));}}
 // Exercise the literal deployment CLI and HOST/PORT environment in a new process.
 const cliPort=new URL(origin).port,cliData=path.join(root,'cli-data-'+name),cli=spawn(process.execPath,[path.join(app,'server.mjs')],{cwd:folder,env:{...process.env,HOST:'0.0.0.0',PORT:cliPort,COMMUNITY_DATA_DIR:cliData},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CLI startup timeout')),10000);cli.once('error',reject);cli.once('exit',code=>reject(Error('CLI exited: '+code)));cli.stdout.on('data',chunk=>{if(String(chunk).includes('Somalia El Nino Watch:')){clearTimeout(timer);resolve();}});});
  assert.equal((await fetch('http://127.0.0.1:'+cliPort+'/')).status,200);results.at(-1).cliStartup='HOST=0.0.0.0 and PORT honored';
 }finally{cli.kill();await new Promise(resolve=>{if(cli.exitCode!==null)resolve();else cli.once('exit',resolve);});}
}
console.log(JSON.stringify(results,null,2));
