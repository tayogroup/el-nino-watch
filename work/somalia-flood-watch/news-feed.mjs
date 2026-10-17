// El Niño news flash for Somalia: the app's own flashes (NOAA's El Niño status, this week's ICPAC
// heavy-rainfall forecast) followed by recent items from Somali and international organisations.
//
//   SoDMA        Somali Disaster Management Agency - the agency's own news feed (Somali).
//   ICRC         the ICRC's own news feed (Somalia items) and a search of its sites.
//   FAO SWALIM   FAO's Somalia water and land unit - only flood, rain and El Niño items.
//   Google News  two searches: "El Niño" Somalia, and Somalia floods/El Niño naming UN and
//                non-UN humanitarian organisations. Headlines link to the source via Google News.
//   ReliefWeb    UN OCHA's humanitarian reports for Somalia - only once RELIEFWEB_APPNAME is set,
//                because the API refuses an appname ReliefWeb has not approved.
//
// Headlines are shown as published; each item is labelled by who published it (government, UN,
// humanitarian organisation or media). Nothing here is an official warning.
const UA = 'Mozilla/5.0 (compatible; ElNinoWatch/1.0; +https://elninowatch.so)';
const DAY = 86400000;
const MAX_ITEMS = 30;

const googleNews = query => `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
const HUMANITARIAN_NAMES = ['WFP', 'UNICEF', 'OCHA', 'IOM', 'UNHCR', 'FAO', 'WHO', 'ICRC', 'IFRC', '"Red Crescent"', 'NRC', '"Save the Children"', '"Mercy Corps"', '"International Rescue Committee"', 'CARE', 'Oxfam', '"World Vision"'];
export const NEWS_SOURCES = Object.freeze({
  sodma: {name: 'SoDMA', url: 'https://sodma.gov.so/feed/', site: 'https://sodma.gov.so/', group: 'government', language: 'so', maxAgeDays: 30, limit: 6, keep: /\b(el ni[nñ]o|fatahaad|daad|roob|webi|digniin|abaar|aafo|flood|rain(s|fall)?\b|deyr)/i},
  swalim: {name: 'FAO SWALIM', url: 'https://www.faoswalim.org/rss.xml', site: 'https://www.faoswalim.org/', group: 'un', language: 'en', maxAgeDays: 60, limit: 4, keep: /\b(el ni[nñ]o|flood|rain(s|fall)?\b|deyr|river|fatahaad|roob)/i},
  // ICRC, at the owner's request (2026-10-15): its own worldwide news feed, Somalia items only (the
  // feed holds about ten days), and a search of ICRC's sites and the Somali Red Crescent for older ones.
  icrc: {name: 'ICRC', url: 'https://www.icrc.org/en/rss/news', site: 'https://www.icrc.org/', group: 'humanitarian', language: 'en', maxAgeDays: 60, limit: 4, keep: /somali|mogadishu/i},
  googleIcrc: {name: 'Google News', url: googleNews('Somalia (site:icrc.org OR site:icrcnewsroom.org OR "Somali Red Crescent") when:60d'), site: 'https://news.google.com/', group: null, language: 'en', maxAgeDays: 60, limit: 4, keep: /somali|mogadishu/i},
  googleElNino: {name: 'Google News', url: googleNews('"El Niño" Somalia when:30d'), site: 'https://news.google.com/', group: null, language: 'en', maxAgeDays: 30, limit: 10, keep: /somali|mogadishu|el ni[nñ]o/i},
  googleHumanitarian: {name: 'Google News', url: googleNews(`Somalia (flood OR floods OR "El Niño" OR Deyr) (${HUMANITARIAN_NAMES.join(' OR ')}) when:30d`), site: 'https://news.google.com/', group: null, language: 'en', maxAgeDays: 30, limit: 10, keep: /somali|mogadishu/i}
});
export const RELIEFWEB_SITE = 'https://reliefweb.int/country/som';

// Outlets left out of the Google News searches, by web address, with the reason. Owner's request,
// 2026-10-15: no advocacy groups presented as news, AI-written content sites, aggregators that only
// re-post other outlets' stories, or outlets with no Somalia beat that a keyword search pulls in.
export const EXCLUDED_OUTLETS = Object.freeze([
  ['genocidewatch.com', 'advocacy group, not a news outlet'],
  ['wansom.ai', 'AI-written content site'],
  ['yahoo.com', 'aggregator re-posting other outlets'],
  ['msn.com', 'aggregator re-posting other outlets'],
  ['nuffoodsspectrum.asia', 'food-industry trade publication, off-topic'],
  ['examinerlive.co.uk', 'UK local news (Yorkshire Live), off-topic'],
  ['winnmediaskn.com', 'Caribbean local radio, off-topic'],
  ['myanmaritv.com', 'Myanmar television, off-topic'],
  ['sonna.so', "Somali National News Agency, left out at the owner's request"],
  ['centralnews.co.za', "Central News South Africa, left out at the owner's request"],
  ['gazettengr.com', "Peoples Gazette Nigeria, left out at the owner's request"],
  ['dawan.africa', "Dawan Africa, left out at the owner's request"],
  // Reviewed in one pass, 2026-10-15, against every publisher the searches had returned: kept only
  // outlets with their own reporting on Somalia or an established international or humanitarian record.
  ['somaliatoday.com', 'rewrites other organisations\' releases, which appear first-hand'],
  ['newvision.co.ug', 'Ugandan paper without its own Somalia reporting, republishes agency copy'],
  ['telesurenglish.net', 'Latin American state broadcaster with no Somalia beat'],
  ['middleeastmonitor.com', 'advocacy-leaning outlet with no Somalia beat'],
  // Known aggregators and content farms, left out before they appear.
  ['devdiscourse.com', 'aggregator and machine-written content'],
  ['latestly.com', 'aggregator re-posting other outlets'],
  ['headtopics.com', 'aggregator re-posting other outlets'],
  ['newsbreak.com', 'aggregator re-posting other outlets'],
  ['biztoc.com', 'aggregator re-posting other outlets'],
  ['ground.news', 'aggregator re-posting other outlets']
]);
// No meeting or event announcements (owner, 2026-10-15): the bar carries warnings, forecasts and
// news about conditions, not who met whom. Matched on the headline, in Somali and English, from
// the start of a word so Somali endings still match ("shirweynaha", "tababarka").
const EVENT_WORDS = /\b(shir|kulan|kala hadl|la kulm|qaabil|booqa|tababar|aqoon[- ]?isweydaarsi|wacyigelin|meertad|munaasabad|xaflad|daahfur|furitaan|meeting|meets\b|met with|conference|summit|workshop|training|trains?\b|trained\b|forum|symposium|webinar|seminar|roundtable|round-table|consultation|ceremony|visit|delegation|courtesy call|panel discussion)/i;
export const isEventAnnouncement = title => EVENT_WORDS.test(String(title || ''));
export function excludedOutlet(sourceUrl) {
  let host = '';
  try { host = new URL(sourceUrl).hostname.toLowerCase(); } catch { return null; }
  return EXCLUDED_OUTLETS.find(([domain]) => host === domain || host.endsWith('.' + domain)) || null;
}

// Who published an item, from its source name: UN bodies, other humanitarian organisations,
// governments, and everything else as media.
const UN = /\b(united nations|un news|un media|ocha|unocha|world food programme|wfp|unicef|unhcr|iom|international organization for migration|fao|food and agriculture organization|who|world health organization|undp|unfpa|reliefweb|un somalia|swalim)\b/i;
const HUMANITARIAN = /\b(icrc|icrcnewsroom|red cross|red crescent|ifrc|norwegian refugee council|nrc|save the children|international rescue committee|rescue\.org|mercy corps|care international|oxfam|world vision|concern worldwide|action against hunger|médecins sans frontières|msf|islamic relief|climate centre|gavi)\b/i;
const GOVERNMENT = /\b(gov\.uk|government|ministry|sodma|disaster management agency|embassy)\b/i;
export function classify(sourceName) {
  const name = String(sourceName || '');
  return UN.test(name) ? 'un' : HUMANITARIAN.test(name) ? 'humanitarian' : GOVERNMENT.test(name) ? 'government' : 'media';
}

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
export function plainText(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => code[0] === '#' ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))) : ENTITIES[code.toLowerCase()] ?? match)
    // SoDMA writes headlines in "mathematical bold" letters; NFKC turns them back into plain text.
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}
const httpsUrl = value => { try { const url = new URL(String(value || '').trim()); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null; } catch { return null; } };

export function parseRss(xml) {
  return [...String(xml).matchAll(/<item[\s>][\s\S]*?<\/item>/g)].map(([item]) => {
    const field = tag => item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))?.[1] ?? '';
    const sourceTag = item.match(/<source(?:\s+url="([^"]*)")?[^>]*>([\s\S]*?)<\/source>/i);
    return {title: plainText(field('title')), link: httpsUrl(plainText(field('link'))), date: Date.parse(plainText(field('pubDate'))), sourceName: sourceTag ? plainText(sourceTag[2]) : '', sourceUrl: sourceTag ? httpsUrl(sourceTag[1]) : null};
  });
}

// One source's recent, relevant items, ready to show.
export function itemsFrom(key, entries, now = Date.now()) {
  const source = NEWS_SOURCES[key];
  // Page titles such as "Details | FAO in Somalia" or "Frequently asked questions: ..." are not headlines.
  return entries.filter(entry => entry.title && !/^(details|frequently asked questions|faq)\b/i.test(entry.title) && entry.link && !excludedOutlet(entry.sourceUrl) && !isEventAnnouncement(entry.title) && Number.isFinite(entry.date) && entry.date <= now + DAY && now - entry.date <= source.maxAgeDays * DAY && (!source.keep || source.keep.test(entry.title)))
    .map(entry => {
      // ICRC's newsroom is ICRC.
      const publisher = /^(www\.)?icrcnewsroom\.org$/i.test(entry.sourceName) ? 'ICRC' : entry.sourceName || source.name;
      // Google News appends " - Publisher" to every headline.
      const title = entry.sourceName && entry.title.endsWith(` - ${entry.sourceName}`) ? entry.title.slice(0, -(entry.sourceName.length + 3)).trim() : entry.title;
      return {kind: 'news', feed: key, title, url: entry.link, publishedAt: new Date(entry.date).toISOString(), source: publisher, group: source.group || classify(publisher), language: source.language};
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, source.limit);
}

// The same story often arrives from several outlets or both searches: keep the newest copy.
const sameStory = title => title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
export function merge(lists) {
  const seen = new Set(), merged = [];
  for (const item of lists.flat().sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))) {
    const key = sameStory(item.title);
    if (!key || seen.has(key)) continue;
    seen.add(key); merged.push(item);
  }
  return merged.slice(0, MAX_ITEMS);
}

// The app's own flashes, from feeds the server already reads.
// A standing pointer to the public health alert at the bottom of the Alerts tab (owner, 2026-10-16).
// It is added after the outage check in loadNews, so it never hides that no news source answered.
export const HEALTH_FLASH = Object.freeze({kind: 'app', key: 'health', label: 'Public health · WHO guidance', title: 'Flooding raises the risk of cholera, malaria and dengue: what to do', url: '#health-alert', publishedAt: null, source: 'WHO', group: 'app', language: 'en'});

// And to the cholera film in that alert (owner, 2026-10-16), which plays in the reader's language.
export const FILM_FLASH = Object.freeze({kind: 'app', key: 'film', label: 'Film · Cholera', title: 'Watch: how to protect your family from cholera', url: '#health-film', publishedAt: null, source: 'El Nino Watch', group: 'app', language: 'en'});

// And to the videos from the field on the home page (owner, 2026-10-17): Cabudwaaq flooding, the Xingod sand dam.
// Hidden for now (owner, 2026-10-17): to show them again, set this true, and remove `hidden` from #field-videos and its footer link.
export const FIELD_VIDEOS_SHOWN = false;
export const FIELD_FLASH = Object.freeze({kind: 'app', key: 'field', label: 'Videos from the field', title: 'Watch: flooding in Cabudwaaq, and rain filling the Xingod sand dam', url: '#field-videos', publishedAt: null, source: 'El Nino Watch', group: 'app', language: 'en'});

// And to the malaria, dysentery and typhoid, and hepatitis A and E films on the Diseases tab (owner, 2026-10-17).
export const FILMS_FLASH = Object.freeze({kind: 'app', key: 'films', label: 'Films · Health', title: 'Watch: new films on malaria, dysentery and typhoid, and hepatitis', url: '#malaria-film', publishedAt: null, source: 'El Nino Watch', group: 'app', language: 'en'});

// And to the Somali audio bulletin first on the home page (owner, 2026-10-17), only while bulletins are on.
export const PODCAST_FLASH = Object.freeze({kind: 'app', key: 'podcast', label: 'Audio bulletin', title: 'Listen: El Niño and flood news, three times a day', url: '#podcast', publishedAt: null, source: 'El Nino Watch', group: 'app', language: 'en'});

export function appItems({enso, alerts} = {}) {
  const items = [];
  if (enso?.available && (enso.alertStatus || enso.synopsis)) {
    items.push({kind: 'app', key: 'enso', label: 'El Niño status · NOAA', title: [enso.alertStatus, enso.synopsis].filter(Boolean).join(': '), url: enso.sourceUrl || null, publishedAt: enso.issuedAt || null, source: 'NOAA Climate Prediction Center', group: 'app', language: 'en'});
  }
  const icpac = (alerts?.sources || []).find(source => source.id === 'icpac');
  const icpacAlerts = (alerts?.alerts || []).filter(alert => alert.sourceId === 'icpac' || alert.basis === 'regional-forecast');
  if (alerts?.available && icpac?.available && icpac.forecast?.weekLabel) {
    const cities = new Set(icpacAlerts.flatMap(alert => alert.scope?.cities || []));
    items.push({kind: 'app', key: 'icpac', label: 'Rainfall forecast · ICPAC', title: `${cities.size} of 30 cities have a heavy-rainfall forecast for ${icpac.forecast.weekLabel}`, url: '#tab=alerts', publishedAt: icpac.fetchedAt || null, source: 'ICPAC', group: 'app', language: 'en'});
  }
  return items;
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url, {headers: {'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, application/json;q=0.9'}, signal: AbortSignal.timeout(20000)});
  const text = await response.text();
  // FAO SWALIM answers its feed with HTTP 500 and a complete RSS body; accept a body that is a feed.
  if (!response.ok && !/<rss[\s>]|<item[\s>]/i.test(text)) throw new Error(`HTTP ${response.status}`);
  return text;
}

async function reliefWeb(appname, fetchImpl, now) {
  const since = new Date(now - 30 * DAY).toISOString().slice(0, 10);
  const body = {limit: 10, profile: 'list', preset: 'latest', fields: {include: ['title', 'url_alias', 'date.created', 'source.shortname', 'source.name']},
    query: {value: '"El Nino" OR "El Niño" OR flood OR floods OR Deyr', operator: 'OR'},
    filter: {operator: 'AND', conditions: [{field: 'primary_country.iso3', value: 'som'}, {field: 'date.created', value: {from: `${since}T00:00:00+00:00`}}]}};
  const response = await fetchImpl(`https://api.reliefweb.int/v2/reports?appname=${encodeURIComponent(appname)}`, {method: 'POST', headers: {'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return (data.data || []).map(({fields = {}}) => {
    const publisher = fields.source?.[0]?.shortname || fields.source?.[0]?.name || 'ReliefWeb';
    return {kind: 'news', feed: 'reliefweb', title: plainText(fields.title), url: httpsUrl(fields.url_alias), publishedAt: fields.date?.created ? new Date(fields.date.created).toISOString() : null, source: publisher, group: classify(publisher) === 'media' ? 'humanitarian' : classify(publisher), language: 'en'};
  }).filter(item => item.title && item.url && item.publishedAt && !isEventAnnouncement(item.title));
}

export async function loadNews({app = {}, fetchImpl = fetch, now = Date.now(), reliefWebAppname = process.env.RELIEFWEB_APPNAME || ''} = {}) {
  const status = [], lists = [];
  await Promise.all(Object.keys(NEWS_SOURCES).map(async key => {
    try {
      const items = itemsFrom(key, parseRss(await fetchText(NEWS_SOURCES[key].url, fetchImpl)), now);
      lists.push(items); status.push({id: key, available: true, items: items.length});
    } catch (error) { status.push({id: key, available: false, error: error.message}); }
  }));
  if (reliefWebAppname) {
    try { const items = await reliefWeb(reliefWebAppname, fetchImpl, now); lists.push(items); status.push({id: 'reliefweb', available: true, items: items.length}); }
    catch (error) { status.push({id: 'reliefweb', available: false, error: error.message}); }
  } else status.push({id: 'reliefweb', available: false, error: 'Not enabled: RELIEFWEB_APPNAME is not set.'});
  const news = merge(lists), flashes = appItems(app);
  if (!news.length && !flashes.length) throw new Error('No news source answered.');
  return {items: [...flashes, ...(app.podcast ? [PODCAST_FLASH] : []), ...(FIELD_VIDEOS_SHOWN ? [FIELD_FLASH] : []), HEALTH_FLASH, FILM_FLASH, FILMS_FLASH, ...news], sources: status.sort((a, b) => a.id.localeCompare(b.id)), note: 'Headlines are shown as published by each organisation or outlet. Nothing here is an official warning.'};
}
