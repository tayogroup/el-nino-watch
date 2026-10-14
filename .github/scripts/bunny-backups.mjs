// Inspect, and optionally repair, the report-backup settings of the Bunny Magic
// Containers app. Run by .github/workflows/bunny-backups.yml with the account API
// key from the BUNNYNET_API_KEY secret.
//
// This repository and its Actions logs are PUBLIC: print names, counts and yes/no
// facts only. Never print a variable's value, a password or another zone's name.
//
//   node bunny-backups.mjs inspect   read-only report
//   node bunny-backups.mjs apply     set BACKUP_STORAGE_ZONE/KEY on the container
//   node bunny-backups.mjs create-and-apply   create the private zone if missing, then apply
//   node bunny-backups.mjs stats-key          set a new random STATS_KEY (private /stats view);
//                                             read it in Bunny: Container settings > Environment variables
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
for (const wanted of ['BACKUP_STORAGE_ZONE', 'BACKUP_STORAGE_KEY', 'STATS_KEY']) {
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

if (mode === 'stats-key') {
  const {randomBytes} = await import('node:crypto');
  const statsKey = randomBytes(24).toString('base64url');
  mask(statsKey);
  process.exit((await setEnv(container, env, {STATS_KEY: statsKey})) ? 0 : 1);
}
if (mode !== 'apply' && mode !== 'create-and-apply') process.exit(0);

if (!zone) { console.error(`Create the storage zone ${zoneName} first.`); process.exit(1); }
if ((zone.PullZones || []).length) { console.error('Refusing: that storage zone has a pull zone, so backups would be public.'); process.exit(1); }
if (!zone.Password) { console.error('The API returned no password for the zone.'); process.exit(1); }
const endpoint = zone.StorageHostname ? `https://${zone.StorageHostname}` : null;
const wanted = {BACKUP_STORAGE_ZONE: zoneName, BACKUP_STORAGE_KEY: zone.Password, ...(endpoint && endpoint !== 'https://storage.bunnycdn.com' ? {BACKUP_STORAGE_ENDPOINT: endpoint} : {})};
process.exit((await setEnv(container, env, wanted)) ? 0 : 1);
