import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const dist = new URL('./somalia-flood-watch/dist/', import.meta.url);
const source = await readFile(new URL('home-city.js', dist), 'utf8');
const app = await readFile(new URL('app.js', dist), 'utf8');
const html = await readFile(new URL('index.html', dist), 'utf8');
const KEY = 'somalia-home-city-v1';

function button() {
  const attrs = new Map(), classes = new Set(), handlers = [];
  return {
    hidden: true, textContent: '',
    setAttribute: (name, value) => attrs.set(name, String(value)), getAttribute: name => attrs.get(name) ?? null,
    classList: {toggle: (name, on) => on ? classes.add(name) : classes.delete(name), contains: name => classes.has(name)},
    addEventListener: (type, fn) => type === 'click' && handlers.push(fn), click() { handlers.forEach(fn => fn()); }
  };
}
function memoryStorage({failWrites = false} = {}) {
  const data = new Map();
  return {data, getItem: key => data.has(key) ? data.get(key) : null, setItem(key, value) { if (failWrites) throw new Error('QuotaExceeded'); data.set(key, String(value)); }, removeItem: key => data.delete(key)};
}
function load(storage) {
  const el = button(), window = {};
  if (storage !== undefined) Object.defineProperty(window, 'localStorage', {get() { if (storage === 'throws') throw new Error('SecurityError'); return storage; }});
  vm.runInNewContext(source, {window, document:{getElementById: id => id === 'home-city-button' ? el : null}});
  return {el, api:window.HomeCity};
}

test('a visitor can make the city on screen their own, and undo it', () => {
  const storage = memoryStorage(), {el, api} = load(storage);
  assert.equal(el.hidden, false);
  assert.equal(api.get(), null);
  api.current('Mogadishu');
  assert.equal(el.textContent, '☆ Make Mogadishu my city');
  assert.equal(el.getAttribute('aria-pressed'), 'false');
  api.current('Galkayo');
  el.click();
  assert.equal(storage.data.get(KEY), 'Galkayo');
  assert.equal(el.textContent, '★ My city: Galkayo');
  assert.equal(el.getAttribute('aria-pressed'), 'true');
  assert.ok(el.classList.contains('is-home'));
  api.current('Baidoa');
  assert.equal(el.textContent, '☆ Make Baidoa my city', 'another city on screen does not claim to be home');
  api.current('Galkayo');
  el.click();
  assert.equal(storage.data.has(KEY), false, 'pressing again clears the choice');
  assert.equal(el.getAttribute('aria-pressed'), 'false');
});

test('the control stays out of the way when the browser will not keep the choice', () => {
  for (const storage of ['throws', null]) {
    const {el, api} = load(storage);
    assert.equal(el.hidden, true);
    assert.equal(api.get(), null);
  }
  const {el, api} = load(memoryStorage({failWrites:true}));
  assert.equal(el.hidden, false);
  api.current('Kismayo');
  el.click();
  assert.equal(el.hidden, true, 'a write that does not stick hides the button rather than pretend');
  assert.equal(api.get(), null);
});

test('app.js opens the saved city only when the address names none, and loads after home-city.js', () => {
  assert.match(app, /if\(i>=0\)selected=i;else if\(!p\.has\('city'\)\)\{const home=cities\.findIndex\(c=>c\[0\]===window\.HomeCity\?\.get\?\.\(\)\);if\(home>=0\)selected=home\}/);
  assert.match(app, /function render\(\)\{const c=cities\[selected\],s=summary\(selected\);window\.HomeCity\?\.current\?\.\(c\[0\]\);/);
  assert.ok(html.indexOf('<script src="home-city.js"></script>') > 0);
  assert.ok(html.indexOf('<script src="home-city.js"></script>') < html.indexOf('<script src="app.js"></script>'));
  assert.match(html, /<button type="button" id="home-city-button" class="home-city-button" aria-pressed="false" hidden><\/button>/);
});
