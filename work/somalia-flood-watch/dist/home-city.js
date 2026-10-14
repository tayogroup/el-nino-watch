/* El Nino Watch: the city bar (which city is on screen, and the visitor's own
   default city, "My city").
   The default is stored in this browser only. app.js asks HomeCity.get() when
   the address names no city, tells HomeCity.current() which city is on screen,
   and gives HomeCity.connect() the function that opens a city; a link that
   names a city still opens that city. Loaded before app.js. */
(function () {
  'use strict';
  const KEY = 'somalia-home-city-v1';
  const control = document.getElementById('site-city-control');
  const picker = document.getElementById('site-city');
  const button = document.getElementById('home-city-button');
  const names = (window.SOMALIA_CITIES || []).map(city => city[0]).filter(Boolean);
  let shown = null, open = null;

  function storage() {
    try { return window.localStorage || null; } catch { return null; }
  }
  function get() {
    try { return storage()?.getItem(KEY) || null; } catch { return null; }
  }
  // Returns false when the browser will not keep it (private mode, blocked storage).
  function set(name) {
    const store = storage();
    if (!store) return false;
    try {
      if (name) store.setItem(KEY, name); else store.removeItem(KEY);
      return (store.getItem(KEY) || null) === (name || null);
    } catch { return false; }
  }

  function paint() {
    if (!shown) return;
    if (picker && picker.value !== shown) picker.value = shown;
    if (!button) return;
    const mine = get() === shown;
    button.setAttribute('aria-pressed', String(mine));
    button.classList.toggle('is-home', mine);
    button.textContent = mine ? '★ My city' : '☆ Set as my city';
  }

  // Called by app.js whenever the city on screen changes.
  function current(name) {
    if (typeof name !== 'string' || !name) return;
    const changed = name !== shown;
    shown = name;
    paint();
    // For visits.js (anonymous city counts).
    if (changed) window.dispatchEvent?.(new CustomEvent('site-city-change', {detail: {city: name}}));
  }

  // Called by app.js with the function that opens a city by name.
  function connect(fn) {
    if (typeof fn !== 'function') return;
    open = fn;
    if (control && picker && names.length) control.hidden = false;
  }

  if (picker) {
    // Alphabetical, so a city is quick to find; names are proper nouns and stay as written.
    for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      picker.appendChild(option);
    }
    picker.addEventListener('change', () => { if (open && picker.value && picker.value !== shown) open(picker.value); });
  }
  if (button) {
    if (storage()) button.hidden = false;
    button.addEventListener('click', () => {
      if (!shown) return;
      const ok = set(get() === shown ? null : shown);
      if (!ok) { button.hidden = true; return; }
      paint();
    });
  }

  window.HomeCity = Object.freeze({get, set, current, connect});
})();
