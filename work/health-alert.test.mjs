import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {mkdtemp, rm, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from './somalia-flood-watch/server.mjs';

const dist = new URL('./somalia-flood-watch/dist/', import.meta.url);
const index = await readFile(new URL('index.html', dist), 'utf8');
const start = index.indexOf('<section class="health-alert" id="health-alert"');
const section = index.slice(start, index.indexOf('</section>', start) + '</section>'.length);

// The Diseases tab (owner, 2026-10-16): the health alert, then the trainings (the films).
const panelStart = index.indexOf('<section class="panel diseases-panel" id="diseases-panel" data-site-tab="diseases"');
const panelEnd = index.indexOf('\n', panelStart);
const panel = index.slice(panelStart, panelEnd);

test('the public health alert and the trainings have their own Diseases tab, after Alerts', () => {
  assert.ok(panelStart > index.indexOf('id="alerts-panel"'), 'the panel follows the alerts panel');
  assert.ok(panelStart < index.indexOf('id="daily-panel"'));
  assert.ok(start > panelStart && start < panelEnd, 'the health alert is in it');
  assert.ok(panel.indexOf('id="trainings"') > panel.indexOf('id="health-share"'), 'then the trainings');
  assert.ok(panel.endsWith('</figure></section></section>'), 'the film closes the trainings, which close the panel');
  assert.match(panel, /<h2 id="diseases-title">Diseases<\/h2>/);
  const alerts = index.slice(index.indexOf('id="alerts-panel"'), panelStart);
  assert.ok(!alerts.includes('id="health-alert"') && !alerts.includes('<video'), 'nothing of it is left on the Alerts tab');
  assert.ok(alerts.includes('<p class="film-callout health-callout"><span>Flooding raises the risk of cholera, malaria and dengue.</span> <a href="#diseases-panel">Health guidance and a training film are on the Diseases tab ▶</a></p>'), 'which points to it');
  const tabs = [...index.matchAll(/data-site-tab-link="([a-z]+)"/g)].map(match => match[1]);
  assert.equal(tabs[tabs.indexOf('alerts') + 1], 'diseases', 'the side menu lists it after Alerts');
  assert.match(index, /<a class="site-tab" role="tab" id="site-tab-diseases" href="#diseases-panel" data-site-tab-link="diseases" aria-selected="false" tabindex="-1"><svg[^]*?<\/svg><span>Diseases<\/span><\/a>/);
  const shell = readFileSync(new URL('shell.css', dist), 'utf8');
  assert.match(shell, /#alerts-panel>:is\([^)]*\.health-callout[^)]*\)\{display:none\}/, 'the overview, which shows the alert list, leaves the pointer out');
});

test('the phone bottom bar has Diseases too, after Alerts, in six columns that fit 320px in Somali', async () => {
  const bar = index.slice(index.indexOf('<nav class="mobile-bottom-nav"'), index.indexOf('</nav>', index.indexOf('<nav class="mobile-bottom-nav"')));
  const labels = [...bar.matchAll(/<span>([^<]+)<\/span><\/a>/g)].map(match => match[1]);
  assert.deepEqual(labels, ['30 cities', 'Weather', 'Map', 'Alerts', 'Diseases', 'Report']);
  assert.ok(bar.includes('<a href="#diseases-panel" data-site-tab-target="diseases">'), 'an in-page link tabs.js opens, in either view');
  const tabs = readFileSync(new URL('tabs.js', dist), 'utf8');
  assert.match(tabs, /querySelectorAll\('\[data-site-tab-target\]'\)/, 'tabs.js marks it as the current page');
  assert.match(readFileSync(new URL('mayor.css', dist), 'utf8'), /\.mobile-bottom-nav\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  const catalog = JSON.parse(await readFile(new URL('./i18n-public.json', import.meta.url), 'utf8'));
  // "Khariidadda fatahaadda" does not fit a sixth of 320px; "Khariidad" does (measured 47px in a 53px cell).
  assert.equal(catalog.messages.Map, 'Khariidad');
});

test('the Diseases tab reads in Somali', async () => {
  const catalog = JSON.parse(await readFile(new URL('./i18n-public.json', import.meta.url), 'utf8'));
  assert.equal(catalog.messages.Diseases, 'Cudurrada');
  const texts = [...panel.slice(0, panel.indexOf('<section class="health-alert"')).matchAll(/>([^<>]+)</g), ...panel.slice(panel.indexOf('id="trainings"')).matchAll(/>([^<>]+)</g)]
    .map(match => match[1].trim()).filter(text => /[A-Za-z]/.test(text));
  assert.ok(texts.length >= 5);
  for (const text of [...texts, 'Flooding raises the risk of cholera, malaria and dengue.', 'Health guidance and a training film are on the Diseases tab ▶']) assert.ok(catalog.messages[text], text);
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
    assert.match(row, /data-share-tab="diseases"/);
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
  assert.match(tabs, /if \(mayor\(\)\) return openInMayor\(event\);/, 'the city manager view handles it');
  const catalog = JSON.parse(await readFile(new URL('./i18n-public.json', import.meta.url), 'utf8'));
  assert.equal(catalog.messages['Public health alert'], 'Digniinta caafimaadka bulshada');
});

test('the waterborne-diseases film is the first training, in English with English and Somali captions and its own Share row', async () => {
  const trainings = panel.slice(panel.indexOf('<section class="trainings" id="trainings"'));
  assert.ok(trainings.indexOf('id="waterborne-film"') > 0 && trainings.indexOf('id="waterborne-film"') < trainings.indexOf('id="health-film"'), 'the overview first, then the cholera film');
  for (const part of ['<video id="waterborne-film" controls preload="metadata" playsinline poster="film/waterborne-diseases.jpg"', '<source src="film/waterborne-diseases.mp4" type="video/mp4">',
    '<track kind="captions" src="film/waterborne-diseases.vtt" srclang="en" label="English" default>', '<track kind="captions" src="film/waterborne-diseases.so.vtt" srclang="so" label="Soomaali">', '<div id="waterborne-share"></div></figure>']) assert.ok(trainings.includes(part), part);
  for (const name of ['waterborne-diseases.mp4', 'waterborne-diseases.jpg', 'waterborne-diseases.vtt', 'waterborne-diseases.so.vtt']) assert.ok((await stat(new URL('film/' + name, dist))).size > 1000, name);
  const so = await readFile(new URL('film/waterborne-diseases.so.vtt', dist), 'utf8');
  assert.match(so, /^WEBVTT\n\n1\n/); assert.match(so, /Cagaarshowga/); assert.doesNotMatch(so, /O R S/);
  // Somali readers keep the English film (no Somali narration yet), with the Somali captions showing.
  const video = {innerHTML: '', loads: 0, setAttribute() {}, load() { this.loads++; }, textTracks: [{language: 'en', mode: 'showing'}, {language: 'so', mode: 'disabled'}]};
  const document = {getElementById: id => id === 'waterborne-film' ? video : null, addEventListener() {}};
  const window = {document, SiteLanguage: {getLanguage: () => 'so'}, setTimeout: fn => fn(), localStorage: {getItem: () => null, setItem() {}}};
  vm.runInContext(await readFile(new URL('alerts.js', dist), 'utf8'), vm.createContext({window, URL, URLSearchParams, Date}));
  assert.equal(video.loads, 0, 'the English film stays');
  assert.deepEqual(video.textTracks.map(track => track.mode), ['disabled', 'showing']);
  for (const lang of ['en', 'so']) {
    const nodes = {'waterborne-share': {innerHTML: ''}};
    const doc = {readyState: 'complete', title: '', body: {nodeType: 11, childNodes: []}, documentElement: {setAttribute() {}}, getElementById: id => nodes[id] || null, querySelectorAll: () => [], addEventListener() {}};
    const win = {document: doc, location: {href: `https://elninowatch.so/?lang=${lang}`, protocol: 'https:'}, localStorage: {getItem: () => null, setItem() {}}, navigator: {}, setTimeout: fn => fn()};
    const context = vm.createContext({window: win, URL, URLSearchParams, Date});
    for (const file of ['translations-so.js', 'i18n.js', 'share.js', 'alerts.js']) vm.runInContext(await readFile(new URL(file, dist), 'utf8'), context);
    assert.match(nodes['waterborne-share'].innerHTML, /data-share-tab="#waterborne-film"/);
    const text = win.SiteShare.textOf(win.FloodAlerts.waterborneShareLines);
    assert.equal(win.SiteShare.fit(text), text, `${lang}: nothing is cut or dropped for X`);
    if (lang === 'so') { assert.match(text, /^Daawo: cudurrada biyaha/); assert.doesNotMatch(text, /\b(the|and|with|film)\b/); }
  }
});

test('the cholera film is the second training on the Diseases tab, with English and Somali captions', async () => {
  const trainings = panel.slice(panel.indexOf('<section class="trainings" id="trainings"'));
  assert.ok(trainings.includes('<video id="health-film" controls preload="metadata" playsinline poster="film/cholera-prevention.jpg"'), 'the film is in the trainings');
  assert.ok(!section.includes('<video'), 'and no longer in the health alert');
  assert.ok(trainings.includes('<source src="film/cholera-prevention.mp4" type="video/mp4">'));
  assert.ok(trainings.includes('<track kind="captions" src="film/cholera-prevention.vtt" srclang="en" label="English" default>'));
  assert.ok(trainings.includes('<track kind="captions" src="film/cholera-prevention.so.vtt" srclang="so" label="Soomaali">'));
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

test('the film has a Share row whose link opens the film itself, in English and Somali', async () => {
  assert.ok(index.includes('<div id="film-share"></div></figure>'), 'the row sits under the film');
  for (const lang of ['en', 'so']) {
    const nodes = {'film-share': {innerHTML: ''}};
    const document = {readyState: 'complete', title: '', body: {nodeType: 11, childNodes: []}, documentElement: {setAttribute() {}}, getElementById: id => nodes[id] || null, querySelectorAll: () => [], addEventListener() {}};
    const window = {document, location: {href: `https://elninowatch.so/?lang=${lang}`, protocol: 'https:'}, localStorage: {getItem: () => null, setItem() {}}, navigator: {}, setTimeout: fn => fn()};
    const context = vm.createContext({window, URL, URLSearchParams, Date});
    for (const file of ['translations-so.js', 'i18n.js', 'share.js', 'alerts.js']) vm.runInContext(await readFile(new URL(file, dist), 'utf8'), context);
    const row = nodes['film-share'].innerHTML;
    assert.match(row, /^<div class="share-row"/); assert.match(row, /data-share-tab="#health-film"/);
    assert.equal(window.SiteShare.linkFor('#health-film'), lang === 'so' ? 'https://elninowatch.so/?lang=so#health-film' : 'https://elninowatch.so/#health-film');
    const text = window.SiteShare.textOf(window.FloodAlerts.filmShareLines);
    assert.equal(text.split('\n').length, 3);
    assert.equal(window.SiteShare.fit(text), text, `${lang}: nothing is cut or dropped for X`);
    if (lang === 'so') { assert.match(text, /^Daawo: sida qoyskaaga/); assert.doesNotMatch(text, /\b(the|and|with|film)\b/); }
  }
});

test('the waterborne-diseases film: its prevention scenes are the approved cholera scenes word for word, so their clips can be reused', async () => {
  const film = new URL('./film/', import.meta.url);
  for (const [id, base] of [['waterborne-diseases', 'cholera-prevention'], ['waterborne-diseases-so', 'cholera-prevention-so']]) {
    const sb = JSON.parse(await readFile(new URL(id + '.json', film), 'utf8')), approved = JSON.parse(await readFile(new URL(base + '.json', film), 'utf8'));
    for (const scene of ['boil', 'handwash', 'latrine', 'food']) assert.deepEqual(sb.scenes.find(s => s.id === scene), approved.scenes.find(s => s.id === scene), `${id} ${scene}`);
    // New scenes take new ids, so the cholera film's own title, spread, ORS and closing clips are never picked up.
    for (const scene of sb.scenes) assert.ok(['boil', 'handwash', 'latrine', 'food'].includes(scene.id) || !approved.scenes.some(s => s.id === scene.id), `${id}: ${scene.id} would reuse a cholera clip`);
    assert.equal(sb.voice.voice, approved.voice.voice, 'the same voice as the approved film');
    assert.match(sb.voice.approved, /^PENDING|^owner, /, 'voicing waits for the owner');
    for (const source of sb.sources.filter(x => /^WHO/.test(x))) assert.match(source, /https:\/\/www\.who\.int\//, source);
  }
  const html = await readFile(new URL('film.html', film), 'utf8');
  assert.ok(html.includes("const at = s.at || [.02, .1, .44, .66];"), 'the cholera film keeps its ORS timings');
});

test('the site footer links to the cholera film, in Somali too', async () => {
  const footer = index.slice(index.indexOf('<footer class="site-footer'), index.indexOf('</footer>'));
  assert.ok(footer.includes('<a href="#diseases-panel">Diseases</a><a href="#health-alert">Public health alert</a><a href="#health-film">Cholera film</a>'), 'the Diseases tab, then its two sections');
  const catalog = JSON.parse(await readFile(new URL('./i18n-public.json', import.meta.url), 'utf8'));
  assert.equal(catalog.messages['Cholera film'], 'Filimka daacuunka');
});

test('the map tab calls out the cholera film, in Somali too', async () => {
  const start = index.indexOf('id="map-panel"'), panel = index.slice(start, index.indexOf('<div class="map-controls">', start) + 30);
  assert.ok(panel.includes('<p class="film-callout"><span>Flood water can carry cholera.</span> <a href="#health-film">Watch the film: how to protect your family ▶</a></p>'), 'near the top of the map panel');
  const catalog = JSON.parse(await readFile(new URL('./i18n-public.json', import.meta.url), 'utf8'));
  assert.equal(catalog.messages['Flood water can carry cholera.'], 'Biyaha fatahaaddu waxay qaadi karaan daacuun.');
  assert.equal(catalog.messages['Watch the film: how to protect your family ▶'], 'Daawo filimka: sida qoyskaaga loo ilaaliyo ▶');
});

test('the weather tab calls out the cholera film too', () => {
  const start = index.indexOf('id="daily-panel"'), panel = index.slice(start, index.indexOf('id="daily-status"', start));
  assert.ok(panel.includes('<p class="film-callout"><span>Flood water can carry cholera.</span> <a href="#health-film">Watch the film: how to protect your family ▶</a></p>'), 'under the weather panel heading');
});

test('every tab calls out the cholera film', () => {
  const callout = '<p class="film-callout"><span>Flood water can carry cholera.</span> <a href="#health-film">Watch the film: how to protect your family ▶</a></p>';
  const panelOf = id => { const start = index.indexOf(`id="${id}"`); return index.slice(start, index.indexOf('</section>', start)); };
  for (const id of ['city-rankings-panel', 'map-panel', 'daily-panel', 'community-panel', 'source-panel']) assert.ok(panelOf(id).includes(callout), id);
  assert.equal(index.split(callout).length - 1, 5, 'once on each tab');
});

test('the malaria, dysentery and typhoid, and hepatitis A and E films: after the cholera film, English with English captions, each with a Share row, footer link and Sources entry', async () => {
  const trainings = index.slice(index.indexOf('<section class="trainings"'), index.indexOf('</section></section>', index.indexOf('<section class="trainings"')));
  const films = [['malaria-film', 'malaria-prevention', 'Malaria film'], ['dysentery-film', 'dysentery-typhoid', 'Dysentery and typhoid film'], ['hepatitis-film', 'hepatitis-a-e', 'Hepatitis A and E film']];
  let last = trainings.indexOf('id="health-film"');
  const catalog = JSON.parse(await readFile(new URL('./i18n-public.json', import.meta.url), 'utf8'));
  const sources = await readFile(new URL('sources.html', dist), 'utf8');
  const footer = index.slice(index.indexOf('<footer class="site-footer'), index.indexOf('</footer>'));
  for (const [id, file, link] of films) {
    const at = trainings.indexOf(`<video id="${id}" controls preload="metadata" playsinline poster="film/${file}.jpg" width="1280" height="720"><source src="film/${file}.mp4" type="video/mp4"><track kind="captions" src="film/${file}.vtt" srclang="en" label="English" default></video>`);
    assert.ok(at > last, `${id} follows the film before it`);
    last = at;
    for (const ext of ['mp4', 'jpg', 'vtt']) assert.ok((await stat(new URL(`film/${file}.${ext}`, dist))).size > 0, `${file}.${ext}`);
    assert.match(await readFile(new URL(`film/${file}.vtt`, dist), 'utf8'), /^WEBVTT/);
    const caption = trainings.slice(at).match(/<figcaption>([^<]+)<\/figcaption>/)[1];
    assert.ok(catalog.messages[caption], `Somali for: ${caption}`);
    assert.ok(trainings.includes(`<div id="${id.replace('-film', '-share')}"></div></figure>`), `${id} has a Share row`);
    assert.ok(footer.includes(`<a href="#${id}">${link}</a>`) && catalog.messages[link], `${id} in the footer, in Somali too`);
    assert.ok(sources.includes(`href="/#${id}"`), `${id} on the Sources page`);
  }
  assert.ok(footer.includes('<a href="#health-film">Cholera film</a><a href="#malaria-film">Malaria film</a>'), 'the new films follow the cholera film in the footer');
  const {FILMS_FLASH} = await import('./somalia-flood-watch/news-feed.mjs');
  assert.equal(FILMS_FLASH.url, '#health-films');
  assert.ok(catalog.messages[FILMS_FLASH.label] && catalog.messages[FILMS_FLASH.title], 'the flash item in Somali');
  // Each film's Share row links to that film, and each storyboard records the owner's approval of the English.
  const nodes = {'malaria-share': {innerHTML: ''}, 'dysentery-share': {innerHTML: ''}, 'hepatitis-share': {innerHTML: ''}};
  const doc = {readyState: 'complete', title: '', body: {nodeType: 11, childNodes: []}, documentElement: {setAttribute() {}}, getElementById: id => nodes[id] || null, querySelectorAll: () => [], addEventListener() {}};
  const win = {document: doc, location: {href: 'https://elninowatch.so/', protocol: 'https:'}, localStorage: {getItem: () => null, setItem() {}}, navigator: {}, setTimeout: fn => fn()};
  const context = vm.createContext({window: win, URL, URLSearchParams, Date});
  for (const file of ['translations-so.js', 'i18n.js', 'share.js', 'alerts.js']) vm.runInContext(await readFile(new URL(file, dist), 'utf8'), context);
  for (const [id, file] of films) {
    assert.match(nodes[id.replace('-film', '-share')].innerHTML, new RegExp(`data-share-tab="#${id}"`));
    const sb = JSON.parse(await readFile(new URL(`./film/${file}.json`, import.meta.url), 'utf8'));
    assert.match(sb.voice.approved, /^owner, 2026-10-17/);
    const so = JSON.parse(await readFile(new URL(`./film/${file}-so.json`, import.meta.url), 'utf8'));
    assert.match(so.voice.approved, /^PENDING/, 'the Somali script still awaits the owner');
  }
});

test('the health films on the home page: a thumbnail for each film under the audio bulletin, opening and playing it on the Diseases tab', async () => {
  const strip = index.slice(index.indexOf('<section class="panel film-strip" id="health-films" data-site-tab="overview"'), index.indexOf('</section>', index.indexOf('id="health-films"')));
  assert.ok(strip.length > 0 && index.indexOf('id="health-films"') < index.indexOf('id="site-disclaimer"'), 'on the home page, before the disclaimer');
  const films = [...strip.matchAll(/<a class="film-thumb" href="#([\w-]+)" data-film="\1"[^>]*><span class="film-thumb-img"><img src="(film\/thumb-[\w-]+\.jpg)"/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(films.map(f => f[0]), ['waterborne-film', 'health-film', 'malaria-film', 'dysentery-film', 'hepatitis-film'], 'every film on the Diseases tab');
  for (const [id, thumb] of films) {
    assert.ok(index.includes(`<video id="${id}"`), `${id} exists`);
    const size = (await stat(new URL(thumb, dist))).size;
    assert.ok(size > 2000 && size < 40000, `${thumb} is a small thumbnail (${size} bytes)`);
  }
  assert.ok(strip.includes('data-so-time="3:14" data-so-thumb="film/thumb-cholera-prevention-so.jpg"'), 'the cholera film is longer in Somali');
  assert.ok((await stat(new URL('film/thumb-cholera-prevention-so.jpg', dist))).size > 2000);
  const catalog = JSON.parse(await readFile(new URL('./i18n-public.json', import.meta.url), 'utf8'));
  for (const text of ['SHORT FILMS · DISEASES AFTER FLOODS', 'Health films: protect your family', 'Five short films, step by step. Tap one to watch it on the Diseases tab.', 'Diseases from dirty water', 'Cholera', 'Malaria', 'Dysentery and typhoid', 'Hepatitis A and E', 'Health films']) assert.ok(catalog.messages[text], `Somali for: ${text}`);
  const footer = index.slice(index.indexOf('<footer class="site-footer'), index.indexOf('</footer>'));
  assert.ok(footer.includes('<a href="#health-films">Health films</a>'));
  const shell = await readFile(new URL('shell.css', dist), 'utf8');
  assert.match(shell, /main>#health-films\{order:-1\}/, 'phones: under the bulletin');
  assert.equal(shell.split('"nav films films" "nav disc disc"').length - 1, 4, 'desktop: its own row in every home layout');
  const {FILMS_FLASH} = await import('./somalia-flood-watch/news-feed.mjs');
  assert.equal(FILMS_FLASH.url, '#health-films', 'the news flash points to the thumbnails');
  // A tap plays the film: the listener is in the capture phase, because tabs.js stops the click there.
  const alerts = await readFile(new URL('alerts.js', dist), 'utf8');
  assert.match(alerts, /closest\?\.\('\.film-thumb\[data-film\]'\)[\s\S]{0,260}\}, true\);/);
  assert.ok(index.indexOf('<script src="alerts.js">') < index.indexOf('<script src="tabs.js">'), 'and it loads before tabs.js');
  // The cholera thumbnail follows the page language.
  const link = {dataset: {soTime: '3:14', soThumb: 'film/thumb-cholera-prevention-so.jpg'}, img: {src: 'film/thumb-cholera-prevention.jpg', getAttribute() { return this.src; }, setAttribute(_, v) { this.src = v; }}, time: {textContent: '2:24'}};
  link.querySelector = sel => sel === 'img' ? link.img : link.time;
  const doc = {readyState: 'complete', title: '', body: {nodeType: 11, childNodes: []}, documentElement: {setAttribute() {}}, getElementById: () => null, querySelectorAll: sel => sel === '.film-thumb[data-so-time]' ? [link] : [], addEventListener() {}};
  const win = {document: doc, location: {href: 'https://elninowatch.so/', protocol: 'https:'}, localStorage: {getItem: () => null, setItem() {}}, navigator: {}, setTimeout: fn => fn()};
  const context = vm.createContext({window: win, URL, URLSearchParams, Date});
  for (const file of ['translations-so.js', 'i18n.js', 'share.js', 'alerts.js']) vm.runInContext(await readFile(new URL(file, dist), 'utf8'), context);
  win.FloodAlerts.filmThumbs('so');
  assert.deepEqual([link.time.textContent, link.img.src], ['3:14', 'film/thumb-cholera-prevention-so.jpg']);
  win.FloodAlerts.filmThumbs('en');
  assert.deepEqual([link.time.textContent, link.img.src], ['2:24', 'film/thumb-cholera-prevention.jpg']);
});
