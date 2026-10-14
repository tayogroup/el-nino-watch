import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseDate, parseStations, parseEnso, parseWeeklyNino} from './somalia-flood-watch/feeds.mjs';

test('SWALIM actual station HTML preserves dates, levels, thresholds and missing gauges', async () => {
  const rows = parseStations(await readFile(new URL('./swalim-stations.html', import.meta.url), 'utf8'));
  assert.equal(rows.length, 11);
  const jowhar = rows.find(r => r.code === 'SH004');
  assert.equal(jowhar.name, 'Jowhar');
  assert.equal(jowhar.observedAt, '2026-10-13');
  assert.equal(jowhar.levelM, 5.37);
  assert.equal(jowhar.moderateM, 5);
  assert.equal(jowhar.highM, 5.25);
  assert.equal(jowhar.bankFullM, 5.5);
  assert.equal(rows.find(r => r.code === 'JB002').levelM, null);
  assert.equal(rows.find(r => r.code === 'JB001').levelM, 4.1);
  assert.equal(rows.find(r => r.code === 'SH006').observedAt, '2008-12-31');
});

test('NOAA advisory uses source issue date, decodes Niño and does not use the next release date', () => {
  const item = parseEnso('<p>DIAGNOSTIC DISCUSSION</p><p>8 October 2026</p><p>ENSO Alert System Status: <a>El Ni&ntilde;o Advisory</a></p><p>Synopsis: El Niño continues to strengthen. Detailed description.</p><p>The next discussion is scheduled for 12 November 2026.</p>');
  assert.equal(item.issuedAt, '2026-10-08');
  assert.equal(item.alertStatus, 'El Niño Advisory');
  assert.equal(item.synopsis, 'El Niño continues to strengthen.');
  assert.throws(() => parseEnso('Source unavailable'));
});

test('NOAA weekly fixed-width negative anomalies and different dates parse correctly', () => {
  const weekly = parseWeeklyNino('Week SST SSTA\n  30SEP2026     26.1 5.3     29.0 4.0     29.9 3.2     29.9 1.2\n  07OCT2026     26.1-0.2     29.0 4.1     30.0-0.3     29.9 1.3\n');
  assert.equal(weekly.date, '2026-10-07');
  assert.equal(weekly.nino34Sst, 30);
  assert.equal(weekly.nino34Anomaly, -0.3);
  assert.equal(parseDate('Oct. 13, 2026'), '2026-10-13');
  assert.equal(parseDate('31 February 2026'), null);
});
