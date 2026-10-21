/* Optional cities stay on this device and never change the 44-city watchlist. */
(function (root) {
  'use strict';
  const KEY = 'somalia-extra-cities-v1';
  const LIMIT = 100;
  const MAX_BYTES = 100 * 1024;
  const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const aliases = new Map();
  const core = (Array.isArray(root.SOMALIA_CITIES) ? root.SOMALIA_CITIES : []).map(city => ({
    name: Array.isArray(city) ? city[0] : city?.name,
    lat: Array.isArray(city) ? city[2] : city?.lat,
    lon: Array.isArray(city) ? city[3] : city?.lon
  })).filter(city => typeof city.name === 'string' && Number.isFinite(city.lat) && Number.isFinite(city.lon));
  let records = [];
  let storage = null;
  let persisted = false;
  let storageError = null;
  let warning = core.length === 44 ? null : 'The 44-city watchlist has not loaded. Reload the page before adding a city.';
  let sequence = 0;

  function fail(message) { throw new Error(message); }
  function lexical(value) {
    return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  }
  const aliasGroups = [
    ['Mogadishu', 'Muqdisho', 'Mogadiscio'], ['Hargeisa', 'Hargeysa'], ['Bosaso', 'Boosaaso'],
    ['Kismayo', 'Kismaayo', 'Kismayu'], ['Baidoa', 'Baydhabo'], ['Garowe', 'Garoowe'],
    ['Beledweyne', 'Beletweyne', 'Beled Weyne', 'Belet Weyn'], ['Jowhar', 'Jawhar'],
    ['Afgooye', 'Afgoye'], ['Marka', 'Merca'], ['Galkayo', 'Gaalkacyo', 'Galkacyo'],
    ['Dhusamareb', 'Dhuusamareeb', 'Dhusamareeb'], ['Burao', 'Burco'], ['Berbera'], ['Luuq'],
    ['Bardera', 'Bardhere', 'Baardheere'], ['Doolow', 'Dolow'], ['Balcad', 'Balad'],
    ['Wanlaweyn', 'Wanla Weyn'], ['Buur Hakaba', 'Bur Hakaba', 'Buurhakaba'], ['Hudur', 'Xudur'],
    ['Borama', 'Boorama'], ['Erigavo', 'Ceerigaabo'], ['Las Anod', 'Laas Caanood', 'Laascaanood'],
    ['Qardho', 'Kardo'], ['Eyl'], ['Galdogob', 'Galdogob'], ['Badhan', 'Badhaan'],
    ['Zeila', 'Zeylac', 'Saylac'], ['Laasqoray', 'Las Qoray', 'Laas Qoray', 'Las Khorey'],
    ['Adado', 'Cadaado', 'Adaado'], ['Guriceel', 'Guri Ceel', 'Guri El', 'Guriel'],
    ['Cabudwaaq', 'Caabudwaaq', 'Cabuud Waaq', 'Cabud Waaq', 'Abudwak', 'Abudwaq', 'Abudwaaq'],
    ['Buulobarde', 'Buulo Burde', 'Buloburde', 'Buulo Barde', 'Bulo Burti', 'Bulo Burte'],
    ['Afmadow', 'Afmadoow', 'Afmadu'], ['Baraawe', 'Barawe', 'Barawa', 'Brava', 'Brawa'], ["Bu'aale", 'Bu’aale', 'Buaale', 'Bualle', 'Bu Aale'],
    ['Ceel Waaq', 'Ceelwaaq', 'El Waq', 'Elwaq'], ['Ceelburde', 'Ceel Barde', 'Ceelbarde', 'El Barde', 'Elbarde'], ['Diinsoor', 'Dinsoor', 'Dinsor', 'Diinsor'],
    ['Garbahaarey', 'Garbahaarrey', 'Garbaharey', 'Garbahare', 'Garba Harre'], ['Jalalaqsi', 'Jalalaqsiy', 'Jalalassi'], ['Jamaame', 'Jamame', 'Jamaameh'],
    ['Jilib'], ['Kurtunwaarey', 'Kurtunwarey', 'Kurtun Waarey'], ['Qansaxdheere', 'Qansax Dheere', 'Qansahdhere', 'Kansahdere'],
    ['Saakow', 'Sakow', 'Saakoow'], ['Sablaale', 'Sablale']
  ];
  for (const group of aliasGroups) for (const name of group) aliases.set(lexical(name), lexical(group[0]));
  function normalizeName(value) {
    const normalized = lexical(value);
    return aliases.get(normalized) || normalized;
  }
  function object(value, fields, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
    for (const key in value) if (!own(value, key)) fail(`${label} cannot contain inherited fields.`);
    for (const key of Object.keys(value)) if (RESERVED.has(key) || !fields.includes(key)) fail(`${label} contains an unsupported field.`);
    return value;
  }
  function text(value, label, optional = false) {
    if (optional && (value === undefined || value === null || value === '')) return '';
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f<>]/.test(value)) fail(`${label} must be plain text without markup or control characters.`);
    const result = value.trim();
    if (result.length > 80 || (!optional && (result.length < 2 || !/\p{L}/u.test(result)))) fail(`${label} must contain ${optional ? 'at most 80' : '2 to 80'} characters${optional ? '' : ' and include a letter'}.`);
    return result;
  }
  function coordinates(lat, lon) {
    const absent = value => value === undefined || value === null || value === '';
    if (absent(lat) && absent(lon)) return {lat: null, lon: null};
    if (absent(lat) || absent(lon) || typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) fail('Enter both latitude and longitude as valid numbers, or leave both blank.');
    if (lat < -2 || lat > 13 || lon < 40 || lon > 52) fail('Coordinates must be within the Somalia-area map bounds: latitude −2 to 13, longitude 40 to 52. These map bounds do not verify a city or national boundary.');
    return {lat, lon};
  }
  function distanceKm(a, b) {
    const radians = value => value * Math.PI / 180;
    const deltaLat = radians(b.lat - a.lat);
    const deltaLon = radians(b.lon - a.lon);
    const term = Math.sin(deltaLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(deltaLon / 2) ** 2;
    return 6371.0088 * 2 * Math.atan2(Math.sqrt(Math.max(0, term)), Math.sqrt(Math.max(0, 1 - term)));
  }
  function duplicate(candidate, extras = records) {
    const key = normalizeName(candidate.name);
    for (const [cities, label] of [[core, '44-city watchlist'], [extras, 'additional-city list']]) {
      for (const city of cities) {
        if (normalizeName(city.name) === key) return `${city.name} is already in the ${label}.`;
        if (Number.isFinite(candidate.lat) && Number.isFinite(candidate.lon) && Number.isFinite(city.lat) && Number.isFinite(city.lon) && distanceKm(candidate, city) <= 2) return `These coordinates are within 2 km of ${city.name}, which is already in the ${label}. Choose its existing entry or check the location.`;
      }
    }
    return null;
  }
  function id(value) {
    if (typeof value !== 'string' || !/^extra-[a-zA-Z0-9_-]{1,100}$/.test(value)) fail('Saved city ID is invalid.');
    return value;
  }
  function timestamp(value) {
    if (typeof value !== 'string') fail('Saved city date is invalid.');
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) fail('Saved city date is invalid.');
    return value;
  }
  function newId() {
    try {
      if (typeof root.crypto?.randomUUID === 'function') {
        const value = id(`extra-${root.crypto.randomUUID()}`);
        if (!records.some(city => city.id === value)) return value;
      }
    } catch (_) { /* A unique device-local fallback remains available. */ }
    let value;
    do { value = `extra-${Date.now().toString(36)}-${(++sequence).toString(36)}`; } while (records.some(city => city.id === value));
    return value;
  }
  function persist() {
    try {
      if (!storage) storage = root.localStorage;
      if (!storage || typeof storage.setItem !== 'function' || typeof storage.getItem !== 'function') fail('Browser storage is unavailable.');
      const encoded = JSON.stringify({schema: 1, cities: records});
      storage.setItem(KEY, encoded);
      if (storage.getItem(KEY) !== encoded) fail('Browser storage did not save these changes.');
      persisted = true;
      storageError = null;
    } catch (_) {
      persisted = false;
      storageError = 'Browser storage is unavailable or full. Additional cities are kept in memory and may be lost when this page closes.';
    }
  }
  function load() {
    try {
      storage = root.localStorage;
      if (!storage || typeof storage.getItem !== 'function') fail('Browser storage is unavailable.');
      const saved = storage.getItem(KEY);
      if (saved === null) { persist(); return; }
      if (typeof saved !== 'string' || saved.length > MAX_BYTES) fail('Saved additional-city data is too large.');
      const parsed = object(JSON.parse(saved), ['schema', 'cities'], 'Saved list');
      if (parsed.schema !== 1 || !Array.isArray(parsed.cities)) fail('Saved additional-city list is unsupported.');
      let skipped = 0;
      const clean = [];
      const ids = new Set();
      for (const savedCity of parsed.cities) {
        try {
          if (clean.length >= LIMIT) fail('Saved list exceeds its limit.');
          object(savedCity, ['id', 'name', 'region', 'lat', 'lon', 'createdAt', 'updatedAt'], 'Saved city');
          const createdAt = timestamp(savedCity.createdAt);
          const city = {id: id(savedCity.id), name: text(savedCity.name, 'City name'), region: text(savedCity.region, 'Region', true), ...coordinates(savedCity.lat, savedCity.lon), createdAt, updatedAt: own(savedCity, 'updatedAt') ? timestamp(savedCity.updatedAt) : createdAt};
          if (ids.has(city.id) || duplicate(city, clean)) fail('Saved city is a duplicate.');
          ids.add(city.id);
          clean.push(city);
        } catch (_) { skipped++; }
      }
      records = clean;
      persisted = true;
      if (skipped) warning = `${skipped} invalid or duplicate saved ${skipped === 1 ? 'city was' : 'cities were'} skipped. Review this additional-city list; the 44-city watchlist is unchanged.`;
    } catch (_) {
      persisted = false;
      storageError = 'The saved additional-city list could not be read. New entries will remain in memory until browser storage can save them.';
    }
  }
  load();
  root.ExtraCitiesStore = Object.freeze({
    list() { return records.map(city => ({...city})); },
    add(input) {
      if (core.length !== 44) fail('The 44-city watchlist has not loaded. Reload the page before adding a city.');
      object(input, ['name', 'region', 'lat', 'lon'], 'City');
      const city = {name: text(input.name, 'City name'), region: text(input.region, 'Region', true), ...coordinates(input.lat, input.lon)};
      const reason = duplicate(city);
      if (reason) fail(reason);
      if (records.length >= LIMIT) fail(`This device has reached its ${LIMIT}-additional-city limit. Remove an entry to add another.`);
      const now = new Date().toISOString();
      const record = {id: newId(), ...city, createdAt: now, updatedAt: now};
      records.push(record);
      persist();
      return {...record};
    },
    update(value, patch) {
      if (core.length !== 44) fail('The 44-city watchlist has not loaded. Reload the page before editing a city.');
      id(value);
      object(patch, ['name', 'region', 'lat', 'lon'], 'City update');
      const index = records.findIndex(city => city.id === value);
      if (index < 0) fail('This additional city was not found.');
      const previous = records[index];
      const candidate = {
        ...previous,
        name: own(patch, 'name') ? text(patch.name, 'City name') : previous.name,
        region: own(patch, 'region') ? text(patch.region, 'Region', true) : previous.region,
        ...coordinates(own(patch, 'lat') ? patch.lat : previous.lat, own(patch, 'lon') ? patch.lon : previous.lon)
      };
      const reason = duplicate(candidate, records.filter(city => city.id !== value));
      if (reason) fail(reason);
      candidate.updatedAt = new Date().toISOString();
      records[index] = candidate;
      persist();
      return {...candidate};
    },
    remove(value) {
      id(value);
      const index = records.findIndex(city => city.id === value);
      if (index < 0) return false;
      records.splice(index, 1);
      persist();
      return true;
    },
    storageStatus() { return {persisted, error: storageError, warning}; },
    normalizeName
  });
})(window);
