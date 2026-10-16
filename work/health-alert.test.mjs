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

test('the cholera film is the first training on the Diseases tab, with English and Somali captions', async () => {
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
