import assert from 'node:assert/strict';
import { harness, weatherFixture, citiesFixture, BASE } from './somalia-flood-watch/verify.mjs';

const indices = html => [...html.matchAll(/data-city="(\d+)"/g)].map(match => Number(match[1]));
const weather = weatherFixture();
for (const city of weather) city.daily.precipitation_sum.fill(0);
for (const [index, peak] of [[0, 9.9], [1, 10], [2, 24.9], [3, 25], [4, 25], [17, 10]]) weather[index].daily.precipitation_sum[6] = peak;
weather[4].daily.precipitation_sum[7] = null;
weather[16].daily.precipitation_sum.fill(1);
const h = harness({ weather });
await h.settle();

assert.deepEqual(indices(h.get('rows').innerHTML), Array.from({ length: 15 }, (_, index) => index));
assert.deepEqual(indices(h.get('rows-secondary').innerHTML), Array.from({ length: 15 }, (_, index) => index + 15));
const all = [...indices(h.get('rows').innerHTML), ...indices(h.get('rows-secondary').innerHTML)];
assert.equal(new Set(all).size, 30, 'every city appears once across the two fixed columns');

assert.equal(h.evaluate('summary(0).risk'), 'Lower');
assert.equal(h.evaluate('summary(1).risk'), 'Watch');
assert.equal(h.evaluate('summary(2).risk'), 'Watch');
assert.equal(h.evaluate('summary(3).risk'), 'Elevated');
assert.equal(h.evaluate('summary(4).risk'), 'Unavailable');
assert.equal(h.evaluate('summary(4).total'), null, 'missing daily rainfall cannot become a zero total');
assert.equal(h.evaluate('summary(4).riskWatch'), false, 'incomplete forecasts cannot contribute to the threshold count');
assert.equal(h.evaluate('summary(16).risk'), 'Lower', '14-day total exceeding 10 mm does not satisfy a daily threshold');
assert.equal(h.get('elevated').textContent, 4, '10 and 24.9 mm/day qualify alongside elevated days');
assert.equal(h.get('coverage').textContent, '≥10 mm/day · 29/30 complete forecasts');

h.get('search').value = 'Shabelle';
h.get('search').oninput();
assert.deepEqual(indices(h.get('rows').innerHTML), [7, 8, 9]);
assert.deepEqual(indices(h.get('rows-secondary').innerHTML), [17], 'Cabudwaaq replaced Wanlaweyn and belongs to Galgaduud, not Shabelle');
h.get('search').value = ' Laasqoray ';
h.get('search').oninput();
assert.deepEqual(indices(h.get('rows').innerHTML), []);
assert.deepEqual(indices(h.get('rows-secondary').innerHTML), [29]);
h.evaluate('selectCity(29)');
await h.settle();
assert.equal(h.get('citytitle').textContent, citiesFixture[29][0]);
assert.match(h.get('rows-secondary').innerHTML, /class="selected-city"/);
assert.match(h.get('rows-secondary').innerHTML, /data-city="29" aria-current="true"/);

h.get('search').value = '';
h.get('search').oninput();
h.setTime(BASE + 121 * 60000);
h.evaluate('render()');
assert.match(h.get('rows-secondary').innerHTML, /Watch · stale/, 'old forecasts retain their stale label');
const csv = h.evaluate('exportForecast()');
const exported = (await csv.text()).trim().split(/\r?\n/);
assert.equal(exported.length, 421, 'both groups still export all 420 city/day records plus a header');

const unavailable = harness({ weatherError: 'offline' });
await unavailable.settle();
assert.equal(unavailable.get('elevated').textContent, '—');
assert.equal(unavailable.get('coverage').textContent, '≥10 mm/day · 0/30 complete forecasts');
assert.match(unavailable.get('rows').innerHTML, /Unavailable/);
assert.match(unavailable.get('rows-secondary').innerHTML, /Unavailable/);
// One line per city, "Mogadishu, Banaadir", and tighter rows (owner, 2026-10-16). The rows keep the button + small markup;
// the stylesheet puts them on one line, after the earlier block rules, and print keeps its own.
assert.match(h.get('rows').innerHTML, /<td><button data-city="\d+"[^>]*>[^<]+<\/button><small>[^<]+<\/small><\/td>/);
{
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('./somalia-flood-watch/dist/watchlist.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('one line per city'), css.indexOf('@media print{.site-disclaimer'));
  assert.ok(css.indexOf('one line per city') > css.indexOf('@media(max-width:600px){.site-disclaimer'), 'after the phone rules it overrides');
  for (const rule of ['.watchlist-group td:first-child{white-space:nowrap', '.watchlist-group td:first-child small{display:inline', '.watchlist-group td:first-child small::before{content:", "}', '.watchlist-group td{padding-top:5px;padding-bottom:5px}'])
    assert.ok(block.includes(rule), rule);
  // The evidence column's Somali fits one line on a phone (owner, 2026-10-16): the cell has 175px at 375px wide; this is 151px.
  // "Xogta waxyeellada magaalada lama hayo" (257px) took two lines.
  const catalog = JSON.parse(readFileSync(new URL('./i18n-public.json', import.meta.url), 'utf8'));
  assert.equal(catalog.messages['City impacts unavailable'], 'Xog saameyn lama hayo');
}
console.log('PASS watchlist: two groups of 15, searching/selection, daily threshold boundaries, missing/stale data, and 420-row export.');
