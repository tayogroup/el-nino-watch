// Audio bulletins: a short Somali radio-style summary of the El Niño and flood situation three times a day
// (06:30, 12:30 and 18:30 East Africa Time). Owner, 2026-10-16: Somali only; written from the site's own
// feeds by the fixed template below and voiced by Google Gemini (voice Puck); the owner approves the template
// once and bulletins then publish on their own; WhatsApp subscribers get them only if they opt in.
//
// The template's rules: only MOEWR is called official; every figure comes from a feed; a source that is
// down is read as "not available", never as an older figure; when nothing has changed the midday bulletin
// says so instead of repeating itself; news is read only from Somali-language items, with the source named.
//
// Switched off until all three hold: the owner has approved this template version (APPROVED_TEMPLATE ===
// TEMPLATE_VERSION), GEMINI_API_KEY is set, and PODCAST_ENABLED=1. Bulletins are kept KEEP_DAYS days in
// <dataDir>/podcast/ as MP3 (ffmpeg turns Gemini's WAV into 48 kbit/s mono, about 0.35 MB a minute).
import {readFile, writeFile, rename, unlink, mkdir, readdir} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const TEMPLATE_VERSION = '2026-10-16';
// The template version the owner approved. null: not approved, so nothing is voiced or published.
export const APPROVED_TEMPLATE = null;
export const SLOTS = Object.freeze([
  {id: 'morning', at: '06:30', name: 'subaxa'},
  {id: 'midday', at: '12:30', name: 'duhurka'},
  {id: 'evening', at: '18:30', name: 'fiidka'}
]);
export const KEEP_DAYS = 7;
const LATE_MS = 2 * 3600 * 1000;        // a slot missed by more than this (a restart) is skipped, not read late
const CHECK_MS = 60 * 1000;
const RETRY_MS = 5 * 60 * 1000, MAX_ATTEMPTS = 3;
const EAT_MS = 3 * 3600 * 1000;
const SITE = 'https://elninowatch.so';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/interactions';
// How it is read: Gemini's style field is not spoken.
export const STYLE = 'Calm, clear and steady, like a radio news presenter reading a public safety bulletin. Not cheerful.';
const ID = /^(\d{4}-\d{2}-\d{2})-(morning|midday|evening)$/;

export function podcastConfig(env = process.env) {
  const config = {
    apiKey: String(env.GEMINI_API_KEY || '').trim(),
    on: env.PODCAST_ENABLED === '1',
    model: env.PODCAST_MODEL || 'gemini-3.8-flash-tts',
    voice: env.PODCAST_VOICE || 'Puck',
    ffmpeg: env.FFMPEG || 'ffmpeg',
    approved: APPROVED_TEMPLATE === TEMPLATE_VERSION
  };
  config.enabled = !!(config.apiKey && config.on && config.approved);
  return config;
}

// ---- Somali words ---------------------------------------------------------------------------------

const DAYS = ['Axad', 'Isniin', 'Talaado', 'Arbaco', 'Khamiis', 'Jimce', 'Sabti'];
const MONTHS = ['Janaayo', 'Febraayo', 'Maarso', 'Abriil', 'Maajo', 'Juun', 'Luulyo', 'Agoosto', 'Sebtembar', 'Oktoobar', 'Nofembar', 'Desembar'];
export const CITY_SO = {Mogadishu: 'Muqdisho', Hargeisa: 'Hargeysa', Bosaso: 'Boosaaso', Kismayo: 'Kismaayo', Baidoa: 'Baydhabo', Garowe: 'Garoowe',
  Galkayo: 'Gaalkacyo', Dhusamareb: 'Dhuusamarreeb', Burao: 'Burco', Bardera: 'Baardheere', 'Buur Hakaba': 'Buurhakaba', Hudur: 'Xuddur',
  Borama: 'Boorama', Erigavo: 'Ceerigaabo', 'Las Anod': 'Laascaanood', Adado: 'Cadaado'};
export const REGION_SO = {'Woqooyi Galbeed': 'Waqooyi Galbeed', 'Lower Juba': 'Jubbada Hoose', 'Middle Juba': 'Jubbada Dhexe', Hiraan: 'Hiiraan',
  'Middle Shabelle': 'Shabeellaha Dhexe', 'Lower Shabelle': 'Shabeellaha Hoose', Sahil: 'Saaxil'};
const GAUGE_SO = {Bardheere: 'Baardheere', Dollow: 'Doolow', Bualle: "Bu'aale", 'Belet Weyne': 'Beledweyne', 'Bulo Burti': 'Buulobarde', Afgoi: 'Afgooye', Audegle: 'Awdheegle', 'Mahadey Weyne': 'Mahaday'};
const RIVER_SO = {Juba: 'Jubba', Shabelle: 'Shabeelle'};
const city = name => CITY_SO[name] || name;
const region = name => REGION_SO[name] || name;
// "A, B iyo C"
const list = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} iyo ${items.at(-1)}`;
// Gauges read to the centimetre: 5.17 against a 5.25 mark must not both round to 5.2.
const metres = value => `${Number(value).toFixed(2)} mitir`;
const sentence = text => { const t = String(text || '').trim().replace(/\s+/g, ' '); return /[.!?]$/.test(t) ? t : `${t}.`; };
// A headline in capitals is read better in sentence case.
const calm = text => (/[a-z]/.test(text) ? text : text.charAt(0) + text.slice(1).toLowerCase());

// One tip per bulletin, in turn. The film tips use the owner-corrected wording of the cholera film.
export const TIPS = Object.freeze([
  'Talo: biyaha la cabbo karkari, ama ku nadiifi kiniinka biyaha sida baakadda ku qoran.',
  'Talo: gacmaha ku dhaq saabuun iyo biyo nadiif ah, ka dib musqusha iyo ka hor cuntada.',
  'Talo: haddii qof shuban biyo ah qabo, isla markiiba bilow daawada O R S, oo u tag xarun caafimaad.',
  'Talo: biyaha nadiifka ah ku kaydi weel nadiif ah oo dabool leh.',
  'Talo: ha dhex marin biyaha fatahaadda, hana ku dhex wadin baabuur. Biyo yar oo socda ayaa qof iyo baabuur qaadi kara.',
  'Talo: xoolaha iyo alaabta muhiimka ah u guuri meel sare ka hor inta aysan biyuhu kicin.',
  'Talo: seexo gogol kaneecada laga ilaaliyo, oo faaruqi weelasha biyaha fadhiya.'
]);

// NOAA's status, as the clause after "NOAA waxay sheegtay ... in".
const ENSO_SO = {'El Niño Advisory': 'El Niño uu socdo', 'Final El Niño Advisory': 'El Niño uu dhammaaday', 'El Niño Watch': 'El Niño la filayo',
  'La Niña Advisory': 'La Niña ay socoto', 'La Niña Watch': 'La Niña la filayo'};

// ---- Time ----------------------------------------------------------------------------------------

const eat = ms => new Date(ms + EAT_MS);
export const eatDate = ms => eat(ms).toISOString().slice(0, 10);
const minutes = at => { const [h, m] = at.split(':').map(Number); return h * 60 + m; };
function dateWords(ms) {
  const d = eat(ms);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// The slot due at this moment (within LATE_MS of its time), or null.
export function dueSlot(ms) {
  const d = eat(ms), now = d.getUTCHours() * 60 + d.getUTCMinutes();
  for (const slot of [...SLOTS].reverse()) {
    const at = minutes(slot.at);
    if (now >= at && now < at + LATE_MS / 60000) return {slot, date: eatDate(ms), id: `${eatDate(ms)}-${slot.id}`};
  }
  return null;
}

// ---- The template --------------------------------------------------------------------------------

function officialSection(alerts, now) {
  const moewrUp = alerts?.alerts && (alerts.sources || []).some(source => source.id === 'moewr' && source.available !== false);
  if (!moewrUp) return {text: 'Digniinaha rasmiga ah ee Wasaaradda Tamarta iyo Kheyraadka Biyaha lama heli karo hadda.', facts: null};
  const active = alerts.alerts.filter(alert => alert.sourceId === 'moewr' && alert.status === 'active' && Date.parse(alert.endsAt) > now && alert.scope?.region);
  if (!active.length) return {text: 'Wasaaradda Tamarta iyo Kheyraadka Biyaha: hadda ma jirto digniin fatahaadeed oo rasmi ah.', facts: []};
  const groups = [['warning', true], ['warning', false], ['watch', null], ['advisory', null]];
  const words = {warning: 'Digniin fatahaadeed', watch: 'Feejignaan fatahaadeed', advisory: 'Talo fatahaadeed'};
  const parts = [];
  for (const [level, aa] of groups) {
    const regions = [...new Set(active.filter(alert => alert.level === level && (aa === null || !!alert.aaActive === aa)).map(alert => region(alert.scope.region)))].sort();
    if (regions.length) parts.push(`${words[level]}: ${list(regions)}${level === 'warning' && aa ? '; tallaabada hore waa la hawlgeliyay' : ''}.`);
  }
  const facts = active.map(alert => `${alert.scope.region}|${alert.level}|${alert.aaActive ? 1 : 0}`).sort();
  return {text: `Digniinaha rasmiga ah ee Wasaaradda Tamarta iyo Kheyraadka Biyaha waa kuwan. ${parts.join(' ')}`, facts};
}

function riverSection(stations, now) {
  const fresh = (stations?.stations || []).filter(s => typeof s.levelM === 'number' && typeof s.moderateM === 'number'
    && Date.parse(s.observedAt) > now - 2 * 86400000);
  if (!stations?.available || !fresh.length) return {text: 'Heerarka webiyada Jubba iyo Shabeelle lama heli karo hadda.', facts: null};
  const state = s => s.levelM >= (s.highM ?? Infinity) ? 'high' : s.levelM >= s.moderateM ? 'moderate' : s.levelM >= 0.9 * s.moderateM ? 'near' : 'below';
  const said = {high: 'oo ka sarreeya heerka sare', moderate: 'oo ka sarreeya heerka dhexdhexaadka ah', near: 'oo ku dhow heerka dhexdhexaadka ah'};
  const notable = fresh.filter(s => state(s) !== 'below').sort((a, b) => b.levelM / b.moderateM - a.levelM / a.moderateM);
  const lines = notable.map(s => {
    const near = state(s) === 'moderate' && typeof s.highM === 'number' && s.levelM >= 0.95 * s.highM ? `, kuna dhow heerka sare ee ${metres(s.highM)}` : '';
    return `Webiga ${RIVER_SO[s.river] || s.river} ee ${GAUGE_SO[s.name] || s.name} wuxuu marayaa ${metres(s.levelM)}, ${said[state(s)]}${near}.`;
  });
  const rest = notable.length ? 'Cabbirada kale ee webiyada way ka hooseeyaan heerarka khatarta.' : 'Cabbirada webiyada Jubba iyo Shabeelle dhammaantood way ka hooseeyaan heerarka khatarta.';
  return {text: `Webiyada: ${[...lines, rest].join(' ')}`, facts: fresh.map(s => `${s.name}|${state(s)}`).sort()};
}

// rain: [{city, days: [{date, mm}]}] from Open-Meteo. The target day: today, or tomorrow in the evening.
function rainSection(rain, now, slotId) {
  const offset = slotId === 'evening' ? 1 : 0, when = offset ? 'berri' : 'maanta';
  const date = eatDate(now + offset * 86400000);
  const values = (rain || []).map(entry => ({name: entry.city, mm: entry.days.find(day => day.date === date)?.mm})).filter(entry => typeof entry.mm === 'number');
  if (values.length < 15) return `Saadaasha roobka ${when} lama heli karo hadda.`;
  const heavy = values.filter(entry => entry.mm >= 10).sort((a, b) => b.mm - a.mm).slice(0, 3);
  if (!heavy.length) return `Roob xooggan, 10 milimitir ama ka badan, looma filayo ${when} 30-ka magaalo midkoodna.`;
  return `Roobka ${when}: roobka ugu badan waxaa laga filayaa ${list(heavy.map(entry => `${city(entry.name)} ${Math.round(entry.mm)} milimitir`))}. Kani waa saadaal moodeel.`;
}

function icpacSection(alerts, now) {
  const active = (alerts?.alerts || []).filter(alert => alert.sourceId === 'icpac' && Date.parse(alert.endsAt) > now);
  if (!active.length) return '';
  const rank = {extreme: 3, 'very-heavy': 2, heavy: 1};
  const cities = [...new Map(active.flatMap(alert => (alert.scope?.cities || []).map(name => [name, rank[alert.category] || 0]))).entries()];
  const top = cities.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => city(name));
  return `Saadaasha toddobaadkan ee ICPAC waxay muujinaysaa roob xooggan ${cities.length} ka mid ah 30-ka magaalo, oo ay ku jiraan ${list(top)}. Taasi waa saadaal moodeel, ma aha digniin rasmi ah.`;
}

function newsLines(enso, news, now) {
  const lines = [];
  const phase = ENSO_SO[enso?.alertStatus || enso?.phase];
  const [, month, day] = String(enso?.issuedAt || '').slice(0, 10).split('-').map(Number);
  if (enso?.available !== false && phase && month && day) lines.push(`NOAA waxay sheegtay ${day} ${MONTHS[month - 1]} in ${phase}.`);
  for (const item of news?.items || []) {
    if (item.language !== 'so' || item.group === 'app' || !item.title) continue;
    if (!(Date.parse(item.publishedAt) > now - 3 * 86400000)) continue;
    lines.push(`${item.source} ayaa sheegtay: ${sentence(calm(item.title))}`);
  }
  return lines;
}

const tipFor = (ms, slotId) => TIPS[(Math.floor((ms + EAT_MS) / 86400000) * 3 + SLOTS.findIndex(slot => slot.id === slotId)) % TIPS.length];

// The bulletin's words. previous: the facts of today's last bulletin, for the midday "what changed".
export function buildScript({slotId, now, alerts, stations, enso, news, rain, previous = null}) {
  const slot = SLOTS.find(item => item.id === slotId);
  if (!slot) throw new Error('Unknown slot.');
  const official = officialSection(alerts, now), rivers = riverSection(stations, now);
  const parts = [`Waa El Nino Watch, warbixinta ${slot.name} ee ${dateWords(now)}. Kani ma aha adeeg digniin rasmi ah.`];
  if (slotId === 'midday' && previous && official.facts && rivers.facts
    && JSON.stringify(official.facts) === JSON.stringify(previous.official) && JSON.stringify(rivers.facts) === JSON.stringify(previous.rivers)) {
    parts.push('Digniinaha rasmiga ah iyo heerarka webiyada isma beddelin tan iyo subaxdii.');
  } else {
    parts.push(official.text, rivers.text);
  }
  if (slotId !== 'midday') parts.push(rainSection(rain, now, slotId));
  if (slotId === 'evening') { const icpac = icpacSection(alerts, now); if (icpac) parts.push(icpac); }
  const items = newsLines(enso, news, now).slice(0, slotId === 'evening' ? 2 : slotId === 'midday' ? 1 : 0);
  if (items.length) parts.push(`Warar: ${items.join(' ')}`);
  parts.push(tipFor(now, slotId));
  parts.push('Raac tilmaamaha maamulka deegaanka iyo SoDMA. Xog dheeraad ah ka hel elninowatch.so. Waa El Nino Watch.');
  return {text: parts.join('\n\n'), title: `Warbixinta ${slot.name}, ${dateWords(now)}`, facts: {official: official.facts, rivers: rivers.facts}};
}

// ---- Rain, from Open-Meteo -------------------------------------------------------------------------

export async function loadRain(cities, fetchImpl = fetch) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', cities.map(c => c[2]).join(','));
  url.searchParams.set('longitude', cities.map(c => c[3]).join(','));
  url.searchParams.set('daily', 'precipitation_sum');
  url.searchParams.set('forecast_days', '3');
  url.searchParams.set('timezone', 'Africa/Mogadishu');
  const response = await fetchImpl(url, {signal: AbortSignal.timeout(30000), redirect: 'error'});
  if (!response.ok) throw new Error(`Open-Meteo returned HTTP ${response.status}.`);
  const data = await response.json();
  const rows = Array.isArray(data) ? data : [data];
  return cities.map((c, i) => ({city: c[0], days: (rows[i]?.daily?.time || []).map((date, k) => ({date, mm: rows[i].daily.precipitation_sum?.[k]}))}));
}

// ---- Voice ---------------------------------------------------------------------------------------

function wavFromPcm(pcm, rate = 24000) {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}
// Seconds of audio in a 16-bit mono WAV.
export function wavSeconds(wav) {
  const rate = wav.readUInt32LE(24), data = wav.indexOf('data', 12);
  return data < 0 ? 0 : wav.readUInt32LE(data + 4) / (rate * 2);
}

export async function voice(text, config, fetchImpl = fetch) {
  const response = await fetchImpl(GEMINI, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180000),
    headers: {'x-goog-api-key': config.apiKey, 'Content-Type': 'application/json'},
    body: JSON.stringify({
      model: config.model,
      input: [{type: 'user_input', content: [{type: 'text', text, annotations: [{type: 'speech_metadata', style: STYLE}]}]}],
      response_format: {type: 'audio'},
      generation_config: {speech_config: [{voice: config.voice}]}
    })
  });
  // The status only: the body may echo the request, and the key is never logged.
  if (!response.ok) throw new Error(`Gemini returned HTTP ${response.status}.`);
  const body = await response.json();
  const data = (body.steps || []).filter(step => step.type === 'model_output').flatMap(step => step.content || []).filter(part => part.type === 'audio').at(-1)?.data;
  if (!data) throw new Error('Gemini returned no audio.');
  const audio = Buffer.from(data, 'base64');
  return audio.subarray(0, 4).toString('latin1') === 'RIFF' ? audio : wavFromPcm(audio);
}

export function toMp3(ffmpeg, wavFile, mp3File) {
  return new Promise((resolve, reject) => execFile(ffmpeg, ['-y', '-v', 'error', '-i', wavFile, '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '48k', mp3File], {timeout: 120000},
    error => error ? reject(new Error(`ffmpeg failed: ${error.message.split('\n')[0]}`)) : resolve()));
}

// ---- The service ---------------------------------------------------------------------------------

export function createPodcast({dataDir, cities = [], config = podcastConfig(), statsKey = '', feeds = {}, fetchImpl = fetch,
  now = () => Date.now(), log = console, onPublished = async () => {}, encode = (wavFile, mp3File) => toMp3(config.ffmpeg, wavFile, mp3File)} = {}) {
  const dir = path.join(path.resolve(dataDir), 'podcast'), file = path.join(dir, 'index.json');
  // items: newest first; attempts: {id: {count, at}}; facts: the last bulletin's, for "what changed".
  let state = {version: 1, items: [], hold: false, attempts: {}, facts: null};
  let timer = null, running = null, saving = Promise.resolve();
  const ready = readFile(file, 'utf8').then(text => { const saved = JSON.parse(text); if (saved?.version === 1) state = {...state, ...saved}; })
    .catch(error => { if (error.code !== 'ENOENT') log.error(`Podcast index not loaded: ${error.message}`); });

  function save() {
    saving = saving.then(async () => {
      await mkdir(dir, {recursive: true});
      const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`;
      try { await writeFile(temporary, JSON.stringify(state), {flag: 'wx'}); await rename(temporary, file); }
      catch (error) { await unlink(temporary).catch(() => {}); log.error(`Podcast index not saved: ${error.message}`); }
    });
    return saving;
  }

  async function gather(at) {
    const take = async loader => { try { return await loader(); } catch { return null; } };
    const [alerts, stations, enso, news, rain] = await Promise.all([take(feeds.alerts), take(feeds.stations), take(feeds.enso), take(feeds.news), take(() => loadRain(cities, fetchImpl))]);
    return {alerts, stations, enso, news, rain, now: at};
  }

  // Write, voice and publish one bulletin.
  async function publish(due) {
    const at = now();
    const data = await gather(at);
    const previous = state.facts?.date === due.date ? state.facts : null;
    const script = buildScript({slotId: due.slot.id, previous, ...data});
    const wav = await voice(script.text, config, fetchImpl);
    await mkdir(dir, {recursive: true});
    const wavFile = path.join(dir, `${due.id}.wav`), mp3File = path.join(dir, `${due.id}.mp3`);
    await writeFile(wavFile, wav);
    try { await encode(wavFile, mp3File); } finally { await unlink(wavFile).catch(() => {}); }
    const item = {id: due.id, slot: due.slot.id, date: due.date, title: script.title, text: script.text, seconds: Math.round(wavSeconds(wav)), publishedAt: new Date(at).toISOString(), file: `${due.id}.mp3`};
    state.items = [item, ...state.items.filter(other => other.id !== item.id)];
    state.facts = {date: due.date, ...script.facts};
    delete state.attempts[due.id];
    await prune();
    await save();
    log.log(`Podcast: published ${item.id} (${item.seconds} s).`);
    await Promise.resolve(onPublished(item)).catch(error => log.error(`Podcast hand-off failed: ${error.message}`));
    return item;
  }

  // Bulletins older than KEEP_DAYS go, with their files.
  async function prune() {
    const cutoff = eatDate(now() - KEEP_DAYS * 86400000);
    state.items = state.items.filter(item => item.date > cutoff);
    const keep = new Set(state.items.map(item => item.file));
    for (const name of await readdir(dir).catch(() => [])) if (/\.mp3$/.test(name) && !keep.has(name)) await unlink(path.join(dir, name)).catch(() => {});
  }

  async function tick() {
    if (!config.enabled || state.hold) return null;
    if (running) return running;
    running = (async () => {
      await ready;
      const due = dueSlot(now());
      if (!due || state.items.some(item => item.id === due.id)) return null;
      const tried = state.attempts[due.id];
      if (tried && (tried.count >= MAX_ATTEMPTS || now() - tried.at < RETRY_MS)) return null;
      state.attempts[due.id] = {count: (tried?.count || 0) + 1, at: now()};
      try { return await publish(due); }
      catch (error) { log.error(`Podcast ${due.id} failed (attempt ${state.attempts[due.id].count}): ${error.message}`); await save(); return null; }
    })().finally(() => { running = null; });
    return running;
  }

  const keyMatches = given => {
    if (!statsKey || !given) return false;
    const a = Buffer.from(String(given)), b = Buffer.from(statsKey);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const publicItem = item => ({id: item.id, slot: item.slot, date: item.date, title: item.title, text: item.text, seconds: item.seconds, publishedAt: item.publishedAt, url: `/podcast/${item.file}`});

  async function handle(req, res, url) {
    if (url.pathname !== '/api/podcast' && url.pathname !== '/api/podcast/hold') return false;
    const send = (status, body) => {
      const buffer = Buffer.from(JSON.stringify(body));
      res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buffer.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
      res.end(req.method === 'HEAD' ? undefined : buffer);
      return true;
    };
    await ready;
    if (url.pathname === '/api/podcast') {
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, {error: 'Only GET is supported.'});
      // Bulletins already made stay listenable while new ones are held.
      if (!config.enabled && !state.items.length) return send(200, {enabled: false});
      return send(200, {enabled: config.enabled, hold: state.hold, slots: SLOTS.map(slot => slot.at), items: state.items.slice(0, 6).map(publicItem)});
    }
    // The owner's hold switch: POST {"hold": true|false} with the stats key in X-Stats-Key.
    if (req.method !== 'POST') return send(405, {error: 'Only POST is supported.'});
    if (!keyMatches(req.headers['x-stats-key'])) return send(403, {error: 'The stats key is required.'});
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 1024) return send(413, {error: 'Too large.'}); }
    let hold;
    try { hold = JSON.parse(body).hold; } catch { return send(400, {error: 'Invalid JSON.'}); }
    if (typeof hold !== 'boolean') return send(400, {error: 'Send {"hold": true} or {"hold": false}.'});
    state.hold = hold;
    await save();
    log.log(`Podcast: ${hold ? 'held' : 'resumed'} by the owner.`);
    return send(200, {hold});
  }

  // /podcast/<id>.mp3 -> the file to stream, or null.
  function audioFile(pathname) {
    const match = /^\/podcast\/([\w-]+)\.mp3$/.exec(pathname);
    if (!match || !ID.test(match[1]) || !state.items.some(item => item.id === match[1])) return null;
    return path.join(dir, `${match[1]}.mp3`);
  }

  function start() {
    if (!config.enabled || timer) return;
    const run = () => tick().catch(error => log.error(`Podcast check failed: ${error.message}`));
    setTimeout(run, 90 * 1000).unref?.();
    timer = setInterval(run, CHECK_MS);
    timer.unref?.();
  }

  return {handle, audioFile, tick, publish, start, ready: () => ready, state: () => state};
}

// ---- Command line: write (and, with --voice, voice) one bulletin from the live site's data ------------
//   node work/somalia-flood-watch/podcast.mjs --slot evening            the script, free
//   node work/somalia-flood-watch/podcast.mjs --slot evening --voice    also voice it (Gemini bills per audio second)
// --voice needs GEMINI_API_KEY in the environment or in the file named by ENV_FILE; it is never printed.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
  const slotId = arg('--slot') || 'evening', site = arg('--from') || SITE, at = Date.now();
  const cities = JSON.parse(await readFile(new URL('./dist/cities.json', import.meta.url), 'utf8'));
  const get = async name => { const response = await fetch(`${site}/api/${name}`, {signal: AbortSignal.timeout(90000)}); return response.json(); };
  const take = async promise => { try { return await promise; } catch { return null; } };
  const [alerts, stations, enso, news, rain] = await Promise.all([take(get('alerts')), take(get('stations')), take(get('enso')), take(get('news')), take(loadRain(cities))]);
  const script = buildScript({slotId, now: at, alerts, stations, enso, news, rain});
  console.log(`${script.title}\n${'-'.repeat(60)}\n${script.text}\n${'-'.repeat(60)}\n${script.text.length} characters, ${script.text.split(/\s+/).length} words.`);
  if (args.includes('--voice')) {
    let apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey && process.env.ENV_FILE) apiKey = ((await readFile(process.env.ENV_FILE, 'utf8')).match(/^GEMINI_API_KEY=(.+)$/m)?.[1] || '').trim().replace(/^["']|["']$/g, '');
    if (!apiKey) { console.log('GEMINI_API_KEY is not set (environment or ENV_FILE).'); process.exit(2); }
    const config = {...podcastConfig({...process.env, GEMINI_API_KEY: apiKey}), apiKey};
    const out = path.resolve(arg('--out') || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'outputs', 'podcast'));
    await mkdir(out, {recursive: true});
    const wav = await voice(script.text, config);
    const base = path.join(out, `sample-${eatDate(at)}-${slotId}`);
    await writeFile(`${base}.wav`, wav);
    await writeFile(`${base}.txt`, script.text);
    await toMp3(config.ffmpeg, `${base}.wav`, `${base}.mp3`);
    console.log(`Voiced with ${config.voice} (${config.model}): ${base}.mp3, ${wavSeconds(wav).toFixed(1)} s.`);
  }
}
