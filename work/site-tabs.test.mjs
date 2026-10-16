import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const dist = new URL('./somalia-flood-watch/dist/', import.meta.url);
const html = await readFile(new URL('index.html', dist), 'utf8');
const app = await readFile(new URL('app.js', dist), 'utf8');
const tabsJs = await readFile(new URL('tabs.js', dist), 'utf8');
const TABS = ['overview', 'weather', 'map', 'alerts', 'diseases', 'community', 'sources'];
// Blocks shown on every tab, or only in the mayor view.
const GLOBAL = ['site-disclaimer', 'intro', 'livebar', 'manager-tool-bar', 'mayor-extension-bar', 'mayor-panel', 'site-bar', 'site-footer'];
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

// Direct children of <main>, from a small tag walker (no DOM library in this repo).
function mainChildren(source) {
  const start = source.indexOf('<main'), end = source.indexOf('</main>');
  const body = source.slice(source.indexOf('>', start) + 1, end);
  const children = [];
  let depth = 0;
  for (const match of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, name, attrs, selfClosing] = match;
    if (closing) { depth--; continue; }
    if (depth === 0) children.push({name, attrs});
    if (!selfClosing && !VOID.has(name.toLowerCase())) depth++;
  }
  assert.equal(depth, 0, 'main is balanced');
  return children;
}
const attr = (attrs, name) => (attrs.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1];

test('every block in <main> belongs to a tab or is deliberately global', () => {
  const children = mainChildren(html);
  assert.ok(children.length >= 15);
  const seen = new Set();
  for (const {name, attrs} of children) {
    const tabs = attr(attrs, 'data-site-tab'), label = `<${name} id="${attr(attrs, 'id') || ''}" class="${attr(attrs, 'class') || ''}">`;
    if (tabs) {
      for (const tab of tabs.split(/\s+/)) { assert.ok(TABS.includes(tab), `${label} names unknown tab ${tab}`); seen.add(tab); }
    } else {
      const classes = (attr(attrs, 'class') || '').split(/\s+/), id = attr(attrs, 'id');
      assert.ok(GLOBAL.some(item => classes.includes(item) || id === item), `${label} has no data-site-tab: it would show on every tab`);
    }
  }
  assert.deepEqual([...seen].sort(), [...TABS].sort(), 'every tab has content');
});

test('tab links, their fallback anchors and the parts of shared blocks agree', () => {
  const links = [...html.matchAll(/<a class="site-tab"([^>]*)>/g)].map(match => match[1]);
  assert.deepEqual(links.map(link => attr(link, 'data-site-tab-link')), TABS);
  for (const link of links) {
    assert.equal(attr(link, 'role'), 'tab');
    const target = attr(link, 'href').slice(1);
    assert.match(html, new RegExp(`\\sid="${target}"`), `tab anchor #${target} exists for no-JS use`);
  }
  assert.equal(links.filter(link => attr(link, 'aria-selected') === 'true').length, 1);
  const workspace = html.match(/<div class="workspace" id="manager-map-workspace"([^>]*)>/)[1];
  const shared = attr(workspace, 'data-site-tab').split(/\s+/);
  const parts = [...html.matchAll(/data-site-tab-part="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual([...new Set(parts)].sort(), [...shared].sort(), 'each tab sharing the workspace shows part of it');
});

test('tabs load before app.js, and app.js only ever reaches them optionally', () => {
  assert.ok(html.indexOf('<script src="tabs.js"></script>') > 0);
  assert.ok(html.indexOf('<script src="tabs.js"></script>') < html.indexOf('<script src="app.js"></script>'));
  assert.match(html, /<link rel="stylesheet" href="tabs\.css">/);
  const uses = [...app.matchAll(/window\.SiteTabs(.{0,2})/g)].map(match => match[1]);
  assert.ok(uses.length >= 4);
  for (const next of uses) assert.ok(next.startsWith('?.') || next.startsWith('&&'), `window.SiteTabs${next} must be optional so the harnesses without tabs.js behave as before`);
  for (const tab of TABS) assert.ok(tabsJs.includes(`'${tab}'`), `tabs.js knows ${tab}`);
  assert.match(app, /MANAGER_TOOLS=\{map:'map-panel',weather:'daily-panel',alerts:'alerts-panel',community:'community-panel'\}/, 'tab keys match the mayor tool keys app.js maps them to');
});
