import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {mkdtemp, rm, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from './somalia-flood-watch/server.mjs';

const dist = new URL('./somalia-flood-watch/dist/', import.meta.url);
const index = await readFile(new URL('index.html', dist), 'utf8');
const start = index.indexOf('<section class="health-alert" id="health-alert"');
const section = index.slice(start, index.indexOf('</section>', start) + '</section>'.length);

test('the public health alert sits at the bottom of the Alerts tab', () => {
  const alerts = index.indexOf('id="alerts-panel"'), next = index.indexOf('<section', alerts + 1 + section.length);
  assert.ok(start > alerts, 'after the alerts panel opens');
  assert.ok(start > index.indexOf('East Africa Hazards Watch ↗</a>', alerts), 'below the alert list and its links');
  assert.ok(index.indexOf('</section>', start + section.length - 1) < index.indexOf('id="daily-panel"'), 'and inside the alerts panel');
  assert.ok(next > start);
});

test('its content: eight diseases, five actions, WHO sources only, and never an official warning', () => {
  assert.equal((section.match(/<tr><th scope="row">/g) || []).length, 8);
  for (const disease of ['Cholera and other acute diarrhoeal diseases', 'Dysentery and typhoid fever', 'Hepatitis A and E', 'Malaria', 'Dengue fever', 'Rift Valley fever', 'Skin and wound infections', 'Measles and respiratory infections']) assert.ok(section.includes(`<th scope="row">${disease}</th>`), disease);
  assert.equal((section.match(/<li><b>/g) || []).length, 5);
  const links = [...section.matchAll(/<a href="([^"]+)"/g)].map(match => match[1]);
  assert.equal(links.length, 6);
  for (const href of links) assert.match(href, /^https:\/\/(cdn|www)\.who\.int\//, href);
  assert.ok(links.includes('https://cdn.who.int/media/docs/default-source/meeting-reports/global-public-health-situation-analysis-el-nino-2026_.pdf'));
  assert.ok(section.includes('Health guidance from WHO · not an outbreak report'));
  assert.ok(section.includes('It is not an official warning or an outbreak report'));
  assert.doesNotMatch(section.replace('It is not an official warning or an outbreak report', ''), /official warning/i, 'no other claim about official status');
});

test('every piece of its text reads in Somali', async () => {
  const document = {readyState: 'complete', title: '', body: {nodeType: 11, childNodes: []}, documentElement: {setAttribute() {}}, getElementById: () => null, querySelectorAll: () => []};
  const window = {document, location: {href: 'https://elninowatch.so/?lang=so', protocol: 'https:'}, localStorage: {getItem: () => null, setItem() {}}};
  const context = vm.createContext({window, URL});
  vm.runInContext(await readFile(new URL('translations-so.js', dist), 'utf8'), context);
  vm.runInContext(await readFile(new URL('i18n.js', dist), 'utf8'), context);
  const texts = [...section.matchAll(/>([^<>]+)</g)].map(match => match[1].replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()).filter(text => /[A-Za-z]/.test(text));
  assert.ok(texts.length > 50, 'the section text was read');
  const untranslated = texts.filter(text => window.SiteLanguage.translateText(text) === text);
  assert.deepEqual(untranslated, []);
  assert.equal(window.SiteLanguage.translateText('Malaria'), 'Duumada');
  assert.match(window.SiteLanguage.translateText('WHO: Cholera fact sheet ↗'), /^WHO: Warqadda xaqiiqooyinka daacuunka ↗$/);
});

test('the health alert has a Share row, and its post fits X whole in English and Somali', async () => {
  assert.ok(section.includes('<div id="health-share"></div></section>'), 'the row sits at the end of the section');
  for (const lang of ['en', 'so']) {
    const nodes = {'health-share': {innerHTML: ''}};
    const document = {readyState: 'complete', title: '', body: {nodeType: 11, childNodes: []}, documentElement: {setAttribute() {}}, getElementById: id => nodes[id] || null, querySelectorAll: () => [], addEventListener() {}};
    const window = {document, location: {href: `https://elninowatch.so/?lang=${lang}`, protocol: 'https:'}, localStorage: {getItem: () => null, setItem() {}}, navigator: {}};
    const context = vm.createContext({window, URL, URLSearchParams, Date});
    for (const file of ['translations-so.js', 'i18n.js', 'share.js', 'alerts.js']) vm.runInContext(await readFile(new URL(file, dist), 'utf8'), context);
    const row = nodes['health-share'].innerHTML;
    assert.match(row, /^<div class="share-row" role="group" aria-label="Share" data-share-lines="/);
    assert.match(row, /data-share-tab="alerts"/);
    const text = window.SiteShare.textOf(window.FloodAlerts.healthShareLines);
    assert.equal(text.split('\n').length, 3);
    assert.equal(window.SiteShare.fit(text), text, `${lang}: nothing is cut or dropped for X`);
    assert.match(text.split('\n')[2], lang === 'so' ? /^Talo caafimaad oo ka timid WHO/ : /^Health guidance from WHO, not an outbreak report\.$/);
    if (lang === 'so') assert.doesNotMatch(text, /\b(the|and|with)\b/, 'the Somali post has no English left');
  }
});

test('the site footer links to the health alert, in Somali too', async () => {
  const footer = index.slice(index.indexOf('<footer class="site-footer'), index.indexOf('</footer>'));
  assert.ok(footer.includes('<a href="#health-alert">Public health alert</a>'));
  const tabs = await readFile(new URL('tabs.js', dist), 'utf8');
  assert.match(tabs, /if \(mayor\(\)\) return openInMayor\(event\);/, 'the city manager view opens the Alerts tool for it');
  const catalog = JSON.parse(await readFile(new URL('./i18n-public.json', import.meta.url), 'utf8'));
  assert.equal(catalog.messages['Public health alert'], 'Digniinta caafimaadka bulshada');
});

test('the cholera film sits in the health alert, with English and Somali captions', async () => {
  assert.ok(section.includes('<video id="health-film" controls preload="metadata" playsinline poster="film/cholera-prevention.jpg"'), 'the film is in the section');
  assert.ok(section.includes('<source src="film/cholera-prevention.mp4" type="video/mp4">'));
  assert.ok(section.includes('<track kind="captions" src="film/cholera-prevention.vtt" srclang="en" label="English" default>'));
  assert.ok(section.includes('<track kind="captions" src="film/cholera-prevention.so.vtt" srclang="so" label="Soomaali">'));
  assert.ok(section.indexOf('id="health-film"') < section.indexOf('How flooding raises the risk'), 'near the top of the section');
  for (const name of ['cholera-prevention.mp4', 'cholera-prevention.jpg', 'cholera-prevention.vtt', 'cholera-prevention.so.vtt', 'cholera-prevention-so.mp4', 'cholera-prevention-so.jpg', 'cholera-prevention-so.vtt']) assert.ok((await stat(new URL('film/' + name, dist))).size > 1000, name);
  const en = await readFile(new URL('film/cholera-prevention.vtt', dist), 'utf8'), so = await readFile(new URL('film/cholera-prevention.so.vtt', dist), 'utf8');
  for (const vtt of [en, so]) { assert.match(vtt, /^WEBVTT\n\n1\n\d\d:\d\d:\d\d\.\d{3} --> /); assert.doesNotMatch(vtt, /O R S/, 'captions show ORS, not the spelled-out narration'); }
  assert.match(so, /Daacuun|daacuun/); assert.match(en, /cholera/i);
  // The Somali film's own captions, word-timed from its narration, in the owner's corrected wording.
  const somaliFilm = await readFile(new URL('film/cholera-prevention-so.vtt', dist), 'utf8');
  assert.match(somaliFilm, /^WEBVTT\n\n1\n/); assert.doesNotMatch(somaliFilm, /O R S/);
  assert.match(somaliFilm, /barkadaha/); assert.match(so, /barkadaha/, 'the scene-timed Somali captions follow the corrected script too');
  assert.doesNotMatch(somaliFilm + so, /kiniiniga ORS|kinniiniga|dhakhar kuu qoro/, 'ORS is daawada ORS, started at once (owner, 2026-10-16)');
  const last = text => text.trim().split('\n').filter(line => line.includes(' --> ')).at(-1).split(' --> ')[1];
  assert.ok(Math.abs(Date.parse('1970-01-01T' + last(en) + 'Z') - Date.parse('1970-01-01T' + last(so) + 'Z')) < 2000, 'both tracks end with the film');
});

test('film files are sent in byte ranges, as Safari and iPhones need', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-film-'));
  const server = createServer({dataDir});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port + '/film/';
    const size = (await stat(new URL('film/cholera-prevention.mp4', dist))).size;
    const whole = await fetch(base + 'cholera-prevention.mp4');
    assert.equal(whole.status, 200); assert.equal(whole.headers.get('content-type'), 'video/mp4'); assert.equal(whole.headers.get('accept-ranges'), 'bytes');
    assert.equal(Number(whole.headers.get('content-length')), size); assert.equal((await whole.arrayBuffer()).byteLength, size);
    assert.equal(whole.headers.get('cache-control'), 'public, max-age=3600', 'the CDN may keep a film for an hour');
    const first = await fetch(base + 'cholera-prevention.mp4', {headers: {Range: 'bytes=0-99'}});
    assert.equal(first.status, 206); assert.equal(first.headers.get('content-range'), `bytes 0-99/${size}`); assert.equal((await first.arrayBuffer()).byteLength, 100);
    const tail = await fetch(base + 'cholera-prevention.mp4', {headers: {Range: 'bytes=-500'}});
    assert.equal(tail.status, 206); assert.equal(tail.headers.get('content-range'), `bytes ${size - 500}-${size - 1}/${size}`); assert.equal((await tail.arrayBuffer()).byteLength, 500);
    const open = await fetch(base + 'cholera-prevention.mp4', {headers: {Range: `bytes=${size - 10}-`}});
    assert.equal(open.status, 206); assert.equal((await open.arrayBuffer()).byteLength, 10);
    for (const bad of [`bytes=${size}-`, 'bytes=50-10', 'bytes=-', 'items=0-5']) {
      const answer = await fetch(base + 'cholera-prevention.mp4', {headers: {Range: bad}});
      assert.equal(answer.status, 416, bad); assert.equal(answer.headers.get('content-range'), `bytes */${size}`); await answer.arrayBuffer();
    }
    const head = await fetch(base + 'cholera-prevention.mp4', {method: 'HEAD'});
    assert.equal(head.status, 200); assert.equal(Number(head.headers.get('content-length')), size);
    const vtt = await fetch(base + 'cholera-prevention.so.vtt');
    assert.equal(vtt.headers.get('content-type'), 'text/vtt; charset=utf-8'); assert.match(await vtt.text(), /^WEBVTT/);
    assert.equal((await fetch(base + '../film/../index.html')).status, 200, 'paths still resolve inside the app');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, {recursive: true, force: true}); }
});

test('the film plays in the page language: the Somali film for Somali readers, with its own captions', async () => {
  for (const lang of ['en', 'so']) {
    // A stand-in for the video: its caption tracks follow whatever <track> elements it holds.
    const video = {
      innerHTML: '', poster: 'film/cholera-prevention.jpg', loads: 0,
      setAttribute(name, value) { this[name] = value; }, load() { this.loads++; },
      tracks: [{language: 'en', mode: 'disabled'}, {language: 'so', mode: 'disabled'}],
      get textTracks() { return this.innerHTML ? [...this.innerHTML.matchAll(/srclang="(\w+)"/g)].map(([, language], i) => (this.tracks[i] = this.tracks[i]?.language === language ? this.tracks[i] : {language, mode: 'disabled'})) : this.tracks; }
    };
    const listeners = [];
    const document = {getElementById: id => id === 'health-film' ? video : null, addEventListener: (type, fn) => listeners.push(fn)};
    const window = {document, SiteLanguage: {getLanguage: () => lang}, setTimeout: fn => fn(), localStorage: {getItem: () => null, setItem() {}}};
    vm.runInContext(await readFile(new URL('alerts.js', dist), 'utf8'), vm.createContext({window, URL, URLSearchParams, Date}));
    if (lang === 'so') {
      assert.ok(video.innerHTML.startsWith('<source src="film/cholera-prevention-so.mp4" type="video/mp4">'), 'the Somali film');
      assert.ok(video.innerHTML.includes('<track kind="captions" src="film/cholera-prevention-so.vtt" srclang="so" label="Soomaali" default>'));
      assert.equal(video.poster, 'film/cholera-prevention-so.jpg'); assert.equal(video.loads, 1);
      assert.deepEqual(video.textTracks.map(track => track.mode), ['showing']);
    } else {
      assert.equal(video.innerHTML, '', 'English readers keep the film index.html loads'); assert.equal(video.loads, 0);
      assert.deepEqual(video.textTracks.map(track => track.mode), ['showing', 'disabled']);
    }
    video.textTracks.forEach(track => { track.mode = 'disabled'; });
    window.FloodAlerts.filmCaptions();
    assert.ok(video.textTracks.every(track => track.mode === 'disabled'), 'a redraw in the same language keeps the viewer\'s choice');
    window.SiteLanguage.getLanguage = () => (lang === 'so' ? 'en' : 'so');
    listeners.forEach(fn => fn({target: {closest: selector => selector === '[data-site-language]' ? {} : null}}));
    if (lang === 'so') {
      assert.ok(video.innerHTML.startsWith('<source src="film/cholera-prevention.mp4"'), 'back to the English film');
      assert.equal(video.poster, 'film/cholera-prevention.jpg');
      assert.deepEqual(video.textTracks.map(track => track.language + ':' + track.mode), ['en:showing', 'so:disabled']);
    } else {
      assert.ok(video.innerHTML.startsWith('<source src="film/cholera-prevention-so.mp4"'), 'switching to Somali loads the Somali film');
      assert.deepEqual(video.textTracks.map(track => track.language + ':' + track.mode), ['so:showing']);
    }
  }
});
