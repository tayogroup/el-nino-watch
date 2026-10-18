// Audio bulletins: a short radio-style summary of the El Niño and flood situation three times a day (06:30,
// 12:30 and 18:30 East Africa Time), in Somali and, once the owner approves its wording, in English. Written
// from the site's own feeds by the fixed template below and voiced by Google Gemini (voice Puck). The owner
// approves each language's template once and bulletins then publish on their own; WhatsApp subscribers get
// them only if they opt in, in the language they signed up in. Owner: Somali, 2026-10-16; English, 2026-10-17.
//
// The template's rules: only MOEWR is called official; every figure comes from a feed; a source that is
// down is read as "not available", never as an older figure; when nothing has changed the midday bulletin
// says so instead of repeating itself; news is read only from items in the bulletin's own language, with
// the source named, so nothing is machine-translated.
//
// Switched off until all three hold: the owner has approved the Somali template (APPROVED_TEMPLATE ===
// TEMPLATE_VERSION), GEMINI_API_KEY is set, and PODCAST_ENABLED=1. English bulletins are made only once
// APPROVED_TEMPLATE_EN === TEMPLATE_VERSION_EN as well. Bulletins are kept KEEP_DAYS days in
// <dataDir>/podcast/ as MP3 (ffmpeg turns Gemini's WAV into 48 kbit/s mono, about 0.35 MB a minute).
import {readFile, writeFile, rename, unlink, mkdir, readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const TEMPLATE_VERSION = '2026-10-16';
// The template version the owner approved; anything else, and nothing is voiced or published. Approved by the
// owner on 2026-10-16 after hearing that evening's bulletin voiced by Puck: the wording, the seven tips and the
// voice. Changing the template's words means a new TEMPLATE_VERSION and a new approval.
export const APPROVED_TEMPLATE = '2026-10-16';
// The English template (owner asked for English bulletins on 2026-10-17). Approved by the owner on 2026-10-17
// after hearing that evening's English bulletin voiced by Puck: the wording, the seven tips and the voice.
// Anything else here, and English bulletins are not made (English readers then hear the Somali one).
export const TEMPLATE_VERSION_EN = '2026-10-17';
export const APPROVED_TEMPLATE_EN = '2026-10-17';
export const SLOTS = Object.freeze([
  {id: 'morning', at: '06:30', name: 'subaxa', en: 'morning'},
  {id: 'midday', at: '12:30', name: 'duhurka', en: 'midday'},
  {id: 'evening', at: '18:30', name: 'fiidka', en: 'evening'}
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
// A Somali bulletin's id is "<date>-<slot>"; an English one adds "-en".
const ID = /^(\d{4}-\d{2}-\d{2})-(morning|midday|evening)(-en)?$/;
export const bulletinId = (date, slotId, lang) => `${date}-${slotId}${lang === 'en' ? '-en' : ''}`;

export function podcastConfig(env = process.env) {
  const config = {
    apiKey: String(env.GEMINI_API_KEY || '').trim(),
    on: env.PODCAST_ENABLED === '1',
    model: env.PODCAST_MODEL || 'gemini-3.8-flash-tts',
    voice: env.PODCAST_VOICE || 'Puck',
    ffmpeg: env.FFMPEG || 'ffmpeg',
    approved: APPROVED_TEMPLATE === TEMPLATE_VERSION,
    approvedEn: APPROVED_TEMPLATE_EN === TEMPLATE_VERSION_EN
  };
  config.enabled = !!(config.apiKey && config.on && config.approved);
  // Somali first: it is the site's first language and the approved one.
  config.languages = config.approvedEn ? ['so', 'en'] : ['so'];
  return config;
}

// ---- Words ---------------------------------------------------------------------------------------

export const CITY_SO = {Mogadishu: 'Muqdisho', Hargeisa: 'Hargeysa', Bosaso: 'Boosaaso', Kismayo: 'Kismaayo', Baidoa: 'Baydhabo', Garowe: 'Garoowe',
  Galkayo: 'Gaalkacyo', Dhusamareb: 'Dhuusamarreeb', Burao: 'Burco', Bardera: 'Baardheere', 'Buur Hakaba': 'Buurhakaba', Hudur: 'Xuddur',
  Borama: 'Boorama', Erigavo: 'Ceerigaabo', 'Las Anod': 'Laascaanood', Adado: 'Cadaado'};
export const REGION_SO = {'Woqooyi Galbeed': 'Waqooyi Galbeed', 'Lower Juba': 'Jubbada Hoose', 'Middle Juba': 'Jubbada Dhexe', Hiraan: 'Hiiraan',
  'Middle Shabelle': 'Shabeellaha Dhexe', 'Lower Shabelle': 'Shabeellaha Hoose', Sahil: 'Saaxil'};
const GAUGE_SO = {Bardheere: 'Baardheere', Dollow: 'Doolow', Bualle: "Bu'aale", 'Belet Weyne': 'Beledweyne', 'Bulo Burti': 'Buulobarde', Afgoi: 'Afgooye', Audegle: 'Awdheegle', 'Mahadey Weyne': 'Mahaday'};
const GAUGE_EN = {Bualle: "Bu'aale", 'Belet Weyne': 'Beledweyne'};
const RIVER_SO = {Juba: 'Jubba', Shabelle: 'Shabeelle'};
const sentence = text => { const t = String(text || '').trim().replace(/\s+/g, ' '); return /[.!?]$/.test(t) ? t : `${t}.`; };
// A headline in capitals is read better in sentence case.
const calm = text => (/[a-z]/.test(text) ? text : text.charAt(0) + text.slice(1).toLowerCase());

// One tip per bulletin, in turn. The Somali film tips use the owner-corrected wording of the cholera film.
export const TIPS = Object.freeze([
  'Talo: biyaha la cabbo karkari, ama ku nadiifi kiniinka biyaha sida baakadda ku qoran.',
  'Talo: gacmaha ku dhaq saabuun iyo biyo nadiif ah, ka dib musqusha iyo ka hor cuntada.',
  'Talo: haddii qof shuban biyo ah qabo, isla markiiba bilow daawada O R S, oo u tag xarun caafimaad.',
  'Talo: biyaha nadiifka ah ku kaydi weel nadiif ah oo dabool leh.',
  'Talo: ha dhex marin biyaha fatahaadda, hana ku dhex wadin baabuur. Biyo yar oo socda ayaa qof iyo baabuur qaadi kara.',
  'Talo: xoolaha iyo alaabta muhiimka ah u guuri meel sare ka hor inta aysan biyuhu kicin.',
  'Talo: seexo gogol kaneecada laga ilaaliyo, oo faaruqi weelasha biyaha fadhiya.'
]);
export const TIPS_EN = Object.freeze([
  'Tip: boil drinking water, or treat it with water treatment tablets as the packet says.',
  'Tip: wash your hands with soap and clean water, after the toilet and before eating.',
  'Tip: if someone has watery diarrhoea, start O R S straight away, and go to a health facility.',
  'Tip: keep safe water in a clean container with a lid.',
  'Tip: do not walk or drive through floodwater. A little moving water can carry away a person or a car.',
  'Tip: move livestock and important belongings to higher ground before the water rises.',
  'Tip: sleep under a mosquito net, and empty containers of standing water.'
]);

// Everything the template says, in each language. The Somali is the owner-approved wording, unchanged.
const WORDS = {
  so: {
    days: ['Axad', 'Isniin', 'Talaado', 'Arbaco', 'Khamiis', 'Jimce', 'Sabti'],
    months: ['Janaayo', 'Febraayo', 'Maarso', 'Abriil', 'Maajo', 'Juun', 'Luulyo', 'Agoosto', 'Sebtembar', 'Oktoobar', 'Nofembar', 'Desembar'],
    date: (day, d, month) => `${day}, ${d} ${month}`,
    and: 'iyo', city: name => CITY_SO[name] || name, region: name => REGION_SO[name] || name,
    gauge: name => GAUGE_SO[name] || name, river: name => RIVER_SO[name] || name, metres: value => `${Number(value).toFixed(2)} mitir`,
    open: (slot, date) => `Waa El Nino Watch, warbixinta ${slot.name} ee ${date}. Kani ma aha adeeg digniin rasmi ah.`,
    title: (slot, date) => `Warbixinta ${slot.name}, ${date}`,
    officialDown: 'Digniinaha rasmiga ah ee Wasaaradda Tamarta iyo Kheyraadka Biyaha lama heli karo hadda.',
    officialNone: 'Wasaaradda Tamarta iyo Kheyraadka Biyaha: hadda ma jirto digniin fatahaadeed oo rasmi ah.',
    levels: {warning: 'Digniin fatahaadeed', watch: 'Feejignaan fatahaadeed', advisory: 'Talo fatahaadeed'},
    activated: '; tallaabada hore waa la hawlgeliyay',
    official: parts => `Digniinaha rasmiga ah ee Wasaaradda Tamarta iyo Kheyraadka Biyaha waa kuwan. ${parts}`,
    riversDown: 'Heerarka webiyada Jubba iyo Shabeelle lama heli karo hadda.',
    state: {high: 'oo ka sarreeya heerka sare', moderate: 'oo ka sarreeya heerka dhexdhexaadka ah', near: 'oo ku dhow heerka dhexdhexaadka ah'},
    nearHigh: high => `, kuna dhow heerka sare ee ${high}`,
    gaugeLine: (river, gauge, level, state, near) => `Webiga ${river} ee ${gauge} wuxuu marayaa ${level}, ${state}${near}.`,
    riversRest: 'Cabbirada kale ee webiyada way ka hooseeyaan heerarka khatarta.',
    riversAllBelow: 'Cabbirada webiyada Jubba iyo Shabeelle dhammaantood way ka hooseeyaan heerarka khatarta.',
    rivers: lines => `Webiyada: ${lines}`,
    today: 'maanta', tomorrow: 'berri',
    rainDown: when => `Saadaasha roobka ${when} lama heli karo hadda.`,
    rainNone: when => `Roob xooggan, 10 milimitir ama ka badan, looma filayo ${when} 30-ka magaalo midkoodna.`,
    rainEntry: (name, mm) => `${name} ${mm} milimitir`,
    rain: (when, entries) => `Roobka ${when}: roobka ugu badan waxaa laga filayaa ${entries}. Kani waa saadaal moodeel.`,
    icpac: (count, top) => `Saadaasha toddobaadkan ee ICPAC waxay muujinaysaa roob xooggan ${count} ka mid ah 30-ka magaalo, oo ay ku jiraan ${top}. Taasi waa saadaal moodeel, ma aha digniin rasmi ah.`,
    // NOAA's status, as the clause after "NOAA waxay sheegtay ... in".
    enso: {'El Niño Advisory': 'El Niño uu socdo', 'Final El Niño Advisory': 'El Niño uu dhammaaday', 'El Niño Watch': 'El Niño la filayo',
      'La Niña Advisory': 'La Niña ay socoto', 'La Niña Watch': 'La Niña la filayo'},
    noaa: (d, month, phase) => `NOAA waxay sheegtay ${d} ${month} in ${phase}.`,
    reported: (source, title) => `${source} ayaa sheegtay: ${title}`,
    news: lines => `Warar: ${lines}`,
    unchanged: 'Digniinaha rasmiga ah iyo heerarka webiyada isma beddelin tan iyo subaxdii.',
    tips: TIPS,
    close: 'Raac tilmaamaha maamulka deegaanka iyo SoDMA. Xog dheeraad ah ka hel elninowatch.so. Waa El Nino Watch.'
  },
  en: {
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    date: (day, d, month) => `${day} ${d} ${month}`,
    and: 'and', city: name => name, region: name => name,
    gauge: name => GAUGE_EN[name] || name, river: name => name, metres: value => `${Number(value).toFixed(2)} metres`,
    open: (slot, date) => `This is El Nino Watch, with the ${slot.en} bulletin for ${date}. This is not an official warning service.`,
    title: (slot, date) => `${slot.en.charAt(0).toUpperCase() + slot.en.slice(1)} bulletin, ${date}`,
    officialDown: 'Official warnings from the Ministry of Energy and Water Resources are not available right now.',
    officialNone: 'The Ministry of Energy and Water Resources has no official flood warning in force.',
    levels: {warning: 'Flood warning', watch: 'Flood watch', advisory: 'Flood advisory'},
    activated: '; anticipatory action has been activated',
    official: parts => `Official flood warnings from the Ministry of Energy and Water Resources. ${parts}`,
    riversDown: 'River levels on the Juba and Shabelle are not available right now.',
    state: {high: 'above its high flood level', moderate: 'above its moderate flood level', near: 'close to its moderate flood level'},
    nearHigh: high => `, and close to its high level of ${high}`,
    gaugeLine: (river, gauge, level, state, near) => `The ${river} at ${gauge} is at ${level}, ${state}${near}.`,
    riversRest: 'Other gauges are below their flood levels.',
    riversAllBelow: 'All gauges on the Juba and Shabelle are below their flood levels.',
    rivers: lines => `Rivers: ${lines}`,
    today: 'today', tomorrow: 'tomorrow',
    rainDown: when => `The rain forecast for ${when} is not available right now.`,
    rainNone: when => `No heavy rain, 10 millimetres or more, is expected ${when} in any of the 30 cities.`,
    rainEntry: (name, mm) => `${name}, ${mm} millimetres`,
    rain: (when, entries) => `Rain ${when}: the most rain is expected in ${entries}. This is a model forecast.`,
    icpac: (count, top) => `ICPAC's forecast for this week shows heavy rain in ${count} of the 30 cities, including ${top}. That is a model forecast, not an official warning.`,
    enso: {'El Niño Advisory': 'El Niño is under way', 'Final El Niño Advisory': 'El Niño has ended', 'El Niño Watch': 'El Niño is expected',
      'La Niña Advisory': 'La Niña is under way', 'La Niña Watch': 'La Niña is expected'},
    noaa: (d, month, phase) => `NOAA said on ${d} ${month} that ${phase}.`,
    reported: (source, title) => `${source} reports: ${title}`,
    news: lines => `News: ${lines}`,
    unchanged: 'Official warnings and river levels have not changed since this morning.',
    tips: TIPS_EN,
    close: 'Follow the instructions of local authorities and SoDMA. More at elninowatch.so. This is El Nino Watch.'
  }
};
// "A, B iyo C" / "A, B and C"
const list = (w, items) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${w.and} ${items.at(-1)}`;

// ---- Time ----------------------------------------------------------------------------------------

const eat = ms => new Date(ms + EAT_MS);
export const eatDate = ms => eat(ms).toISOString().slice(0, 10);
const minutes = at => { const [h, m] = at.split(':').map(Number); return h * 60 + m; };
function dateWords(w, ms) {
  const d = eat(ms);
  return w.date(w.days[d.getUTCDay()], d.getUTCDate(), w.months[d.getUTCMonth()]);
}

// The slot due at this moment (within LATE_MS of its time), or null. id: the Somali bulletin's.
export function dueSlot(ms) {
  const d = eat(ms), now = d.getUTCHours() * 60 + d.getUTCMinutes();
  for (const slot of [...SLOTS].reverse()) {
    const at = minutes(slot.at);
    if (now >= at && now < at + LATE_MS / 60000) return {slot, date: eatDate(ms), id: bulletinId(eatDate(ms), slot.id, 'so')};
  }
  return null;
}

// ---- The template --------------------------------------------------------------------------------

function officialSection(w, alerts, now) {
  const moewrUp = alerts?.alerts && (alerts.sources || []).some(source => source.id === 'moewr' && source.available !== false);
  if (!moewrUp) return {text: w.officialDown, facts: null};
  const active = alerts.alerts.filter(alert => alert.sourceId === 'moewr' && alert.status === 'active' && Date.parse(alert.endsAt) > now && alert.scope?.region);
  if (!active.length) return {text: w.officialNone, facts: []};
  const groups = [['warning', true], ['warning', false], ['watch', null], ['advisory', null]];
  const parts = [];
  for (const [level, aa] of groups) {
    const regions = [...new Set(active.filter(alert => alert.level === level && (aa === null || !!alert.aaActive === aa)).map(alert => w.region(alert.scope.region)))].sort();
    if (regions.length) parts.push(`${w.levels[level]}: ${list(w, regions)}${level === 'warning' && aa ? w.activated : ''}.`);
  }
  const facts = active.map(alert => `${alert.scope.region}|${alert.level}|${alert.aaActive ? 1 : 0}`).sort();
  return {text: w.official(parts.join(' ')), facts};
}

function riverSection(w, stations, now) {
  const fresh = (stations?.stations || []).filter(s => typeof s.levelM === 'number' && typeof s.moderateM === 'number'
    && Date.parse(s.observedAt) > now - 2 * 86400000);
  if (!stations?.available || !fresh.length) return {text: w.riversDown, facts: null};
  const state = s => s.levelM >= (s.highM ?? Infinity) ? 'high' : s.levelM >= s.moderateM ? 'moderate' : s.levelM >= 0.9 * s.moderateM ? 'near' : 'below';
  const notable = fresh.filter(s => state(s) !== 'below').sort((a, b) => b.levelM / b.moderateM - a.levelM / a.moderateM);
  const lines = notable.map(s => {
    // Gauges read to the centimetre: 5.17 against a 5.25 mark must not both round to 5.2.
    const near = state(s) === 'moderate' && typeof s.highM === 'number' && s.levelM >= 0.95 * s.highM ? w.nearHigh(w.metres(s.highM)) : '';
    return w.gaugeLine(w.river(s.river), w.gauge(s.name), w.metres(s.levelM), w.state[state(s)], near);
  });
  return {text: w.rivers([...lines, notable.length ? w.riversRest : w.riversAllBelow].join(' ')), facts: fresh.map(s => `${s.name}|${state(s)}`).sort()};
}

// rain: [{city, days: [{date, mm}]}] from Open-Meteo. The target day: today, or tomorrow in the evening.
function rainSection(w, rain, now, slotId) {
  const offset = slotId === 'evening' ? 1 : 0, when = offset ? w.tomorrow : w.today;
  const date = eatDate(now + offset * 86400000);
  const values = (rain || []).map(entry => ({name: entry.city, mm: entry.days.find(day => day.date === date)?.mm})).filter(entry => typeof entry.mm === 'number');
  if (values.length < 15) return w.rainDown(when);
  const heavy = values.filter(entry => entry.mm >= 10).sort((a, b) => b.mm - a.mm).slice(0, 3);
  if (!heavy.length) return w.rainNone(when);
  return w.rain(when, list(w, heavy.map(entry => w.rainEntry(w.city(entry.name), Math.round(entry.mm)))));
}

function icpacSection(w, alerts, now) {
  const active = (alerts?.alerts || []).filter(alert => alert.sourceId === 'icpac' && Date.parse(alert.endsAt) > now);
  if (!active.length) return '';
  const rank = {extreme: 3, 'very-heavy': 2, heavy: 1};
  const cities = [...new Map(active.flatMap(alert => (alert.scope?.cities || []).map(name => [name, rank[alert.category] || 0]))).entries()];
  const top = cities.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => w.city(name));
  return w.icpac(cities.length, list(w, top));
}

// NOAA's status, then news items in the bulletin's own language (never translated), with the source named.
function newsLines(w, lang, enso, news, now) {
  const lines = [];
  const phase = w.enso[enso?.alertStatus || enso?.phase];
  const [, month, day] = String(enso?.issuedAt || '').slice(0, 10).split('-').map(Number);
  if (enso?.available !== false && phase && month && day) lines.push(w.noaa(day, w.months[month - 1], phase));
  for (const item of news?.items || []) {
    if (item.language !== lang || item.group === 'app' || !item.title) continue;
    if (!(Date.parse(item.publishedAt) > now - 3 * 86400000)) continue;
    lines.push(w.reported(item.source, sentence(calm(item.title))));
  }
  return lines;
}

const tipFor = (w, ms, slotId) => w.tips[(Math.floor((ms + EAT_MS) / 86400000) * 3 + SLOTS.findIndex(slot => slot.id === slotId)) % w.tips.length];

// The bulletin's words, in Somali (the default) or English. previous: the facts of today's last bulletin,
// for the midday "what changed".
export function buildScript({slotId, now, alerts, stations, enso, news, rain, previous = null, lang = 'so'}) {
  const slot = SLOTS.find(item => item.id === slotId);
  if (!slot) throw new Error('Unknown slot.');
  const w = WORDS[lang === 'en' ? 'en' : 'so'], date = dateWords(w, now);
  const official = officialSection(w, alerts, now), rivers = riverSection(w, stations, now);
  const parts = [w.open(slot, date)];
  if (slotId === 'midday' && previous && official.facts && rivers.facts
    && JSON.stringify(official.facts) === JSON.stringify(previous.official) && JSON.stringify(rivers.facts) === JSON.stringify(previous.rivers)) {
    parts.push(w.unchanged);
  } else {
    parts.push(official.text, rivers.text);
  }
  if (slotId !== 'midday') parts.push(rainSection(w, rain, now, slotId));
  if (slotId === 'evening') { const icpac = icpacSection(w, alerts, now); if (icpac) parts.push(icpac); }
  const items = newsLines(w, lang === 'en' ? 'en' : 'so', enso, news, now).slice(0, slotId === 'evening' ? 2 : slotId === 'midday' ? 1 : 0);
  if (items.length) parts.push(w.news(items.join(' ')));
  parts.push(tipFor(w, now, slotId));
  parts.push(w.close);
  return {text: parts.join('\n\n'), title: w.title(slot, date), facts: {official: official.facts, rivers: rivers.facts}};
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

// ---- The podcast feed ----------------------------------------------------------------------------

const xmlEscape = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[c]));
export const FEEDS = Object.freeze({so: Object.freeze({
  path: '/podcast.xml', language: 'so',
  title: 'El Nino Watch: Warbixinta codka',
  description: 'Warbixin gaaban oo Af-Soomaali ah oo ku saabsan El Niño iyo fatahaadda Soomaaliya, saddex jeer maalintii (06:30, 12:30 iyo 18:30 saacadda Bariga Afrika). Ma aha digniin rasmi ah; digniinaha rasmiga ah waxay ka yimaadaan MOEWR. A short Somali-language bulletin on El Niño and flooding in Somalia, three times a day. Not an official warning.',
  owner: 'Mandek Consulting', email: 'contact@mandekconsulting.com', cover: `${SITE}/podcast-cover.jpg`
}), en: Object.freeze({
  path: '/podcast-en.xml', language: 'en',
  title: 'El Nino Watch: Audio bulletin',
  description: 'A short English-language bulletin on El Niño and flooding in Somalia, three times a day (06:30, 12:30 and 18:30 East Africa Time): official flood warnings, river levels, rain forecasts and news. Not an official warning service; official warnings come from MOEWR. A Somali-language version is at https://elninowatch.so/podcast.xml.',
  owner: 'Mandek Consulting', email: 'contact@mandekconsulting.com', cover: `${SITE}/podcast-cover-en.jpg`
})});
export const FEED = FEEDS.so;
export function buildFeed(items, sizes = [], lang = 'so') {
  const FEED = FEEDS[lang === 'en' ? 'en' : 'so'];
  const entry = (item, i) => `<item><title>${xmlEscape(item.title)}</title><description>${xmlEscape(item.text)}</description>`
    + `<enclosure url="${SITE}/podcast/${xmlEscape(item.file)}" length="${Number(sizes[i]) || 0}" type="audio/mpeg"/>`
    + `<guid isPermaLink="false">elninowatch-${xmlEscape(item.id)}</guid><pubDate>${new Date(item.publishedAt).toUTCString()}</pubDate>`
    + `<itunes:duration>${Math.round(Number(item.seconds) || 0)}</itunes:duration><itunes:explicit>false</itunes:explicit></item>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom"><channel>`
    + `<title>${xmlEscape(FEED.title)}</title><link>${SITE}/#podcast</link><atom:link href="${SITE}${FEED.path}" rel="self" type="application/rss+xml"/>`
    + `<language>${FEED.language}</language><description>${xmlEscape(FEED.description)}</description><copyright>El Nino Watch</copyright>`
    + `<itunes:author>El Nino Watch</itunes:author><itunes:owner><itunes:name>${xmlEscape(FEED.owner)}</itunes:name><itunes:email>${xmlEscape(FEED.email)}</itunes:email></itunes:owner>`
    + `<itunes:image href="${FEED.cover}"/><image><url>${FEED.cover}</url><title>${xmlEscape(FEED.title)}</title><link>${SITE}/#podcast</link></image>`
    + `<itunes:category text="News"><itunes:category text="Daily News"/></itunes:category><itunes:explicit>false</itunes:explicit><itunes:type>episodic</itunes:type>`
    + (items[0] ? `<lastBuildDate>${new Date(items[0].publishedAt).toUTCString()}</lastBuildDate>` : '')
    + items.map(entry).join('') + `</channel></rss>\n`;
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

  // What a slot's bulletin compares with: today's last bulletin from an EARLIER slot. Once one language of
  // the slot is published, state.facts is that slot's own, so the next language takes factsBefore: otherwise
  // the English midday compared the midday with itself and always said nothing had changed (17 October 2026:
  // Jowhar fell from 5.17 to 4.90 m, the Somali read it, the English said "not changed").
  function previousFacts(due) {
    const facts = state.facts;
    if (!facts || facts.date !== due.date) return null;
    if (facts.slot !== due.slot.id) return facts;
    return state.factsBefore?.date === due.date ? state.factsBefore : null;
  }

  const languageOf = item => item.lang || 'so';
  const languages = () => config.languages || ['so'];
  // Write, voice and publish one bulletin, in one language. data: the feeds, gathered once for the slot.
  async function publish(due, lang = 'so', data = null) {
    const at = now(), id = bulletinId(due.date, due.slot.id, lang);
    data ||= await gather(at);
    const script = buildScript({slotId: due.slot.id, previous: previousFacts(due), lang, ...data});
    const wav = await voice(script.text, config, fetchImpl);
    await mkdir(dir, {recursive: true});
    const wavFile = path.join(dir, `${id}.wav`), mp3File = path.join(dir, `${id}.mp3`);
    await writeFile(wavFile, wav);
    try { await encode(wavFile, mp3File); } finally { await unlink(wavFile).catch(() => {}); }
    // bytes: the podcast feed's enclosure length.
    const item = {id, lang, slot: due.slot.id, date: due.date, title: script.title, text: script.text, seconds: Math.round(wavSeconds(wav)), publishedAt: new Date(at).toISOString(), file: `${id}.mp3`, bytes: (await stat(mp3File)).size};
    state.items = [item, ...state.items.filter(other => other.id !== item.id)];
    // The facts are the same in both languages; the midday "what changed" compares against them. The first
    // language of a slot moves the earlier slot's facts to factsBefore, so the second compares with the same.
    if (state.facts?.slot !== due.slot.id || state.facts?.date !== due.date) state.factsBefore = state.facts;
    state.facts = {date: due.date, slot: due.slot.id, ...script.facts};
    delete state.attempts[id];
    await prune();
    await save();
    log.log(`Podcast: published ${item.id} (${item.seconds} s).`);
    await Promise.resolve(onPublished(item, {languages: languages()})).catch(error => log.error(`Podcast hand-off failed: ${error.message}`));
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
      if (!due) return null;
      let data = null;
      const made = [];
      for (const lang of languages()) {
        const id = bulletinId(due.date, due.slot.id, lang);
        if (state.items.some(item => item.id === id)) continue;
        const tried = state.attempts[id];
        if (tried && (tried.count >= MAX_ATTEMPTS || now() - tried.at < RETRY_MS)) continue;
        state.attempts[id] = {count: (tried?.count || 0) + 1, at: now()};
        try { data ||= await gather(now()); made.push(await publish(due, lang, data)); }
        catch (error) { log.error(`Podcast ${id} failed (attempt ${state.attempts[id].count}): ${error.message}`); await save(); }
      }
      return made[0] || null;
    })().finally(() => { running = null; });
    return running;
  }

  const keyMatches = given => {
    if (!statsKey || !given) return false;
    const a = Buffer.from(String(given)), b = Buffer.from(statsKey);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const publicItem = item => ({id: item.id, lang: languageOf(item), slot: item.slot, date: item.date, title: item.title, text: item.text, seconds: item.seconds, publishedAt: item.publishedAt, url: `/podcast/${item.file}`});

  async function handle(req, res, url) {
    if (url.pathname === FEEDS.so.path) return sendFeed(req, res, 'so');
    if (url.pathname === FEEDS.en.path) return sendFeed(req, res, 'en');
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
      const recent = ['so', 'en'].flatMap(lang => state.items.filter(item => languageOf(item) === lang).slice(0, 6));
      return send(200, {enabled: config.enabled, hold: state.hold, languages: languages(), slots: SLOTS.map(slot => slot.at), items: state.items.filter(item => recent.includes(item)).map(publicItem)});
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

  // The podcast feed (RSS 2.0 with Apple's podcast tags) at /podcast.xml, for Spotify, Apple Podcasts and
  // podcast apps: the bulletins of the last KEEP_DAYS days, newest first. Owner, 2026-10-17.
  async function sendFeed(req, res, lang) {
    await ready;
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, {'Allow': 'GET, HEAD'}); res.end(); return true; }
    const items = state.items.filter(item => languageOf(item) === lang);
    if (!items.length && !(config.enabled && languages().includes(lang))) { res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'}); res.end(req.method === 'HEAD' ? undefined : 'No audio bulletins.'); return true; }
    const sizes = await Promise.all(items.map(async item => item.bytes ?? (await stat(path.join(dir, item.file)).catch(() => null))?.size ?? 0));
    const xml = buildFeed(items, sizes, lang);
    const buffer = Buffer.from(xml);
    res.writeHead(200, {'Content-Type': 'application/rss+xml; charset=utf-8', 'Content-Length': buffer.length, 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : buffer);
    return true;
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
//   add --lang en for the English bulletin
// --voice needs GEMINI_API_KEY in the environment or in the file named by ENV_FILE; it is never printed.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
  const slotId = arg('--slot') || 'evening', site = arg('--from') || SITE, at = Date.now(), lang = arg('--lang') === 'en' ? 'en' : 'so';
  const cities = JSON.parse(await readFile(new URL('./dist/cities.json', import.meta.url), 'utf8'));
  const get = async name => { const response = await fetch(`${site}/api/${name}`, {signal: AbortSignal.timeout(90000)}); return response.json(); };
  const take = async promise => { try { return await promise; } catch { return null; } };
  const [alerts, stations, enso, news, rain] = await Promise.all([take(get('alerts')), take(get('stations')), take(get('enso')), take(get('news')), take(loadRain(cities))]);
  const script = buildScript({slotId, now: at, alerts, stations, enso, news, rain, lang});
  console.log(`${script.title}\n${'-'.repeat(60)}\n${script.text}\n${'-'.repeat(60)}\n${script.text.length} characters, ${script.text.split(/\s+/).length} words.`);
  if (args.includes('--voice')) {
    let apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey && process.env.ENV_FILE) apiKey = ((await readFile(process.env.ENV_FILE, 'utf8')).match(/^GEMINI_API_KEY=(.+)$/m)?.[1] || '').trim().replace(/^["']|["']$/g, '');
    if (!apiKey) { console.log('GEMINI_API_KEY is not set (environment or ENV_FILE).'); process.exit(2); }
    const config = {...podcastConfig({...process.env, GEMINI_API_KEY: apiKey}), apiKey};
    const out = path.resolve(arg('--out') || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'outputs', 'podcast'));
    await mkdir(out, {recursive: true});
    const wav = await voice(script.text, config);
    const base = path.join(out, `sample-${bulletinId(eatDate(at), slotId, lang)}`);
    await writeFile(`${base}.wav`, wav);
    await writeFile(`${base}.txt`, script.text);
    await toMp3(config.ffmpeg, `${base}.wav`, `${base}.mp3`);
    console.log(`Voiced with ${config.voice} (${config.model}): ${base}.mp3, ${wavSeconds(wav).toFixed(1)} s.`);
  }
}
