import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),work=path.join(root,'work');
const testFiles=(await fs.readdir(work)).filter(file=>file.endsWith('.test.mjs')).sort().map(file=>'work/'+file);
const checks=['verify.mjs','verify-daily.mjs','verify-interaction.mjs','verify-map.mjs'].map(file=>['work/somalia-flood-watch/'+file]);checks.push(['work/verify-observed-flood.mjs']);
for(const args of [...checks,['--test','--test-concurrency=1',...testFiles]]){const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);}
console.log('All source checks and '+testFiles.length+' regression test files passed.');
