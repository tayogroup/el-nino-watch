import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';

const script = fs.readFileSync(new URL('./somalia-flood-watch/dist/mayor-store.js', import.meta.url), 'utf8');
const cityScript = fs.readFileSync(new URL('./somalia-flood-watch/dist/cities.js', import.meta.url), 'utf8');
const KEY = 'somalia-city-manager-v1';
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const reject = (call, pattern = /./) => { assert.throws(call, pattern); checks++; };
const plain = value => JSON.parse(JSON.stringify(value));

function harness({saved, values = new Map(), crypto = {randomUUID}, readFails = false, writeFails = false, mismatch = false, storageGetterFails = false} = {}) {
  if (saved !== undefined) values.set(KEY, saved);
  const controls = {readFails, writeFails, mismatch};
  const storage = {
    getItem(key) { if (controls.readFails) throw new Error('Denied'); return controls.mismatch ? null : values.get(key) ?? null; },
    setItem(key, value) { if (controls.writeFails) throw new Error('Quota'); values.set(key, String(value)); }
  };
  const root = {crypto};
  Object.defineProperty(root, 'localStorage', {get() { if (storageGetterFails) throw new Error('SecurityError'); return storage; }});
  const context = vm.createContext({window: root, console, fetch() { throw new Error('Local dashboard must never use the network.'); }});
  vm.runInContext(cityScript, context);
  vm.runInContext(script, context);
  return {store: root.CityManagerStore, values, controls, root};
}

{
  const h = harness();
  check(plain(h.store.storageStatus()), {persisted: true, error: null}, 'storage is confirmed by a write and read');
  check(h.root.SOMALIA_CITIES.length, 30);
  for (const city of h.root.SOMALIA_CITIES) check(h.store.list(city[0].toLowerCase().replace(/[^a-z0-9]+/g, '-')).length, 0, 'all cities start without fake actions');
  check(plain(JSON.parse(h.values.get(KEY))), {schema: 1, cities: {}}, 'private storage is separate from community records');
  const action = h.store.add('Galkayo', {title: ' Clear market drain ', owner: ' Works team ', dueDate: '2028-02-29', priority: 'high'});
  check(plain({cityId: action.cityId, title: action.title, owner: action.owner, dueDate: action.dueDate, priority: action.priority, status: action.status}), {cityId: 'galkayo', title: 'Clear market drain', owner: 'Works team', dueDate: '2028-02-29', priority: 'high', status: 'todo'});
  check(Number.isFinite(Date.parse(action.createdAt)) && action.createdAt === action.updatedAt, true);
  check(h.store.list('mogadishu').length, 0, 'city actions remain isolated');
  check(h.store.list('galkayo').length, 1);
  const publicCopy = h.store.list('galkayo');
  publicCopy[0].title = 'Mutated elsewhere'; publicCopy.push({}); action.title = 'Also mutated';
  check(h.store.list('galkayo')[0].title, 'Clear market drain', 'records returned to UI cannot mutate storage');
  reject(() => h.store.update('mogadishu', action.id, {status: 'done'}), /not found/);
  const updated = h.store.update('galkayo', action.id, {status: 'in-progress', owner: null, dueDate: null, priority: 'normal'});
  check(plain({status: updated.status, owner: updated.owner, dueDate: updated.dueDate, priority: updated.priority}), {status: 'in-progress', owner: '', dueDate: '', priority: 'normal'});
  check(updated.createdAt, action.createdAt);
  for (const status of ['blocked', 'done', 'todo']) check(h.store.update('galkayo', action.id, {status}).status, status);
  const reportId = '01856394-79e5-4812-9b8a-74d1bf1361da';
  check(h.store.reviewStatus('galkayo', reportId), 'unreviewed');
  for (const status of ['checking', 'checked', 'escalated', 'unreviewed']) {
    check(h.store.review('galkayo', reportId, status).status, status);
    check(h.store.reviewStatus('galkayo', reportId), status);
  }
  h.store.review('galkayo', reportId, 'checked');
  check(h.store.reviewStatus('mogadishu', reportId), 'unreviewed', 'review labels are scoped to the selected city');
  const reload = harness({values: h.values});
  check(plain(reload.store.list('galkayo')), plain(h.store.list('galkayo')), 'actions persist across reload');
  check(reload.store.reviewStatus('galkayo', reportId), 'checked', 'local review status persists');
  check(reload.store.remove('galkayo', action.id), true);
  check(reload.store.remove('galkayo', action.id), false);
  check(harness({values: h.values}).store.list('galkayo').length, 0, 'deletion persists');
  check(JSON.parse(h.values.get(KEY)).cities.galkayo.reviews.length, 1, 'changing review status updates one record');
}

{
  const h = harness();
  const defaulted = h.store.add('mogadishu', {title: 'Inspect culverts', owner: null, dueDate: null});
  check(plain({owner: defaulted.owner, dueDate: defaulted.dueDate, priority: defaulted.priority}), {owner: '', dueDate: '', priority: 'normal'});
  for (const title of [undefined, null, '', '  ', 12, 'x'.repeat(161), 'two\nlines', 'control\u0085character']) reject(() => h.store.add('mogadishu', {title}));
  for (const city of [null, undefined, '', 'unknown', '__proto__', 'constructor', 'Buur Hakaba']) reject(() => h.store.list(city), /supported city/);
  for (const date of ['2027-02-29', '2026-02-30', '2026-13-01', '2026-00-01', '2026-04-31', '0000-01-01', '2026-1-01', '2026-10-13T00:00:00Z', 1]) reject(() => h.store.update('mogadishu', defaulted.id, {dueDate: date}), /date/);
  check(h.store.update('mogadishu', defaulted.id, {dueDate: '2026-02-28'}).dueDate, '2026-02-28');
  for (const owner of [4, {}, 'x'.repeat(101), 'control\u0000character']) reject(() => h.store.update('mogadishu', defaulted.id, {owner}));
  for (const status of [null, undefined, 'verified', 'complete', 'escalated']) reject(() => h.store.update('mogadishu', defaulted.id, {status}), /status/);
  for (const priority of [null, 'urgent', 1]) reject(() => h.store.add('mogadishu', {title: 'Inspect drains', priority}), /priority/);
  for (const status of ['verified', 'done', undefined, null]) reject(() => h.store.review('mogadishu', 'report-1', status), /status/);
  for (const id of ['', '__proto__', 'constructor', 'x'.repeat(101), '<script>', null]) reject(() => h.store.reviewStatus('mogadishu', id), /ID/);
  reject(() => h.store.add('mogadishu', {title: 'Task', status: 'done'}), /unsupported/);
  reject(() => h.store.update('mogadishu', defaulted.id, JSON.parse('{"__proto__":{"polluted":true}}')), /unsupported/);
  reject(() => h.store.add('mogadishu', JSON.parse('{"title":"Task","constructor":{"prototype":{"polluted":true}}}')), /unsupported/);
  reject(() => h.store.add('mogadishu', Object.create({title: 'Inherited task'})), /inherited/);
  check({}.polluted, undefined);
  check(h.store.list('mogadishu')[0].status, 'todo', 'failed updates leave the saved action unchanged');
  const nullProto = Object.create(null); nullProto.title = 'Drain inspection';
  check(h.store.add('mogadishu', nullProto).title, 'Drain inspection');
}

{
  const h = harness({writeFails: true});
  check(h.store.storageStatus().persisted, false, 'initial write failure never claims persistence');
  check(/memory/.test(h.store.storageStatus().error), true);
  const action = h.store.add('galkayo', {title: 'Inspect crossing'});
  h.store.review('galkayo', 'report-1', 'escalated');
  check(h.store.list('galkayo')[0].id, action.id, 'storage failure keeps the action in memory');
  check(h.store.reviewStatus('galkayo', 'report-1'), 'escalated');
  h.controls.writeFails = false;
  h.store.update('galkayo', action.id, {status: 'blocked'});
  check(plain(h.store.storageStatus()), {persisted: true, error: null}, 'later successful save clears the failure');
  check(harness({values: h.values}).store.reviewStatus('galkayo', 'report-1'), 'escalated', 'recovery saves prior in-memory changes');
  for (const options of [{readFails: true}, {storageGetterFails: true}, {mismatch: true}]) {
    const unavailable = harness(options);
    check(unavailable.store.storageStatus().persisted, false);
    unavailable.store.add('mogadishu', {title: 'Local task'});
    check(unavailable.store.list('mogadishu').length, 1);
    check(unavailable.store.storageStatus().persisted, false);
  }
}

{
  const good = harness();
  good.store.add('galkayo', {title: 'Inspect canal'});
  good.store.review('galkayo', 'report-1', 'checking');
  const payload = () => JSON.parse(good.values.get(KEY));
  const duplicate = payload(); duplicate.cities.galkayo.actions.push({...duplicate.cities.galkayo.actions[0]});
  const duplicateReview = payload(); duplicateReview.cities.galkayo.reviews.push({...duplicateReview.cities.galkayo.reviews[0]});
  const wrongCity = payload(); wrongCity.cities.galkayo.actions[0].cityId = 'mogadishu';
  const invalidDate = payload(); invalidDate.cities.galkayo.actions[0].dueDate = '2027-02-29';
  const verified = payload(); verified.cities.galkayo.reviews[0].status = 'verified';
  const invalidTime = payload(); invalidTime.cities.galkayo.actions[0].updatedAt = 'yesterday';
  const actionOverflow = payload(); actionOverflow.cities.galkayo.actions = Array.from({length: 201}, (_, i) => ({...actionOverflow.cities.galkayo.actions[0], id: `action-${i}`}));
  for (const saved of ['{broken', 'null', JSON.stringify({schema: 2, cities: {}}), '{"schema":1,"cities":{"__proto__":{"actions":[],"reviews":[]}}}', ...[duplicate, duplicateReview, wrongCity, invalidDate, verified, invalidTime, actionOverflow].map(JSON.stringify)]) {
    const h = harness({saved});
    check(h.store.list('galkayo').length, 0, 'malformed storage is ignored without throwing during load');
    check(h.store.storageStatus().persisted, false);
    check(/invalid.*ignored/.test(h.store.storageStatus().error), true);
    check(h.values.get(KEY), saved, 'invalid data is retained until an intentional new edit');
    h.store.add('mogadishu', {title: 'Start fresh'});
    check(h.store.storageStatus().persisted, true);
    check(harness({values: h.values}).store.list('mogadishu').length, 1);
  }
}

{
  const timestamp = '2026-10-13T09:00:00.000Z';
  const retired = ['badhan', 'zeila', 'wanlaweyn', 'eyl'];
  const replacements = ['adado', 'guriceel', 'cabudwaaq', 'buulobarde'];
  const saved = {schema: 1, cities: {
    galkayo: {actions: [{id: 'existing-galkayo-action', cityId: 'galkayo', title: 'Inspect Galkayo drain', owner: 'Works team', dueDate: '2026-10-20', priority: 'normal', status: 'todo', createdAt: timestamp, updatedAt: timestamp}], reviews: [{reportId: 'existing-galkayo-report', status: 'checking', updatedAt: timestamp}]}
  }};
  for (const city of retired) saved.cities[city] = {
    actions: [{id: `archived-${city}-action`, cityId: city, title: `Inspect ${city} drainage`, owner: 'Original works team', dueDate: '2026-10-20', priority: 'high', status: 'blocked', createdAt: timestamp, updatedAt: timestamp}],
    reviews: [{reportId: `archived-${city}-report`, status: 'checked', updatedAt: timestamp}]
  };
  const h = harness({saved: JSON.stringify(saved)});
  check(plain(h.store.storageStatus()), {persisted: true, error: null}, 'retired city buckets do not invalidate the current dashboard');
  check(plain(JSON.parse(h.values.get(KEY))), saved, 'valid archived actions and reviews are preserved during load');
  check(h.store.list('galkayo')[0].id, 'existing-galkayo-action', 'unaffected current city data remains accessible');
  check(h.store.reviewStatus('galkayo', 'existing-galkayo-report'), 'checking');
  for (const city of retired) {
    reject(() => h.store.list(city), /supported city/);
    reject(() => h.store.add(city, {title: 'New retired city action'}), /supported city/);
    reject(() => h.store.update(city, `archived-${city}-action`, {status: 'done'}), /supported city/);
    reject(() => h.store.remove(city, `archived-${city}-action`), /supported city/);
    reject(() => h.store.review(city, `archived-${city}-report`, 'checking'), /supported city/);
    reject(() => h.store.reviewStatus(city, `archived-${city}-report`), /supported city/);
  }
  for (const city of replacements) {
    check(h.store.list(city).length, 0, 'replacement cities never inherit archived actions');
    const action = h.store.add(city, {title: `Inspect ${city} drain`});
    check(action.cityId, city);
    check(h.store.update(city, action.id, {status: 'in-progress'}).status, 'in-progress', 'replacement cities support normal actions');
    check(h.store.reviewStatus(city, `archived-${retired[replacements.indexOf(city)]}-report`), 'unreviewed', 'archived reviews are not reassigned');
  }
  h.store.update('galkayo', 'existing-galkayo-action', {status: 'done'});
  const persisted = JSON.parse(h.values.get(KEY));
  for (const city of retired) check(persisted.cities[city], saved.cities[city], 'adding or updating active actions preserves each original archived bucket');
  const reload = harness({values: h.values});
  check(plain(reload.store.storageStatus()), {persisted: true, error: null});
  check(reload.store.list('galkayo')[0].status, 'done');
  for (const city of replacements) check(reload.store.list(city)[0].cityId, city);
  for (const city of retired) check(JSON.parse(reload.values.get(KEY)).cities[city], saved.cities[city], 'retired records remain unchanged after another reload');
  for (const city of ['never-monitored', 'constructor', '__proto__']) {
    const invalid = structuredClone(saved);
    Object.defineProperty(invalid.cities, city, {value: {actions: [], reviews: []}, enumerable: true});
    const encoded = JSON.stringify(invalid), rejected = harness({saved: encoded});
    check(rejected.store.storageStatus().persisted, false, 'archive validation accepts only the four explicit retired locations');
    check(/invalid.*ignored/.test(rejected.store.storageStatus().error), true);
    check(rejected.values.get(KEY), encoded, 'invalid storage is not rewritten during load');
    reject(() => rejected.store.list(city), /supported city/);
  }
}

{
  const h = harness({crypto: {randomUUID: () => 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'}});
  const first = h.store.add('galkayo', {title: 'First action'});
  const second = h.store.add('mogadishu', {title: 'Second action'});
  check(first.id !== second.id, true, 'a repeated crypto value falls back to a unique local ID');
  const noCrypto = harness({crypto: null});
  const ids = Array.from({length: 200}, (_, i) => noCrypto.store.add('galkayo', {title: `Action ${i}`}).id);
  check(new Set(ids).size, 200, 'the fallback is unique within a city');
  reject(() => noCrypto.store.add('galkayo', {title: 'Over limit'}), /200-action limit/);
  check(noCrypto.store.add('mogadishu', {title: 'Other city action'}).cityId, 'mogadishu', 'per-city limit does not block another city');
  for (let i = 0; i < 1000; i++) noCrypto.store.review(i < 500 ? 'galkayo' : 'mogadishu', `report-${i}`, 'checking');
  reject(() => noCrypto.store.review('mogadishu', 'report-extra', 'checked'), /1000-review limit/);
  check(noCrypto.store.review('galkayo', 'report-0', 'checked').status, 'checked', 'existing reviews can be updated at the limit');
  check(harness({values: noCrypto.values}).store.list('galkayo').length, 200, 'bounded records remain valid after reload');
  const throwingCrypto = harness({crypto: {randomUUID() { throw new Error('Unavailable'); }}});
  check(throwingCrypto.store.add('galkayo', {title: 'Fallback action'}).id.startsWith('local-'), true, 'crypto failures still allow a local action');
}

console.log(`City manager local store passed ${checks} checks.`);
