import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const manifest=JSON.parse(await fs.readFile(path.join(root,'MANIFEST.json'),'utf8'));
for(const entry of manifest.files){const target=path.resolve(root,entry.path);assert.ok(target.startsWith(root+path.sep));const bytes=await fs.readFile(target);assert.equal(bytes.length,entry.bytes,entry.path+' size');assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,entry.path+' hash');}
console.log(manifest.files.length+' packaged files match the SHA-256 manifest.');
