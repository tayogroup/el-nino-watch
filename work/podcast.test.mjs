import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat, copyFile, readdir} from 'node:fs/promises';
import {Readable} from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createServer} from './somalia-flood-watch/server.mjs';
import {buildScript, dueSlot, podcastConfig, createPodcast, STYLE, TIPS, KEEP_DAYS, APPROVED_TEMPLATE, TEMPLATE_VERSION} from './somalia-flood-watch/podcast.mjs';
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

test('the Alerts tab has a hidden bulletin panel that shows the latest bulletin, in Somali, when there is one', async () => {
  const index = await readFile(new URL('index.html', dist), 'utf8');
  assert.ok(index.includes('<div class="podcast" id="podcast" role="region" aria-labelledby="podcast-title" hidden>'));
  const alerts = index.slice(index.indexOf('id="alerts-panel"'), index.indexOf('id="diseases-panel"'));
  assert.ok(alerts.includes('id="podcast"'), 'on the Alerts tab');
  assert.ok(index.indexOf('<script src="podcast.js"></script>') > 0 && index.indexOf('<script src="podcast.js"></script>') < index.indexOf('<script src="alerts.js"></script>'));
  assert.match(await readFile(new URL('shell.css', dist), 'utf8'), /#alerts-panel>:is\([^)]*\.podcast[^)]*\)\{display:none\}/, 'not on the overview');
  const catalog = JSON.parse(await readFile(new URL('./i18n-public.json', import.meta.url), 'utf8'));
  for (const text of ['AUDIO BULLETIN · IN SOMALI', 'Listen: the latest bulletin', 'Not an official warning', 'Read the bulletin']) assert.ok(catalog.messages[text], text);
  for (const answer of [{enabled: false}, {enabled: true, items: [{title: 'Warbixinta fiidka, Jimce, 16 Oktoobar', text: 'Waa El Nino Watch.', seconds: 125, url: '/podcast/2026-10-16-evening.mp3'}]}]) {
    const nodes = {podcast: {hidden: true}, 'podcast-audio': {paused: true, attrs: {}, getAttribute(n) { return this.attrs[n] ?? null; }, setAttribute(n, v) { this.attrs[n] = v; }}, 'podcast-when': {textContent: ''}, 'podcast-text': {textContent: ''}};
    const window = {document: {getElementById: id => nodes[id] || null}, fetch: async () => ({json: async () => answer})};
    vm.runInContext(await readFile(new URL('podcast.js', dist), 'utf8'), vm.createContext({window}));
    await window.ElNinoPodcast.load();
    if (answer.enabled) {
      assert.equal(nodes.podcast.hidden, false);
      assert.equal(nodes['podcast-audio'].attrs.src, '/podcast/2026-10-16-evening.mp3');
      assert.equal(nodes['podcast-when'].textContent, 'Warbixinta fiidka, Jimce, 16 Oktoobar · 2:05');
      assert.equal(nodes['podcast-text'].textContent, 'Waa El Nino Watch.');
    } else assert.equal(nodes.podcast.hidden, true, 'nothing to play: the panel stays hidden');
  }
});
