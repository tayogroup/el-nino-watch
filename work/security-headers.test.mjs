import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp, rm} from 'node:fs/promises';
import {createServer, SECURITY_HEADERS, canonicalRedirect} from './somalia-flood-watch/server.mjs';

// One request with a chosen Host header (fetch will not set it), the body ignored.
const get = (port, pathname, host, method = 'GET') => new Promise((resolve, reject) => {
  const req = http.request({host: '127.0.0.1', port, path: pathname, method, headers: {Host: host}}, res => { res.resume(); res.on('end', () => resolve(res)); });
  req.on('error', reject);
  req.end();
});

test('security headers on every response, and www.elninowatch.so redirects to elninowatch.so without being cached (owner, 2026-10-18)', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-security-'));
  const server = createServer({dataDir});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address();
  try {
    // The page, a script, an API answer and a film part all carry the headers.
    for (const pathname of ['/', '/app.js', '/api/podcast', '/sources']) {
      const res = await get(port, pathname, 'elninowatch.so');
      assert.notEqual(res.statusCode, 301, `${pathname}: elninowatch.so itself is never redirected`);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers[name.toLowerCase()], value, `${pathname}: ${name}`);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
    }
    assert.match(SECURITY_HEADERS['Permissions-Policy'], /geolocation=\(self\)/, 'the community report form can still ask for the location');
    // www goes to the one address, path and query kept, never stored by the CDN.
    const www = await get(port, '/sources?lang=so', 'www.elninowatch.so');
    assert.equal(www.statusCode, 301);
    assert.equal(www.headers.location, 'https://elninowatch.so/sources?lang=so');
    assert.equal(www.headers['cache-control'], 'no-store');
    assert.equal(www.headers['cdn-cache-control'], 'no-store');
    assert.equal(www.headers['strict-transport-security'], SECURITY_HEADERS['Strict-Transport-Security'], 'the redirect carries the headers too');
    assert.equal((await get(port, '/api/visit', 'www.elninowatch.so', 'POST')).statusCode, 308, 'a POST keeps its method');
    assert.equal((await get(port, '/', 'localhost:4193')).statusCode, 200, 'a local run is not redirected');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, {recursive: true, force: true});
  }
  // The CDN may name the visitor's host in X-Forwarded-Host; only the exact www name redirects.
  assert.equal(canonicalRedirect({headers: {host: 'origin.internal', 'x-forwarded-host': 'www.elninowatch.so'}, url: '/'}), 'https://elninowatch.so/');
  assert.equal(canonicalRedirect({headers: {host: 'WWW.ElNinoWatch.so:443'}, url: '/x'}), 'https://elninowatch.so/x');
  for (const host of ['elninowatch.so', 'www.example.org', 'wwwelninowatch.so', '127.0.0.1:4193', '']) assert.equal(canonicalRedirect({headers: {host}, url: '/'}), null, host || 'no host');
});
