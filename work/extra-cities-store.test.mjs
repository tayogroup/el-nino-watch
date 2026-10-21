import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';

const script = fs.readFileSync(new URL('./somalia-flood-watch/dist/extra-cities-store.js', import.meta.url), 'utf8');
const citiesScript = fs.readFileSync(new URL('./somalia-flood-watch/dist/cities.js', import.meta.url), 'utf8');
const KEY = 'somalia-extra-cities-v1';
const plain = value => JSON.parse(JSON.stringify(value));
let checks = 0;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
function reject(call, expression = /./) { assert.throws(call, expression); checks++; }

function harness({values = new Map(), saved, readFails = false, writeFails = false, mismatch = false, getterFails = false, crypto = {randomUUID}, missingCore = false} = {}) {
  if (saved !== undefined) values.set(KEY, saved);
  const controls = {readFails, writeFails, mismatch};
  const storage = {
    getItem(key) { if (controls.readFails) throw new Error('Unavailable'); return controls.mismatch ? null : values.get(key) ?? null; },
    setItem(key, value) { if (controls.writeFails) throw new Error('Quota'); values.set(key, String(value)); }
  };
  const root = {crypto};
  Object.defineProperty(root, 'localStorage', {get() { if (getterFails) throw new Error('SecurityError'); return storage; }});
  const context = vm.createContext({window: root, fetch() { throw new Error('Optional cities must never use the network.'); }});
  if (!missingCore) vm.runInContext(citiesScript, context);
  const original = JSON.stringify(root.SOMALIA_CITIES);
  vm.runInContext(script, context);
  return {store: root.ExtraCitiesStore, values, controls, root, original};
}

{
  const h = harness();
  check(plain(h.store.storageStatus()), {persisted: true, error: null, warning: null});
  check(h.store.list().length, 0, 'no invented cities are seeded');
  check(plain(JSON.parse(h.values.get(KEY))), {schema: 1, cities: []});
  const city = h.store.add({name: '  Ceel Buur  ', region: ' Galgaduud '});
  check(plain({name: city.name, region: city.region, lat: city.lat, lon: city.lon}), {name: 'Ceel Buur', region: 'Galgaduud', lat: null, lon: null}, 'name-only entries retain unknown coordinates');
  check(city.id.startsWith('extra-'), true);
  check(city.createdAt, city.updatedAt);
  check(Number.isFinite(Date.parse(city.createdAt)), true);
  city.name = 'Mutated return value';
  const list = h.store.list(); list[0].name = 'Mutated list'; list.push({});
  check(h.store.list()[0].name, 'Ceel Buur', 'returned data cannot mutate the store');
  const reload = harness({values: h.values});
  check(plain(reload.store.list()), plain(h.store.list()), 'records survive a page reload');
  const originalId = h.store.list()[0].id;
  const updated = h.store.update(originalId, {name: 'Ceelbuur', lat: 4.6833, lon: 46.6167});
  check(updated.id, originalId);
  check(updated.createdAt, reload.store.list()[0].createdAt, 'editing keeps the original identity and creation date');
  check(plain({lat: updated.lat, lon: updated.lon}), {lat: 4.6833, lon: 46.6167});
  check(h.store.update(originalId, {region: null}).region, '');
  check(h.store.update(originalId, {lat: null, lon: null}).lat, null, 'clearing coordinates does not create latitude zero');
  check(h.store.remove(originalId), true);
  check(h.store.remove(originalId), false);
  check(harness({values: h.values}).store.list().length, 0, 'removal persists');
  check(JSON.stringify(h.root.SOMALIA_CITIES), h.original, 'original watchlist is byte-for-byte unchanged');
  check(h.root.SOMALIA_CITIES.length, 44);
  check([...h.values.keys()], [KEY], 'the Mayor and public-report stores are untouched');
  reject(() => h.store.remove('__proto__'), /ID/);
  reject(() => h.store.update('extra-missing', {name: 'Elsewhere'}), /not found/);
}

{
  const h = harness();
  for (const city of h.root.SOMALIA_CITIES) reject(() => h.store.add({name: city[0]}), /44-city watchlist/);
  for (const alias of ['muqdisho', 'MOGADISCIO', 'Gáalkacyo', 'Galkacyo', 'Hargeysa', 'Kismaayo', 'Baydhabo', 'Beletweyne', 'Beled-Weyne', 'Jawhar', 'Afgoye', 'Garoowe', 'Burco', 'Boosaaso', 'Merca', 'Dhuusamareeb', 'Laas Caanood', 'Kardo', 'Ceerigaabo', 'Baardheere', 'Dolow', 'Balad', 'Xudur', 'Boorama', 'Las Khorey', 'Cadaado', 'Adaado', 'Guri Ceel', 'Guriel', 'Caabudwaaq', 'Cabud Waaq', 'Abudwak', 'Abudwaq', 'Buulo Burde', 'Buloburde', 'Bulo Burti', 'Bulo Burte']) reject(() => h.store.add({name: alias}), /44-city watchlist/);
  check(h.store.normalizeName(' Gáal-kacyo '), h.store.normalizeName('Galkayo'), 'aliases and punctuation share their canonical name');
  h.store.add({name: 'Ceel-Buur'});
  reject(() => h.store.add({name: '  CEEL  BUUR  '}), /additional-city list/);
  reject(() => h.store.add({name: 'Céélbuur'}), /additional-city list/);
  const another = h.store.add({name: 'Ceel Dheer'});
  reject(() => h.store.update(another.id, {name: 'Ceelbuur'}), /additional-city list/);
  reject(() => h.store.update(another.id, {name: 'Gaalkacyo'}), /44-city watchlist/);
  check(h.store.list()[1].name, 'Ceel Dheer', 'failed edit does not change the saved record');
}

{
  const h = harness();
  for (const name of ['Badhan', 'Zeylac', 'Wanla Weyn', 'Eyl']) h.store.add({name});
  check(h.store.list().length, 4, 'retired monitored cities can be added separately without entering the new 44');
  reject(() => h.store.add({name: 'Zeila'}), /additional-city list/, 'retired aliases still detect duplicate optional entries');
  check(h.root.SOMALIA_CITIES.length, 44);
}

{
  const h = harness();
  reject(() => h.store.add({name: 'Mogadishu north', lat: 2.0569, lon: 45.3182}), /within 2 km of Mogadishu/);
  const origin = h.store.add({name: 'Village origin', lat: 4, lon: 41});
  const delta = distance => distance / 6371.0088 * 180 / Math.PI;
  reject(() => h.store.add({name: 'Village near', lat: 4 + delta(1.999), lon: 41}), /within 2 km of Village origin/);
  const farther = h.store.add({name: 'Village farther', lat: 4 + delta(2.001), lon: 41});
  check(farther.name, 'Village farther', 'the distance threshold uses kilometres rather than approximate coordinate differences');
  check(h.store.update(origin.id, {name: 'Origin renamed'}).name, 'Origin renamed', 'editing the same coordinates does not duplicate itself');
  reject(() => h.store.update(farther.id, {lat: 4.005}), /within 2 km/);
  const equator = h.store.add({name: 'Equatorial village', lat: 0, lon: 44});
  check(equator.lat, 0, 'a deliberately provided latitude zero is valid');
  check(h.store.add({name: 'Northern bounds', lat: 13, lon: 52}).lat, 13);
  check(h.store.add({name: 'Southern bounds', lat: -2, lon: 40}).lat, -2);
}

{
  const h = harness();
  for (const input of [{name: 'A'}, {name: ' '}, {name: '??'}, {name: 'A'.repeat(81)}, {name: 'Bad\nName'}, {name: '<img src=x onerror=alert(1)>'}, {name: 'Valid town', region: 'x'.repeat(81)}, {name: 'Valid town', region: 'bad\u0000region'}]) reject(() => h.store.add(input), /City name|Region/);
  for (const input of [{lat: 4}, {lon: 46}, {lat: null, lon: 46}, {lat: 4, lon: ''}, {lat: '4', lon: 46}, {lat: NaN, lon: 46}, {lat: 4, lon: Infinity}, {lat: -2.01, lon: 46}, {lat: 13.01, lon: 46}, {lat: 4, lon: 39.99}, {lat: 4, lon: 52.01}]) reject(() => h.store.add({name: 'Valid town', ...input}), /coordinates|latitude|longitude|bounds/i);
  reject(() => h.store.add({name: 'Valid town', unsupported: true}), /unsupported/);
  reject(() => h.store.add(JSON.parse('{"name":"Valid town","__proto__":{"polluted":true}}')), /unsupported/);
  reject(() => h.store.add(Object.assign(Object.create({inherited: 'bad'}), {name: 'Valid town'})), /inherited/);
  check({}.polluted, undefined, 'malicious keys do not pollute object prototypes');
  const town = h.store.add({name: "Ceel 'Town'", lat: '', lon: ''});
  check(town.lat, null);
  reject(() => h.store.update(town.id, {id: 'extra-stolen'}), /unsupported/);
  reject(() => h.store.update(town.id, {lat: 5}), /both latitude/);
  check(h.store.list()[0].lat, null);
}

{
  const h = harness({crypto: {randomUUID() { return 'same-id'; }}});
  const first = h.store.add({name: 'Village first'});
  const second = h.store.add({name: 'Village second'});
  check(first.id !== second.id, true, 'repeated UUIDs cannot collide');
  const fallback = harness({crypto: {randomUUID() { throw new Error('Denied'); }}});
  check(fallback.store.add({name: 'Fallback village'}).id.startsWith('extra-'), true);
  const limited = harness();
  for (let i = 0; i < 100; i++) limited.store.add({name: `Additional village ${i}`});
  check(limited.store.list().length, 100);
  reject(() => limited.store.add({name: 'One village too many'}), /100-additional-city limit/);
  check(limited.store.update(limited.store.list()[0].id, {region: 'Updated region'}).region, 'Updated region', 'full lists can still be edited');
  limited.store.remove(limited.store.list()[0].id);
  check(limited.store.add({name: 'A replacement village'}).name, 'A replacement village');
}

{
  const date = '2026-10-13T08:00:00.000Z';
  const valid = {id: 'extra-good', name: 'Ceel Buur', region: 'Galgaduud', lat: null, lon: null, createdAt: date};
  const invalid = [{...valid, id: 'extra-core', name: 'Gaalkacyo'}, {...valid, id: 'extra-duplicate'}, {...valid, id: 'extra-bad-coordinates', lat: 4}, {...valid, id: '__proto__'}, {...valid, id: 'extra-bad-name', name: '<script>x</script>'}, {...valid, id: 'extra-bad-date', createdAt: '2026-99-99'}];
  const h = harness({saved: JSON.stringify({schema: 1, cities: [valid, ...invalid]})});
  check(h.store.list().length, 1, 'corrupt and duplicate saved rows are skipped individually');
  check(h.store.list()[0].updatedAt, date, 'older saved rows gain a valid edit timestamp');
  check(h.store.storageStatus().warning.includes('6 invalid or duplicate'), true, 'the UI receives a visible recovery warning');
  check(h.store.storageStatus().persisted, true);
  h.store.add({name: 'Ceel Dheer'});
  check(JSON.parse(h.values.get(KEY)).cities.length, 2, 'a deliberate edit saves the cleaned list');
  check(h.store.storageStatus().warning.includes('skipped'), true, 'saving cannot silently hide the recovery notice');
  for (const saved of ['{bad json', JSON.stringify({schema: 2, cities: []}), JSON.stringify({schema: 1, cities: {}}), 'x'.repeat(102401)]) {
    const broken = harness({saved});
    check(broken.store.list().length, 0);
    check(broken.store.storageStatus().persisted, false);
    check(typeof broken.store.storageStatus().error, 'string');
  }
}

{
  for (const options of [{readFails: true}, {writeFails: true}, {getterFails: true}, {mismatch: true}]) {
    const h = harness(options);
    check(h.store.storageStatus().persisted, false, 'storage failures never claim persistence');
    const added = h.store.add({name: 'Memory-only village'});
    check(h.store.list()[0].id, added.id, 'memory fallback remains usable');
    check(h.store.storageStatus().persisted, false);
    check(h.store.storageStatus().error.includes('memory'), true);
  }
  const h = harness({writeFails: true});
  h.store.add({name: 'Recovered village'});
  h.controls.writeFails = false;
  h.store.add({name: 'Persisted village'});
  check(h.store.storageStatus().persisted, true, 'later successful saves recover durable storage');
  check(harness({values: h.values}).store.list().length, 2);
  const missing = harness({missingCore: true});
  reject(() => missing.store.add({name: 'Any village'}), /watchlist has not loaded/);
  check(missing.store.storageStatus().warning.includes('not loaded'), true, 'duplicate checking fails visibly when the original cities are absent');
}

console.log(`${checks} extra-city store checks passed.`);
