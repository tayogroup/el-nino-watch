// Inspect, and optionally repair, the report-backup settings of the Bunny Magic
// Containers app. Run by .github/workflows/bunny-backups.yml with the account API
// key from the BUNNYNET_API_KEY secret.
//
// This repository and its Actions logs are PUBLIC: print names, counts and yes/no
// facts only. Never print a variable's value, a password or another zone's name.
//
//   node bunny-backups.mjs inspect   read-only report
//   node bunny-backups.mjs snapshots read-only: report backups, and any report missing from the live site
//   node bunny-backups.mjs apply     set BACKUP_STORAGE_ZONE/KEY on the container
//   node bunny-backups.mjs create-and-apply   create the private zone if missing, then apply
//   node bunny-backups.mjs stats-key          set a new random STATS_KEY (private /stats view);
//                                             read it in Bunny: Container settings > Environment variables
//   node bunny-backups.mjs source-keys        copy GOOGLE_FLOOD_API_KEY, RELIEFWEB_APPNAME, GEMINI_API_KEY, PODCAST_ENABLED, the WHATSAPP_*,
//                                             OPEN_METEO_API_KEY and REVIEW_KEYS
//                                             settings, where set, from the bunny-settings environment's
//                                             secrets onto the container
const [mode = 'inspect'] = process.argv.slice(2);
const {BUNNYNET_API_KEY: key, BUNNY_APP_ID: appId, BUNNY_CONTAINER: containerName = 'el-nino-watch', BACKUP_ZONE: zoneName = 'el-nino-watch-backups'} = process.env;
if (!key || !appId) { console.error('BUNNYNET_API_KEY and BUNNY_APP_ID are required.'); process.exit(2); }
const mask = value => { if (value) console.log(`::add-mask::${value}`); };

// Merge variables into the container (keeping the others), then read them back.
async function setEnv(container, env, wanted) {
  const shape = env[0] && 'key' in env[0] && !('name' in env[0]) ? 'key' : 'name';
  const merged = env.filter(item => !Object.hasOwn(wanted, envName(item))).concat(Object.entries(wanted).map(([name, value]) => shape === 'key' ? {key: name, value} : {name, value}));
  await api('PATCH', `/mc/apps/${appId}/containers/${container.id}`, {id: container.id, environmentVariables: merged});
  const after = (await api('GET', `/mc/apps/${appId}`)).containerTemplates.find(item => item.id === container.id);
  const ok = Object.entries(wanted).every(([name, value]) => envList(after).some(item => envName(item) === name && envValue(item) === value));
  console.log(`Applied ${Object.keys(wanted).join(', ')}; read back: ${ok ? 'present' : 'NOT PRESENT'}.`);
  return ok;
}

async function api(method, path, body) {
  const response = await fetch(`https://api.bunny.net${path}`, {
    method, headers: {AccessKey: key, Accept: 'application/json', ...(body ? {'Content-Type': 'application/json'} : {})},
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path.replace(appId, '<app>')} returned HTTP ${response.status}`);
  return text ? JSON.parse(text) : null;
}
const envList = container => container.environmentVariables || container.environment || container.env || [];
const envName = item => item?.name ?? item?.key ?? item?.Name;
const envValue = item => item?.value ?? item?.Value ?? '';

const app = await api('GET', `/mc/apps/${appId}`);
const containers = app.containerTemplates || [];
const container = containers.find(item => item.name === containerName);
console.log(`App status: ${app.status ?? app.appStatus ?? 'unknown'}; containers: ${containers.map(item => item.name).join(', ') || 'none'}`);
if (!container) { console.error(`No container named ${containerName}.`); process.exit(1); }
console.log(`Container fields: ${Object.keys(container).sort().join(', ')}`);
const env = envList(container);
for (const item of env) mask(envValue(item));
console.log(`Environment variables on ${containerName}: ${env.length ? env.map(item => `${envName(item)}=${envValue(item) ? '<set>' : '<empty>'}`).join(', ') : 'none'}`);
for (const wanted of ['BACKUP_STORAGE_ZONE', 'BACKUP_STORAGE_KEY', 'STATS_KEY', 'GOOGLE_FLOOD_API_KEY', 'RELIEFWEB_APPNAME', 'GEMINI_API_KEY', 'PODCAST_ENABLED', 'WHATSAPP_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_NUMBER', 'WHATSAPP_TEMPLATE_SO_LANGUAGE', 'OPEN_METEO_API_KEY', 'REVIEW_KEYS']) {
  const near = env.map(envName).filter(name => name && name !== wanted && name.replace(/[^A-Z]/gi, '').toUpperCase() === wanted.replace(/_/g, ''));
  console.log(`${wanted}: ${env.some(item => envName(item) === wanted && envValue(item)) ? 'present' : 'MISSING'}${near.length ? ` (near-miss names: ${near.join(', ')})` : ''}`);
}
const volumes = container.volumeMounts || container.volumes || [];
console.log(`Volume mounts: ${volumes.map(item => item.mountPath || item.path || JSON.stringify(Object.keys(item))).join(', ') || 'none listed on the container'}`);

const zones = (await api('GET', '/storagezone')).filter?.(item => !item.Deleted) ?? [];
for (const item of zones) mask(item.Password), mask(item.ReadOnlyPassword);
let zone = zones.find(item => item.Name === zoneName);
// create-and-apply: a private Standard zone in Falkenstein (near the app in
// Frankfurt, a separate data centre), with no pull zone.
if (!zone && mode === 'create-and-apply') {
  zone = await api('POST', '/storagezone', {Name: zoneName, Region: 'DE', ZoneTier: 0});
  mask(zone?.Password); mask(zone?.ReadOnlyPassword);
  console.log(`Created storage zone ${zoneName}.`);
}
console.log(`Storage zone ${zoneName}: ${zone ? `exists, region ${zone.Region}, pull zones attached: ${(zone.PullZones || []).length}` : 'NOT FOUND'}`);
// Only zones that look like this app's are named; the account's others are counted.
const candidates = zones.filter(item => item.Name !== zoneName && /nino|backup/i.test(item.Name));
console.log(`Other zones that may be this app's: ${candidates.map(item => `${item.Name} (region ${item.Region}, pull zones ${(item.PullZones || []).length})`).join(', ') || 'none'}; other storage zones on the account: ${zones.length - candidates.length - (zone ? 1 : 0)}`);

// source-keys: the data-source keys the owner keeps as secrets of the bunny-settings environment.
// Only the ones set are copied; the others on the container are left as they are.
if (mode === 'source-keys') {
  const wanted = Object.fromEntries(['GOOGLE_FLOOD_API_KEY', 'RELIEFWEB_APPNAME', 'GEMINI_API_KEY', 'PODCAST_ENABLED', 'WHATSAPP_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_NUMBER', 'WHATSAPP_TEMPLATE_SO_LANGUAGE', 'OPEN_METEO_API_KEY', 'REVIEW_KEYS'].map(name => [name, (process.env[name] || '').trim()]).filter(([, value]) => value));
  Object.values(wanted).forEach(mask);
  if (!Object.keys(wanted).length) { console.error('None of GOOGLE_FLOOD_API_KEY, RELIEFWEB_APPNAME, GEMINI_API_KEY, PODCAST_ENABLED, the WHATSAPP_* settings, OPEN_METEO_API_KEY or REVIEW_KEYS is set as a secret of the bunny-settings environment.'); process.exit(1); }
  process.exit((await setEnv(container, env, wanted)) ? 0 : 1);
}
if (mode === 'stats-key') {
  const {randomBytes} = await import('node:crypto');
  const statsKey = randomBytes(24).toString('base64url');
  mask(statsKey);
  process.exit((await setEnv(container, env, {STATS_KEY: statsKey})) ? 0 : 1);
}
// snapshots (read-only): every report backup with the reports it holds, and any report a backup
// holds that the live site no longer has. Prints only what the site already shows publicly - a
// shortened report ID, city, type and times - never descriptions, names or media.
if (mode === 'snapshots') {
  if (!zone?.Password) { console.error(`No password available for ${zoneName}.`); process.exit(1); }
  const storage = `https://${zone.StorageHostname || 'storage.bunnycdn.com'}/${encodeURIComponent(zoneName)}/el-nino-watch`;
  const read = async rel => {
    const response = await fetch(`${storage}/${rel}`, {headers: {AccessKey: zone.Password, Accept: 'application/json'}});
    if (!response.ok) throw new Error(`Backup storage GET ${rel.split('/')[0]} returned HTTP ${response.status}`);
    return response.json();
  };
  const brief = report => `${String(report.id).slice(0, 8)} ${report.cityId} ${report.category} observed ${report.observedAt} received ${report.receivedAt}`;
  const names = (await read('snapshots/')).filter(item => item.IsDirectory).map(item => item.ObjectName).sort();
  console.log(`Snapshots: ${names.length}`);
  const seen = new Map();
  for (const name of names) {
    const reports = (await read(`snapshots/${name}/reports.json`)).reports || [];
    console.log(`\n${name}: ${reports.length} report(s)`);
    for (const report of reports) {
      console.log(`  ${brief(report)}`);
      const entry = seen.get(report.id) || {report, first: name};
      entry.last = name; seen.set(report.id, entry);
    }
  }
  const live = await (await fetch('https://elninowatch.so/api/community/reports?limit=500', {headers: {Accept: 'application/json'}})).json();
  const liveIds = new Set((live.reports || []).map(report => report.id));
  console.log(`\nLive site now: ${liveIds.size} report(s); reports in any backup: ${seen.size}`);
  const gone = [...seen.values()].filter(entry => !liveIds.has(entry.report.id));
  console.log(gone.length ? `In a backup but no longer on the live site: ${gone.length}` : 'Every report in the backups is still on the live site.');
  for (const entry of gone) console.log(`  ${brief(entry.report)} - in snapshots ${entry.first} to ${entry.last}`);
  process.exit(0);
}
if (mode !== 'apply' && mode !== 'create-and-apply') process.exit(0);

if (!zone) { console.error(`Create the storage zone ${zoneName} first.`); process.exit(1); }
if ((zone.PullZones || []).length) { console.error('Refusing: that storage zone has a pull zone, so backups would be public.'); process.exit(1); }
if (!zone.Password) { console.error('The API returned no password for the zone.'); process.exit(1); }
const endpoint = zone.StorageHostname ? `https://${zone.StorageHostname}` : null;
const wanted = {BACKUP_STORAGE_ZONE: zoneName, BACKUP_STORAGE_KEY: zone.Password, ...(endpoint && endpoint !== 'https://storage.bunnycdn.com' ? {BACKUP_STORAGE_ENDPOINT: endpoint} : {})};
process.exit((await setEnv(container, env, wanted)) ? 0 : 1);
