// WhatsApp alerts, through Meta's WhatsApp Business Platform (Cloud API). Owner, 2026-10-16.
//
// Sign-up starts in WhatsApp, not in a form: the site's button opens WhatsApp with "JOIN <city>"
// (Somali "KU BIIR <city>") addressed to the El Nino Watch number, and the person sends it. That proves
// the number is theirs and is the opt-in Meta requires. "STOP" deletes them; "STOP <city>" drops one
// city; "LIST" and "HELP" answer. Replies are free-form messages inside WhatsApp's 24-hour window.
//
// Alerts: MOEWR's national flood levels, ICPAC heavy-rain forecasts and Google Flood Hub river levels
// for a subscribed city. A message goes out when an alert STARTS for a city or gets WORSE; a level
// that holds, or falls, sends nothing. Alerts are business-initiated, so they use the approved message
// template (WHATSAPP_TEMPLATE, default flood_alert; its text is in DEPLOYMENT.md). At most
// MAX_PER_DAY alerts per person per East Africa Time day, official MOEWR first.
//
// Audio bulletins (podcast.mjs), opt-in only (owner, 2026-10-16): "CODKA" (English "AUDIO") asks for them,
// "JOOJI CODKA" ("STOP AUDIO") stops them. A new bulletin in WHATSAPP_BULLETIN_SLOTS (default: evening)
// goes to those subscribers as the WHATSAPP_BULLETIN_TEMPLATE template (default flood_bulletin; its text is
// in DEPLOYMENT.md) with a link to listen. Someone may take the bulletin without following any city.
//
// Switched off until every WHATSAPP_* setting below is present. Subscribers live in
// <dataDir>/whatsapp.json (phone numbers: private, never committed, never logged in full).
import {readFile, writeFile, rename, unlink} from 'node:fs/promises';
import path from 'node:path';
import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';

export const MAX_CITIES = 5;
export const MAX_PER_DAY = 3;
export const CHECK_MS = 15 * 60 * 1000;
const SITE = 'https://elninowatch.so';
const SOURCES = ['moewr', 'floodhub', 'icpac'];
const eatDay = ms => new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10);
export const mask = number => `…${String(number || '').slice(-3)}`;

export function whatsappConfig(env = process.env) {
  const config = {
    token: env.WHATSAPP_TOKEN || '', phoneNumberId: String(env.WHATSAPP_PHONE_NUMBER_ID || '').trim(), appSecret: env.WHATSAPP_APP_SECRET || '',
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || '', number: String(env.WHATSAPP_NUMBER || '').replace(/\D/g, ''),
    template: env.WHATSAPP_TEMPLATE || 'flood_alert',
    bulletinTemplate: env.WHATSAPP_BULLETIN_TEMPLATE || 'flood_bulletin',
    bulletinSlots: String(env.WHATSAPP_BULLETIN_SLOTS || 'evening').split(',').map(slot => slot.trim()).filter(slot => ['morning', 'midday', 'evening'].includes(slot)),
    // The language code Meta approved the Somali version of the template under, if it did. Without it,
    // Somali subscribers get the English template (their replies are still in Somali).
    somaliLanguage: String(env.WHATSAPP_TEMPLATE_SO_LANGUAGE || '').trim(),
    graphVersion: env.WHATSAPP_GRAPH_VERSION || 'v23.0'
  };
  config.enabled = !!(config.token && /^\d+$/.test(config.phoneNumberId) && config.appSecret && config.verifyToken && /^\d{8,15}$/.test(config.number));
  return config;
}

// ---- Words ---------------------------------------------------------------------------------------

const ALIASES = {gaalkacyo: 'galkayo', muqdisho: 'mogadishu', mogadiscio: 'mogadishu', hargeysa: 'hargeisa', boosaaso: 'bosaso', kismaayo: 'kismayo',
  baydhabo: 'baidoa', garoowe: 'garowe', beledweyn: 'beledweyne', baladweyne: 'beledweyne', beletweyne: 'beledweyne', jawhar: 'jowhar',
  afgoye: 'afgooye', afgoi: 'afgooye', merca: 'marka', merka: 'marka', dhuusamarreeb: 'dhusamareb', dhuusamareeb: 'dhusamareb', burco: 'burao',
  baardheere: 'bardera', bardhere: 'bardera', dolow: 'doolow', dollo: 'doolow', balad: 'balcad', abudwak: 'cabudwaaq', buurhakaba: 'buurhakaba',
  xuddur: 'hudur', boorama: 'borama', ceerigaabo: 'erigavo', laascaanood: 'lasanod', bulobarde: 'buulobarde', cadaado: 'adado'};
const fold = text => String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
export function findCity(text, cities) {
  const key = fold(text);
  if (!key) return null;
  const wanted = ALIASES[key] || key;
  return cities.find(city => fold(city[0]) === wanted)?.[0] || null;
}

const WORDS = {
  en: {
    moewr: {warning: 'national flood warning', watch: 'national flood watch', advisory: 'national flood advisory', act: 'anticipatory action activated', pre: 'anticipatory action pre-activation'},
    icpac: {extreme: 'extremely heavy rainfall forecast this week', 'very-heavy': 'very heavy rainfall forecast this week', heavy: 'heavy rainfall forecast this week'},
    floodhub: {EXTREME: 'river forecast at Extreme level', SEVERE: 'river forecast at Danger level', ABOVE_NORMAL: 'river forecast at Warning level'},
    source: {moewr: 'Ministry of Energy and Water Resources (MOEWR)', icpac: 'ICPAC regional forecast', floodhub: 'Google Flood Hub'},
    status: {official: 'This is the official national flood forecast.', other: 'This is not an official warning.'}
  },
  so: {
    moewr: {warning: 'digniinta fatahaadda qaranka', watch: 'feejignaanta fatahaadda qaranka', advisory: 'talada fatahaadda qaranka', act: 'tallaabada hore waa la hawlgeliyay', pre: 'diyaargarowga tallaabada hore'},
    icpac: {extreme: 'saadaal roob aad iyo aad u xooggan toddobaadkan', 'very-heavy': 'saadaal roob aad u xooggan toddobaadkan', heavy: 'saadaal roob xooggan toddobaadkan'},
    floodhub: {EXTREME: 'saadaasha webiga, heerka aad u daran', SEVERE: 'saadaasha webiga, heerka khatarta', ABOVE_NORMAL: 'saadaasha webiga, heerka digniinta'},
    source: {moewr: 'Wasaaradda Tamarta iyo Kheyraadka Biyaha (MOEWR)', icpac: 'Saadaasha gobolka ee ICPAC', floodhub: 'Google Flood Hub'},
    status: {official: 'Tani waa saadaasha rasmiga ah ee fatahaadda qaranka.', other: 'Tani ma aha digniin rasmi ah.'}
  }
};
// Template variables may not hold line breaks, tabs or long runs of spaces.
const flat = text => String(text || '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 300);

// What the alert says, in one language: the {{2}} variable of the template.
function describe(event, lang) {
  const w = WORDS[lang], a = event.alert;
  if (event.source === 'moewr') return w.moewr[a.level] + (a.aaActive ? `, ${a.level === 'warning' ? w.moewr.act : w.moewr.pre}` : '');
  if (event.source === 'icpac') return w.icpac[a.category];
  return `${w.floodhub[a.googleSeverity]} (${a.scope?.gauge || 'River gauge'})`;
}

export function templateParameters(event, lang) {
  const w = WORDS[lang];
  return [event.city, describe(event, lang), w.source[event.source], event.source === 'moewr' ? w.status.official : w.status.other].map(flat);
}

const REPLIES = {
  en: {
    joined: (cities, active) => `You will get El Nino Watch alerts for ${cities}: official national flood forecasts (MOEWR), ICPAC heavy-rain forecasts and Google Flood Hub river forecasts, when one starts or gets worse, at most ${MAX_PER_DAY} a day. ${active} Reply STOP to stop all alerts, or STOP and a city name for one city. Your number is used only to send these alerts. More: ${SITE}`,
    none: 'No alert is active for these cities right now.',
    active: list => `Active now: ${list}.`,
    full: `You can follow up to ${MAX_CITIES} cities. Reply STOP and a city name to drop one first.`,
    unknown: (text, all) => `We could not find "${text}". Send JOIN and a city name, for example JOIN Galkayo. Cities: ${all}.`,
    stopped: 'You will get no more El Nino Watch alerts, and your number has been deleted. Send JOIN and a city name to start again.',
    stoppedCity: (city, rest) => `You will no longer get alerts for ${city}.${rest ? ` You still get alerts for ${rest}.` : ' You follow no cities now, and your number has been deleted.'}`,
    notFollowing: city => `You do not follow ${city}.`,
    list: cities => cities ? `You get alerts for ${cities}. Reply STOP to stop all alerts.` : 'You do not follow any city. Send JOIN and a city name, for example JOIN Galkayo.',
    help: `El Nino Watch flood alerts. Send JOIN and a city name to get alerts, for example JOIN Galkayo. LIST shows your cities, STOP stops all alerts. Send AUDIO for the audio bulletin in Somali. More: ${SITE}`,
    audioOn: when => `You will get the El Nino Watch audio bulletin, in Somali, ${when}, as a link to listen. Reply STOP AUDIO to stop it. Your number is used only for these messages.`,
    audioOff: cities => `You will no longer get the audio bulletin.${cities ? ` You still get flood alerts for ${cities}.` : ' Your number has been deleted.'}`,
    when: {evening: 'each evening', all: 'three times a day', some: 'each day'}
  },
  so: {
    joined: (cities, active) => `Waxaad heli doontaa digniinaha El Nino Watch ee ${cities}: saadaasha rasmiga ah ee fatahaadda qaranka (MOEWR), saadaasha roobka xooggan ee ICPAC iyo saadaasha webiyada ee Google Flood Hub, marka mid bilaabmo ama uu sii xumaado, ugu badnaan ${MAX_PER_DAY} maalintii. ${active} Ku jawaab JOOJI si aad u joojiso dhammaan digniinaha, ama JOOJI iyo magaalo si aad u joojiso hal magaalo. Lambarkaaga waxaa loo isticmaalaa oo keliya dirista digniinahan. Wax badan: ${SITE}`,
    none: 'Hadda ma jirto digniin u socota magaalooyinkan.',
    active: list => `Hadda socda: ${list}.`,
    full: `Waxaad la socon kartaa ilaa ${MAX_CITIES} magaalo. Marka hore ku jawaab JOOJI iyo magaalo si aad mid uga saarto.`,
    unknown: (text, all) => `Lama helin "${text}". Soo dir KU BIIR iyo magaalo, tusaale KU BIIR Galkayo. Magaalooyinka: ${all}.`,
    stopped: 'Mar dambe ma heli doontid digniinaha El Nino Watch, lambarkaagana waa la tirtiray. Soo dir KU BIIR iyo magaalo si aad dib ugu bilowdo.',
    stoppedCity: (city, rest) => `Mar dambe ma heli doontid digniinaha ${city}.${rest ? ` Weli waxaad heleysaa digniinaha ${rest}.` : ' Hadda ma la socotid magaalo, lambarkaagana waa la tirtiray.'}`,
    notFollowing: city => `Ma la socotid ${city}.`,
    list: cities => cities ? `Waxaad heleysaa digniinaha ${cities}. Ku jawaab JOOJI si aad u joojiso dhammaan digniinaha.` : 'Ma la socotid magaalo. Soo dir KU BIIR iyo magaalo, tusaale KU BIIR Galkayo.',
    help: `Digniinaha fatahaadda ee El Nino Watch. Soo dir KU BIIR iyo magaalo si aad u hesho digniinaha, tusaale KU BIIR Galkayo. LIISKA wuxuu muujiyaa magaalooyinkaaga, JOOJI wuxuu joojiyaa dhammaan digniinaha. Soo dir CODKA si aad u hesho warbixinta codka. Wax badan: ${SITE}`,
    audioOn: when => `Waxaad WhatsApp ku heli doontaa warbixinta codka ee El Nino Watch ${when}, oo ah xiriir aad ka dhageysato. Ku jawaab JOOJI CODKA si aad u joojiso. Lambarkaaga waxaa loo isticmaalaa oo keliya fariimahan.`,
    audioOff: cities => `Mar dambe ma heli doontid warbixinta codka.${cities ? ` Weli waxaad heleysaa digniinaha fatahaadda ee ${cities}.` : ' Lambarkaagana waa la tirtiray.'}`,
    when: {evening: 'fiid kasta', all: 'saddex jeer maalintii', some: 'maalin kasta'}
  }
};

export function parseCommand(text) {
  const words = String(text || '').trim().replace(/\s+/g, ' ');
  let match;
  if ((match = /^(join|subscribe|start)(?:\s+(.*))?$/i.exec(words))) return {action: 'join', lang: 'en', city: match[2] || ''};
  if ((match = /^(ku biir|kubiir|biir)(?:\s+(.*))?$/i.exec(words))) return {action: 'join', lang: 'so', city: match[2] || ''};
  // The audio bulletin, before STOP and JOOJI so "STOP AUDIO" is not read as a city.
  if (/^(audio|bulletin)$/i.test(words)) return {action: 'audio-on', lang: 'en'};
  if (/^(codka|cod)$/i.test(words)) return {action: 'audio-on', lang: 'so'};
  if (/^stop (audio|bulletin)$/i.test(words)) return {action: 'audio-off', lang: 'en'};
  if (/^(jooji codka|codka jooji)$/i.test(words)) return {action: 'audio-off', lang: 'so'};
  if ((match = /^(stop|unsubscribe)(?:\s+(.*))?$/i.exec(words))) return {action: 'stop', lang: 'en', city: match[2] || ''};
  if ((match = /^(jooji)(?:\s+(.*))?$/i.exec(words))) return {action: 'stop', lang: 'so', city: match[2] || ''};
  if (/^list$/i.test(words)) return {action: 'list', lang: 'en'};
  if (/^liiska$/i.test(words)) return {action: 'list', lang: 'so'};
  return {action: 'help', lang: null};
}

// The alerts feed (alerts-feed.mjs, as /api/alerts serves it) as one event per city and source.
// rank orders severity within a source; a higher rank for the same city and source is "worse".
export function alertEvents(feedData, now = Date.now()) {
  const events = [];
  for (const alert of feedData?.alerts || []) {
    const source = alert.sourceId;
    if (!SOURCES.includes(source) || alert.status !== 'active' || !(Date.parse(alert.endsAt) > now)) continue;
    const rank = source === 'moewr' ? ({advisory: 1, watch: 3, warning: 5}[alert.level] || 0) + (alert.aaActive ? 1 : 0)
      : source === 'icpac' ? ({heavy: 1, 'very-heavy': 2, extreme: 3}[alert.category] || 0)
      : ({ABOVE_NORMAL: 1, SEVERE: 2, EXTREME: 3}[alert.googleSeverity] || 0);
    if (!rank) continue;
    for (const city of alert.scope?.cities || []) events.push({key: `${city}|${source}`, city, source, rank, endsAt: alert.endsAt, alert});
  }
  // The worst event for each city and source.
  const best = new Map();
  for (const event of events) if (!best.has(event.key) || best.get(event.key).rank < event.rank) best.set(event.key, event);
  return [...best.values()];
}

export function createWhatsApp({dataDir, cities = [], config = whatsappConfig(), alerts = async () => null, fetchImpl = fetch, now = () => Date.now(), log = console} = {}) {
  const file = path.join(path.resolve(dataDir), 'whatsapp.json');
  // subscribers: {waId: {cities, lang, joinedAt}}; levels: {"city|source": {rank, endsAt}};
  // sentToday: {waId: {day, count}}; baselined: the first check records the alerts already running.
  let state = {version: 1, subscribers: {}, levels: {}, sentToday: {}, baselined: false};
  const seenMessages = new Set();
  let timer = null, checking = null, saving = Promise.resolve();
  const ready = readFile(file, 'utf8').then(text => {
    const saved = JSON.parse(text);
    if (saved?.version === 1) state = {...state, ...saved};
  }).catch(error => { if (error.code !== 'ENOENT') log.error(`WhatsApp subscribers not loaded: ${error.message}`); });

  function save() {
    saving = saving.then(async () => {
      const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(state), {flag: 'wx', mode: 0o600});
        await rename(temporary, file);
      } catch (error) {
        await unlink(temporary).catch(() => {});
        log.error(`WhatsApp subscribers not saved: ${error.message}`);
      }
    });
    return saving;
  }

  async function graph(body) {
    const response = await fetchImpl(`https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: {Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({messaging_product: 'whatsapp', ...body})});
    if (!response.ok) {
      const code = (await response.json().catch(() => ({})))?.error?.code;
      throw new Error(`WhatsApp returned HTTP ${response.status}${code ? ` (code ${code})` : ''}.`);
    }
    return response.json().catch(() => ({}));
  }
  const sendText = (to, text) => graph({to, type: 'text', text: {body: text, preview_url: false}})
    .catch(error => log.error(`WhatsApp reply to ${mask(to)} failed: ${error.message}`));

  function sendTemplate(to, event, lang) {
    const somali = lang === 'so' && config.somaliLanguage;
    const parameters = templateParameters(event, somali ? 'so' : 'en').map(text => ({type: 'text', text}));
    return graph({to, type: 'template', template: {name: config.template, language: {code: somali ? config.somaliLanguage : 'en'}, components: [{type: 'body', parameters}]}});
  }

  const cityList = names => names.join(', ');
  async function activeFor(names, lang) {
    const data = await Promise.resolve(alerts()).catch(() => null);
    const list = alertEvents(data, now()).filter(event => names.includes(event.city))
      .sort((a, b) => SOURCES.indexOf(a.source) - SOURCES.indexOf(b.source) || b.rank - a.rank)
      .map(event => `${event.city}: ${describe(event, lang)} (${WORDS[lang].source[event.source]})`);
    return list.length ? REPLIES[lang].active(list.join('; ')) : REPLIES[lang].none;
  }

  async function onMessage(from, text) {
    const command = parseCommand(text), existing = state.subscribers[from];
    const lang = command.lang || existing?.lang || 'en', say = REPLIES[lang];
    if (command.action === 'help') return sendText(from, say.help);
    if (command.action === 'list') return sendText(from, say.list(existing ? cityList(existing.cities) : ''));
    if (command.action === 'audio-on') {
      const record = existing || {cities: [], lang, joinedAt: new Date(now()).toISOString()};
      record.bulletin = true; record.lang = lang;
      state.subscribers[from] = record;
      await save();
      const slots = config.bulletinSlots || ['evening'];
      return sendText(from, say.audioOn(say.when[slots.length === 3 ? 'all' : slots.length === 1 && slots[0] === 'evening' ? 'evening' : 'some']));
    }
    if (command.action === 'audio-off') {
      if (existing) {
        existing.bulletin = false;
        if (!existing.cities.length) { delete state.subscribers[from]; delete state.sentToday[from]; }
        await save();
      }
      return sendText(from, say.audioOff(existing?.cities.length ? cityList(existing.cities) : ''));
    }
    if (command.action === 'stop') {
      if (!existing) return sendText(from, say.stopped);
      if (!command.city) { delete state.subscribers[from]; delete state.sentToday[from]; await save(); return sendText(from, say.stopped); }
      const city = findCity(command.city, cities);
      if (!city || !existing.cities.includes(city)) return sendText(from, say.notFollowing(city || command.city));
      existing.cities = existing.cities.filter(name => name !== city);
      // Someone who also takes the audio bulletin is kept for it.
      if (!existing.cities.length && !existing.bulletin) { delete state.subscribers[from]; delete state.sentToday[from]; }
      await save();
      return sendText(from, say.stoppedCity(city, cityList(existing.cities)));
    }
    const city = findCity(command.city, cities);
    if (!city) return sendText(from, say.unknown(flat(command.city).slice(0, 40), cityList(cities.map(item => item[0]))));
    const record = existing || {cities: [], lang, joinedAt: new Date(now()).toISOString()};
    if (!record.cities.includes(city)) {
      if (record.cities.length >= MAX_CITIES) return sendText(from, say.full);
      record.cities.push(city);
    }
    record.lang = lang;
    state.subscribers[from] = record;
    await save();
    return sendText(from, say.joined(cityList(record.cities), await activeFor(record.cities, lang)));
  }

  // One pass: new or worse alerts go to the subscribers of their city, within the daily cap.
  async function check() {
    if (!config.enabled) return {sent: 0, skipped: 0};
    if (checking) return checking;
    checking = (async () => {
      await ready;
      const data = await alerts();
      if (!data?.alerts) return {sent: 0, skipped: 0, unavailable: true};
      const at = now(), events = alertEvents(data, at), fresh = [];
      const available = new Set((data.sources || []).filter(source => source.available).map(source => source.id));
      for (const event of events) {
        const held = state.levels[event.key];
        if (!held || Date.parse(held.endsAt) <= at || event.rank > held.rank) fresh.push(event);
        state.levels[event.key] = {rank: event.rank, endsAt: event.endsAt};
      }
      // An alert that ended may start again later; a source that failed to answer keeps its levels.
      const current = new Set(events.map(event => event.key));
      for (const key of Object.keys(state.levels)) if (!current.has(key) && available.has(key.split('|')[1])) delete state.levels[key];
      let sent = 0, skipped = 0;
      if (!state.baselined) { state.baselined = true; await save(); return {sent, skipped, baselined: fresh.length}; }
      const day = eatDay(at);
      for (const [waId, subscriber] of Object.entries(state.subscribers)) {
        const mine = fresh.filter(event => subscriber.cities.includes(event.city))
          .sort((a, b) => SOURCES.indexOf(a.source) - SOURCES.indexOf(b.source) || b.rank - a.rank);
        const today = state.sentToday[waId]?.day === day ? state.sentToday[waId] : {day, count: 0};
        for (const event of mine) {
          if (today.count >= MAX_PER_DAY) { skipped++; continue; }
          try { await sendTemplate(waId, event, subscriber.lang); today.count++; sent++; }
          catch (error) { log.error(`WhatsApp alert to ${mask(waId)} failed: ${error.message}`); }
        }
        state.sentToday[waId] = today;
      }
      await save();
      if (sent || skipped) log.log(`WhatsApp alerts: ${sent} sent, ${skipped} over the daily limit.`);
      return {sent, skipped};
    })().finally(() => { checking = null; });
    return checking;
  }

  // A new audio bulletin, to the subscribers who asked for it, in the slots chosen for WhatsApp.
  async function sendBulletin(item) {
    if (!config.enabled || !item || !(config.bulletinSlots || ['evening']).includes(item.slot)) return {sent: 0};
    await ready;
    let sent = 0;
    const link = `${SITE}/?lang=so#podcast`;
    for (const [waId, subscriber] of Object.entries(state.subscribers)) {
      if (!subscriber.bulletin) continue;
      const somali = subscriber.lang === 'so' && config.somaliLanguage;
      const parameters = [flat(item.title), link].map(text => ({type: 'text', text}));
      try {
        await graph({to: waId, type: 'template', template: {name: config.bulletinTemplate, language: {code: somali ? config.somaliLanguage : 'en'}, components: [{type: 'body', parameters}]}});
        sent++;
      } catch (error) { log.error(`WhatsApp bulletin to ${mask(waId)} failed: ${error.message}`); }
    }
    if (sent) log.log(`WhatsApp bulletin ${item.id}: ${sent} sent.`);
    return {sent};
  }

  function verified(req, raw) {
    const header = String(req.headers['x-hub-signature-256'] || '');
    const expected = Buffer.from(`sha256=${createHmac('sha256', config.appSecret).update(raw).digest('hex')}`);
    const given = Buffer.from(header);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  async function handle(req, res, url) {
    if (url.pathname !== '/api/whatsapp' && url.pathname !== '/api/whatsapp/webhook') return false;
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      const buffer = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      res.writeHead(status, {'Content-Type': type, 'Content-Length': buffer.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
      res.end(req.method === 'HEAD' ? undefined : buffer);
      return true;
    };
    // What the page needs to draw its button: nothing at all while the service is off.
    if (url.pathname === '/api/whatsapp') return send(200, config.enabled ? {enabled: true, number: config.number} : {enabled: false});
    if (!config.enabled) return send(404, {error: 'WhatsApp alerts are not set up.'});
    if (req.method === 'GET') {
      // Meta's one-time check when the webhook is registered.
      const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === config.verifyToken;
      return ok ? send(200, String(url.searchParams.get('hub.challenge') || ''), 'text/plain; charset=utf-8') : send(403, {error: 'Verification failed.'});
    }
    if (req.method !== 'POST') return send(405, {error: 'Only GET and POST are supported.'});
    const chunks = [];
    let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 256 * 1024) return send(413, {error: 'Too large.'}); chunks.push(chunk); }
    const raw = Buffer.concat(chunks);
    if (!verified(req, raw)) return send(401, {error: 'Signature does not match.'});
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { return send(400, {error: 'Invalid JSON.'}); }
    await ready;
    for (const entry of body?.entry || []) for (const change of entry?.changes || []) for (const message of change?.value?.messages || []) {
      const from = String(message?.from || '');
      // Meta can deliver the same message twice; act on it once.
      if (!/^\d{8,15}$/.test(from) || !message.id || seenMessages.has(message.id)) continue;
      seenMessages.add(message.id);
      if (seenMessages.size > 1000) seenMessages.delete(seenMessages.values().next().value);
      if (message.type === 'text') await onMessage(from, message.text?.body);
      else await sendText(from, REPLIES[state.subscribers[from]?.lang || 'en'].help);
    }
    return send(200, {received: true});
  }

  function start() {
    if (!config.enabled || timer) return;
    const run = () => check().catch(error => log.error(`WhatsApp alert check failed: ${error.message}`));
    setTimeout(run, 60 * 1000).unref?.();
    timer = setInterval(run, CHECK_MS);
    timer.unref?.();
  }

  return {handle, check, start, onMessage, sendBulletin, subscribers: () => state.subscribers, ready: () => ready};
}
