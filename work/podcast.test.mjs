import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat, copyFile, readdir} from 'node:fs/promises';
import {Readable} from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createServer} from './somalia-flood-watch/server.mjs';
import {buildScript, dueSlot, podcastConfig, createPodcast, STYLE, TIPS, KEEP_DAYS, APPROVED_TEMPLATE, TEMPLATE_VERSION, APPROVED_TEMPLATE_EN, TEMPLATE_VERSION_EN} from './somalia-flood-watch/podcast.mjs';
import {createWhatsApp, whatsappConfig, parseCommand} from './somalia-flood-watch/whatsapp.mjs';

const dist = new URL('./somalia-flood-watch/dist/', import.meta.url);
const cities = JSON.parse(await readFile(new URL('cities.json', dist), 'utf8'));
const quiet = {log() {}, error() {}};
const EVENING = Date.parse('2026-10-16T15:35:00Z');   // 18:35 EAT, Friday
const MORNING = Date.parse('2026-10-16T03:35:00Z');   // 06:35 EAT
const MIDDAY = Date.parse('2026-10-16T09:35:00Z');    // 12:35 EAT

const moewr = (region, level, aaActive = false) => ({sourceId: 'moewr', status: 'active', level, aaActive, endsAt: '2026-10-20T23:59:59Z', scope: {region, cities: []}});
const icpac = (city, category) => ({sourceId: 'icpac', status: 'active', category, endsAt: '2026-10-20T20:59:59Z', scope: {cities: [city]}});
const ALERTS = {available: true, alerts: [moewr('Galgaduud', 'warning', true), moewr('Bakool', 'watch', true), moewr('Bay', 'advisory'), icpac('Baidoa', 'heavy'), icpac('Beledweyne', 'very-heavy')],
  sources: ['moewr', 'icpac', 'floodhub'].map(id => ({id, available: true}))};
const STATIONS = {available: true, stations: [
  {name: 'Jowhar', river: 'Shabelle', levelM: 5.17, moderateM: 5, highM: 5.25, observedAt: '2026-10-16'},
  {name: 'Belet Weyne', river: 'Shabelle', levelM: 5.3, moderateM: 6.5, highM: 7.3, observedAt: '2026-10-16'},
  {name: 'Kaitoi', river: 'Juba', levelM: null, moderateM: null, highM: null, observedAt: '2008-12-31'}]};
const ENSO = {available: true, alertStatus: 'El Niño Advisory', issuedAt: '2026-10-08'};
const NEWS = {items: [
  {language: 'so', group: 'sodma', source: 'SoDMA', title: 'WAR-BIXINTA TODDOBAADLAHA EE DIGNIINAHA', publishedAt: '2026-10-15T10:00:00Z'},
  {language: 'en', group: 'news', source: 'FTL Somalia', title: 'Flash floods in Hudur affect 37 households', publishedAt: '2026-10-16T08:00:00Z'}]};
const rainFor = (tomorrow = {Galkayo: 23.2, Adado: 16.4}) => cities.map(c => ({city: c[0], days: [{date: '2026-10-16', mm: 2}, {date: '2026-10-17', mm: tomorrow[c[0]] ?? 3}]}));
const DATA = {alerts: ALERTS, stations: STATIONS, enso: ENSO, news: NEWS, rain: rainFor()};

test('the evening bulletin: official first, rivers to the centimetre, tomorrow\'s rain, ICPAC as a forecast, Somali news only', () => {
  const {text, title} = buildScript({slotId: 'evening', now: EVENING, ...DATA});
  assert.equal(title, 'Warbixinta fiidka, Jimce, 16 Oktoobar');
  assert.ok(text.startsWith('Waa El Nino Watch, warbixinta fiidka ee Jimce, 16 Oktoobar. Kani ma aha adeeg digniin rasmi ah.'));
  assert.ok(text.includes('Digniinaha rasmiga ah ee Wasaaradda Tamarta iyo Kheyraadka Biyaha waa kuwan. Digniin fatahaadeed: Galgaduud; tallaabada hore waa la hawlgeliyay. Feejignaan fatahaadeed: Bakool. Talo fatahaadeed: Bay.'));
  assert.ok(text.includes('Webiga Shabeelle ee Jowhar wuxuu marayaa 5.17 mitir, oo ka sarreeya heerka dhexdhexaadka ah, kuna dhow heerka sare ee 5.25 mitir.'));
  assert.ok(!text.includes('Beledweyne wuxuu') && !text.includes('ee Beledweyne wuxuu marayaa'), 'a gauge below its flood levels is not read out');
  assert.ok(text.includes('Roobka berri: roobka ugu badan waxaa laga filayaa Gaalkacyo 23 milimitir iyo Cadaado 16 milimitir. Kani waa saadaal moodeel.'));
  assert.ok(text.includes('Saadaasha toddobaadkan ee ICPAC waxay muujinaysaa roob xooggan 2 ka mid ah 30-ka magaalo, oo ay ku jiraan Beledweyne iyo Baydhabo. Taasi waa saadaal moodeel, ma aha digniin rasmi ah.'));
  assert.ok(text.includes('Warar: NOAA waxay sheegtay 8 Oktoobar in El Niño uu socdo. SoDMA ayaa sheegtay: War-bixinta toddobaadlaha ee digniinaha.'));
  assert.doesNotMatch(text, /Hudur|FTL/, 'English-language news is not read in a Somali bulletin');
  assert.ok(TIPS.some(tip => text.includes(tip)), 'one tip');
  assert.ok(text.endsWith('Raac tilmaamaha maamulka deegaanka iyo SoDMA. Xog dheeraad ah ka hel elninowatch.so. Waa El Nino Watch.'));
  // Only MOEWR is called official; everything else says it is not.
  const rest = text.replace('Kani ma aha adeeg digniin rasmi ah', '').replace('Digniinaha rasmiga ah ee Wasaaradda', '').replace('ma aha digniin rasmi ah', '');
  assert.doesNotMatch(rest, /rasmi/);
  assert.doesNotMatch(text, /\b(the|and|with|warning|flood|rain|river)\b/i, 'no English');
});

test('a source that is down is said to be unavailable, never read from older figures', () => {
  const stale = {available: true, stations: STATIONS.stations.map(s => ({...s, observedAt: '2026-10-10'}))};
  const {text} = buildScript({slotId: 'evening', now: EVENING, alerts: null, stations: stale, enso: null, news: null, rain: null});
  assert.ok(text.includes('Digniinaha rasmiga ah ee Wasaaradda Tamarta iyo Kheyraadka Biyaha lama heli karo hadda.'));
  assert.ok(text.includes('Heerarka webiyada Jubba iyo Shabeelle lama heli karo hadda.'));
  assert.ok(text.includes('Saadaasha roobka berri lama heli karo hadda.'));
  assert.doesNotMatch(text, /5\.17|Warar/);
  const down = {...ALERTS, sources: ALERTS.sources.map(s => s.id === 'moewr' ? {...s, available: false} : s)};
  assert.ok(buildScript({slotId: 'morning', now: MORNING, ...DATA, alerts: down}).text.includes('lama heli karo hadda'), 'MOEWR down: not "no warnings"');
  const none = {...ALERTS, alerts: ALERTS.alerts.filter(a => a.sourceId !== 'moewr')};
  assert.ok(buildScript({slotId: 'morning', now: MORNING, ...DATA, alerts: none}).text.includes('hadda ma jirto digniin fatahaadeed oo rasmi ah'));
  const dry = buildScript({slotId: 'morning', now: MORNING, ...DATA, rain: rainFor()}).text;
  assert.ok(dry.includes('Roob xooggan, 10 milimitir ama ka badan, looma filayo maanta 30-ka magaalo midkoodna.'), 'the morning reads today\'s rain');
});

test('midday says so when nothing has changed since the morning, and reads the change when something has', () => {
  const morning = buildScript({slotId: 'morning', now: MORNING, ...DATA});
  assert.doesNotMatch(morning.text, /Warar|ICPAC/, 'the morning has no news and no weekly outlook');
  const same = buildScript({slotId: 'midday', now: MIDDAY, ...DATA, previous: morning.facts});
  assert.ok(same.text.includes('Digniinaha rasmiga ah iyo heerarka webiyada isma beddelin tan iyo subaxdii.'));
  assert.ok(!same.text.includes('Webiga Shabeelle'));
  assert.equal((same.text.match(/Warar: /g) || []).length, 1); assert.ok(!same.text.includes('SoDMA ayaa sheegtay'), 'one news line at midday');
  const worse = {...ALERTS, alerts: [...ALERTS.alerts, moewr('Hiraan', 'warning', true)]};
  const changed = buildScript({slotId: 'midday', now: MIDDAY, ...DATA, alerts: worse, previous: morning.facts});
  assert.ok(changed.text.includes('Digniin fatahaadeed: Galgaduud iyo Hiiraan; tallaabada hore waa la hawlgeliyay.'));
});

test('the three slots: 06:30, 12:30 and 18:30 East Africa Time, each due for two hours', () => {
  const at = utc => dueSlot(Date.parse(`2026-10-16T${utc}:00Z`))?.id || null;
  assert.equal(at('03:29'), null);
  assert.equal(at('03:30'), '2026-10-16-morning'); assert.equal(at('05:29'), '2026-10-16-morning'); assert.equal(at('05:31'), null);
  assert.equal(at('09:30'), '2026-10-16-midday'); assert.equal(at('15:30'), '2026-10-16-evening'); assert.equal(at('17:29'), '2026-10-16-evening'); assert.equal(at('17:31'), null);
});

test('switched off until the owner approves the template, and the key and switch are set', () => {
  assert.equal(TEMPLATE_VERSION, '2026-10-16');
  const config = podcastConfig({GEMINI_API_KEY: 'key-not-real', PODCAST_ENABLED: '1'});
  assert.equal(config.voice, 'Puck'); assert.equal(config.model, 'gemini-3.8-flash-tts');
  assert.equal(config.enabled, APPROVED_TEMPLATE === TEMPLATE_VERSION, 'only an approved template runs');
  assert.equal(podcastConfig({PODCAST_ENABLED: '1'}).enabled, false);
  assert.equal(podcastConfig({GEMINI_API_KEY: 'key-not-real'}).enabled, false);
});

// ---- The service, with Gemini, Open-Meteo and ffmpeg stood in for ----

function request(method, url, body = '', headers = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(req, {method, url, headers});
  return req;
}
async function call(service, method, target, body = '', headers = {}) {
  const res = {status: 0, body: '', writeHead(status) { this.status = status; }, end(data) { this.body = data ? data.toString() : ''; }};
  const handled = await service.handle(request(method, target, body, headers), res, new URL(target, 'http://127.0.0.1'));
  return {handled, ...res, json: () => JSON.parse(res.body)};
}

async function setup({gemini = 'ok'} = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-podcast-'));
  const calls = [], published = [];
  let clock = EVENING, answer = gemini;
  const pcm = Buffer.alloc(48000);   // one second of 24 kHz 16-bit silence, with no WAV header
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('https://api.open-meteo.com/')) return {ok: true, status: 200, json: async () => cities.map(c => ({daily: {time: ['2026-10-16', '2026-10-17', '2026-10-18'], precipitation_sum: [1, c[0] === 'Galkayo' ? 23 : 2, 0]}}))};
    calls.push({url: target, headers: options.headers, body: JSON.parse(options.body)});
    if (answer !== 'ok') return {ok: false, status: 500, json: async () => ({})};
    return {ok: true, status: 200, json: async () => ({steps: [{type: 'user_input'}, {type: 'model_output', content: [{type: 'audio', data: pcm.toString('base64')}]}]})};
  };
  const config = {enabled: true, apiKey: 'key-not-real', model: 'gemini-3.8-flash-tts', voice: 'Puck', ffmpeg: 'ffmpeg'};
  const feeds = {alerts: async () => ALERTS, stations: async () => STATIONS, enso: async () => ENSO, news: async () => NEWS};
  const service = createPodcast({dataDir, cities, config, statsKey: 'stats-key-not-real', feeds, fetchImpl, now: () => clock, log: quiet,
    onPublished: item => published.push(item.id), encode: (wav, mp3) => copyFile(wav, mp3)});
  return {service, dataDir, calls, published, setClock: at => { clock = at; }, setGemini: value => { answer = value; }, done: () => rm(dataDir, {recursive: true, force: true})};
}

test('a due bulletin is written, voiced with Puck, saved as MP3 and published once', async () => {
  const t = await setup();
  try {
    const item = await t.service.tick();
    assert.equal(item.id, '2026-10-16-evening'); assert.equal(item.seconds, 1); assert.equal(item.title, 'Warbixinta fiidka, Jimce, 16 Oktoobar');
    assert.equal(t.calls.length, 1);
    const [gemini] = t.calls;
    assert.equal(gemini.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(gemini.headers['x-goog-api-key'], 'key-not-real');
    assert.equal(gemini.body.model, 'gemini-3.8-flash-tts');
    assert.deepEqual(gemini.body.generation_config.speech_config, [{voice: 'Puck'}]);
    assert.deepEqual(gemini.body.response_format, {type: 'audio'});
    const content = gemini.body.input[0].content[0];
    assert.ok(content.text.startsWith('Waa El Nino Watch, warbixinta fiidka')); assert.equal(content.annotations[0].style, STYLE);
    assert.ok(content.text.includes('Gaalkacyo 23 milimitir'), 'tomorrow\'s rain from Open-Meteo');
    const files = await readdir(path.join(t.dataDir, 'podcast'));
    assert.deepEqual(files.filter(f => !f.endsWith('.json')), ['2026-10-16-evening.mp3'], 'the WAV is removed once encoded');
    const mp3 = await readFile(path.join(t.dataDir, 'podcast', '2026-10-16-evening.mp3'));
    assert.equal(mp3.subarray(0, 4).toString('latin1'), 'RIFF', 'Gemini\'s headerless PCM was given a WAV header before encoding');
    assert.deepEqual(t.published, ['2026-10-16-evening']);
    assert.equal(await t.service.tick(), null); assert.equal(t.calls.length, 1, 'never twice');
    const listed = (await call(t.service, 'GET', '/api/podcast')).json();
    assert.equal(listed.enabled, true); assert.equal(listed.items[0].url, '/podcast/2026-10-16-evening.mp3'); assert.ok(listed.items[0].text.includes('Webiga Shabeelle'));
    assert.equal(t.service.audioFile('/podcast/2026-10-16-evening.mp3'), path.join(t.dataDir, 'podcast', '2026-10-16-evening.mp3'));
    for (const bad of ['/podcast/2026-10-15-evening.mp3', '/podcast/../podcast/index.json', '/podcast/index.mp3', '/podcast/2026-10-16-evening.wav']) assert.equal(t.service.audioFile(bad), null, bad);
  } finally { await t.done(); }
});

test('the owner\'s hold switch needs the stats key, and stops new bulletins until lifted', async () => {
  const t = await setup();
  try {
    assert.equal((await call(t.service, 'POST', '/api/podcast/hold', '{"hold":true}')).status, 403);
    assert.equal((await call(t.service, 'POST', '/api/podcast/hold', '{"hold":true}', {'x-stats-key': 'wrong'})).status, 403);
    assert.equal((await call(t.service, 'POST', '/api/podcast/hold', '{"hold":"yes"}', {'x-stats-key': 'stats-key-not-real'})).status, 400);
    assert.equal((await call(t.service, 'POST', '/api/podcast/hold', '{"hold":true}', {'x-stats-key': 'stats-key-not-real'})).status, 200);
    assert.equal(await t.service.tick(), null); assert.equal(t.calls.length, 0, 'held: nothing voiced');
    await call(t.service, 'POST', '/api/podcast/hold', '{"hold":false}', {'x-stats-key': 'stats-key-not-real'});
    assert.equal((await t.service.tick()).id, '2026-10-16-evening');
  } finally { await t.done(); }
});

test('a failed bulletin is tried again after five minutes, at most three times; old bulletins are cleared after a week', async () => {
  const t = await setup({gemini: 'down'});
  try {
    assert.equal(await t.service.tick(), null); assert.equal(t.calls.length, 1);
    assert.equal(await t.service.tick(), null); assert.equal(t.calls.length, 1, 'not straight away');
    t.setClock(EVENING + 5 * 60000); await t.service.tick(); assert.equal(t.calls.length, 2);
    t.setClock(EVENING + 10 * 60000); await t.service.tick(); assert.equal(t.calls.length, 3);
    t.setClock(EVENING + 15 * 60000); await t.service.tick(); assert.equal(t.calls.length, 3, 'three attempts at most');
    t.setGemini('ok');
    t.setClock(EVENING + 86400000); assert.equal((await t.service.tick()).id, '2026-10-17-evening');
    t.setClock(EVENING + (KEEP_DAYS + 2) * 86400000); assert.equal((await t.service.tick()).id, '2026-10-25-evening');
    const files = (await readdir(path.join(t.dataDir, 'podcast'))).filter(f => f.endsWith('.mp3'));
    assert.deepEqual(files, ['2026-10-25-evening.mp3'], 'the bulletin from more than a week ago is gone, file and all');
    assert.deepEqual(t.service.state().items.map(i => i.id), ['2026-10-25-evening']);
  } finally { await t.done(); }
});

test('the server: nothing while off, and only published files are served', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-podcast-server-'));
  const server = createServer({dataDir, podcast: podcastConfig({})});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.deepEqual(await (await fetch(base + '/api/podcast')).json(), {enabled: false});
    assert.equal((await fetch(base + '/podcast/2026-10-16-evening.mp3')).status, 404);
    assert.equal((await fetch(base + '/podcast/../index.html')).status, 200, 'paths outside /podcast/ are the app as before');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, {recursive: true, force: true}); }
});

// ---- WhatsApp: opt-in only ----

test('WhatsApp: CODKA or AUDIO opts in, JOOJI CODKA or STOP AUDIO opts out; only opted-in numbers get the evening bulletin', async () => {
  assert.deepEqual(parseCommand('codka'), {action: 'audio-on', lang: 'so'});
  assert.deepEqual(parseCommand('AUDIO'), {action: 'audio-on', lang: 'en'});
  assert.deepEqual(parseCommand('Jooji codka'), {action: 'audio-off', lang: 'so'});
  assert.deepEqual(parseCommand('stop audio'), {action: 'audio-off', lang: 'en'});
  assert.deepEqual(parseCommand('jooji Burco'), {action: 'stop', lang: 'so', city: 'Burco'}, 'JOOJI with a city still drops the city');
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-podcast-wa-'));
  const sent = [];
  const fetchImpl = async (url, options) => { sent.push(JSON.parse(options.body)); return {ok: true, status: 200, json: async () => ({})}; };
  const env = {WHATSAPP_TOKEN: 'token-not-real', WHATSAPP_PHONE_NUMBER_ID: '1234567890', WHATSAPP_APP_SECRET: 'secret-not-real', WHATSAPP_VERIFY_TOKEN: 'verify-not-real', WHATSAPP_NUMBER: '252610000000'};
  const wa = createWhatsApp({dataDir, cities, config: whatsappConfig(env), alerts: async () => null, fetchImpl, log: quiet});
  const A = '252610000001', B = '252610000002', C = '252610000003';
  try {
    await wa.onMessage(A, 'CODKA');
    assert.deepEqual({cities: wa.subscribers()[A].cities, bulletin: wa.subscribers()[A].bulletin, lang: wa.subscribers()[A].lang}, {cities: [], bulletin: true, lang: 'so'}, 'no city needed');
    assert.match(sent.at(-1).text.body, /fiid kasta/); assert.match(sent.at(-1).text.body, /JOOJI CODKA/);
    await wa.onMessage(B, 'JOIN Galkayo'); await wa.onMessage(B, 'AUDIO'); await wa.onMessage(B, 'STOP Galkayo');
    assert.equal(wa.subscribers()[B].bulletin, true, 'dropping the last city keeps someone who takes the bulletin');
    await wa.onMessage(C, 'JOIN Mogadishu');
    sent.length = 0;
    assert.deepEqual(await wa.sendBulletin({id: '2026-10-16-midday', slot: 'midday', title: 'Warbixinta duhurka'}), {sent: 0}, 'evening only by default');
    assert.deepEqual(await wa.sendBulletin({id: '2026-10-16-evening', slot: 'evening', title: 'Warbixinta fiidka, Jimce, 16 Oktoobar'}), {sent: 2});
    assert.deepEqual(sent.map(m => m.to).sort(), [A, B], 'not to the subscriber who did not opt in');
    assert.equal(sent[0].template.name, 'flood_bulletin');
    assert.deepEqual(sent[0].template.components[0].parameters.map(p => p.text), ['Warbixinta fiidka, Jimce, 16 Oktoobar', 'https://elninowatch.so/?lang=so#podcast']);
    await wa.onMessage(B, 'STOP AUDIO');
    assert.equal(wa.subscribers()[B], undefined, 'no cities and no bulletin: the number is deleted');
    assert.match(sent.at(-1).text.body, /no longer get the audio bulletin.*deleted/);
  } finally { await rm(dataDir, {recursive: true, force: true}); }
});

// ---- The page ----

async function runPanel(answer, lang = 'en') {
  const node = () => ({hidden: true, textContent: '', innerHTML: '', attrs: {}, dataset: {}, paused: true, listeners: {},
    getAttribute(n) { return this.attrs[n] ?? null; }, setAttribute(n, v) { this.attrs[n] = v; }, addEventListener(type, fn) { this.listeners[type] = fn; }});
  const nodes = Object.fromEntries(['podcast', 'podcast-audio', 'podcast-player', 'podcast-read', 'podcast-when', 'podcast-text', 'podcast-times', 'podcast-save', 'podcast-earlier', 'podcast-list', 'podcast-switch'].map(id => [id, node()]));
  const dispatched = [];
  const window = {document: {getElementById: id => nodes[id] || null, addEventListener() {}}, fetch: async () => ({json: async () => answer}), SiteLanguage: {getLanguage: () => lang},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } }, dispatchEvent: event => dispatched.push({type: event.type, detail: {...event.detail}})};
  vm.runInContext(await readFile(new URL('podcast.js', dist), 'utf8'), vm.createContext({window}));
  await window.ElNinoPodcast.load();
  return {nodes, api: window.ElNinoPodcast, dispatched};
}

test('the bulletin is first on the home page, under the header, and only there', async () => {
  const index = await readFile(new URL('index.html', dist), 'utf8');
  assert.ok(index.includes('<main><div class="podcast" id="podcast" role="region" aria-labelledby="podcast-title" data-site-tab="overview" hidden>'), 'the first block of the page, on the home tab');
  assert.equal(index.split('id="podcast"').length - 1, 1, 'not also on the Alerts tab');
  assert.ok(index.indexOf('<script src="podcast.js"></script>') > 0 && index.indexOf('<script src="podcast.js"></script>') < index.indexOf('<script src="alerts.js"></script>'));
  const shell = await readFile(new URL('shell.css', dist), 'utf8');
  assert.match(shell, /main>#podcast\{order:-1\}/, 'first in the one-column home page');
  assert.match(shell, /main:has\(>#podcast:not\(\[hidden\]\)\)\{grid-template-areas:"nav pod pod" "nav films films" "nav disc disc"/, 'first row of the desktop home page');
  const catalog = JSON.parse(await readFile(new URL('./i18n-public.json', import.meta.url), 'utf8'));
  for (const text of ['Audio bulletin in Somali', 'Not an official warning', 'Read the bulletin']) assert.ok(catalog.messages[text], text);
});

test('the panel shows when the first bulletin is due, then the latest bulletin with when it was recorded and when the next is', async () => {
  const off = await runPanel({enabled: false});
  assert.equal(off.nodes.podcast.hidden, true, 'the service is off: nothing shown');
  const first = await runPanel({enabled: true, hold: false, slots: ['06:30', '12:30', '18:30'], items: []});
  assert.equal(first.nodes.podcast.hidden, false, 'on but nothing recorded yet: shown');
  assert.equal(first.nodes['podcast-player'].hidden, true, 'no empty player'); assert.equal(first.nodes['podcast-read'].hidden, true);
  assert.match(first.nodes['podcast-times'].textContent, /^The first bulletin is (tomorrow )?at (06|12|18):30 East Africa Time\.$/);
  const item = {title: 'Warbixinta subaxa, Sabti, 17 Oktoobar', text: 'Waa El Nino Watch.', seconds: 92, url: '/podcast/2026-10-17-morning.mp3', publishedAt: '2026-10-17T03:31:20Z'};
  const shown = await runPanel({enabled: true, hold: false, slots: ['06:30', '12:30', '18:30'], items: [item]});
  assert.equal(shown.nodes['podcast-player'].hidden, false); assert.equal(shown.nodes['podcast-audio'].attrs.src, '/podcast/2026-10-17-morning.mp3');
  assert.equal(shown.nodes['podcast-when'].textContent, 'Warbixinta subaxa, Sabti, 17 Oktoobar · 1:32');
  assert.equal(shown.nodes['podcast-text'].textContent, 'Waa El Nino Watch.');
  // The times line, at fixed moments (East Africa Time is UTC+3).
  const {describeTimes, nextSlot} = shown.api, data = {enabled: true, hold: false, slots: ['06:30', '12:30', '18:30'], items: [item]};
  const at = utc => Date.parse(`2026-10-17T${utc}:00Z`);
  assert.equal(describeTimes(data, at('03:40'), 'en'), 'Recorded at 06:31 EAT · next bulletin at 12:30');
  assert.equal(describeTimes(data, at('03:40'), 'so'), 'Waxaa la duubay 06:31 (saacadda Bariga Afrika) · warbixinta xigta waa 12:30');
  assert.equal(describeTimes(data, at('16:00'), 'en'), 'Recorded at 06:31 EAT · next bulletin tomorrow at 06:30', 'after 18:30 EAT');
  assert.equal(describeTimes({...data, items: []}, at('16:00'), 'so'), 'Warbixinta ugu horreysa waa berri 06:30 saacadda Bariga Afrika.', 'after the last slot of the day: tomorrow');
  assert.equal(describeTimes({...data, items: []}, Date.parse('2026-10-16T21:43:00Z'), 'en'), 'The first bulletin is at 06:30 East Africa Time.', 'what the owner saw at 00:43 EAT: later the same day');
  assert.equal(describeTimes({...data, items: []}, Date.parse('2026-10-16T21:43:00Z'), 'so'), 'Warbixinta ugu horreysa waa 06:30 saacadda Bariga Afrika.');
  assert.equal(describeTimes(data, at('09:00') + 86400000, 'en'), 'Recorded at 06:31 EAT, 2026-10-17 · next bulletin at 12:30', 'an older recording says which day');
  assert.equal(describeTimes({...data, hold: true}, at('03:40'), 'en'), 'Recorded at 06:31 EAT · New bulletins are paused.');
  assert.deepEqual({...nextSlot(at('09:29'))}, {at: '12:30', tomorrow: false}); assert.deepEqual({...nextSlot(at('09:30'))}, {at: '18:30', tomorrow: false});
});

test('the footer links to the audio bulletin, in Somali too', async () => {
  const index = await readFile(new URL('index.html', dist), 'utf8');
  const footer = index.slice(index.indexOf('<footer class="site-footer'), index.indexOf('</footer>'));
  assert.ok(footer.includes('<a href="#podcast-so">Audio bulletin, Somali</a><a href="#podcast-en">Audio bulletin, English</a><a href="#field-videos">Flood videos: Cabudwaaq and Jowhar</a><a href="#health-films">Health films</a><a href="#diseases-panel">Diseases</a>'), 'beside the other in-page links, one per language');
  const catalog = JSON.parse(await readFile(new URL('./i18n-public.json', import.meta.url), 'utf8'));
  assert.equal(catalog.messages['Audio bulletin, Somali'], 'Warbixinta codka, Af-Soomaali');
});

// ---- The enhancements of 2026-10-17: earlier bulletins, play counts, the news flash, the podcast feed ----

const bulletin = (id, slot, title, publishedAt) => ({id, slot, title, text: `Waa El Nino Watch. ${title}.`, seconds: 95, url: `/podcast/${id}.mp3`, publishedAt});
const THREE = [bulletin('2026-10-17-midday', 'midday', 'Warbixinta duhurka, Sabti, 17 Oktoobar', '2026-10-17T09:31:00Z'),
  bulletin('2026-10-17-morning', 'morning', 'Warbixinta subaxa, Sabti, 17 Oktoobar', '2026-10-17T03:31:00Z'),
  bulletin('2026-10-16-evening', 'evening', 'Warbixinta fiidka, Jimce, 16 Oktoobar', '2026-10-16T15:31:00Z')];

test('earlier bulletins are listed to play or save for offline listening, and the first play of each is counted once', async () => {
  const {nodes, dispatched} = await runPanel({enabled: true, hold: false, slots: ['06:30', '12:30', '18:30'], items: THREE});
  assert.equal(nodes['podcast-audio'].attrs.src, '/podcast/2026-10-17-midday.mp3', 'the latest plays first');
  assert.equal(nodes['podcast-save'].hidden, false); assert.equal(nodes['podcast-save'].attrs.href, '/podcast/2026-10-17-midday.mp3');
  assert.equal(nodes['podcast-save'].attrs.download, 'el-nino-watch-2026-10-17-midday.mp3'); assert.equal(nodes['podcast-save'].textContent, 'Save MP3');
  assert.equal(nodes['podcast-earlier'].hidden, false);
  const list = nodes['podcast-list'].innerHTML;
  assert.equal((list.match(/<li>/g) || []).length, 2, 'the two before it');
  assert.ok(list.includes('data-podcast-id="2026-10-17-morning" lang="so">Warbixinta subaxa, Sabti, 17 Oktoobar · 1:35</button>'));
  assert.ok(list.includes('<a href="/podcast/2026-10-16-evening.mp3" download="el-nino-watch-2026-10-16-evening.mp3">Save MP3</a>'));
  assert.ok(!list.includes('2026-10-17-midday'), 'not the one already in the player');
  const play = nodes['podcast-audio'].listeners.play;
  play({target: nodes['podcast-audio']}); play({target: nodes['podcast-audio']});
  assert.deepEqual(dispatched, [{type: 'podcast-play', detail: {slot: 'midday'}}], 'once per bulletin per page');
  const somali = await runPanel({enabled: true, hold: false, slots: ['06:30', '12:30', '18:30'], items: THREE}, 'so');
  assert.equal(somali.nodes['podcast-save'].textContent, 'Kaydi MP3'); assert.ok(somali.nodes['podcast-list'].innerHTML.includes('>Kaydi MP3</a>'));
  const one = await runPanel({enabled: true, hold: false, slots: ['06:30', '12:30', '18:30'], items: THREE.slice(0, 1)});
  assert.equal(one.nodes['podcast-earlier'].hidden, true, 'nothing earlier yet: no list');
  const index = await readFile(new URL('index.html', dist), 'utf8');
  assert.ok(index.includes('<details class="podcast-earlier" id="podcast-earlier" hidden><summary>Earlier bulletins</summary><ul id="podcast-list" data-i18n-skip></ul></details>'));
  const catalog = JSON.parse(await readFile(new URL('./i18n-public.json', import.meta.url), 'utf8'));
  assert.equal(catalog.messages['Earlier bulletins'], 'Warbixinihii hore');
});

test('plays are counted anonymously by the visit counter, by slot, and shown on the stats page', async () => {
  const {createVisits} = await import('./somalia-flood-watch/visits.mjs');
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-plays-'));
  const post = (visits, body) => new Promise(resolve => {
    const req = Readable.from([JSON.stringify(body)]);
    Object.assign(req, {method: 'POST', headers: {host: 'elninowatch.so', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/129'}, socket: {remoteAddress: '10.0.0.9'}});
    visits.handle(req, {writeHead(status) { this.status = status; }, end(data) { resolve({status: this.status, body: data ? JSON.parse(data.toString()) : null}); }}, new URL('https://elninowatch.so/api/visit'));
  });
  try {
    const visits = createVisits({dataDir, cities, log: quiet, publishAfter: 1, now: () => Date.parse('2026-10-17T04:00:00Z')});
    await post(visits, {type: 'view', tab: 'overview', city: 'Mogadishu', lang: 'so'});
    for (const slot of ['morning', 'morning', 'evening', 'nonsense']) assert.equal((await post(visits, {type: 'play', slot, tab: 'overview', city: 'Mogadishu', lang: 'so'})).status, 202);
    const summary = visits.summary(7);
    assert.equal(summary.totals.views, 1, 'a play is not a visit');
    assert.equal(summary.totals.plays, 4);
    assert.deepEqual(summary.totals.bulletins, {morning: 2, evening: 1}, 'an unknown slot is counted but not named');
    assert.deepEqual(summary.days, [{date: '2026-10-17', views: 1, plays: 4}]);
  } finally { await rm(dataDir, {recursive: true, force: true}); }
  // visits.js sends one "play" for the page's podcast-play event.
  const sent = [], listeners = {};
  const window = {location: {protocol: 'https:'}, navigator: {}, setTimeout() {}, addEventListener: (type, fn) => { listeners[type] = fn; },
    fetch: (url, options) => { sent.push(JSON.parse(options.body)); return Promise.resolve({ok: false}); }};
  const document = {getElementById: () => null, body: {classList: {contains: () => false}}, documentElement: {lang: 'so'}};
  vm.runInContext(await readFile(new URL('visits.js', dist), 'utf8'), vm.createContext({window, document, fetch: window.fetch, setTimeout: window.setTimeout}));
  listeners['podcast-play']({detail: {slot: 'evening'}});
  listeners['podcast-play']({detail: {slot: 'bogus'}});
  assert.deepEqual(sent.map(body => [body.type, body.slot]), [['play', 'evening']]);
  const stats = await readFile(new URL('stats.html', dist), 'utf8');
  assert.ok(stats.includes('Audio bulletin plays, this period') && stats.includes("bars('Audio bulletins played'"));
  const sources = await readFile(new URL('sources.html', dist), 'utf8');
  assert.ok(sources.includes('and so is each play of the audio bulletin'), 'the privacy notice says so');
});

test('the news flash carries the audio bulletin while bulletins are on, in Somali too', async () => {
  const {loadNews, PODCAST_FLASH, HEALTH_FLASH} = await import('./somalia-flood-watch/news-feed.mjs');
  assert.deepEqual({...PODCAST_FLASH}, {kind: 'app', key: 'podcast', label: 'Audio bulletin', title: 'Listen: El Niño and flood news, three times a day', url: '#podcast', publishedAt: null, source: 'El Nino Watch', group: 'app', language: 'en'});
  const down = async () => ({ok: false, status: 503, text: async () => ''});
  const enso = {available: true, alertStatus: 'El Niño Advisory', phase: 'El Niño Advisory', issuedAt: '2026-10-08', synopsis: 'El Niño continues.', sourceUrl: 'https://www.cpc.ncep.noaa.gov/'};
  const on = await loadNews({app: {enso, podcast: true}, fetchImpl: down, reliefWebAppname: ''});
  const keys = on.items.filter(item => item.kind === 'app').map(item => item.key);
  assert.ok(keys.includes('podcast'), 'shown while on');
  assert.ok(keys.indexOf('podcast') < keys.indexOf(HEALTH_FLASH.key), 'before the health items');
  const off = await loadNews({app: {enso, podcast: false}, fetchImpl: down, reliefWebAppname: ''});
  assert.ok(!off.items.some(item => item.key === 'podcast'), 'not while off');
  const flash = await readFile(new URL('news-flash.js', dist), 'utf8');
  assert.match(flash, /\['icpac', 'health', 'film', 'podcast'\]\.includes\(item\.key\)/, 'its label and title are translated');
  const catalog = JSON.parse(await readFile(new URL('./i18n-public.json', import.meta.url), 'utf8'));
  assert.equal(catalog.messages[PODCAST_FLASH.label], 'Warbixinta codka');
  assert.ok(catalog.messages[PODCAST_FLASH.title]);
});

test('the podcast feed lists the week\'s bulletins for podcast apps, with cover art; nothing while off', async () => {
  const {buildFeed, FEED} = await import('./somalia-flood-watch/podcast.mjs');
  const xml = buildFeed(THREE.map(item => ({...item, file: `${item.id}.mp3`})), [500000, 480000, 510000]);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"'));
  assert.ok(xml.includes('<language>so</language>') && xml.includes('<title>El Nino Watch: Warbixinta codka</title>'));
  assert.ok(xml.includes(`<itunes:image href="${FEED.cover}"/>`) && FEED.cover === 'https://elninowatch.so/podcast-cover.jpg');
  assert.ok(xml.includes('<itunes:category text="News"><itunes:category text="Daily News"/></itunes:category>'));
  assert.equal((xml.match(/<item>/g) || []).length, 3);
  assert.ok(xml.includes('<enclosure url="https://elninowatch.so/podcast/2026-10-17-midday.mp3" length="500000" type="audio/mpeg"/>'));
  assert.ok(xml.includes('<guid isPermaLink="false">elninowatch-2026-10-17-midday</guid><pubDate>Sat, 17 Oct 2026 09:31:00 GMT</pubDate><itunes:duration>95</itunes:duration>'));
  assert.ok(xml.indexOf('2026-10-17-midday') < xml.indexOf('2026-10-16-evening'), 'newest first');
  assert.ok(buildFeed([{...THREE[0], file: 'x.mp3', title: 'A & B <c>'}], [1]).includes('<title>A &amp; B &lt;c&gt;</title>'), 'escaped');
  assert.ok(xml.includes('Ma aha digniin rasmi ah') && xml.includes('Not an official warning'));
  // Served by the bulletin service, with a real file's size.
  const t = await setup();
  try {
    await t.service.tick();
    const served = await call(t.service, 'GET', '/podcast.xml');
    assert.equal(served.handled, true); assert.equal(served.status, 200);
    const size = (await stat(path.join(t.dataDir, 'podcast', '2026-10-16-evening.mp3'))).size;
    assert.ok(served.body.includes(`<enclosure url="https://elninowatch.so/podcast/2026-10-16-evening.mp3" length="${size}" type="audio/mpeg"/>`));
  } finally { await t.done(); }
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-feed-off-'));
  try {
    const off = createPodcast({dataDir, cities, config: {enabled: false}, log: quiet});
    assert.equal((await call(off, 'GET', '/podcast.xml')).status, 404, 'off and nothing made: no feed');
  } finally { await rm(dataDir, {recursive: true, force: true}); }
  const index = await readFile(new URL('index.html', dist), 'utf8');
  assert.ok(index.includes('<link rel="alternate" type="application/rss+xml" title="El Nino Watch audio bulletin (Somali)" href="/podcast.xml"><link rel="alternate" type="application/rss+xml" title="El Nino Watch audio bulletin (English)" href="/podcast-en.xml"></head>'));
  const cover = await readFile(new URL('podcast-cover.jpg', dist));
  assert.equal(cover.readUInt16BE(0), 0xFFD8, 'a JPEG');
  // Its size, from the first start-of-frame marker: square, at least the 1400 px Apple asks for.
  let i = 2, w = 0, h = 0;
  while (i < cover.length) { const marker = cover.readUInt16BE(i), len = cover.readUInt16BE(i + 2); if (marker >= 0xFFC0 && marker <= 0xFFC3) { h = cover.readUInt16BE(i + 5); w = cover.readUInt16BE(i + 7); break; } i += 2 + len; }
  assert.deepEqual([w, h], [1400, 1400]);
});

// ---- Somali and English (owner, 2026-10-17) ----

test('the English bulletin: the same sections and rules, in English, with English-language news only', async () => {
  const {text, title} = buildScript({slotId: 'evening', now: EVENING, ...DATA, lang: 'en'});
  assert.equal(title, 'Evening bulletin, Friday 16 October');
  assert.ok(text.startsWith('This is El Nino Watch, with the evening bulletin for Friday 16 October. This is not an official warning service.'));
  assert.ok(text.includes('Official flood warnings from the Ministry of Energy and Water Resources. Flood warning: Galgaduud; anticipatory action has been activated. Flood watch: Bakool. Flood advisory: Bay.'));
  assert.ok(text.includes('The Shabelle at Jowhar is at 5.17 metres, above its moderate flood level, and close to its high level of 5.25 metres.'));
  assert.ok(text.includes('Rain tomorrow: the most rain is expected in Galkayo, 23 millimetres and Adado, 16 millimetres. This is a model forecast.'));
  assert.ok(text.includes("ICPAC's forecast for this week shows heavy rain in 2 of the 30 cities, including Beledweyne and Baidoa. That is a model forecast, not an official warning."));
  assert.ok(text.includes('News: NOAA said on 8 October that El Niño is under way. FTL Somalia reports: Flash floods in Hudur affect 37 households.'), 'English items only');
  assert.doesNotMatch(text, /SoDMA ayaa|WAR-BIXINTA/, 'the Somali item is not read in English');
  assert.ok(text.endsWith('Follow the instructions of local authorities and SoDMA. More at elninowatch.so. This is El Nino Watch.'));
  const rest = text.replace('This is not an official warning service', '').replace('Official flood warnings from the Ministry', '').replace('not an official warning', '');
  assert.doesNotMatch(rest, /official/i, 'only MOEWR is called official');
  assert.doesNotMatch(text, /\b(iyo|waa|ayaa|roobka|webiga)\b/, 'no Somali');
  const down = buildScript({slotId: 'morning', now: MORNING, alerts: null, stations: null, enso: null, news: null, rain: null, lang: 'en'}).text;
  assert.ok(down.includes('Official warnings from the Ministry of Energy and Water Resources are not available right now.'));
  assert.ok(down.includes('River levels on the Juba and Shabelle are not available right now.'));
  assert.ok(down.includes('The rain forecast for today is not available right now.'));
  const morning = buildScript({slotId: 'morning', now: MORNING, ...DATA, lang: 'en'});
  assert.ok(buildScript({slotId: 'midday', now: MIDDAY, ...DATA, lang: 'en', previous: morning.facts}).text.includes('Official warnings and river levels have not changed since this morning.'));
});

test('English bulletins wait for the owner to approve their wording; Somali runs on its own approval', () => {
  const config = podcastConfig({GEMINI_API_KEY: 'key-not-real', PODCAST_ENABLED: '1'});
  assert.deepEqual(config.languages, APPROVED_TEMPLATE_EN === TEMPLATE_VERSION_EN ? ['so', 'en'] : ['so']);
  assert.equal(TEMPLATE_VERSION_EN, '2026-10-17');
});

test('with both languages on, each slot is voiced in Somali and English from one reading of the data, each with its own feed', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-podcast-both-'));
  const calls = [], handed = [];
  let rainFetches = 0;
  const pcm = Buffer.alloc(48000);
  const fetchImpl = async (url, options = {}) => {
    if (String(url).startsWith('https://api.open-meteo.com/')) { rainFetches++; return {ok: true, status: 200, json: async () => cities.map(() => ({daily: {time: ['2026-10-16', '2026-10-17'], precipitation_sum: [1, 2]}}))}; }
    calls.push(JSON.parse(options.body));
    return {ok: true, status: 200, json: async () => ({steps: [{type: 'model_output', content: [{type: 'audio', data: pcm.toString('base64')}]}]})};
  };
  const config = {enabled: true, apiKey: 'key-not-real', model: 'gemini-3.8-flash-tts', voice: 'Puck', languages: ['so', 'en']};
  const service = createPodcast({dataDir, cities, config, fetchImpl, now: () => EVENING, log: quiet, encode: (wav, mp3) => copyFile(wav, mp3),
    feeds: {alerts: async () => ALERTS, stations: async () => STATIONS, enso: async () => ENSO, news: async () => NEWS}, onPublished: (item, info) => handed.push([item.id, info.languages.join('+')])});
  try {
    await service.tick();
    assert.deepEqual(service.state().items.map(item => `${item.id}:${item.lang}`).sort(), ['2026-10-16-evening-en:en', '2026-10-16-evening:so']);
    assert.equal(rainFetches, 1, 'the data is read once for both');
    assert.ok(calls[0].input[0].content[0].text.startsWith('Waa El Nino Watch') && calls[1].input[0].content[0].text.startsWith('This is El Nino Watch'), 'Somali first, then English, same voice');
    assert.deepEqual(calls.map(call => call.generation_config.speech_config[0].voice), ['Puck', 'Puck']);
    assert.deepEqual(handed, [['2026-10-16-evening', 'so+en'], ['2026-10-16-evening-en', 'so+en']]);
    await service.tick(); assert.equal(calls.length, 2, 'never twice');
    const listed = (await call(service, 'GET', '/api/podcast')).json();
    assert.deepEqual(listed.languages, ['so', 'en']); assert.deepEqual(listed.items.map(item => item.lang).sort(), ['en', 'so']);
    const so = (await call(service, 'GET', '/podcast.xml')).body, en = (await call(service, 'GET', '/podcast-en.xml')).body;
    assert.ok(so.includes('<language>so</language>') && so.includes('2026-10-16-evening.mp3') && !so.includes('-en.mp3'));
    assert.ok(en.includes('<language>en</language>') && en.includes('2026-10-16-evening-en.mp3') && en.includes('<title>El Nino Watch: Audio bulletin</title>') && en.includes('podcast-cover-en.jpg'));
    assert.ok(service.audioFile('/podcast/2026-10-16-evening-en.mp3'));
  } finally { await rm(dataDir, {recursive: true, force: true}); }
  const off = await mkdtemp(path.join(os.tmpdir(), 'elnino-podcast-en-off-'));
  try {
    const somaliOnly = createPodcast({dataDir: off, cities, config: {enabled: true, languages: ['so']}, log: quiet});
    assert.equal((await call(somaliOnly, 'GET', '/podcast-en.xml')).status, 404, 'no English feed until English is on');
  } finally { await rm(off, {recursive: true, force: true}); }
});

test('the midday bulletin compares with the morning in BOTH languages: the English does not compare the midday with the Somali midday just made', async () => {
  // 17 October 2026: Jowhar fell from 5.17 to 4.90 m by midday. The Somali read it; the English, made seconds
  // later, compared against the Somali midday's facts and said "not changed since this morning".
  const pcm = Buffer.alloc(48000);
  const fetchImpl = async url => String(url).startsWith('https://api.open-meteo.com/')
    ? {ok: true, status: 200, json: async () => cities.map(() => ({daily: {time: ['2026-10-16', '2026-10-17'], precipitation_sum: [1, 2]}}))}
    : {ok: true, status: 200, json: async () => ({steps: [{type: 'model_output', content: [{type: 'audio', data: pcm.toString('base64')}]}]})};
  const config = {enabled: true, apiKey: 'key-not-real', model: 'gemini-3.8-flash-tts', voice: 'Puck', languages: ['so', 'en']};
  const fell = {...STATIONS, stations: STATIONS.stations.map(s => s.name === 'Jowhar' ? {...s, levelM: 4.9} : s)};
  for (const [label, middayStations, changed] of [['a river changed', fell, true], ['nothing changed', STATIONS, false]]) {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-podcast-midday-'));
    let clock = MORNING, stations = STATIONS;
    const service = createPodcast({dataDir, cities, config, fetchImpl, now: () => clock, log: quiet, encode: (wav, mp3) => copyFile(wav, mp3),
      feeds: {alerts: async () => ALERTS, stations: async () => stations, enso: async () => ENSO, news: async () => NEWS}});
    try {
      await service.tick();
      clock = MIDDAY; stations = middayStations;
      await service.tick();
      const text = id => service.state().items.find(item => item.id === id).text;
      const so = text('2026-10-16-midday'), en = text('2026-10-16-midday-en');
      assert.equal(so.includes('isma beddelin tan iyo subaxdii'), !changed, `${label}: Somali`);
      assert.equal(en.includes('have not changed since this morning'), !changed, `${label}: English says the same as the Somali`);
      if (changed) assert.ok(so.includes('4.90 mitir') && en.includes('4.90 metres'), 'both read the new level');
    } finally { await rm(dataDir, {recursive: true, force: true}); }
  }
});

test('WhatsApp: the bulletin in the language each subscriber signed up in, Somali for everyone until English is on', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-podcast-wa-lang-'));
  const sent = [];
  const fetchImpl = async (url, options) => { sent.push(JSON.parse(options.body)); return {ok: true, status: 200, json: async () => ({})}; };
  const env = {WHATSAPP_TOKEN: 'token-not-real', WHATSAPP_PHONE_NUMBER_ID: '1234567890', WHATSAPP_APP_SECRET: 'secret-not-real', WHATSAPP_VERIFY_TOKEN: 'verify-not-real', WHATSAPP_NUMBER: '252610000000'};
  const wa = createWhatsApp({dataDir, cities, config: whatsappConfig(env), alerts: async () => null, fetchImpl, log: quiet});
  const SO = '252610000011', EN = '252610000012';
  try {
    await wa.onMessage(SO, 'CODKA'); await wa.onMessage(EN, 'AUDIO');
    const somali = {id: '2026-10-16-evening', lang: 'so', slot: 'evening', title: 'Warbixinta fiidka, Jimce, 16 Oktoobar'};
    const english = {id: '2026-10-16-evening-en', lang: 'en', slot: 'evening', title: 'Evening bulletin, Friday 16 October'};
    sent.length = 0;
    await wa.sendBulletin(somali, {languages: ['so']});
    assert.deepEqual(sent.map(m => m.to).sort(), [SO, EN].sort(), 'English not on yet: everyone hears Somali');
    sent.length = 0;
    await wa.sendBulletin(somali, {languages: ['so', 'en']}); await wa.sendBulletin(english, {languages: ['so', 'en']});
    assert.deepEqual(sent.map(m => [m.to, m.template.components[0].parameters[1].text]), [[SO, 'https://elninowatch.so/?lang=so#podcast'], [EN, 'https://elninowatch.so/?lang=en#podcast']]);
  } finally { await rm(dataDir, {recursive: true, force: true}); }
});

test('the page plays the bulletin in its own language, and says so when the English page has only Somali', async () => {
  const en = bulletin('2026-10-17-midday-en', 'midday', 'Midday bulletin, Saturday 17 October', '2026-10-17T09:31:30Z');
  const both = await runPanel({enabled: true, hold: false, slots: ['06:30', '12:30', '18:30'], items: [{...en, lang: 'en'}, {...THREE[0], lang: 'so'}]}, 'en');
  assert.equal(both.nodes['podcast-audio'].attrs.src, '/podcast/2026-10-17-midday-en.mp3');
  assert.equal(both.nodes['podcast-when'].attrs.lang, 'en');
  const somaliPage = await runPanel({enabled: true, hold: false, slots: ['06:30', '12:30', '18:30'], items: [{...en, lang: 'en'}, {...THREE[0], lang: 'so'}]}, 'so');
  assert.equal(somaliPage.nodes['podcast-audio'].attrs.src, '/podcast/2026-10-17-midday.mp3');
  const onlySomali = await runPanel({enabled: true, hold: false, slots: ['06:30', '12:30', '18:30'], items: [{...THREE[0], lang: 'so'}]}, 'en');
  assert.equal(onlySomali.nodes['podcast-audio'].attrs.src, '/podcast/2026-10-17-midday.mp3');
  assert.match(onlySomali.nodes['podcast-times'].textContent, / · in Somali$/);
  const index = await readFile(new URL('index.html', dist), 'utf8');
  assert.ok(index.includes('<h2 id="podcast-title">Audio bulletin</h2>'));
  assert.ok(index.includes('href="/podcast.xml">') && index.includes('href="/podcast-en.xml">'));
});

test('the sources page has the audio bulletin, with the player and both feeds, in Somali too', async () => {
  const sources = await readFile(new URL('sources.html', dist), 'utf8');
  const start = sources.indexOf('<section aria-labelledby="audio-bulletin">'), section = sources.slice(start, sources.indexOf('</section>', start));
  assert.ok(start > 0 && start < sources.indexOf('<section aria-labelledby="health">'), 'before the public health guidance');
  for (const href of ['href="/#podcast" data-keep-language', 'href="https://elninowatch.so/podcast.xml"', 'href="https://elninowatch.so/podcast-en.xml"']) assert.ok(section.includes(href), href);
  for (const name of ['MOEWR', 'SWALIM', 'Open-Meteo', 'ICPAC', 'NOAA']) assert.ok(section.includes(name), name);
  assert.ok(section.includes('in Somali and English') && section.includes('It is not an official warning'));
  const catalog = JSON.parse(await readFile(new URL('./i18n-public.json', import.meta.url), 'utf8'));
  assert.equal(catalog.messages['Somali and English'], 'Af-Soomaali iyo Ingiriisi');
  const cover = await readFile(new URL('podcast-cover-en.jpg', dist));
  assert.equal(cover.readUInt16BE(0), 0xFFD8);
});

test('WhatsApp: the audio bulletin has its own button on the Alerts tab and in the bulletin panel, AUDIO or CODKA ready to send', async () => {
  const index = await readFile(new URL('index.html', dist), 'utf8');
  assert.ok(index.includes('<a id="alerts-whatsapp-audio" class="whatsapp-link" href="https://wa.me/" target="_blank" rel="noopener" hidden>Get the audio bulletin on WhatsApp</a>'), 'beside the alerts button');
  assert.ok(index.includes('<p class="podcast-times" id="podcast-times" data-i18n-skip></p><button type="button" id="podcast-switch" class="podcast-switch" hidden data-i18n-skip></button><a id="podcast-whatsapp" class="podcast-save podcast-whatsapp" href="https://wa.me/" target="_blank" rel="noopener" hidden>Get it on WhatsApp</a>'), 'in the bulletin panel');
  assert.match(index, /The audio bulletin button asks for the evening audio bulletin, in the language of this page\./);
  const catalog = JSON.parse(await readFile(new URL('./i18n-public.json', import.meta.url), 'utf8'));
  assert.equal(catalog.messages['Get the audio bulletin on WhatsApp'], 'Ku hel warbixinta codka WhatsApp');
  for (const [answer, lang, shown, text] of [[{enabled: false}, 'en', false, null], [{enabled: true, number: '252610000000'}, 'en', true, 'AUDIO'], [{enabled: true, number: '252610000000'}, 'so', true, 'CODKA']]) {
    const node = () => ({hidden: true, href: '', onclick: null});
    const nodes = {'alerts-whatsapp': node(), 'alerts-whatsapp-note': node(), 'alerts-whatsapp-audio': node(), 'podcast-whatsapp': node()};
    const window = {document: {getElementById: id => nodes[id] || null}, SiteLanguage: {getLanguage: () => lang}, fetch: async () => ({ok: true, json: async () => answer})};
    vm.runInContext(await readFile(new URL('whatsapp.js', dist), 'utf8'), vm.createContext({window, encodeURIComponent}));
    await new Promise(resolve => setTimeout(resolve, 10));
    for (const id of ['alerts-whatsapp-audio', 'podcast-whatsapp']) {
      assert.equal(nodes[id].hidden, !shown, `${id} shown: ${shown}`);
      if (text) assert.equal(nodes[id].href, `https://wa.me/252610000000?text=${text}`, `${lang}: ${text}`);
    }
    assert.equal(nodes['alerts-whatsapp'].hidden, true, 'the alerts button still waits for a city');
  }
});

test('WhatsApp LIST says whether the person takes the audio bulletin', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-podcast-wa-list-'));
  const sent = [];
  const fetchImpl = async (url, options) => { sent.push(JSON.parse(options.body)); return {ok: true, status: 200, json: async () => ({})}; };
  const env = {WHATSAPP_TOKEN: 'token-not-real', WHATSAPP_PHONE_NUMBER_ID: '1234567890', WHATSAPP_APP_SECRET: 'secret-not-real', WHATSAPP_VERIFY_TOKEN: 'verify-not-real', WHATSAPP_NUMBER: '252610000000'};
  const wa = createWhatsApp({dataDir, cities, config: whatsappConfig(env), alerts: async () => null, fetchImpl, log: quiet});
  try {
    await wa.onMessage('252610000021', 'AUDIO'); await wa.onMessage('252610000021', 'LIST');
    assert.equal(sent.at(-1).text.body, 'You do not follow any city. Send JOIN and a city name, for example JOIN Galkayo. You also get the audio bulletin; reply STOP AUDIO to stop it.');
    await wa.onMessage('252610000022', 'KU BIIR Galkayo'); await wa.onMessage('252610000022', 'LIISKA');
    assert.equal(sent.at(-1).text.body, 'Waxaad heleysaa digniinaha Galkayo. Ku jawaab JOOJI si aad u joojiso dhammaan digniinaha. Soo dir CODKA si aad u hesho warbixinta codka.');
  } finally { await rm(dataDir, {recursive: true, force: true}); }
});

test('readers can hear the bulletin in either language: a switch in the panel, and a footer link for each', async () => {
  const en = {...bulletin('2026-10-17-midday-en', 'midday', 'Midday bulletin, Saturday 17 October', '2026-10-17T09:31:30Z'), lang: 'en'};
  const so = {...THREE[0], lang: 'so'};
  const data = {enabled: true, hold: false, slots: ['06:30', '12:30', '18:30'], items: [en, so]};
  const page = await runPanel(data, 'en');
  const toggle = page.nodes['podcast-switch'];
  assert.equal(page.nodes['podcast-audio'].attrs.src, '/podcast/2026-10-17-midday-en.mp3', 'the page language first');
  assert.equal(toggle.hidden, false); assert.equal(toggle.textContent, 'Listen in Somali'); assert.equal(toggle.attrs['data-listen'], 'so');
  page.nodes.podcast.listeners.click({target: {closest: selector => selector === '#podcast-switch' ? toggle : null}});
  assert.equal(page.nodes['podcast-audio'].attrs.src, '/podcast/2026-10-17-midday.mp3', 'switched to the Somali bulletin');
  assert.equal(toggle.textContent, 'Listen in English', 'and offers English back');
  const somaliPage = await runPanel(data, 'so');
  assert.equal(somaliPage.nodes['podcast-switch'].textContent, 'Ku dhageyso Ingiriisi');
  const onlyOne = await runPanel({...data, items: [so]}, 'so');
  assert.equal(onlyOne.nodes['podcast-switch'].hidden, true, 'nothing to switch to');
  const index = await readFile(new URL('index.html', dist), 'utf8');
  const footer = index.slice(index.indexOf('<footer class="site-footer'), index.indexOf('</footer>'));
  assert.ok(footer.includes('<a href="#podcast-so">Audio bulletin, Somali</a><a href="#podcast-en">Audio bulletin, English</a><a href="#field-videos">Flood videos: Cabudwaaq and Jowhar</a><a href="#health-films">Health films</a><a href="#diseases-panel">Diseases</a>'));
  assert.ok(index.includes('<span class="podcast-anchor" id="podcast-so"></span><span class="podcast-anchor" id="podcast-en"></span>'), 'their targets, inside the panel');
  const catalog = JSON.parse(await readFile(new URL('./i18n-public.json', import.meta.url), 'utf8'));
  assert.equal(catalog.messages['Audio bulletin, Somali'], 'Warbixinta codka, Af-Soomaali');
  assert.equal(catalog.messages['Audio bulletin, English'], 'Warbixinta codka, Ingiriisi');
  const script = await readFile(new URL('podcast.js', dist), 'utf8');
  assert.match(script, /a\[href="#podcast-so"\], a\[href="#podcast-en"\]/, 'the footer links pick the language');
});
