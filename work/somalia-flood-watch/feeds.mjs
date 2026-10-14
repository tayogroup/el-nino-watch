const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export const SOURCES = Object.freeze({
  enso: 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml',
  weekly: 'https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for',
  stations: 'https://snrfa.faoswalim.org/stations/'
});

export function htmlText(html) {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|nbsp|amp|lt|gt|quot|apos|ntilde|Ntilde|deg);/g, (_, entity) => {
      if (entity.startsWith('#')) {
        const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
      }
      return ({nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ntilde: 'ñ', Ntilde: 'Ñ', deg: '°'})[entity];
    })
    .replace(/\s+/g, ' ').trim();
}

export function parseDate(label) {
  const clean = String(label || '').replace(/\./g, '').trim();
  let day, month, year;
  let m = clean.match(/^(\d{1,2})\s*([A-Za-z]+)\s*(\d{4})$/);
  if (m) [, day, month, year] = m;
  else {
    m = clean.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (!m) return null;
    [, month, day, year] = m;
  }
  const index = MONTHS.indexOf(month.toLowerCase().slice(0, 3));
  if (index < 0) return null;
  const date = new Date(Date.UTC(Number(year), index, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== index || date.getUTCDate() !== Number(day)) return null;
  return date.toISOString().slice(0, 10);
}

export function parseEnso(html) {
  const text = htmlText(html);
  const status = text.match(/ENSO Alert System Status\s*:\s*([\s\S]*?)(?=Synopsis\s*:|$)/i)?.[1]?.trim();
  if (!status || status.length > 150) throw new Error('NOAA advisory format was not recognized.');
  const beforeStatus = text.slice(0, text.indexOf('ENSO Alert System Status'));
  const issueDates = [...beforeStatus.matchAll(/\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/gi)];
  const issuedLabel = issueDates.at(-1)?.[0];
  const issuedAt = parseDate(issuedLabel);
  if (!issuedAt) throw new Error('NOAA advisory issue date was not recognized.');
  const synopsisText = text.match(/Synopsis\s*:\s*([\s\S]*?)(?=In summary,|This discussion is|Climate Prediction Center|$)/i)?.[1] || '';
  const synopsis = synopsisText.split(/(?<=\.)\s/)[0].replace(/\s*\[\s*Fig\.[^\]]*\]/g, '').trim().slice(0, 700);
  return {issuedAt, issuedLabel, alertStatus: status, phase: status, synopsis, sourceUrl: SOURCES.enso};
}

export function parseWeeklyNino(text) {
  const rows = String(text).split(/\r?\n/).filter(line => /^\s*\d{2}[A-Z]{3}\d{4}\s/.test(line));
  for (const row of rows.reverse()) {
    const label = row.match(/\d{2}[A-Z]{3}\d{4}/)?.[0];
    const date = parseDate(label);
    // Columns have fixed widths; positive anomaly values are separated while negative ones touch SST.
    const values = row.slice(row.indexOf(label) + label.length).match(/[+-]?\d+\.\d+/g)?.map(Number);
    if (date && values?.length === 8 && values.every(Number.isFinite)) {
      return {date, nino34Sst: values[4], nino34Anomaly: values[5], sourceUrl: SOURCES.weekly,
        note: 'Weekly conventional Niño 3.4 SST anomaly; this is not the three-month RONI used in the official advisory.'};
    }
  }
  throw new Error('NOAA weekly SST format was not recognized.');
}

function metres(text) {
  const value = String(text).trim().match(/^([+-]?\d+(?:\.\d+)?)\s*m?$/i);
  return value ? Number(value[1]) : null;
}

export function parseStations(html) {
  const body = String(html).match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
  if (!body) throw new Error('SWALIM station table was not found.');
  const stations = [];
  for (const match of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => htmlText(cell[1]));
    const offset = /^[A-Z]{2}\d{3}$/.test(cells[0]) ? 0 : 1;
    const code = cells[offset];
    if (!/^[A-Z]{2}\d{3}$/.test(code) || cells.length < offset + 10) continue;
    const observedLabel = cells[offset + 5];
    const status = cells[offset + 3];
    stations.push({
      code, name: cells[offset + 1], river: cells[offset + 2], status,
      observedAt: parseDate(observedLabel), observedLabel,
      // A nonfunctional gauge cannot supply a current measurement even if a date exists.
      levelM: /^functional$/i.test(status) ? metres(cells[offset + 6]) : null,
      moderateM: metres(cells[offset + 7]), highM: metres(cells[offset + 8]), bankFullM: metres(cells[offset + 9]),
      sourceUrl: `${SOURCES.stations}${code.toLowerCase()}/`
    });
  }
  if (!stations.length) throw new Error('SWALIM station rows were not recognized.');
  return stations;
}

async function fetchText(url) {
  const response = await fetch(url, {headers: {'User-Agent': 'SomaliaFloodWatch/1.0 (public-data dashboard)', Accept: 'text/html,text/plain'}, signal: AbortSignal.timeout(20000), redirect: 'error'});
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
  const text = await response.text();
  if (text.length > 3_000_000) throw new Error('Source response is unexpectedly large.');
  return text;
}

export async function loadEnso() {
  const [advisory, weekly] = await Promise.allSettled([fetchText(SOURCES.enso), fetchText(SOURCES.weekly)]);
  if (advisory.status !== 'fulfilled') throw advisory.reason;
  const data = parseEnso(advisory.value);
  if (weekly.status === 'fulfilled') {
    try { data.weekly = parseWeeklyNino(weekly.value); }
    catch (error) { data.weekly = null; data.weeklyError = error.message; }
  } else { data.weekly = null; data.weeklyError = 'Weekly SST source is unavailable.'; }
  return data;
}

export async function loadStations() {
  return {stations: parseStations(await fetchText(SOURCES.stations)), sourceUrl: SOURCES.stations};
}
