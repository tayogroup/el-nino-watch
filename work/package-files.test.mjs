import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {serverModules, pageAssets} from './package-files.mjs';

const app = new URL('./somalia-flood-watch/', import.meta.url);
const run = promisify(execFile);

test('the server modules are found by following imports, so none is left out of a package', async () => {
  const modules = await serverModules(app);
  assert.equal(modules[0], 'server.mjs');
  // Every relative import of every module found is itself in the list.
  for (const file of modules) {
    const source = await readFile(new URL(file, app), 'utf8');
    for (const [, next] of source.matchAll(/from\s*['"]\.\/([\w.-]+\.mjs)['"]/g)) assert.ok(modules.includes(next), `${file} imports ${next}`);
  }
  for (const file of ['whatsapp.mjs', 'podcast.mjs', 'news-feed.mjs', 'hydro-feed.mjs', 'floodhub-feed.mjs', 'visits.mjs']) assert.ok(modules.includes(file), file);
  assert.ok(!modules.some(file => /^verify|\.test\./.test(file)), 'no checks or tests');
  assert.ok((await serverModules(app, ['server.mjs', 'docker-entrypoint.mjs'])).includes('docker-entrypoint.mjs'));
});

test('the portable page inlines every stylesheet and script index.html loads from the site itself', async () => {
  const html = await readFile(new URL('dist/index.html', app), 'utf8');
  const {styles, scripts} = pageAssets(html);
  for (const file of ['share.js', 'whatsapp.js', 'news-flash.js', 'podcast.js', 'alerts.js', 'app.js']) assert.ok(scripts.includes(file), file);
  assert.equal(scripts.at(-1), 'app.js', 'in page order');
  assert.ok(styles.includes('vendor/leaflet.css') && styles.includes('shell.css'));
  assert.deepEqual(pageAssets('<link rel="stylesheet" href="https://fonts.example/x.css"><script src="//cdn.example/y.js"></script>'), {styles: [], scripts: []}, 'other sites are not inlined');
});

test('the offline package builds, and its server starts and serves the app', {timeout: 120000}, async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), 'elnino-package-'));
  try {
    await run(process.execPath, [fileURLToPath(new URL('./package-flood-app.mjs', import.meta.url))], {env: {...process.env, PACKAGE_OUT: out}});
    const folder = path.join(out, 'El-Nino-Watch');
    const files = await readdir(folder);
    for (const file of await serverModules(app)) assert.ok(files.includes(file), `${file} is in the package`);
    const portable = await readFile(path.join(out, 'El-Nino-Watch.html'), 'utf8');
    assert.doesNotMatch(portable, /<script src="(?!https?:|\/\/)[^"]+"><\/script>/, 'no script left pointing at a file the page does not carry');
    assert.doesNotMatch(portable, /<link rel="stylesheet" href="(?!https?:|\/\/)[^"]+">/, 'no stylesheet left behind either');
    // Start the packaged server on a free port, with its own empty data folder.
    const port = 47000 + Math.floor(Math.random() * 2000);
    const child = spawn(process.execPath, [path.join(folder, 'server.mjs')], {cwd: os.tmpdir(), env: {...process.env, PORT: String(port), HOST: '127.0.0.1', COMMUNITY_DATA_DIR: path.join(out, 'data'), GEMINI_API_KEY: '', PODCAST_ENABLED: '', WHATSAPP_TOKEN: ''}, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    try {
      const started = Date.now();
      while (!output.includes('El Nino Watch: http') && Date.now() - started < 20000 && child.exitCode === null) await new Promise(resolve => setTimeout(resolve, 100));
      assert.ok(output.includes('El Nino Watch: http'), `the packaged server started: ${output.slice(0, 300)}`);
      const page = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(page.status, 200); assert.match(await page.text(), /<title>/);
      assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/api/podcast`)).json(), {enabled: false});
    } finally {
      // Windows keeps the folder busy until the process has gone.
      if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
    }
  } finally { await rm(out, {recursive: true, force: true}); }
});
