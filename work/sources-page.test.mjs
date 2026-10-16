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
  assert.match(panel, /<a href="\/sources" data-keep-language>Full list of forecast and alert sources →<\/a>/);
  assert.match(panel, /<a href="\/el-nino-watch-sources\.pdf" download>Download PDF \(English\)<\/a>/);
  assert.match(index, /<a href="\/sources" data-keep-language>Forecast and alert sources<\/a><a href="\/stats" id="visitor-stats-link" hidden>/);
  assert.match(page, /<a class="no-print" href="\/" data-keep-language>← Back to El Nino Watch<\/a>/);
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

test('links between the site\'s pages keep the language, including one chosen only by ?lang=so', async () => {
  const links = ['/sources', '/?city=Mogadishu#tab=sources'].map(href => ({href, getAttribute(name) { return name === 'href' ? this.href : null; }, setAttribute(name, value) { if (name === 'href') this.href = value; }}));
  const memory = new Map();
  const document = {readyState: 'complete', title: 'Forecast and alert sources | El Nino Watch', body: {nodeType: 11, childNodes: []}, documentElement: {setAttribute() {}},
    getElementById: () => null, querySelectorAll: selector => selector === 'a[data-keep-language]' ? links : []};
  const window = {document, location: {href: 'https://elninowatch.so/?lang=so', protocol: 'https:'}, localStorage: {getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value)}};
  const context = vm.createContext({window, URL});
  vm.runInContext(await readFile(new URL('translations-so.js', dist), 'utf8'), context);
  vm.runInContext(await readFile(new URL('i18n.js', dist), 'utf8'), context);
  assert.equal(memory.size, 0, 'no saved choice: the language came from the address only');
  assert.deepEqual(links.map(link => link.href), ['/sources?lang=so', '/?city=Mogadishu&lang=so#tab=sources']);
  window.SiteLanguage.setLanguage('en');
  assert.deepEqual(links.map(link => link.href), ['/sources?lang=en', '/?city=Mogadishu&lang=en#tab=sources'], 'switching language updates the links');
});

test('the privacy notice is on the page, linked from the top, and its claims match the code', async () => {
  const start = page.indexOf('<section aria-labelledby="privacy" id="privacy-notice">'), section = page.slice(start, page.indexOf('</section>', start));
  assert.ok(start > 0, 'the privacy section exists');
  assert.ok(page.includes('<a class="no-print" href="#privacy">Privacy notice ↓</a>'), 'linked from the top of the page');
  for (const title of ['Visit counts', 'Community reports', 'WhatsApp alerts', 'Saved in your browser', 'Other services']) assert.ok(section.includes(`<li><b>${title}</b>`), title);
  assert.ok(section.includes('href="mailto:contact@mandekconsulting.com"'));
  // "held in memory for up to 10 minutes": the report rate limit's window.
  assert.ok(section.includes('up to 10 minutes'));
  const community = await readFile(new URL('./somalia-flood-watch/community.mjs', import.meta.url), 'utf8');
  assert.match(community, /until:now \+ 600000/, 'the rate-limit window is still 10 minutes');
  // "No cookies": nothing the server sends sets one.
  for (const file of ['server.mjs', 'community.mjs', 'visits.mjs', 'whatsapp.mjs']) {
    assert.doesNotMatch(await readFile(new URL(`./somalia-flood-watch/${file}`, import.meta.url), 'utf8'), /set-cookie/i, file);
  }
});
