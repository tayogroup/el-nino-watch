import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./somalia-flood-watch/dist/share.js', import.meta.url), 'utf8');
function load({language = 'en', share = null, clipboard = null} = {}) {
  const listeners = [];
  const translations = {'Rainfall today': 'Roobka maanta', 'Not an official warning.': 'Ma aha digniin rasmi ah.'};
  const window = {
    document: {addEventListener: (type, listener) => listeners.push({type, listener})},
    navigator: {...(share ? {share} : {}), ...(clipboard ? {clipboard} : {})},
    SiteLanguage: {getLanguage: () => language, translateText: text => language === 'so' ? translations[text] ?? text : text},
    setTimeout: () => 0
  };
  vm.runInContext(source, vm.createContext({window, URL, URLSearchParams}));
  return {api: window.SiteShare, listeners};
}
// A share row element and one of its buttons, as the click handler sees them.
function click(api, rowHtml, kind) {
  const attribute = name => rowHtml.match(new RegExp(`${name}="([^"]*)"`))?.[1]?.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&') ?? null;
  const row = {getAttribute: attribute};
  const button = {attrs: {'data-share': kind}, textContent: '', getAttribute(name) { return this.attrs[name] ?? null; }, setAttribute(name, value) { this.attrs[name] = value; }, closest: () => row};
  api.onClick({target: {closest: () => button}});
  return button;
}
const lines = [['El Nino Watch · ', {t: 'Rainfall today'}, ' · 15 Oct · EAT'], ['1. Kismayo — 42.0 mm'], [{t: 'Not an official warning.'}]];

test('the text is built in the page language: titles and notes translated, city names and numbers as written', () => {
  assert.equal(load().api.textOf(lines), 'El Nino Watch · Rainfall today · 15 Oct · EAT\n1. Kismayo — 42.0 mm\nNot an official warning.');
  assert.equal(load({language: 'so'}).api.textOf(lines), 'El Nino Watch · Roobka maanta · 15 Oct · EAT\n1. Kismayo — 42.0 mm\nMa aha digniin rasmi ah.');
});

test('the link opens the right tab, in Somali for a Somali reader; anything else is dropped', () => {
  assert.equal(load().api.linkFor('alerts'), 'https://elninowatch.so/#tab=alerts');
  assert.equal(load({language: 'so'}).api.linkFor('overview'), 'https://elninowatch.so/?lang=so#tab=overview');
  assert.equal(load().api.linkFor('javascript:alert(1)'), 'https://elninowatch.so/');
});

test('X gets the text and link, trimmed to fit a post; Facebook gets the link', () => {
  const {api, listeners} = load({language: 'so'});
  assert.equal(listeners[0].type, 'click', 'one click listener for every share row');
  const html = api.row(lines, 'overview');
  const x = new URL(click(api, html, 'x').attrs.href);
  assert.equal(x.origin + x.pathname, 'https://twitter.com/intent/tweet');
  assert.equal(x.searchParams.get('text'), api.textOf(lines));
  assert.equal(x.searchParams.get('url'), 'https://elninowatch.so/?lang=so#tab=overview');
  const facebook = new URL(click(api, html, 'facebook').attrs.href);
  assert.equal(facebook.origin + facebook.pathname, 'https://www.facebook.com/sharer/sharer.php');
  assert.equal(facebook.searchParams.get('u'), 'https://elninowatch.so/?lang=so#tab=overview');
  const long = api.fit('x'.repeat(400));
  assert.equal(long.length, 256); assert.ok(long.endsWith('…'));
  assert.equal(api.fit('short'), 'short');
  // A long list loses its lowest-ranked cities, never its title or closing disclaimer.
  const list = ['El Nino Watch · Flood watch', ...[1, 2, 3, 4, 5].map(n => `${n}. ${'City'.repeat(10)} — 10.0 mm/day`), 'Rainfall-based planning screen, not a flood forecast or an official warning.'].join('\n');
  const english = load().api, kept = english.fit(list).split('\n');
  assert.ok(english.fit(list).length <= 256);
  assert.equal(kept[0], 'El Nino Watch · Flood watch'); assert.equal(kept.at(-1), 'Not an official warning.', 'a long disclaimer becomes the short one');
  assert.ok(kept[1].startsWith('1. ') && kept.length < 7, 'the top cities stay, the lowest go');
  // A list that fits once the disclaimer is shortened keeps all five cities.
  const fiveFit = ['El Nino Watch · Flood watch', ...[1, 2, 3, 4, 5].map(n => `${n}. City${n} — 10.0 mm/day`), 'x'.repeat(200)].join('\n');
  assert.equal(english.fit(fiveFit).split('\n').filter(line => /^\d\. /.test(line)).length, 5);
  assert.equal(load({language: 'so'}).api.fit(fiveFit).split('\n').at(-1), 'Ma aha digniin rasmi ah.', 'in the page language');
});

test('the phone share menu (TikTok, WhatsApp...) is offered only where the browser has one', async () => {
  assert.equal(load().api.row(lines, 'overview').includes('data-share="device"'), false);
  const shared = [];
  const {api} = load({share: async data => { shared.push(data); }});
  const html = api.row(lines, 'alerts');
  assert.match(html, /data-share="device">TikTok, WhatsApp &amp; more<\/button>/);
  click(api, html, 'device');
  assert.equal(JSON.stringify(shared), JSON.stringify([{title: 'El Nino Watch', text: api.textOf(lines), url: 'https://elninowatch.so/#tab=alerts'}]));
});

test('Copy text copies the text and link and says so', async () => {
  const copied = [];
  const {api} = load({clipboard: {writeText: async text => { copied.push(text); }}});
  const button = click(api, api.row(lines, 'overview'), 'copy');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(copied[0], api.textOf(lines) + '\nhttps://elninowatch.so/#tab=overview');
  assert.equal(button.textContent, 'Copied');
});

test('the row escapes its text and keeps the service names out of translation', () => {
  const html = load().api.row([['<b>"quoted"</b>']], 'overview');
  assert.ok(!html.includes('<b>"quoted"'));
  assert.match(html, /<span data-i18n-skip>X \(Twitter\)<\/span>/);
  assert.match(html, /<span data-i18n-skip>Facebook<\/span>/);
});
