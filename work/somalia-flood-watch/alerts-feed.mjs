// Keyless official CAP warnings and separately labelled GDACS event monitoring.
// CAP authority: https://alertingauthority.wmo.int/authorities.php?recId=339
// GDACS API: https://gdacs.org/Documents/2025/GDACS_API_quickstart_v1.pdf
export const ALERT_SOURCES = Object.freeze({
  snma: 'https://meteosomalia.so/api/cap/rss.xml',
  snmaAuthority: 'https://alertingauthority.wmo.int/authorities.php?recId=339',
  gdacs: 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH'
});
const DAY = 86400000;

function safeUrl(value, hosts) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || !hosts.includes(url.hostname.toLowerCase())) return null;
    return url.href;
  } catch { return null; }
}

function plain(value) {
  return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
      if (entity[0] === '#') {
        const value = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
      }
      return ({amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' '})[entity.toLowerCase()];
    }).replace(/\s+/g, ' ').trim();
}

function xmlCheck(xml) {
  if (typeof xml !== 'string' || xml.length > 2_000_000) throw new Error('Warning XML response is invalid or too large.');
  // The parser does not resolve entities; reject DTD/entity declarations entirely.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Warning XML contains unsupported declarations.');
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

function sections(xml, tag) {
  const expression = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${tag}\\s*>`, 'gi');
  return [...xml.matchAll(expression)].map(match => match[1]);
}
const tagText = (xml, tag) => plain(sections(xml, tag)[0] || '');

function isoDate(value, {gdacs = false, end = false, cap = false} = {}) {
  if (!value || typeof value !== 'string') return null;
  let label = value.trim();
  if (cap && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(label)) return null;
  if (gdacs && /^\d{4}-\d\d-\d\d$/.test(label)) label += end ? 'T23:59:59.999Z' : 'T00:00:00Z';
  // GDACS returns UTC ISO values without the Z. Do not apply the host timezone.
  if (gdacs && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?$/.test(label)) label += 'Z';
  const parsed = Date.parse(label);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function parseCapRss(xml) {
  const clean = xmlCheck(xml);
  if (!/<rss\b/i.test(clean) || !/<channel\b/i.test(clean) || !/<\/rss\s*>/i.test(clean)) throw new Error('SNMA CAP RSS format was not recognized.');
  const channel = sections(clean, 'channel')[0];
  const beforeItems = channel.split(/<item\b/i)[0];
  const items = sections(channel, 'item').map(item => ({
    id: tagText(item, 'guid'), title: tagText(item, 'title'),
    issuedAt: isoDate(tagText(item, 'pubDate')),
    capUrl: safeUrl(tagText(item, 'link'), ['meteosomalia.so', 'www.meteosomalia.so'])
  }));
  return {items, publishedAt: isoDate(tagText(beforeItems, 'pubDate')), lastBuildAt: isoDate(tagText(beforeItems, 'lastBuildDate'))};
}

export function parseCapDocument(xml, {now = new Date(), sourceUrl = ALERT_SOURCES.snma} = {}) {
  const clean = xmlCheck(xml);
  if (!/<(?:[A-Za-z_][\w.-]*:)?alert\b/i.test(clean) || !/urn:oasis:names:tc:emergency:cap:1\.[12]/.test(clean)) throw new Error('SNMA CAP warning format was not recognized.');
  const id = tagText(clean, 'identifier');
  const issuedAt = isoDate(tagText(clean, 'sent'), {cap:true});
  const msgType = tagText(clean, 'msgType');
  const references = tagText(clean, 'references').split(/\s+/).filter(Boolean).map(reference => reference.split(',')[1]).filter(Boolean);
  const record = {id, issuedAt, references, msgType, alert: null, reason: null};
  if (!id || !issuedAt) return {...record, reason: 'missing-identity-or-date'};
  if (tagText(clean, 'status') !== 'Actual' || tagText(clean, 'scope') !== 'Public') return {...record, reason: 'not-public-actual'};
  if (!['Alert', 'Update', 'Cancel'].includes(msgType)) return {...record, reason: 'unsupported-message'};
  if (Date.parse(issuedAt) > new Date(now).getTime()) return {...record, reason: 'future-issued'};
  if (msgType === 'Cancel') return {...record, reason: 'cancelled'};
  const infoBlocks = sections(clean, 'info');
  const info = infoBlocks.find(block => /^en(?:-|$)/i.test(tagText(block, 'language'))) || infoBlocks[0];
  if (!info) return {...record, reason: 'missing-info'};
  const endsAt = isoDate(tagText(info, 'expires'), {cap:true});
  const startsAt = isoDate(tagText(info, 'onset'), {cap:true}) || isoDate(tagText(info, 'effective'), {cap:true}) || issuedAt;
  if (!endsAt || Date.parse(endsAt) < Date.parse(startsAt)) return {...record, reason: 'unknown-validity'};
  if (Date.parse(endsAt) <= new Date(now).getTime()) return {...record, reason: 'expired'};
  // A future onset with an already issued warning is still actionable preparedness.
  const severityText = tagText(info, 'severity');
  const severity = ({Extreme:'severe', Severe:'severe', Moderate:'moderate', Minor:'minor', Unknown:'unknown'})[severityText] || 'unknown';
  const areaDescription = sections(info, 'area').map(area => tagText(area, 'areaDesc')).filter(Boolean).join('; ');
  const web = safeUrl(tagText(info, 'web'), ['meteosomalia.so', 'www.meteosomalia.so']);
  const description = tagText(info, 'description');
  const instruction = tagText(info, 'instruction');
  return {...record, alert: {
    id: `snma:${id}`, sourceId: 'snma', title: tagText(info, 'headline') || tagText(info, 'event') || 'Somalia weather warning',
    source: 'SNMA', sourceUrl: web || safeUrl(sourceUrl, ['meteosomalia.so', 'www.meteosomalia.so']) || ALERT_SOURCES.snma,
    issuedAt, startsAt, endsAt, severity, severityText, status: 'active',
    scope: {country:'Somalia', cities:[], areaDescription: areaDescription || 'Area not specified by the warning'},
    description, instruction, basis: 'official-warning', urgency: tagText(info, 'urgency'), certainty: tagText(info, 'certainty')
  }};
}

function affectsSomalia(properties) {
  const countries = [properties.iso3, properties.iso2, properties.country];
  for (const country of Array.isArray(properties.affectedcountries) ? properties.affectedcountries : []) {
    if (typeof country === 'string') countries.push(country);
    else if (country && typeof country === 'object') countries.push(country.iso3, country.iso2, country.countryname, country.name);
  }
  return countries.some(value => /(?:^|[,;\s])(?:Somalia|SOM|SO)(?=$|[,;\s])/i.test(String(value || '')));
}

export function parseGdacsEvents(payload, {now = new Date()} = {}) {
  if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features)) throw new Error('GDACS GeoJSON format was not recognized.');
  const currentTime = new Date(now).getTime();
  let returnedCount = 0, rejectedExpired = 0, rejectedInvalid = 0;
  const alerts = [];
  for (const feature of payload.features) {
    const p = feature?.properties || {};
    if (p.eventtype !== 'FL' || !affectsSomalia(p)) continue;
    returnedCount++;
    const issuedAt = isoDate(p.datemodified, {gdacs:true});
    const startsAt = isoDate(p.fromdate, {gdacs:true});
    const endsAt = isoDate(p.todate, {gdacs:true, end:true});
    if (!issuedAt || !startsAt || !endsAt || Date.parse(issuedAt) > currentTime || Date.parse(endsAt) < Date.parse(startsAt)) { rejectedInvalid++; continue; }
    if (Date.parse(endsAt) <= currentTime) { rejectedExpired++; continue; }
    if (!(p.iscurrent === true || p.iscurrent === 'true') || Date.parse(startsAt) > currentTime || !p.eventid) { rejectedInvalid++; continue; }
    const model = /glofas/i.test(String(p.source || ''));
    const report = safeUrl(p.url?.report, ['gdacs.org', 'www.gdacs.org']) || `https://www.gdacs.org/report.aspx?eventtype=FL&eventid=${encodeURIComponent(p.eventid)}`;
    const alertColor = String(p.episodealertlevel || p.alertlevel || '').toLowerCase();
    alerts.push({
      id:`gdacs:FL:${p.eventid}:${p.episodeid || 0}`, sourceId:'gdacs',
      title:`${model ? 'GDACS model event' : 'GDACS flood event'}: ${plain(p.name || 'Somalia')}`,
      source:`GDACS${p.source ? ' / ' + plain(p.source) : ''}`, sourceUrl:report, issuedAt, startsAt, endsAt,
      severity:({red:'severe', orange:'moderate', green:'minor'})[alertColor] || 'unknown', severityText: plain(p.episodealertlevel || p.alertlevel),
      status:'active', scope:{country:'Somalia', cities:[], areaDescription:plain(p.country || 'Somalia')},
      description: `${plain(p.description || p.htmldescription || p.name)}. ${model ? 'Model-based event signal; inundation has not been confirmed by this record.' : 'Country-level event monitoring; this record does not identify flooded neighbourhoods.'}`,
      basis:model ? 'model-event' : 'event-monitoring'
    });
  }
  return {alerts, returnedCount, rejectedExpired, rejectedInvalid};
}

async function fetchBody(url, fetchImpl, type) {
  const response = await fetchImpl(url, {headers:{Accept:type, 'User-Agent':'SomaliaFloodWatch/1.0 (public warning data dashboard)'}, signal:AbortSignal.timeout(20000), redirect:'error'});
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
  const body = await response.text();
  if (body.length > 8_000_000) throw new Error('Warning feed response is unexpectedly large.');
  return body;
}

async function loadSnma(now, fetchImpl) {
  const rss = parseCapRss(await fetchBody(ALERT_SOURCES.snma, fetchImpl, 'application/xml,text/xml'));
  const entries = rss.items.slice(0, 30);
  const documents = await Promise.allSettled(entries.map(async item => {
    if (!item.capUrl || !new URL(item.capUrl).pathname.startsWith('/api/cap/')) throw new Error('RSS item has no allowlisted CAP document link.');
    return parseCapDocument(await fetchBody(item.capUrl, fetchImpl, 'application/cap+xml,application/xml'), {now, sourceUrl:item.capUrl});
  }));
  const records = documents.filter(result => result.status === 'fulfilled').map(result => result.value);
  const retired = new Set(records.filter(record => ['Update', 'Cancel'].includes(record.msgType) && !['not-public-actual', 'future-issued', 'missing-identity-or-date'].includes(record.reason)).flatMap(record => record.references));
  const unique = new Map();
  for (const record of records) if (record.alert && !retired.has(record.id)) unique.set(record.id, record.alert);
  const failedCount = documents.filter(result => result.status === 'rejected').length;
  return {
    alerts:[...unique.values()], publishedAt:rss.publishedAt, lastBuildAt:rss.lastBuildAt, returnedCount:rss.items.length,
    rejectedExpired:records.filter(record => record.reason === 'expired').length,
    rejectedInvalid:records.filter(record => record.reason && record.reason !== 'expired').length,
    partial:failedCount > 0 || rss.items.length > entries.length, failedCount,
    ...(failedCount ? {error:`${failedCount} CAP documents could not be validated; coverage is incomplete.`} : {})
  };
}

async function loadGdacs(now, fetchImpl) {
  const end = new Date(now);
  const start = new Date(end.getTime() - 30 * DAY);
  const result = {alerts:[], returnedCount:0, rejectedExpired:0, rejectedInvalid:0, windowStart:start.toISOString(), windowEnd:end.toISOString(), partial:false};
  let lastPageCount;
  for (let page = 1; page <= 5; page++) {
    const url = new URL(ALERT_SOURCES.gdacs);
    url.search = new URLSearchParams({eventlist:'FL', fromdate:start.toISOString().slice(0, 10), todate:end.toISOString().slice(0, 10), alertlevel:'red;orange;green', pagesize:'100', pagenumber:String(page)}).toString();
    const payload = JSON.parse(await fetchBody(url.href, fetchImpl, 'application/json'));
    const data = parseGdacsEvents(payload, {now});
    result.alerts.push(...data.alerts);
    result.returnedCount += data.returnedCount;
    result.rejectedExpired += data.rejectedExpired;
    result.rejectedInvalid += data.rejectedInvalid;
    lastPageCount = payload.features.length;
    if (lastPageCount < 100) break;
  }
  result.partial = lastPageCount >= 100;
  result.alerts = [...new Map(result.alerts.map(alert => [alert.id, alert])).values()];
  if (result.partial) result.error = 'GDACS result exceeds the search page limit; coverage is incomplete.';
  return result;
}

export async function loadOfficialAlerts({now = new Date(), fetchImpl = fetch} = {}) {
  if (!Number.isFinite(new Date(now).getTime())) throw new Error('Invalid warning retrieval date.');
  const results = await Promise.allSettled([loadSnma(now, fetchImpl), loadGdacs(now, fetchImpl)]);
  const fetchedAt = new Date().toISOString();
  const sources = results.map((result, index) => {
    const id = index === 0 ? 'snma' : 'gdacs';
    const data = result.status === 'fulfilled' ? result.value : null;
    return {id, name:index === 0 ? 'Somalia National Meteorological Agency CAP' : 'Global Disaster Alert and Coordination System',
      sourceUrl:ALERT_SOURCES[id], available:!!data, fetchedAt:data ? fetchedAt : null,
      ...(data ? {...data, alerts:undefined} : {error:result.reason?.message || 'Source unavailable.'})};
  });
  // Do not convert total source failure into a successfully retrieved empty feed.
  if (!sources.some(source => source.available)) throw new Error(sources.map(source => `${source.id}: ${source.error}`).join(' '));
  const alerts = results.flatMap(result => result.status === 'fulfilled' ? result.value.alerts : []).sort((a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt));
  const officialWarningsAvailable = sources[0].available && !sources[0].partial;
  const eventFeedAvailable = sources[1].available && !sources[1].partial;
  const coverageNote = `SNMA CAP warnings are official national notices. GDACS is separate country-level flood event monitoring and may include model signals. ${sources[0].available ? `${sources[0].returnedCount} CAP records returned; ${sources[0].rejectedExpired} expired records excluded.` : 'Official CAP warning source unavailable.'} ${!officialWarningsAvailable || !eventFeedAvailable ? 'Some source coverage is incomplete. ' : ''}An empty active list does not mean there is no flood risk. Retrieval time is distinct from the warning publication date.`;
  return {alerts, fetchedAt, sources, officialWarningsAvailable, eventFeedAvailable, sourceUrl:ALERT_SOURCES.snma, coverageNote};
}
