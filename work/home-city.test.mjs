import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const dist = new URL('./somalia-flood-watch/dist/', import.meta.url);
const source = await readFile(new URL('home-city.js', dist), 'utf8');
const app = await readFile(new URL('app.js', dist), 'utf8');
const html = await readFile(new URL('index.html', dist), 'utf8');
const KEY = 'somalia-home-city-v1';
const CITIES = [['Mogadishu'], ['Galkayo'], ['Baidoa'], ['Kismayo']];

function element(extra = {}) {
  const attrs = new Map(), classes = new Set(), handlers = new Map();
  return {
    hidden: true, textContent: '',
    setAttribute: (name, value) => attrs.set(name, String(value)), getAttribute: name => attrs.get(name) ?? null,
    classList: {toggle: (name, on) => on ? classes.add(name) : classes.delete(name), contains: name => classes.has(name)},
    addEventListener: (type, fn) => handlers.set(type, [...(handlers.get(type) || []), fn]),
    fire(type) { (handlers.get(type) || []).forEach(fn => fn()); },
    click() { this.fire('click'); },
    ...extra
  };
}
function select() {
  const options = [];
  return element({options, value: '', appendChild(option) { options.push(option); if (!this.value) this.value = option.value; }});
}
function memoryStorage({failWrites = false} = {}) {
  const data = new Map();
  return {data, getItem: key => data.has(key) ? data.get(key) : null, setItem(key, value) { if (failWrites) throw new Error('QuotaExceeded'); data.set(key, String(value)); }, removeItem: key => data.delete(key)};
}
function load(storage) {
  const els = {'site-city-control': element(), 'site-city': select(), 'home-city-button': element()};
  const window = {SOMALIA_CITIES: CITIES};
  if (storage !== undefined) Object.defineProperty(window, 'localStorage', {get() { if (storage === 'throws') throw new Error('SecurityError'); return storage; }});
  const document = {getElementById: id => els[id] || null, createElement: () => ({value: '', textContent: ''})};
  vm.runInNewContext(source, {window, document});
  return {control: els['site-city-control'], picker: els['site-city'], el: els['home-city-button'], api: window.HomeCity};
}

test('the city bar lists every city, shows the one on screen and opens another', () => {
  const {control, picker, api} = load(memoryStorage());
  assert.deepEqual(picker.options.map(option => option.value), ['Baidoa', 'Galkayo', 'Kismayo', 'Mogadishu'], 'alphabetical, so a city is quick to find');
  assert.equal(control.hidden, true, 'hidden until app.js can open a city');
  const opened = [];
  api.connect(name => opened.push(name));
  assert.equal(control.hidden, false);
  api.current('Mogadishu');
  assert.equal(picker.value, 'Mogadishu');
  picker.value = 'Kismayo';
  picker.fire('change');
  assert.deepEqual(opened, ['Kismayo']);
  api.current('Kismayo');
  picker.fire('change');
  assert.deepEqual(opened, ['Kismayo'], 'choosing the city already on screen does nothing');
});

test('a visitor can make the city on screen their own, and undo it', () => {
  const storage = memoryStorage(), {el, api} = load(storage);
  assert.equal(el.hidden, false);
  assert.equal(api.get(), null);
  api.current('Mogadishu');
  assert.equal(el.textContent, '☆ Set as my city');
  assert.equal(el.getAttribute('aria-pressed'), 'false');
  api.current('Galkayo');
  el.click();
  assert.equal(storage.data.get(KEY), 'Galkayo');
  assert.equal(el.textContent, '★ My city');
  assert.equal(el.getAttribute('aria-pressed'), 'true');
  assert.ok(el.classList.contains('is-home'));
  api.current('Baidoa');
  assert.equal(el.textContent, '☆ Set as my city', 'another city on screen does not claim to be home');
  api.current('Galkayo');
  el.click();
  assert.equal(storage.data.has(KEY), false, 'pressing again clears the choice');
  assert.equal(el.getAttribute('aria-pressed'), 'false');
});

test('the button stays out of the way when the browser will not keep the choice', () => {
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

test('app.js opens the saved city only when the address names none, and wires the city bar', () => {
  assert.match(app, /if\(i>=0\)selected=i;else if\(!p\.has\('city'\)\)\{const home=cities\.findIndex\(c=>c\[0\]===window\.HomeCity\?\.get\?\.\(\)\);if\(home>=0\)selected=home\}/);
  assert.match(app, /function render\(\)\{const c=cities\[selected\],s=summary\(selected\);window\.HomeCity\?\.current\?\.\(c\[0\]\);/);
  assert.match(app, /window\.HomeCity\?\.connect\?\.\(name=>\{const i=cities\.findIndex\(c=>c\[0\]===name\);if\(i>=0\)selectCity\(i\)\}\)/);
  assert.ok(html.indexOf('<script src="cities.js"></script>') < html.indexOf('<script src="home-city.js"></script>'), 'the city list exists before the bar is filled');
  assert.ok(html.indexOf('<script src="home-city.js"></script>') < html.indexOf('<script src="app.js"></script>'));
  assert.match(html, /<div class="site-bar" id="site-bar"><div class="site-city" id="site-city-control" hidden><svg[^>]*>.*?<\/svg><select id="site-city" aria-label="Selected city"><\/select><button type="button" id="home-city-button" class="home-city-button" aria-pressed="false" hidden><\/button><\/div><nav class="site-tabs"/);
});
