import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import {Readable} from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createServer} from './somalia-flood-watch/server.mjs';
import {createWhatsApp, whatsappConfig, parseCommand, findCity, alertEvents, templateParameters, MAX_PER_DAY, MAX_CITIES} from './somalia-flood-watch/whatsapp.mjs';

const dist = new URL('./somalia-flood-watch/dist/', import.meta.url);
const cities = JSON.parse(await readFile(new URL('cities.json', dist), 'utf8'));
const ENV = {WHATSAPP_TOKEN: 'token-not-real', WHATSAPP_PHONE_NUMBER_ID: '1234567890', WHATSAPP_APP_SECRET: 'secret-not-real', WHATSAPP_VERIFY_TOKEN: 'verify-not-real', WHATSAPP_NUMBER: '+252 61 000 0000'};
const config = whatsappConfig(ENV);
const ALICE = '252610000001', BOB = '252610000002';
const NOW = Date.parse('2026-10-16T09:00:00Z');
const quiet = {log() {}, error() {}};

const moewr = (region, cityNames, level, aaActive = false) => ({sourceId: 'moewr', status: 'active', level, aaActive, endsAt: '2026-10-20T23:59:59Z', scope: {cities: cityNames, region}});
const icpac = (city, category) => ({sourceId: 'icpac', status: 'active', category, endsAt: '2026-10-20T20:59:59Z', scope: {cities: [city]}});
const floodhub = (city, googleSeverity) => ({sourceId: 'floodhub', status: 'active', googleSeverity, endsAt: '2026-10-21T00:00:00Z', scope: {cities: [city], gauge: 'Webi Jubba river gauge'}});
const feedOf = (alerts, down = []) => ({available: true, alerts, sources: ['moewr', 'icpac', 'floodhub', 'gdacs'].map(id => ({id, available: !down.includes(id)}))});

async function setup({env = ENV, feed = feedOf([]), now = () => NOW} = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-whatsapp-'));
  const sent = [], logs = [];
  let answer = feed;
  const fetchImpl = async (url, options) => {
    sent.push({url: String(url), headers: options.headers, body: JSON.parse(options.body)});
    return {ok: true, status: 200, json: async () => ({messages: [{id: 'wamid.x'}]})};
  };
  const log = {log: text => logs.push(text), error: text => logs.push(text)};
  const wa = createWhatsApp({dataDir, cities, config: whatsappConfig(env), alerts: async () => answer, fetchImpl, now, log});
  return {wa, dataDir, sent, logs, setFeed: feed => { answer = feed; }, done: () => rm(dataDir, {recursive: true, force: true})};
}

function request(method, url, body = '', headers = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(req, {method, url, headers});
  return req;
}
async function call(wa, method, target, body = '', headers = {}) {
  const res = {status: 0, headers: {}, body: '', writeHead(status, head) { this.status = status; this.headers = head; }, end(data) { this.body = data ? data.toString() : ''; }};
  const url = new URL(target, 'http://127.0.0.1');
  const handled = await wa.handle(request(method, target, body, headers), res, url);
  return {handled, ...res, json: () => JSON.parse(res.body)};
}
const signed = (body, secret = ENV.WHATSAPP_APP_SECRET) => ({'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`});
let messageId = 0;
const inbound = (from, text, type = 'text') => JSON.stringify({object: 'whatsapp_business_account', entry: [{changes: [{value: {messages: [{from, id: `wamid.${++messageId}`, type, ...(type === 'text' ? {text: {body: text}} : {})}]}}]}]});
async function message(wa, from, text) {
  const body = inbound(from, text);
  return call(wa, 'POST', '/api/whatsapp/webhook', body, signed(body));
}

test('switched off until every setting is present; the page is told nothing while off', async () => {
  assert.equal(config.enabled, true); assert.equal(config.number, '252610000000');
  for (const key of Object.keys(ENV)) assert.equal(whatsappConfig({...ENV, [key]: ''}).enabled, false, key);
  assert.equal(whatsappConfig({...ENV, WHATSAPP_NUMBER: '12'}).enabled, false);
  const off = await setup({env: {}});
  try {
    assert.deepEqual((await call(off.wa, 'GET', '/api/whatsapp')).json(), {enabled: false});
    assert.equal((await call(off.wa, 'GET', '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1')).status, 404);
    assert.deepEqual(await off.wa.check(), {sent: 0, skipped: 0});
    assert.equal(off.sent.length, 0, 'nothing is sent while off');
    assert.equal((await call(off.wa, 'GET', '/api/other')).handled, false);
  } finally { await off.done(); }
  const on = await setup();
  try { assert.deepEqual((await call(on.wa, 'GET', '/api/whatsapp')).json(), {enabled: true, number: '252610000000'}); } finally { await on.done(); }
});

test('the webhook: Meta\'s verification, and only signed messages are read', async () => {
  const {wa, sent, done} = await setup();
  try {
    const ok = await call(wa, 'GET', '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-not-real&hub.challenge=4242');
    assert.equal(ok.status, 200); assert.equal(ok.body, '4242');
    assert.equal((await call(wa, 'GET', '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=4242')).status, 403);
    const body = inbound(ALICE, 'JOIN Galkayo');
    assert.equal((await call(wa, 'POST', '/api/whatsapp/webhook', body, {})).status, 401, 'no signature');
    assert.equal((await call(wa, 'POST', '/api/whatsapp/webhook', body, signed(body, 'another-secret'))).status, 401, 'wrong secret');
    assert.equal((await call(wa, 'POST', '/api/whatsapp/webhook', body + ' ', signed(body))).status, 401, 'altered body');
    assert.deepEqual(wa.subscribers(), {}); assert.equal(sent.length, 0);
    assert.equal((await call(wa, 'POST', '/api/whatsapp/webhook', body, signed(body))).status, 200);
    assert.deepEqual(wa.subscribers()[ALICE].cities, ['Galkayo']);
    assert.equal((await call(wa, 'POST', '/api/whatsapp/webhook', body, signed(body))).status, 200, 'Meta may deliver twice');
    assert.equal(sent.length, 1, 'a repeated delivery is acted on once');
  } finally { await done(); }
});

test('JOIN, KU BIIR, LIST and STOP; replies in the person\'s language; STOP deletes the number', async () => {
  const {wa, dataDir, sent, done} = await setup({feed: feedOf([moewr('Mudug', ['Galkayo', 'Galdogob'], 'watch')])});
  try {
    await message(wa, ALICE, 'join gaalkacyo');
    const reply = sent.at(-1);
    assert.equal(reply.url, 'https://graph.facebook.com/v23.0/1234567890/messages');
    assert.equal(reply.headers.Authorization, 'Bearer token-not-real');
    assert.equal(reply.body.to, ALICE); assert.equal(reply.body.type, 'text');
    assert.match(reply.body.text.body, /^You will get El Nino Watch alerts for Galkayo: .* Active now: Galkayo: national flood watch \(Ministry of Energy and Water Resources \(MOEWR\)\)\. Reply STOP/);
    await message(wa, ALICE, 'JOIN Mogadishu');
    assert.deepEqual(wa.subscribers()[ALICE].cities, ['Galkayo', 'Mogadishu']);
    assert.match(sent.at(-1).body.text.body, /No alert is active|Active now: Galkayo/);
    await message(wa, BOB, 'KU BIIR Muqdisho');
    assert.equal(wa.subscribers()[BOB].lang, 'so');
    assert.match(sent.at(-1).body.text.body, /^Waxaad heli doontaa digniinaha El Nino Watch ee Mogadishu: .*Hadda ma jirto digniin/);
    await message(wa, BOB, 'nonsense');
    assert.match(sent.at(-1).body.text.body, /^Digniinaha fatahaadda ee El Nino Watch\./, 'help comes in the language they joined in');
    await message(wa, ALICE, 'JOIN Atlantis');
    assert.match(sent.at(-1).body.text.body, /^We could not find "Atlantis"\. .*Cities: Mogadishu, Hargeisa/);
    await message(wa, ALICE, 'LIST');
    assert.equal(sent.at(-1).body.text.body, 'You get alerts for Galkayo, Mogadishu. Reply STOP to stop all alerts. Send AUDIO for the audio bulletin.');
    await message(wa, ALICE, 'STOP Mogadishu');
    assert.deepEqual(wa.subscribers()[ALICE].cities, ['Galkayo']);
    assert.match(sent.at(-1).body.text.body, /no longer get alerts for Mogadishu\. You still get alerts for Galkayo\./);
    await message(wa, ALICE, 'stop');
    assert.equal(wa.subscribers()[ALICE], undefined, 'STOP deletes the number');
    const saved = await readFile(path.join(dataDir, 'whatsapp.json'), 'utf8');
    assert.ok(!saved.includes(ALICE), 'and it is gone from the file');
    if (process.platform !== 'win32') assert.equal((await stat(path.join(dataDir, 'whatsapp.json'))).mode & 0o777, 0o600, 'the file is private');
    await message(wa, BOB, 'JOOJI Mogadishu');
    assert.equal(wa.subscribers()[BOB], undefined, 'dropping the last city deletes the number too');
    assert.match(sent.at(-1).body.text.body, /lambarkaagana waa la tirtiray/);
    for (const name of ['Mogadishu', 'Hargeisa', 'Bosaso', 'Kismayo', 'Baidoa']) await message(wa, ALICE, `JOIN ${name}`);
    await message(wa, ALICE, 'JOIN Garowe');
    assert.equal(wa.subscribers()[ALICE].cities.length, MAX_CITIES); assert.match(sent.at(-1).body.text.body, /up to 5 cities/);
    await call(wa, 'POST', '/api/whatsapp/webhook', inbound(BOB, '', 'image'), signed(inbound(BOB, '', 'image')));
  } finally { await done(); }
});

test('commands and city names as people type them', () => {
  assert.deepEqual(parseCommand('  Join   Galkayo '), {action: 'join', lang: 'en', city: 'Galkayo'});
  assert.deepEqual(parseCommand('ku biir Gaalkacyo'), {action: 'join', lang: 'so', city: 'Gaalkacyo'});
  assert.deepEqual(parseCommand('STOP'), {action: 'stop', lang: 'en', city: ''});
  assert.deepEqual(parseCommand('jooji Burco'), {action: 'stop', lang: 'so', city: 'Burco'});
  assert.equal(parseCommand('liiska').action, 'list');
  assert.equal(parseCommand('hello').action, 'help');
  for (const [typed, city] of [['gaalkacyo', 'Galkayo'], ['Muqdisho', 'Mogadishu'], ['Beled Weyne', 'Beledweyne'], ['Xuddur', 'Hudur'], ['laascaanood', 'Las Anod'], ['Buur Hakaba', 'Buur Hakaba'], ['Kismaayo', 'Kismayo'], ['Burco', 'Burao']]) assert.equal(findCity(typed, cities), city, typed);
  assert.equal(findCity('Nairobi', cities), null);
});

test('alerts: the first check only records what is running; then a message when an alert starts or gets worse', async () => {
  const {wa, sent, setFeed, logs, done} = await setup({feed: feedOf([moewr('Mudug', ['Galkayo', 'Galdogob'], 'advisory')])});
  try {
    await message(wa, ALICE, 'JOIN Galkayo');
    sent.length = 0;
    assert.equal((await wa.check()).baselined, 2, 'already-running alerts are not sent when the service starts');
    assert.equal(sent.length, 0);
    assert.equal((await wa.check()).sent, 0, 'an advisory that holds sends nothing');
    setFeed(feedOf([moewr('Mudug', ['Galkayo', 'Galdogob'], 'watch', true)]));
    assert.equal((await wa.check()).sent, 1);
    const alert = sent.at(-1).body;
    assert.equal(alert.type, 'template'); assert.equal(alert.to, ALICE);
    assert.deepEqual(alert.template.name, 'flood_alert'); assert.deepEqual(alert.template.language, {code: 'en'});
    assert.deepEqual(alert.template.components[0].parameters.map(p => p.text), ['Galkayo', 'national flood watch, anticipatory action pre-activation', 'Ministry of Energy and Water Resources (MOEWR)', 'This is the official national flood forecast.']);
    assert.equal((await wa.check()).sent, 0, 'the same level again sends nothing');
    setFeed(feedOf([moewr('Mudug', ['Galkayo', 'Galdogob'], 'advisory')]));
    assert.equal((await wa.check()).sent, 0, 'a level that falls sends nothing');
    setFeed(feedOf([moewr('Mudug', ['Galkayo', 'Galdogob'], 'watch')]));
    assert.equal((await wa.check()).sent, 1, 'and rising again does');
    setFeed(feedOf([]));
    await wa.check();
    setFeed(feedOf([moewr('Mudug', ['Galkayo', 'Galdogob'], 'watch')]));
    assert.equal((await wa.check()).sent, 1, 'an alert that ended and starts again is new');
    setFeed(feedOf([], ['moewr']));
    await wa.check();
    setFeed(feedOf([moewr('Mudug', ['Galkayo', 'Galdogob'], 'watch')]));
    // By now Alice has had her 3 for the day, so "skipped" counts too: nothing may even be attempted.
    assert.deepEqual(await wa.check(), {sent: 0, skipped: 0}, 'a source that failed to answer has not ended its alerts');
    setFeed(null);
    assert.equal((await wa.check()).unavailable, true);
    assert.ok(logs.every(line => !line.includes(ALICE)), 'logs never hold a full number');
  } finally { await done(); }
});

test('ICPAC and Flood Hub wording, the official line only for MOEWR, Somali when Meta approved it, and the daily limit', async () => {
  const events = alertEvents(feedOf([icpac('Kismayo', 'very-heavy'), floodhub('Kismayo', 'SEVERE'), moewr('Lower Juba', ['Kismayo'], 'warning')]), NOW);
  const byKey = Object.fromEntries(events.map(event => [event.source, event]));
  assert.deepEqual(templateParameters(byKey.icpac, 'en'), ['Kismayo', 'very heavy rainfall forecast this week', 'ICPAC regional forecast', 'This is not an official warning.']);
  assert.deepEqual(templateParameters(byKey.floodhub, 'en'), ['Kismayo', 'river forecast at Danger level (Webi Jubba river gauge)', 'Google Flood Hub', 'This is not an official warning.']);
  assert.deepEqual(templateParameters(byKey.moewr, 'so'), ['Kismayo', 'digniinta fatahaadda qaranka', 'Wasaaradda Tamarta iyo Kheyraadka Biyaha (MOEWR)', 'Tani waa saadaasha rasmiga ah ee fatahaadda qaranka.']);
  for (const event of events) for (const lang of ['en', 'so']) for (const text of templateParameters(event, lang)) assert.ok(!/[\n\t]| {2}/.test(text) && text.length, 'template variables have no line breaks or space runs');
  assert.deepEqual(alertEvents(feedOf([{...icpac('Kismayo', 'heavy'), endsAt: '2026-10-15T00:00:00Z'}, {...icpac('Baidoa', 'heavy'), status: 'expired'}, {sourceId: 'gdacs', status: 'active', endsAt: '2026-10-20T00:00:00Z', scope: {cities: ['Kismayo']}}]), NOW), [], 'ended, inactive and GDACS alerts are not sent');

  for (const somali of ['', 'so']) {
    const {wa, sent, setFeed, done} = await setup({env: {...ENV, WHATSAPP_TEMPLATE_SO_LANGUAGE: somali}, feed: feedOf([])});
    try {
      await message(wa, BOB, 'KU BIIR Kismayo');
      await message(wa, ALICE, 'JOIN Kismayo'); await message(wa, ALICE, 'JOIN Baidoa');
      await wa.check();
      sent.length = 0;
      setFeed(feedOf([icpac('Kismayo', 'very-heavy'), floodhub('Kismayo', 'SEVERE'), moewr('Lower Juba', ['Kismayo'], 'warning'), icpac('Baidoa', 'heavy')]));
      const result = await wa.check();
      const toAlice = sent.filter(item => item.body.to === ALICE), toBob = sent.filter(item => item.body.to === BOB);
      assert.equal(toAlice.length, MAX_PER_DAY, 'at most 3 a day'); assert.equal(result.skipped, 1);
      assert.equal(toAlice[0].body.template.components[0].parameters[2].text, 'Ministry of Energy and Water Resources (MOEWR)', 'official first');
      assert.equal(toBob.length, 3);
      assert.deepEqual(toBob[0].body.template.language, {code: somali || 'en'}, somali ? 'Somali template once approved' : 'English until a Somali template is approved');
      assert.equal(toBob[0].body.template.components[0].parameters[1].text, somali ? 'digniinta fatahaadda qaranka' : 'national flood warning');
    } finally { await done(); }
  }
});

test('subscribers and alert levels survive a restart', async () => {
  const first = await setup({feed: feedOf([moewr('Mudug', ['Galkayo'], 'watch')])});
  try {
    await message(first.wa, ALICE, 'JOIN Galkayo');
    await first.wa.check();
    const again = createWhatsApp({dataDir: first.dataDir, cities, config, alerts: async () => feedOf([moewr('Mudug', ['Galkayo'], 'watch')]), fetchImpl: async () => { throw new Error('nothing should be sent'); }, now: () => NOW, log: quiet});
    assert.deepEqual((await again.check()), {sent: 0, skipped: 0}, 'no repeat after a restart');
    await again.ready();
    assert.deepEqual(again.subscribers()[ALICE].cities, ['Galkayo']);
  } finally { await first.done(); }
});

test('the Alerts tab button: hidden while off; JOIN or KU BIIR for the selected city', async () => {
  const index = await readFile(new URL('index.html', dist), 'utf8');
  assert.ok(index.includes('<a id="alerts-whatsapp" class="whatsapp-link" href="https://wa.me/" target="_blank" rel="noopener" hidden>Get alerts on WhatsApp</a>'));
  assert.ok(index.indexOf('<script src="whatsapp.js">') < index.indexOf('<script src="alerts.js">'));
  async function page(answer, lang = 'en') {
    const nodes = {'alerts-whatsapp': {hidden: true, href: ''}, 'alerts-whatsapp-note': {hidden: true}};
    const window = {document: {getElementById: id => nodes[id]}, SiteLanguage: {getLanguage: () => lang}, fetch: async () => ({ok: true, json: async () => answer})};
    vm.runInContext(await readFile(new URL('whatsapp.js', dist), 'utf8'), vm.createContext({window, URL, encodeURIComponent}));
    for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));
    window.WhatsAppAlerts.update('Galkayo');
    return nodes;
  }
  const off = await page({enabled: false});
  assert.equal(off['alerts-whatsapp'].hidden, true); assert.equal(off['alerts-whatsapp-note'].hidden, true);
  const on = await page({enabled: true, number: '252610000000'});
  assert.equal(on['alerts-whatsapp'].hidden, false);
  assert.equal(on['alerts-whatsapp'].href, 'https://wa.me/252610000000?text=JOIN%20Galkayo');
  assert.equal((await page({enabled: true, number: '252610000000'}, 'so'))['alerts-whatsapp'].href, 'https://wa.me/252610000000?text=KU%20BIIR%20Galkayo');
  assert.equal((await page({enabled: true, number: 'javascript:alert(1)'}))['alerts-whatsapp'].hidden, true, 'only a plain number is used');
});

test('the button text and note read in Somali', async () => {
  const document = {readyState: 'complete', title: '', body: {nodeType: 11, childNodes: []}, documentElement: {setAttribute() {}}, getElementById: () => null, querySelectorAll: () => []};
  const window = {document, location: {href: 'https://elninowatch.so/?lang=so', protocol: 'https:'}, localStorage: {getItem: () => null, setItem() {}}};
  const context = vm.createContext({window, URL});
  vm.runInContext(await readFile(new URL('translations-so.js', dist), 'utf8'), context);
  vm.runInContext(await readFile(new URL('i18n.js', dist), 'utf8'), context);
  assert.equal(window.SiteLanguage.translateText('Get alerts on WhatsApp'), 'Ka hel digniinaha WhatsApp');
  const index = await readFile(new URL('index.html', dist), 'utf8');
  const note = /<p id="alerts-whatsapp-note"[^>]*>([^<]+)<\/p>/.exec(index)[1];
  assert.match(window.SiteLanguage.translateText(note), /^Badhanka digniinaha WhatsApp/);
  assert.match(window.SiteLanguage.translateText(note), /JOOJI CODKA/, 'how to stop the bulletin, too');
});

test('the server routes the WhatsApp endpoints, and is off without the settings', async () => {
  for (const [settings, expected] of [[whatsappConfig({}), {enabled: false}], [config, {enabled: true, number: '252610000000'}]]) {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'elnino-whatsapp-server-'));
    const server = createServer({dataDir, whatsapp: settings});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const base = 'http://127.0.0.1:' + server.address().port;
      assert.deepEqual(await (await fetch(base + '/api/whatsapp')).json(), expected);
      const check = await fetch(base + '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-not-real&hub.challenge=77');
      assert.equal(check.status, expected.enabled ? 200 : 404);
      const post = await fetch(base + '/api/whatsapp/webhook', {method: 'POST', body: '{}'});
      assert.equal(post.status, expected.enabled ? 401 : 404, 'an unsigned POST reaches the handler, not the GET-only guard');
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, {recursive: true, force: true}); }
  }
});
