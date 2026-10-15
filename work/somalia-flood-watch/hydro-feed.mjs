// The official national flood forecast: Somali National Hydrological Services, Ministry of Energy
// and Water Resources (MOEWR), published at https://hydro.tekhub.so/. Used with the Ministry's
// permission (owner, 2026-10-15).
//
// Each daily run gives every one of Somalia's 18 regions a level for the active rainy season,
// from clear to advisory, watch and warning; watch goes with anticipatory-action (AA)
// pre-activation and warning with AA activation. As on the service's own page, an active AA flag
// raises the level it belongs to. Regions at advisory or above become alerts for the monitored
// cities in them.
//
// The data comes from the service's public database, read with the public key its own page ships
// (found in its page at run time, or set as SNHS_SUPABASE_KEY), so a key change on their side
// does not need a release here.
const SITE = 'https://hydro.tekhub.so/';
const DATABASE = 'https://tulskmtjmdwglhsbkydz.supabase.co';
const DAY = 86400000;
const MAX_AGE_MS = 3 * DAY;
export const HYDRO_SOURCE = Object.freeze({id: 'moewr', name: 'Somali National Hydrological Services (MOEWR)', url: SITE});

// The service's 18 regions, and the app's region names they contain. Sahil (Berbera) is part of
// Woqooyi Galbeed in the 18-region division the service uses.
export const HYDRO_REGIONS = Object.freeze({
  'awdal': ['Awdal', ['Awdal']], 'bakool': ['Bakool', ['Bakool']], 'banadir': ['Banadir', ['Banaadir']], 'bari': ['Bari', ['Bari']],
  'bay': ['Bay', ['Bay']], 'galgaduud': ['Galgaduud', ['Galgaduud']], 'gedo': ['Gedo', ['Gedo']], 'hiraan': ['Hiraan', ['Hiraan']],
  'lower-juba': ['Lower Juba', ['Lower Juba']], 'lower-shabelle': ['Lower Shabelle', ['Lower Shabelle']], 'middle-juba': ['Middle Juba', ['Middle Juba']],
  'middle-shabelle': ['Middle Shabelle', ['Middle Shabelle']], 'mudug': ['Mudug', ['Mudug']], 'nugaal': ['Nugaal', ['Nugaal']],
  'sanaag': ['Sanaag', ['Sanaag']], 'sool': ['Sool', ['Sool']], 'togdheer': ['Togdheer', ['Togdheer']], 'woqooyi-galbeed': ['Woqooyi Galbeed', ['Woqooyi Galbeed', 'Sahil']]
});

// Gu (March-May, into June) and Deyr (October-December). The service publishes both every day and
// marks one active; outside both seasons the Deyr thresholds are used.
export function activeSeason(now = new Date()) {
  const month = new Date(new Date(now).getTime() + 3 * 3600000).getUTCMonth() + 1;
  return month >= 3 && month <= 6 ? 'Gu' : 'Deyr';
}

// The level the service shows: an active AA activation is a warning, an active AA pre-activation a watch.
export function effectiveLevel(row) {
  if (row?.aa_act_active || row?.level === 'warning') return 'warning';
  if (row?.aa_pre_active || row?.level === 'watch') return 'watch';
  return row?.level === 'advisory' ? 'advisory' : 'clear';
}
const LEVELS = {
  warning: {severity: 'severe', label: 'Warning', aa: 'anticipatory action activated'},
  watch: {severity: 'moderate', label: 'Watch', aa: 'anticipatory action pre-activation'},
  advisory: {severity: 'minor', label: 'Advisory', aa: null}
};
const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%` : null;

// One region's alert, for the monitored cities in it (none for Middle Juba: shown for all cities only).
export function hydroAlert(row, run, cities) {
  const level = effectiveLevel(row), meta = LEVELS[level], region = HYDRO_REGIONS[row?.region_id];
  if (!meta || !region) return null;
  const [regionName, appRegions] = region;
  const names = cities.filter(city => appRegions.includes(city[1])).map(city => city[0]);
  const aaActive = level === 'warning' ? !!row.aa_act_active : level === 'watch' ? !!row.aa_pre_active : false;
  return {
    id: `moewr:${run.folder}:${row.region_id}`, sourceId: 'moewr',
    title: `${regionName} region · national flood ${meta.label.toLowerCase()}${aaActive ? ` · ${meta.aa}` : ''}`,
    source: HYDRO_SOURCE.name, sourceUrl: SITE, issuedAt: run.publishedAt, startsAt: run.startsAt, endsAt: run.endsAt,
    severity: meta.severity, severityText: meta.label, status: 'active',
    scope: {country: 'Somalia', cities: names, region: regionName, areaDescription: `${regionName} region`},
    // One fixed sentence shape per level, so the page can translate it (i18n-public.json patterns).
    description: `${regionName} region: national flood ${meta.label.toLowerCase()} for the ${run.season} season. Forecast flooded share of the region: ${percent(row.frac_d1) ?? '—'} tomorrow, ${percent(row.frac_d1_d3) ?? '—'} over days 1–3, ${percent(row.frac_d2_d5) ?? '—'} over days 2–5.`,
    basis: 'national-hydrological-forecast', level, aaActive, season: run.season
  };
}

let discoveredKey = null;
async function publicKey(fetchImpl) {
  if (process.env.SNHS_SUPABASE_KEY) return process.env.SNHS_SUPABASE_KEY;
  if (discoveredKey) return discoveredKey;
  const page = await (await fetchImpl(SITE, {signal: AbortSignal.timeout(20000)})).text();
  const script = page.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  if (!script) throw new Error('The national hydrological service page did not name its script.');
  const bundle = await (await fetchImpl(new URL(script, SITE), {signal: AbortSignal.timeout(30000)})).text();
  const key = (bundle.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []).find(token => {
    try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).role === 'anon'; } catch { return false; }
  });
  if (!key) throw new Error('The national hydrological service page carries no public data key.');
  return (discoveredKey = key);
}

export async function loadHydroAlerts({now = new Date(), fetchImpl = fetch, cities = []} = {}) {
  const key = await publicKey(fetchImpl), season = activeSeason(now);
  const query = async path => {
    const response = await fetchImpl(`${DATABASE}/rest/v1/${path}`, {headers: {apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json'}, signal: AbortSignal.timeout(20000)});
    if (response.status === 401 || response.status === 403) discoveredKey = null;
    if (!response.ok) throw new Error(`National hydrological data returned HTTP ${response.status}.`);
    return response.json();
  };
  const rows = await query(`hydro_regional_exceedance?select=region_id,season,run_folder,run_timestamp,run_date_label,best_model,frac_d1,frac_d1_d3,frac_d2_d5,level,aa_pre_signal,aa_pre_active,aa_act_active,published_at&season=eq.${season}&order=published_at.desc&limit=60`);
  if (!Array.isArray(rows) || !rows.length) throw new Error(`No national hydrological forecast for the ${season} season.`);
  const latest = rows[0], publishedAt = Date.parse(latest.published_at);
  if (!Number.isFinite(publishedAt) || new Date(now).getTime() - publishedAt > MAX_AGE_MS) throw new Error('The latest national hydrological forecast is more than 3 days old.');
  // The latest row for each region from the newest run.
  const run = rows.filter(row => row.run_folder === latest.run_folder);
  const byRegion = new Map(run.map(row => [row.region_id, row]));
  const runStart = /^(\d{4})(\d{2})(\d{2})/.exec(String(latest.run_folder || ''));
  const startsAt = runStart ? `${runStart[1]}-${runStart[2]}-${runStart[3]}T00:00:00Z` : new Date(publishedAt).toISOString();
  const runInfo = {folder: latest.run_folder, label: latest.run_date_label, season, publishedAt: new Date(publishedAt).toISOString(), startsAt, endsAt: new Date(Date.parse(startsAt) + 5 * DAY - 1000).toISOString()};
  const alerts = [...byRegion.values()].map(row => hydroAlert(row, runInfo, cities)).filter(Boolean);
  const levels = {warning: 0, watch: 0, advisory: 0, clear: 0};
  for (const row of byRegion.values()) levels[effectiveLevel(row)]++;
  return {alerts, season, run: runInfo.label, publishedAt: runInfo.publishedAt, regions: byRegion.size, levels};
}
