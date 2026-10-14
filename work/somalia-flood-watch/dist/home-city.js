/* El Nino Watch: the visitor's own default city ("My city").
   Stored in this browser only. app.js asks HomeCity.get() when the address
   names no city, and tells HomeCity.current() which city is on screen; a link
   that names a city still opens that city. Loaded before app.js. */
(function () {
  'use strict';
  const KEY = 'somalia-home-city-v1';
  const button = document.getElementById('home-city-button');
  let shown = null;

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
    if (!button || !shown) return;
    const mine = get() === shown;
    button.setAttribute('aria-pressed', String(mine));
    button.classList.toggle('is-home', mine);
    // One text node, so the Somali catalogue's patterns can translate it whole.
    button.textContent = mine ? `★ My city: ${shown}` : `☆ Make ${shown} my city`;
  }

  // Called by app.js whenever the city on screen changes.
  function current(name) {
    if (typeof name !== 'string' || !name) return;
    shown = name;
    paint();
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

  window.HomeCity = Object.freeze({get, set, current});
})();
