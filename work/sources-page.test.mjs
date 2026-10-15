import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createServer} from './somalia-flood-watch/server.mjs';
import {ALERT_SOURCES} from './somalia-flood-watch/alerts-feed.mjs';
import {SOURCES} from './somalia-flood-watch/feeds.mjs';
import {OBSERVED_SOURCE_URL} from './somalia-flood-watch/observed-flood.mjs';
import {COPERNICUS_SOURCE_URL} from './somalia-flood-watch/copernicus.mjs';

const dist = new URL('./somalia-flood-watch/dist/', import.meta.url);
const page = await readFile(new URL('sources.html', dist), 'utf8');
const index = await readFile(new URL('index.html', dist), 'utf8');

test('the sources page lists every source URL the server reads from', () => {
  const used = [...Object.values(ALERT_SOURCES), ...Object.values(SOURCES), OBSERVED_SOURCE_URL, COPERNICUS_SOURCE_URL, 'https://api.open-meteo.com/v1/forecast', 'https://flood-api.open-meteo.com/v1/flood'];
  for (const url of used) assert.ok(page.includes(`href="${url}"`), `sources.html is missing ${url}`);
  for (const [, href] of page.matchAll(/<a[^>]*href="(https:[^"]+)"/g)) assert.match(href, /^https:\/\/[a-z0-9.-]+\//, `not a plain https link: ${href}`);
});

test('the app links the page and the PDF from the Sources tab and the footer', () => {
  const panel = index.slice(index.indexOf('id="source-panel"'), index.indexOf('</section>', index.indexOf('id="source-panel"')));
  assert.match(panel, /<a href="\/sources">Full list of forecast and alert sources →<\/a>/);
  assert.match(panel, /<a href="\/el-nino-watch-sources\.pdf" download>Download PDF \(English\)<\/a>/);
  assert.match(index, /<a href="\/sources">Forecast and alert sources<\/a><a href="\/stats" id="visitor-stats-link" hidden>/);
});

test('every piece of page text has a Somali translation, apart from names and links kept as published', async () => {
  const context = vm.createContext({window: {}});
  vm.runInContext(await readFile(new URL('translations-so.js', dist), 'utf8'), context);
  const messages = context.window.SOMALIA_TRANSLATIONS_SO.messages;
  const visible = page.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '')
    .replace(/<(\w+)\b[^>]*\bdata-i18n-skip\b[^>]*>[\s\S]*?<\/\1>/g, '');
  const texts = [...visible.matchAll(/>([^<>]+)</g)].map(match => match[1].replace(/\s+/g, ' ').trim()).filter(text => /[A-Za-z]/.test(text));
  assert.ok(texts.length > 40, 'the page text was read');
  const decode = text => text.replace(/&amp;/g, '&');
  const missing = texts.map(decode).filter(text => !messages[text]);
  assert.deepEqual(missing, [], 'untranslated page text');
});

test('/sources serves the page and the PDF is served as a PDF', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-sources-'));
  const server = createServer({dataDir});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const html = await fetch(base + '/sources');
    assert.equal(html.status, 200);
    assert.match(await html.text(), /<title>Forecast and alert sources \| El Nino Watch<\/title>/);
    const pdf = await fetch(base + '/el-nino-watch-sources.pdf');
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    const bytes = Buffer.from(await pdf.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(bytes.length > 20000, 'the PDF has content');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, {recursive: true, force: true});
  }
});
