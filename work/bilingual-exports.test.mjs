import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const dist = new URL('./somalia-flood-watch/dist/', import.meta.url);
const names = ['translations-so.js', 'i18n.js', 'cities.js', 'mayor.js'];
const sources = Object.fromEntries(await Promise.all(names.map(async name => [
  name, await fs.readFile(new URL(name, dist), 'utf8')
])));
const NOW = '2026-10-14T08:10:00.000Z';
const LAST = '2026-10-14T08:05:00.000Z';
const DAY = 86400000;
const days = Array.from({length: 14}, (_, index) =>
  new Date(Date.parse('2026-10-14T00:00:00Z') + index * DAY).toISOString().slice(0, 10));

function harness() {
  const preferences = new Map();
  const root = {
    location: {href: 'http://127.0.0.1:4173/'},
    localStorage: {
      getItem: key => preferences.get(key) ?? null,
      setItem: (key, value) => preferences.set(key, value)
    },
    URL
  };
  const context = vm.createContext({window: root, URL, Date, console});
  for (const name of names) vm.runInContext(sources[name], context, {filename: name});
  assert.equal(root.SiteLanguage.getLanguage(), 'en');
  return {root, api: root.CityManager, language: root.SiteLanguage};
}

function input(h, changes = {}) {
  const warning = {
    basis: 'official-warning', status: 'active', issuedAt: '2026-10-14T07:00:00Z',
    endsAt: '2026-10-15T08:00:00Z', cityNames: ['Galkayo'],
    scopeLabel: 'Somalia country-level · city extent unspecified'
  };
  return {
    cities: h.root.SOMALIA_CITIES, selectedCity: 10, selectedDate: days[0], days,
    now: NOW,
    weatherRows: days.map((date, i) => ({date, rain: i === 0 ? 10 : i === 1 ? 25 : 0,
      probability: 40, maxTemperature: 32})),
    weatherFeed: {data: [{}], lastSuccess: LAST},
    stationFeed: {data: {stations: []}, lastSuccess: LAST},
    station: null,
    officialFeed: {data: {sources: []}, lastSuccess: LAST},
    alertModel: {fresh: {official: true}, alerts: [
      {...warning, id: 'ui-title', title: 'Refresh', sourceUrl: 'https://warnings.example.test/ui-title'},
      {...warning, id: 'date-title', title: '14 Oct 2026', sourceUrl: 'https://warnings.example.test/date-title'}
    ], coverageNote: 'Warning coverage may be incomplete; no returned notice does not establish safety.'},
    catalogueFeed: {data: null},
    observedState: {metadata: null},
    community: {cityId: 'galkayo', available: true, lastSuccess: LAST, records: [
      {id: 'ui-description', cityId: 'galkayo', category: 'flood',
        description: 'Unknown', observedAt: '2026-10-14T07:30:00Z',
        deaths: null, injuries: 0, damagedProperties: 2},
      {id: 'date-description', cityId: 'galkayo', category: 'rain',
        description: '14 Oct 2026', observedAt: '2026-10-14T07:00:00Z',
        deaths: 0, injuries: null, damagedProperties: null}
    ]},
    reviews: {'ui-description': 'checked', 'date-description': 'unreviewed'},
    actions: [
      {id: 'action-ui', cityId: 'galkayo', title: 'Refresh', owner: '14 Oct 2026',
        dueDate: '2026-10-15', priority: 'high', status: 'in-progress',
        createdAt: LAST, updatedAt: LAST},
      {id: 'action-date', cityId: 'galkayo', title: '14 Oct 2026', owner: 'Alerts',
        dueDate: '', priority: 'normal', status: 'todo', createdAt: LAST, updatedAt: LAST},
      {id: 'action-blocked', cityId: 'galkayo', title: 'Unknown', owner: 'To do',
        dueDate: '', priority: 'low', status: 'blocked', createdAt: LAST, updatedAt: LAST},
      {id: 'action-done', cityId: 'galkayo', title: 'Forecast', owner: 'Done',
        dueDate: '', priority: 'normal', status: 'done', createdAt: LAST, updatedAt: LAST}
    ],
    ...changes
  };
}

function lineStarting(text, prefix) {
  const result = text.split('\n').find(line => line.startsWith(prefix));
  assert.ok(result, `Expected exported line beginning ${JSON.stringify(prefix)}`);
  return result;
}

// Read actual machine exports without changing their English interoperability schema.
function readCsv(csv) {
  return csv.split('\r\n').map(line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)]
    .map(match => match[1].replaceAll('""', '"')));
}

test('human daily briefing follows the selected language and keeps factual limitations', () => {
  const h = harness(), model = h.api.build(input(h));
  const english = h.api.briefingText(model);
  assert.match(english, /^El Nino Watch — Galkayo daily planning briefing/m);
  assert.match(english, /This is not a government dashboard\./);
  assert.match(english, /Local actions and review stages are saved on this device and are not sent to authorities\./);
  assert.match(english, /App thresholds, not flood probabilities\./);
  assert.match(english, /^COMMUNITY REPORTS — UNVERIFIED$/m);

  h.language.setLanguage('so');
  const somali = h.api.briefingText(model);
  assert.notEqual(somali, english);
  assert.match(somali, /^El Nino Watch — warbixinta kooban ee qorshaynta maalinlaha ah ee Galkayo/m);
  assert.match(somali, /Ma aha bog (?:dowladeed|maamul oo dawladdu leedahay)\./);
  assert.match(somali, /qalabkan.*looma(?:na)? diro hay'adaha/i);
  assert.match(somali, /ma aha suurtagalnimada fatahaadda/i);
  assert.match(somali, /^Roobka maanta: 10\.0 mm$/m);
  assert.match(somali, /14 Oktoobar 2026/);
  assert.match(somali, /^WARBIXINNADA BULSHADA — AAN LA XAQIIJIN$/m);
  assert.match(somali, /la xiriir xafiisyada d[ao]wladda hoose ama hay[’']adda (?:ay khusayso|ay arrintu khusayso)/i);

  h.language.setLanguage('en');
  assert.equal(h.api.briefingText(model), english, 'English export is recovered without reverse translating Somali');
  delete h.root.SiteLanguage;
  assert.equal(h.api.briefingText(model), english, 'Missing language runtime falls back to a complete English briefing');
});

test('official warning titles remain raw even when they equal UI labels or date-like text', () => {
  const h = harness(), model = h.api.build(input(h));
  h.language.setLanguage('so');
  assert.notEqual(h.language.translateText('Refresh'), 'Refresh', 'Fixture would change if treated as UI text');
  assert.notEqual(h.language.translateText('14 Oct 2026'), '14 Oct 2026', 'Fixture would change if treated as a displayed date');
  const somali = h.api.briefingText(model);
  for (const warning of model.cityWarnings) {
    const line = somali.split('\n').find(value => value.includes(warning.sourceUrl));
    assert.ok(line, 'Issuing source URL is retained');
    assert.ok(line.startsWith(warning.title + ' — '), 'Issuing title is preserved verbatim');
    assert.match(line, /Oktoobar/, 'Only generated expiry metadata is localized');
  }
});

test('user report descriptions, action titles and named owners remain raw in Somali briefing', () => {
  const h = harness(), model = h.api.build(input(h));
  h.language.setLanguage('so');
  const somali = h.api.briefingText(model);
  for (const report of model.reports) {
    const line = lineStarting(somali, report.id + ':');
    assert.ok(line.includes('; ' + report.description + ';'), 'User description retains exact spelling');
    assert.match(line, /Oktoobar/, 'Generated report observation date is localized independently');
  }
  for (const action of model.actions) {
    const line = somali.split('\n').find(value => value.includes(' | ' + action.title + ' | '));
    assert.ok(line, `Action title preserved: ${action.title}`);
    assert.ok(line.includes(': ' + action.owner + ' | '), `Named owner preserved: ${action.owner}`);
  }
  const checked = lineStarting(somali, 'ui-description:');
  assert.match(checked, /(?:Halkan|Qalabkan) dib loogu eegay/, 'Local review remains a local review label');
  assert.doesNotMatch(checked, /warbixin.*la xaqiijiyey/i, 'Local checking must not become a verified public report');
});

test('unknown reported impacts are distinguishable from explicitly reported zeros in both languages', () => {
  const h = harness(), model = h.api.build(input(h));
  assert.equal(model.reports.find(report => report.id === 'ui-description').deaths, null);
  assert.equal(model.reports.find(report => report.id === 'ui-description').injuries, 0);
  const english = h.api.briefingText(model);
  assert.match(lineStarting(english, 'ui-description:'), /deaths Unknown, injuries 0, damaged properties 2/);
  assert.match(lineStarting(english, 'date-description:'), /deaths 0, injuries Unknown, damaged properties Unknown/);
  h.language.setLanguage('so');
  const somali = h.api.briefingText(model);
  assert.match(lineStarting(somali, 'ui-description:'), /Dhimashada la soo sheegay (?:Xog aan la hayn|Xog lama hayo), Dhaawacyada la soo sheegay 0, Hantida waxyeelladu gaartay 2/);
  assert.match(lineStarting(somali, 'date-description:'), /Dhimashada la soo sheegay 0, Dhaawacyada la soo sheegay (?:Xog aan la hayn|Xog lama hayo), Hantida waxyeelladu gaartay (?:Xog aan la hayn|Xog lama hayo)/);
  assert.match(somali, /tirooyinka lama isku daro/i, 'Overlapping report claims are not represented as summed city totals');
});

test('machine action CSV retains identical English schema, statuses and raw records in both languages', () => {
  const h = harness(), model = h.api.build(input(h));
  const english = h.api.csvText(model);
  h.language.setLanguage('so');
  const somali = h.api.csvText(model);
  assert.equal(somali, english, 'Machine export is independent of presentation language');
  const rows = readCsv(somali);
  assert.deepEqual(rows[0], ['city', 'title', 'owner', 'due_date', 'priority', 'status', 'created_at', 'updated_at']);
  assert.deepEqual(rows.slice(1).map(row => row[5]), ['in-progress', 'todo', 'blocked', 'done']);
  assert.deepEqual(rows.slice(1).map(row => row[4]), ['high', 'normal', 'low', 'normal']);
  assert.deepEqual(rows.slice(1).map(row => row[1]), ['Refresh', '14 Oct 2026', 'Unknown', 'Forecast']);
  assert.deepEqual(rows.slice(1).map(row => row[2]), ['14 Oct 2026', 'Alerts', 'To do', 'Done']);
  assert.ok(rows.slice(1).every(row => row[0] === 'Galkayo' && row[6] === LAST && row[7] === LAST));
  assert.equal(rows[1][3], '2026-10-15');
  assert.equal(rows[2][3], '', 'Unset due dates remain empty rather than an invented date');
});

test('Somali briefing localizes generated missing-data and expiry labels while keeping source titles raw', () => {
  const h = harness(), model = h.api.build(input(h));
  h.language.setLanguage('so');
  const somali = h.api.briefingText(model);
  assert.equal(model.observation.date, null);
  assert.equal(model.catalogue.radarScene, null);
  assert.equal(model.catalogue.opticalScene, null);
  const generatedRows = somali.split('\n').filter(line =>
    /Copernicus|warnings\.example\.test|Mandek Consulting/.test(line));
  const generated = generatedRows.join('\n');
  assert.doesNotMatch(generated, /\bTime unavailable\b/, 'Generated missing-acquisition time label is Somali');
  assert.doesNotMatch(generated, /\bunavailable UTC\b/, 'Generated missing-product date label is Somali');
  assert.doesNotMatch(generated, /; Expires /, 'Generated warning expiry label is Somali');
  assert.doesNotMatch(generated, /^Created by /m, 'Generated creator label is Somali');
  assert.match(somali, /^Refresh — /m, 'Source warning text stays original despite generated-label translation');
  assert.match(somali, /^14 Oct 2026 — /m, 'Date-looking source warning text stays original');
  assert.match(somali, /contact@mandekconsulting\.com · elninowatch\.so/);
});
