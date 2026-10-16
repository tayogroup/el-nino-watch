import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const dist = new URL('./somalia-flood-watch/dist/', import.meta.url);
const index = await readFile(new URL('index.html', dist), 'utf8');
const start = index.indexOf('<section class="health-alert" id="health-alert"');
const section = index.slice(start, index.indexOf('</section>', start) + '</section>'.length);

test('the public health alert sits at the bottom of the Alerts tab', () => {
  const alerts = index.indexOf('id="alerts-panel"'), next = index.indexOf('<section', alerts + 1 + section.length);
  assert.ok(start > alerts, 'after the alerts panel opens');
  assert.ok(start > index.indexOf('East Africa Hazards Watch ↗</a>', alerts), 'below the alert list and its links');
  assert.ok(index.indexOf('</section>', start + section.length - 1) < index.indexOf('id="daily-panel"'), 'and inside the alerts panel');
  assert.ok(next > start);
});

test('its content: eight diseases, five actions, WHO sources only, and never an official warning', () => {
  assert.equal((section.match(/<tr><th scope="row">/g) || []).length, 8);
  for (const disease of ['Cholera and other acute diarrhoeal diseases', 'Dysentery and typhoid fever', 'Hepatitis A and E', 'Malaria', 'Dengue fever', 'Rift Valley fever', 'Skin and wound infections', 'Measles and respiratory infections']) assert.ok(section.includes(`<th scope="row">${disease}</th>`), disease);
  assert.equal((section.match(/<li><b>/g) || []).length, 5);
  const links = [...section.matchAll(/<a href="([^"]+)"/g)].map(match => match[1]);
  assert.equal(links.length, 6);
  for (const href of links) assert.match(href, /^https:\/\/(cdn|www)\.who\.int\//, href);
  assert.ok(links.includes('https://cdn.who.int/media/docs/default-source/meeting-reports/global-public-health-situation-analysis-el-nino-2026_.pdf'));
  assert.ok(section.includes('Health guidance from WHO · not an outbreak report'));
  assert.ok(section.includes('It is not an official warning or an outbreak report'));
  assert.doesNotMatch(section.replace('It is not an official warning or an outbreak report', ''), /official warning/i, 'no other claim about official status');
});

test('every piece of its text reads in Somali', async () => {
  const document = {readyState: 'complete', title: '', body: {nodeType: 11, childNodes: []}, documentElement: {setAttribute() {}}, getElementById: () => null, querySelectorAll: () => []};
  const window = {document, location: {href: 'https://elninowatch.so/?lang=so', protocol: 'https:'}, localStorage: {getItem: () => null, setItem() {}}};
  const context = vm.createContext({window, URL});
  vm.runInContext(await readFile(new URL('translations-so.js', dist), 'utf8'), context);
  vm.runInContext(await readFile(new URL('i18n.js', dist), 'utf8'), context);
  const texts = [...section.matchAll(/>([^<>]+)</g)].map(match => match[1].replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()).filter(text => /[A-Za-z]/.test(text));
  assert.ok(texts.length > 50, 'the section text was read');
  const untranslated = texts.filter(text => window.SiteLanguage.translateText(text) === text);
  assert.deepEqual(untranslated, []);
  assert.equal(window.SiteLanguage.translateText('Malaria'), 'Duumada');
  assert.match(window.SiteLanguage.translateText('WHO: Cholera fact sheet ↗'), /^WHO: Warqadda xaqiiqooyinka daacuunka ↗$/);
});

test('the health alert has a Share row, and its post fits X whole in English and Somali', async () => {
  assert.ok(section.includes('<div id="health-share"></div></section>'), 'the row sits at the end of the section');
  for (const lang of ['en', 'so']) {
    const nodes = {'health-share': {innerHTML: ''}};
    const document = {readyState: 'complete', title: '', body: {nodeType: 11, childNodes: []}, documentElement: {setAttribute() {}}, getElementById: id => nodes[id] || null, querySelectorAll: () => [], addEventListener() {}};
    const window = {document, location: {href: `https://elninowatch.so/?lang=${lang}`, protocol: 'https:'}, localStorage: {getItem: () => null, setItem() {}}, navigator: {}};
    const context = vm.createContext({window, URL, URLSearchParams, Date});
    for (const file of ['translations-so.js', 'i18n.js', 'share.js', 'alerts.js']) vm.runInContext(await readFile(new URL(file, dist), 'utf8'), context);
    const row = nodes['health-share'].innerHTML;
    assert.match(row, /^<div class="share-row" role="group" aria-label="Share" data-share-lines="/);
    assert.match(row, /data-share-tab="alerts"/);
    const text = window.SiteShare.textOf(window.FloodAlerts.healthShareLines);
    assert.equal(text.split('\n').length, 3);
    assert.equal(window.SiteShare.fit(text), text, `${lang}: nothing is cut or dropped for X`);
    assert.match(text.split('\n')[2], lang === 'so' ? /^Talo caafimaad oo ka timid WHO/ : /^Health guidance from WHO, not an outbreak report\.$/);
    if (lang === 'so') assert.doesNotMatch(text, /\b(the|and|with)\b/, 'the Somali post has no English left');
  }
});
