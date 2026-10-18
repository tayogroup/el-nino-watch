import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from './somalia-flood-watch/server.mjs';

const TEST_FILE = fileURLToPath(import.meta.url);
const WORK = path.dirname(TEST_FILE);

// Dispatch through the actual HTTP request listener without opening a port.
// Keeping the server unqueried first reproduces startup-time storage failures.
async function request(server, url) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`Request timed out: ${url}`)), 2000);
    const res = {
      headersSent:false, writableEnded:false, statusCode:null, headers:{},
      // Like Node's: headers set beforehand (the security headers) merge with writeHead's.
      setHeader(name, value) { this.headers[name] = value; },
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = {...this.headers, ...headers};
        this.headersSent = true;
      },
      end(body) {
        clearTimeout(deadline);
        this.writableEnded = true;
        resolve({status:this.statusCode, headers:this.headers, body:body?.toString() || ''});
      },
      destroy() { clearTimeout(deadline); reject(new Error('Response destroyed.')); }
    };
    server.emit('request', {method:'GET', url, headers:{}, socket:{remoteAddress:'127.0.0.1'}}, res);
  });
}

if (process.argv[2] === '--scenario') {
  const [, , , dataDir, expectedStatus] = process.argv;
  const server = createServer({dataDir});
  // Strict unhandled rejection mode makes a missing early catch crash this
  // child before any community request can attach its own rejection handler.
  await delay(100);
  const staticResponse = await request(server, '/');
  assert.equal(staticResponse.status, 200);
  assert.match(staticResponse.headers['Content-Type'], /^text\/html/);
  assert.match(staticResponse.body, /El Nino Watch/);
  const communityResponse = await request(server, '/api/community/reports');
  assert.equal(communityResponse.status, Number(expectedStatus));
  if (Number(expectedStatus) === 503) {
    assert.deepEqual(JSON.parse(communityResponse.body), {
      error:'Community storage is temporarily unavailable. Try again later.'
    });
    // A failed storage request must not impair later static requests either.
    assert.equal((await request(server, '/i18n.js')).status, 200);
  } else {
    const data = JSON.parse(communityResponse.body);
    assert.deepEqual(data.reports, []);
    assert.equal(data.total, 0);
    assert.equal(data.status, 'unverified');
  }
  console.log('Scenario passed.');
} else {
  const scratch = await mkdtemp(path.join(WORK, 'community-storage-startup-'));
  try {
    const invalidPath = path.join(scratch, 'not-a-directory');
    await writeFile(invalidPath, 'Fixture file prevents mkdir.');
    const malformed = path.join(scratch, 'malformed-json');
    const wrongShape = path.join(scratch, 'wrong-shape');
    await mkdir(malformed);
    await mkdir(wrongShape);
    await writeFile(path.join(malformed, 'reports.json'), '{');
    const wrongShapeBody = JSON.stringify({version:2, reports:[]});
    await writeFile(path.join(wrongShape, 'reports.json'), wrongShapeBody);

    for (const [label, dataDir, status] of [
      ['data path is a file', invalidPath, 503],
      ['malformed stored JSON', malformed, 503],
      ['unsupported database shape', wrongShape, 503],
      ['fresh writable storage', path.join(scratch, 'working'), 200]
    ]) {
      const result = spawnSync(process.execPath,
        ['--unhandled-rejections=strict', TEST_FILE, '--scenario', dataDir, String(status)],
        {encoding:'utf8', timeout:10000, windowsHide:true});
      assert.ifError(result.error);
      assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
      assert.match(result.stdout, /Scenario passed/);
      assert.doesNotMatch(result.stderr, /UnhandledPromiseRejection|uncaughtException/);
      console.log(`PASS: ${label}; static routes available, community HTTP ${status}.`);
    }
    assert.equal(await readFile(path.join(malformed, 'reports.json'), 'utf8'), '{');
    assert.equal(await readFile(path.join(wrongShape, 'reports.json'), 'utf8'), wrongShapeBody);
    console.log('Community startup storage checks passed: no unhandled rejection, original records preserved.');
  } finally {
    const absoluteScratch = path.resolve(scratch);
    assert.ok(absoluteScratch.startsWith(WORK + path.sep), 'Cleanup remains inside the test workspace.');
    await rm(absoluteScratch, {recursive:true, force:true});
  }
}
