// Open-Meteo addresses. The free API is for non-commercial use only (under 10,000 calls a day). With
// OPEN_METEO_API_KEY set (a paid Open-Meteo plan), every request goes to Open-Meteo's customer hosts with
// the key; without it nothing changes. Open-Meteo accepts the key only as the "apikey" query parameter,
// so these URLs must never be logged, shown to visitors or put in an error message.
export const OPEN_METEO = Object.freeze({
  forecast: Object.freeze({free: 'https://api.open-meteo.com/v1/forecast', paid: 'https://customer-api.open-meteo.com/v1/forecast'}),
  flood: Object.freeze({free: 'https://flood-api.open-meteo.com/v1/flood', paid: 'https://customer-flood-api.open-meteo.com/v1/flood'}),
  elevation: Object.freeze({free: 'https://api.open-meteo.com/v1/elevation', paid: 'https://customer-api.open-meteo.com/v1/elevation'})
});

export function openMeteoPlan(env = process.env) {
  return String(env.OPEN_METEO_API_KEY || '').trim() ? 'paid' : 'free';
}

export function openMeteoUrl(kind, query = '', env = process.env) {
  const hosts = OPEN_METEO[kind];
  if (!hosts) throw new Error(`Unknown Open-Meteo service: ${kind}`);
  const key = String(env.OPEN_METEO_API_KEY || '').trim();
  const text = (query instanceof URLSearchParams ? query.toString() : String(query)).replace(/^\?/, '');
  if (!key) return hosts.free + (text ? '?' + text : '');
  return hosts.paid + '?' + (text ? text + '&' : '') + 'apikey=' + encodeURIComponent(key);
}
