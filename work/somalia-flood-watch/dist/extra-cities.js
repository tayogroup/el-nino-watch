/* Additional locations stay on this device and outside the monitored 44-city watchlist. */
(function (global) {
  'use strict';
  const HOUR = 3600000, DAY = 86400000, CACHE_AGE = 15 * 60000, FEED_AGE = 2 * HOUR;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
  const number = value => typeof value === 'number' && Number.isFinite(value);
  const epoch = value => typeof value === 'string' ? Date.parse(value) : NaN;
  const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(epoch(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value;
  function daysAt(now = Date.now()) {
    const today = new Date(now + 3 * HOUR).toISOString().slice(0,10), start = epoch(today + 'T00:00:00Z');
    return Array.from({length:14}, (_,i) => new Date(start + i * DAY).toISOString().slice(0,10));
  }
  function coordinates(city) {
    return number(city?.lat) && number(city?.lon) && city.lat >= -2 && city.lat <= 13 && city.lon >= 40 && city.lon <= 52;
  }
  function urls(city, now = Date.now()) {
    if (!coordinates(city)) throw Error('Add latitude and longitude inside the Somalia map area before loading a forecast.');
    const days = daysAt(now), weather = new URL('https://api.open-meteo.com/v1/forecast'), river = new URL('https://flood-api.open-meteo.com/v1/flood');
    for (const url of [weather,river]) { url.searchParams.set('latitude',city.lat); url.searchParams.set('longitude',city.lon); }
    weather.searchParams.set('daily','precipitation_sum,precipitation_probability_max,temperature_2m_max');
    weather.searchParams.set('forecast_days','14'); weather.searchParams.set('timezone','Africa/Mogadishu');
    weather.searchParams.set('temperature_unit','celsius'); weather.searchParams.set('precipitation_unit','mm');
    river.searchParams.set('daily','river_discharge'); river.searchParams.set('start_date',days[0]); river.searchParams.set('end_date',days[13]); river.searchParams.set('timezone','GMT');
    return {weather:weather.href,river:river.href};
  }
  function validateForecast(data, kind) {
    const fields = kind === 'weather' ? ['precipitation_sum','precipitation_probability_max','temperature_2m_max'] : ['river_discharge'];
    const expectedOffset = kind === 'weather' ? 10800 : 0, daily = data?.daily;
    if (!data || Array.isArray(data) || data.utc_offset_seconds !== expectedOffset) throw Error(kind === 'weather' ? 'Weather dates must use Somalia time (UTC+3).' : 'River discharge dates must use UTC.');
    if (!daily || !Array.isArray(daily.time) || !daily.time.length || daily.time.length > 31 || !daily.time.every(validDay) || new Set(daily.time).size !== daily.time.length) throw Error('Forecast dates are missing or invalid.');
    for (const field of fields) {
      const values = daily[field];
      if (!Array.isArray(values) || values.length !== daily.time.length || !values.every(value => value === null || number(value) && (field === 'temperature_2m_max' || value >= 0) && (field !== 'precipitation_probability_max' || value <= 100))) throw Error('Invalid forecast field: ' + field);
    }
    if (kind === 'weather' && data.daily_units?.precipitation_sum !== 'mm') throw Error('Rainfall units must be millimetres.');
    if (kind === 'river' && !['m³/s','m3/s'].includes(data.daily_units?.river_discharge)) throw Error('River discharge units must be cubic metres per second.');
    return data;
  }
  function weatherRows(data) {
    return data?.daily?.time?.map((date,i) => ({date,rain:data.daily.precipitation_sum[i],probability:data.daily.precipitation_probability_max[i],maxTemperature:data.daily.temperature_2m_max[i]})) || [];
  }
  function riverRows(data) { return data?.daily?.time?.map((date,i) => ({date,discharge:data.daily.river_discharge[i]})) || []; }
  function snapshot(feed, now) {
    const at = epoch(feed.lastSuccess);
    return {...feed,stale:!!feed.data && (!!feed.error || !Number.isFinite(at) || at > now + 60000 || now - at > FEED_AGE)};
  }
  function lookupCandidates(data) {
    const results = Array.isArray(data?.results) ? data.results : [];
    return results.filter(item => item?.country_code === 'SO' && typeof item.name === 'string' && item.name.trim() && typeof item.feature_code === 'string' && /^P/.test(item.feature_code) && coordinates({lat:item.latitude,lon:item.longitude})).map(item => ({name:item.name.trim().slice(0,80),region:typeof item.admin1 === 'string' ? item.admin1.slice(0,80) : '',lat:item.latitude,lon:item.longitude})).filter((item,index,all) => all.findIndex(other => other.name === item.name && other.lat === item.lat && other.lon === item.lon) === index);
  }
  const state = {initialized:false,open:false,focus:null,cities:new Map(),lookupSequence:0,candidates:[],lookupName:null,editId:null};
  const get = id => global.document?.getElementById(id);
  function store() { return global.ExtraCitiesStore; }
  function list() { try { return store()?.list?.() || []; } catch { return []; } }
  function storageText() {
    const status = store()?.storageStatus?.() || {persisted:false,error:'City storage is unavailable.'};
    return (status.persisted ? 'Saved on this device; separate from the monitored 44 cities.' : 'Memory only: city storage is unavailable. Keep this page open; additions will be lost after reload.') + (status.warning ? ' ' + status.warning : '') + (status.error ? ' ' + status.error : '');
  }
  function setMessage(message, error = false) {
    const target = get('extra-cities-message');
    if (target) { target.textContent = message; target.classList.toggle('extra-error',error); }
  }
  function fallbackForecast(input) {
    return '<p class="extra-error">Flood outlook presentation is unavailable. Please reload the app.</p>' + '<p>Rainfall is a screening signal; it does not establish flood depth or extent.</p>';
  }
  function forecastHtml(city, entry) {
    const now = Date.now(), weather = snapshot(entry.weather,now), river = snapshot(entry.river,now);
    const input = {cityName:city.name,region:city.region || '',days:daysAt(now),selectedDate:entry.selectedDate,weatherRows:weatherRows(weather.data),riverRows:riverRows(river.data),weatherFeed:weather,riverFeed:river,station:null,stationFeed:{data:null},now:new Date(now).toISOString(),onDay:date => { entry.selectedDate = date; renderList(); }};
    entry.model = global.FloodOutlook?.build ? global.FloodOutlook.build(input) : input;
    return global.FloodOutlook?.html ? global.FloodOutlook.html(entry.model) : fallbackForecast(input);
  }
  function renderList() {
    const target = get('extra-cities-list'); if (!target) return;
    const active = global.document.activeElement, restoreId = active?.dataset?.extraId, restoreAction = active?.dataset?.extraAction;
    const restoreDay = active?.dataset?.floodDay, restoreOutlook = active?.closest?.('[data-extra-outlook-id]')?.dataset?.extraOutlookId;
    const cities = list(), storage = get('extra-cities-storage'); if (storage) storage.textContent = storageText();
    const count = get('extra-cities-count'); if (count) count.textContent = cities.length + (cities.length === 1 ? ' additional city' : ' additional cities');
    target.innerHTML = cities.length ? cities.map(city => {
      const entry = state.cities.get(city.id), loading = entry?.weather?.loading || entry?.river?.loading, location = coordinates(city) ? city.lat.toFixed(5) + ', ' + city.lon.toFixed(5) : 'Coordinates not supplied';
      const removing = entry?.removePending && Date.now() - entry.removePending < 10000;
      return '<article class="extra-city-card"><div class="extra-city-heading"><div><h3>' + esc(city.name) + '</h3><p>' + (city.region?'<span data-i18n-skip>'+esc(city.region)+'</span>':'Region not supplied') + ' · ' + esc(location) + '</p></div><span class="extra-local-tag">Additional location</span></div><div class="extra-city-actions"><button type="button" class="extra-primary" data-extra-action="forecast" data-extra-id="' + esc(city.id) + '" ' + (loading || !coordinates(city) ? 'disabled' : '') + '>' + (loading ? 'Loading live outlook…' : entry?.shown ? 'Refresh 14-day outlook' : 'Load 14-day outlook') + '</button><button type="button" data-extra-action="edit" data-extra-id="' + esc(city.id) + '">' + (coordinates(city) ? 'Edit city' : 'Add coordinates') + '</button><button type="button" class="extra-remove" data-extra-action="remove" data-extra-id="' + esc(city.id) + '">' + (removing ? 'Confirm removal' : 'Remove') + '</button>' + (removing ? '<button type="button" data-extra-action="cancel-remove" data-extra-id="' + esc(city.id) + '">Keep city</button><span class="extra-remove-note">Remove this device’s saved city?</span>' : '') + '</div>' + (entry?.shown ? '<div class="extra-city-outlook" data-extra-outlook-id="' + esc(city.id) + '" aria-busy="' + !!loading + '">' + forecastHtml(city,entry) + '</div>' : !coordinates(city) ? '<p class="extra-note">Add coordinates to load an outlook. Unknown coordinates remain unknown.</p>' : '') + '</article>';
    }).join('') : '<div class="extra-empty"><span aria-hidden="true">＋</span><h3>No additional cities yet</h3><p>Save a Somali city below. The original 44-city watchlist stays separate.</p></div>';
    for (const container of target.querySelectorAll('[data-extra-outlook-id]')) {
      const model = state.cities.get(container.dataset.extraOutlookId)?.model;
      if (model) global.FloodOutlook?.bind?.(container,model);
      if (restoreDay && container.dataset.extraOutlookId === restoreOutlook) Array.from(container.querySelectorAll('[data-flood-day]')).find(button => button.dataset.floodDay === restoreDay)?.focus();
    }
    if (restoreId && restoreAction) {
      const candidates = Array.from(target.querySelectorAll('[data-extra-id]')).filter(element => element.dataset.extraId === restoreId && !element.disabled);
      (candidates.find(element => element.dataset.extraAction === restoreAction) || candidates[0])?.focus();
    }
  }
  function newEntry() { return {sequence:0,shown:false,weather:{data:null,lastSuccess:null,error:null,loading:false},river:{data:null,lastSuccess:null,error:null,loading:false},controllers:[]}; }
  async function requestJson(url, controller) {
    const timer = setTimeout(() => controller?.abort(),25000);
    try {
      const response = await global.fetch(url,{signal:controller?.signal,headers:{Accept:'application/json'}});
      if (!response.ok) throw Error('Source returned HTTP ' + response.status + '.');
      const result = await response.json(); if (result?.error) throw Error(typeof result.reason === 'string' ? result.reason.slice(0,240) : 'The source could not produce this forecast.'); return result;
    } finally { clearTimeout(timer); }
  }
  async function loadForecast(id, force = true) {
    const city = list().find(item => item.id === id); if (!city) return false;
    let entry = state.cities.get(id); if (!entry) { entry = newEntry(); state.cities.set(id,entry); }
    if (!coordinates(city)) { setMessage('Latitude and longitude are needed to load an outlook.',true); return false; }
    if (entry.weather.loading || entry.river.loading) return entry.promise;
    const now = Date.now();
    const requestedDays = daysAt(now);
    if (!force && ['weather','river'].every(kind => entry[kind].data && !entry[kind].error && now - epoch(entry[kind].lastSuccess) < CACHE_AGE && requestedDays.every(date => entry[kind].data.daily.time.includes(date)))) { entry.shown = true; renderList(); return true; }
    const endpoints = urls(city,now), sequence = ++entry.sequence; entry.shown = true;
    const stillCurrent = () => state.cities.get(id) === entry && sequence === entry.sequence && list().some(item => item.id === id);
    const tasks = ['weather','river'].map(kind => {
      const feed = entry[kind]; feed.loading = true; feed.lastAttempt = new Date(now).toISOString();
      const controller = typeof global.AbortController === 'function' ? new global.AbortController() : null; if (controller) entry.controllers.push(controller);
      return (async () => {
        try { const data = validateForecast(await requestJson(endpoints[kind],controller),kind); if (!stillCurrent()) return; feed.data = data; feed.lastSuccess = new Date().toISOString(); feed.error = null; }
        catch (error) { if (!stillCurrent()) return; feed.error = error.name === 'AbortError' ? 'Source request timed out. Retry the outlook.' : String(error.message || error).slice(0,300); }
        finally { if (stillCurrent()) { feed.loading = false; renderList(); } }
      })();
    });
    renderList(); entry.promise = Promise.allSettled(tasks).then(() => { if (stillCurrent()) { entry.controllers = []; renderList(); } return stillCurrent(); });
    return entry.promise;
  }
  function invalidateLookup(clear = true) {
    state.lookupSequence++; state.lookupName = null;
    if (clear) { state.candidates = []; const results = get('extra-city-candidates'); if (results) results.innerHTML = ''; }
    const button = get('extra-city-find'); if (button) { button.disabled = false; button.textContent = 'Find coordinates'; }
  }
  async function lookup() {
    const name = get('extra-city-name').value.trim();
    if (name.length < 2) { setMessage('Enter at least two letters of a city name to find coordinates.',true); get('extra-city-name').focus(); return; }
    invalidateLookup(); const sequence = state.lookupSequence, button = get('extra-city-find'), results = get('extra-city-candidates'); state.lookupName = name;
    button.disabled = true; button.textContent = 'Finding coordinates…'; results.textContent = 'Searching Somali populated places…';
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name',name); url.searchParams.set('count','10'); url.searchParams.set('language','en'); url.searchParams.set('format','json'); url.searchParams.set('countryCode','SO');
    const current = () => sequence === state.lookupSequence && get('extra-city-name').value.trim() === name;
    const controller = typeof global.AbortController === 'function' ? new global.AbortController() : null;
    try {
      const data = await requestJson(url.href,controller); if (!current()) return;
      state.candidates = lookupCandidates(data);
      results.innerHTML = state.candidates.length ? '<p class="extra-note">Choose the matching city. Selecting coordinates does not save it yet.</p>' + state.candidates.map((city,index) => '<button type="button" class="extra-candidate" data-extra-candidate="' + index + '"><b data-i18n-skip>' + esc(city.name) + '</b><span>' + (city.region?'<span data-i18n-skip>'+esc(city.region)+'</span>':'Region not supplied') + ' · ' + city.lat.toFixed(5) + ', ' + city.lon.toFixed(5) + '</span><em>Select location</em></button>').join('') : '<p class="extra-note">No matching Somali populated place was returned. Try another spelling or enter coordinates manually.</p>';
    } catch (error) { if (current()) { results.textContent = 'Coordinate lookup is unavailable. You can enter coordinates manually.'; setMessage(error.name === 'AbortError' ? 'City lookup timed out.' : String(error.message || error).slice(0,300),true); } }
    finally { if (current()) { button.disabled = false; button.textContent = 'Find coordinates'; } }
  }
  function selectCandidate(index) {
    const city = state.candidates[index]; if (!city) return false;
    get('extra-city-name').value = city.name; get('extra-city-region').value = city.region; get('extra-city-lat').value = String(city.lat); get('extra-city-lon').value = String(city.lon);
    invalidateLookup(); setMessage('Coordinates selected for ' + city.name + '. Review them, then select Add city.'); get('extra-city-add').focus(); return true;
  }
  function resetForm() {
    state.editId = null; get('extra-city-form').reset(); get('extra-city-form-title').textContent = 'Add a Somali city';
    get('extra-city-add').textContent = '＋ Add city'; get('extra-city-cancel-edit').hidden = true; invalidateLookup();
  }
  function edit(id) {
    const city = list().find(item => item.id === id); if (!city) return false;
    state.editId = id; invalidateLookup();
    get('extra-city-name').value = city.name; get('extra-city-region').value = city.region || '';
    get('extra-city-lat').value = number(city.lat) ? String(city.lat) : ''; get('extra-city-lon').value = number(city.lon) ? String(city.lon) : '';
    get('extra-city-form-title').textContent = 'Edit ' + city.name; get('extra-city-add').textContent = 'Save changes'; get('extra-city-cancel-edit').hidden = false;
    get('extra-city-form-title').scrollIntoView?.({block:'nearest'}); get(coordinates(city) ? 'extra-city-name' : 'extra-city-lat').focus(); setMessage('Review the saved city and save changes.'); return true;
  }
  function submit(event) {
    event?.preventDefault(); const form = get('extra-city-form'); if (form?.reportValidity && !form.reportValidity()) return false;
    try {
      if (!store()?.add) throw Error('City storage is unavailable. Reload the app and try again.');
      const lat = get('extra-city-lat').value.trim(), lon = get('extra-city-lon').value.trim();
      if (!!lat !== !!lon) throw Error('Supply both latitude and longitude, or leave both fields blank.');
      const fields = {name:get('extra-city-name').value.trim(),region:get('extra-city-region').value.trim(),lat:lat ? Number(lat) : null,lon:lon ? Number(lon) : null};
      const editing = !!state.editId, city = editing ? store().update(state.editId,fields) : store().add(fields);
      if (editing) { const entry = state.cities.get(city.id); if (entry) { entry.sequence++; for (const controller of entry.controllers) controller.abort(); state.cities.delete(city.id); } }
      resetForm(); renderList(); setMessage(city.name + (editing ? ' updated in the additional-city list.' : ' added to the additional-city list.') + ' The monitored 44 cities are unchanged.'); get('extra-city-name').focus(); return city;
    } catch (error) { setMessage(String(error.message || error),true); return false; }
  }
  function remove(id) {
    const city = list().find(item => item.id === id); if (!city) return false;
    let entry = state.cities.get(id); if (!entry) { entry = newEntry(); state.cities.set(id,entry); }
    if (!entry.removePending || Date.now() - entry.removePending >= 10000) { entry.removePending = Date.now(); renderList(); return false; }
    try {
      if (!store().remove(id)) throw Error('This saved city could not be removed.');
      entry.sequence++; for (const controller of entry.controllers) controller.abort(); state.cities.delete(id); if (state.editId === id) resetForm(); renderList(); setMessage(city.name + ' removed from this device.'); get('extra-city-name').focus(); return true;
    } catch (error) { setMessage(String(error.message || error),true); return false; }
  }
  function close() {
    const dialog = get('extra-cities-dialog'); if (!dialog || !state.open) return;
    state.open = false; invalidateLookup();
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    dialog.hidden = true; dialog.classList.remove('extra-fallback'); global.document.body.classList.remove('extra-dialog-open');
    if (state.focus?.isConnected !== false) state.focus?.focus?.(); state.focus = null;
  }
  function open() {
    if (!state.initialized) init(); const dialog = get('extra-cities-dialog'); if (!dialog) return false;
    if (state.open) return true; state.open = true; state.focus = global.document.activeElement; renderList(); dialog.hidden = false;
    try { if (typeof dialog.showModal !== 'function') throw Error('Native dialog is unavailable.'); dialog.showModal(); }
    catch { dialog.classList.add('extra-fallback'); dialog.setAttribute('role','dialog'); dialog.setAttribute('aria-modal','true'); }
    global.document.body.classList.add('extra-dialog-open'); get('extra-cities-close').focus(); refreshShown(); return true;
  }
  function refreshShown() {
    if (!state.open || global.document.hidden) return;
    for (const city of list()) if (state.cities.get(city.id)?.shown && coordinates(city)) loadForecast(city.id,false);
  }
  function focusTrap(event) {
    if (!state.open) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab' || !get('extra-cities-dialog').classList.contains('extra-fallback')) return;
    const focusable = Array.from(get('extra-cities-dialog').querySelectorAll('button, input, a[href], select, textarea, [tabindex="0"]')).filter(element => !element.disabled && !element.hidden);
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0], last = focusable[focusable.length-1];
    if (event.shiftKey && (global.document.activeElement === first || !get('extra-cities-dialog').contains(global.document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && global.document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function init() {
    if (state.initialized) return true; const root = get('extra-cities-root'); if (!root) return false;
    root.innerHTML = '<dialog id="extra-cities-dialog" class="extra-dialog" aria-labelledby="extra-cities-title" aria-describedby="extra-cities-intro" hidden><header class="extra-dialog-header"><div><p class="extra-eyebrow">Local planning locations</p><h2 id="extra-cities-title">Additional cities</h2></div><button type="button" id="extra-cities-close" class="extra-dialog-close" aria-label="Close additional cities">✕</button></header><div class="extra-dialog-content"><p id="extra-cities-intro">Keep locations beyond the 44-city watchlist here. Load a live two-week planning outlook for each location with coordinates.</p><p id="extra-cities-storage" class="extra-storage" role="status"></p><div class="extra-list-title"><h3>Your additional-city list</h3><span id="extra-cities-count"></span></div><div id="extra-cities-list"></div><section class="extra-add-section" aria-labelledby="extra-city-form-title"><h3 id="extra-city-form-title">Add a Somali city</h3><p class="extra-note">Find a city’s coordinates or enter them manually. You can save its name first and add coordinates later. Names, common spelling variants and nearby coordinates are checked for duplicates against this list and the original 44 cities.</p><form id="extra-city-form"><div class="extra-name-row"><label>City name<input id="extra-city-name" name="name" type="text" minlength="2" maxlength="80" required autocomplete="off" placeholder="e.g. A city outside the watchlist"></label><button id="extra-city-find" type="button">Find coordinates</button></div><div id="extra-city-candidates" class="extra-candidates" aria-live="polite"></div><label>Region <span>(optional)</span><input id="extra-city-region" name="region" type="text" maxlength="80" autocomplete="off"></label><div class="extra-coordinate-grid"><label>Latitude <span>(optional)</span><input id="extra-city-lat" name="latitude" type="number" step="any" min="-2" max="13" placeholder="Decimal degrees"></label><label>Longitude <span>(optional)</span><input id="extra-city-lon" name="longitude" type="number" step="any" min="40" max="52" placeholder="Decimal degrees"></label></div><p class="extra-note">Leave both coordinates blank, or supply both. Map area: latitude −2 to 13°, longitude 40 to 52°. This bounds check does not verify an administrative boundary. Coordinates locate one forecast point; they are not city boundaries.</p><div class="extra-form-actions"><button id="extra-city-add" type="submit" class="extra-primary">＋ Add city</button><button id="extra-city-cancel-edit" type="button" hidden>Cancel edit</button></div></form><p id="extra-cities-message" class="extra-message" role="status" aria-live="polite"></p></section><aside class="extra-limitations"><b>Planning context</b><p>Rainfall uses Somalia time (EAT). GloFAS river discharge uses UTC and a model grid cell; a matched local gauge is unavailable. These are model estimates, not flood-depth, impact or evacuation predictions. Official city warnings, community reporting and satellite coverage are not connected for additional locations.</p><p>City additions stay on this device. For emergency support, contact local government offices or the relevant authority.</p><a href="https://open-meteo.com/en/docs/geocoding-api" target="_blank" rel="noopener">Coordinate lookup source ↗</a></aside></div></dialog>';
    state.initialized = true;
    get('extra-cities-open')?.addEventListener('click',open); get('extra-cities-close').addEventListener('click',close);
    get('watchlist-add-city')?.addEventListener('click',() => { if (open()) get('extra-city-name')?.focus?.(); });
    get('extra-city-form').addEventListener('submit',submit); get('extra-city-find').addEventListener('click',lookup); get('extra-city-name').addEventListener('input',() => invalidateLookup());
    get('extra-city-cancel-edit').addEventListener('click',() => { resetForm(); setMessage('City edit cancelled.'); get('extra-city-name').focus(); });
    get('extra-cities-dialog').addEventListener('cancel',event => { event.preventDefault(); close(); });
    get('extra-cities-dialog').addEventListener('close',() => { if (state.open) close(); });
    get('extra-cities-dialog').addEventListener('click',event => {
      const candidate = event.target.closest('[data-extra-candidate]'); if (candidate) { selectCandidate(Number(candidate.dataset.extraCandidate)); return; }
      const action = event.target.closest('[data-extra-action]'); if (!action) return;
      if (action.dataset.extraAction === 'forecast') loadForecast(action.dataset.extraId,true);
      else if (action.dataset.extraAction === 'edit') edit(action.dataset.extraId);
      else if (action.dataset.extraAction === 'remove') remove(action.dataset.extraId);
      else if (action.dataset.extraAction === 'cancel-remove') { const entry = state.cities.get(action.dataset.extraId); if (entry) entry.removePending = null; renderList(); }
    });
    global.document.addEventListener('keydown',focusTrap); global.document.addEventListener('visibilitychange',refreshShown); global.addEventListener?.('online',refreshShown);
    global.setInterval?.(refreshShown,CACHE_AGE); renderList(); return true;
  }
  global.ExtraCities = {init,open,close,loadForecast,lookup,selectCandidate,submit,edit,remove,refreshList:renderList,daysAt,urls,validateForecast,weatherRows,riverRows,lookupCandidates};
})(window);
