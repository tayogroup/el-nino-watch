(function () {
  'use strict';
  const MAX_FILES = 4, MAX_BYTES = 50 * 1024 * 1024;
  const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']);
  const CATEGORIES = new Set(['flood', 'rain', 'damage']);
  const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
  const RECEIPT_KEY = 'somalia-community-report-receipts-v1';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cityId = city => String(Array.isArray(city) ? city[0] : city?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const byId = id => document.getElementById(id);
  const label = value => ({ flood: 'Flooding', rain: 'Rainfall', damage: 'Flood impact' }[value] || 'Community report');
  const eatInput = (date = new Date()) => new Date(date.getTime() + 3 * 3600000).toISOString().slice(0, 16);
  const timeLabel = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-GB', { timeZone: 'Africa/Mogadishu', dateStyle: 'medium', timeStyle: 'short' }) + ' EAT' : 'Date not supplied';
  let root = null, cities = [], selected = 0, scope = 'city', category = 'all', records = [], loading = false;
  let feedAvailable = false, feedError = null, feedFetchedAt = null, feedTotal = 0;
  let onLocation = null, onChange = null, pendingFiles = [], previewUrls = [], requestSequence = 0, submitBusy = false;
  let reportFocusSequence = 0;
  let receipts = {};
  const commentDrafts = new Map();
  try { const saved = JSON.parse(localStorage.getItem(RECEIPT_KEY) || '{}'); if (saved && typeof saved === 'object' && !Array.isArray(saved)) receipts = saved; } catch {}

  function safeSource(value) {
    if (!String(value || '').trim()) return null;
    try { const url = new URL(String(value)); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
  }
  function managedMediaUrl(value) {
    try { const url = new URL(value, location.href); return url.origin === location.origin && /^\/api\/community\/media\/[a-zA-Z0-9._-]+$/.test(url.pathname) && !url.search && !url.hash ? url.href : null; } catch { return null; }
  }
  function validateFiles(files) {
    const items = Array.from(files || []), errors = [];
    if (items.length > MAX_FILES) errors.push('Choose no more than 4 photos or videos.');
    if (items.reduce((total, file) => total + (Number(file.size) || 0), 0) > MAX_BYTES) errors.push('The combined upload must be 50 MB or smaller.');
    for (const file of items) {
      if (!MIME_TYPES.has(file.type)) errors.push(`${file.name || 'This file'}: use JPG, PNG, WebP, GIF, MP4 or WebM.`);
      if (!Number.isFinite(file.size) || file.size <= 0) errors.push(`${file.name || 'This file'} is empty or cannot be read.`);
    }
    return { valid: errors.length === 0, errors };
  }
  function validateDraft(draft, knownCities = cities, now = new Date()) {
    const errors = [], ids = new Set(knownCities.map(cityId));
    const payload = { cityId: String(draft.cityId || ''), category: String(draft.category || ''), author: String(draft.author || '').trim(), description: String(draft.description || '').trim(), observedAt: null, latitude: null, longitude: null, deaths: null, injuries: null, damagedProperties: null, sourceUrl: null };
    if (!ids.has(payload.cityId)) errors.push('Choose a city from the list.');
    if (!CATEGORIES.has(payload.category)) errors.push('Choose flooding, rainfall or flood impact.');
    if (payload.author.length > 60 || CONTROL.test(payload.author)) errors.push('Use a name or alias of up to 60 characters.');
    if (payload.description.length < 10 || payload.description.length > 3000 || CONTROL.test(payload.description)) errors.push('Describe what you observed using 10–3,000 printable characters.');
    const entered = String(draft.observedAt || '');
    const zoned = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(entered) ? entered + '+03:00' : entered;
    const observed = Date.parse(zoned);
    const localCalendarValid = !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(entered) || (Number.isFinite(observed) && eatInput(new Date(observed)) === entered.slice(0, 16));
    const calendar = new Date(zoned.slice(0, 10) + 'T00:00:00Z'), calendarValid = Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 10) === zoned.slice(0, 10);
    if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(zoned) || !Number.isFinite(observed) || !localCalendarValid || !calendarValid) errors.push('Provide the observation date and time in Somalia time (EAT).');
    else if (observed > now.getTime() + 3600000) errors.push('The observation time cannot be more than one hour in the future.');
    else if (observed < Date.parse('2000-01-01T00:00:00Z')) errors.push('Use an observation date from 2000 onwards.');
    else payload.observedAt = new Date(observed).toISOString();
    const latText = String(draft.latitude ?? '').trim(), lonText = String(draft.longitude ?? '').trim();
    if ((latText === '') !== (lonText === '')) errors.push('Provide both latitude and longitude, or leave both blank.');
    else if (latText !== '') {
      const lat = Number(latText), lon = Number(lonText);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -2 || lat > 13 || lon < 40 || lon > 52) errors.push('Use coordinates in the Somalia reporting area: latitude −2 to 13, longitude 40 to 52.');
      else { payload.latitude = lat; payload.longitude = lon; }
    }
    for (const field of ['deaths', 'injuries', 'damagedProperties']) {
      const raw = String(draft[field] ?? '').trim();
      if (raw !== '') {
        const number = Number(raw);
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(number) || number > 100000) errors.push('Impact counts must be whole numbers from 0 to 100,000; leave unknown counts blank.');
        else payload[field] = number;
      }
    }
    if (String(draft.sourceUrl || '').trim()) {
      payload.sourceUrl = safeSource(draft.sourceUrl);
      if (!payload.sourceUrl || payload.sourceUrl.length > 1000) errors.push('Use a public http:// or https:// source link of up to 1,000 characters.');
    }
    return { valid: errors.length === 0, errors: [...new Set(errors)], payload };
  }
  function getCityName(id) { const city = cities.find(city => cityId(city) === id); return city ? (Array.isArray(city) ? city[0] : city.name) : String(id || 'City unspecified').replace(/-/g, ' '); }
  function readReceipt(id) { return typeof receipts[id] === 'string' && receipts[id].length > 5 ? receipts[id] : null; }
  function notifyChange() {
    const visible = category === 'all' ? records : records.filter(report => report.category === category);
    try { onChange?.(visible, { available: feedAvailable, loading, error: feedError, fetchedAt: feedFetchedAt, total: feedTotal, scope, category, cityId: scope === 'city' ? cityId(cities[selected]) : null }); } catch {}
  }
  function storeReceipt(id, token) {
    if (!id || typeof token !== 'string') return false;
    receipts[id] = token;
    try { localStorage.setItem(RECEIPT_KEY, JSON.stringify(receipts)); return true; } catch { return false; }
  }
  function metric(value, title) { return `<span class="community-metric"><strong>${Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('en-GB') : 'Unknown'}</strong><span>${esc(title)}</span></span>`; }
  function mediaHtml(item) {
    const url = managedMediaUrl(item.url), mime = item.type || item.mimeType;
    if (!url || !MIME_TYPES.has(mime)) return '';
    if (mime.startsWith('video/')) return `<figure><video controls preload="metadata" playsinline data-i18n-user-attrs="aria-label" aria-label="${esc(item.name || 'Community flood video')}"><source src="${esc(url)}" type="${esc(mime)}">Your browser cannot play this video.</video><figcaption>${esc(item.name || 'Uploaded video')}</figcaption></figure>`;
    return `<figure><a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" data-i18n-user-attrs="alt" alt="${esc(item.name || 'Community photo of flooding or rain')}" loading="lazy"></a><figcaption>${esc(item.name || 'Uploaded photo')}</figcaption></figure>`;
  }
  function renderReport(report, options = {}) {
    const id = String(report.id || ''), source = safeSource(report.sourceUrl), comments = Array.isArray(report.comments) ? report.comments : [];
    const draft = commentDrafts.get(id) || {};
    const own = options.own ?? !!readReceipt(id), locationKnown = finite(report.latitude) && finite(report.longitude);
    const markup = `<article id="community-report-${esc(id)}" class="community-card" data-report="${esc(id)}"><div class="community-card-head"><div><span class="community-badge">Unverified community report</span><h3>${esc(label(report.category))} · ${esc(getCityName(report.cityId))}</h3><p class="community-card-meta">Observed ${esc(timeLabel(report.observedAt))} · Shared by <span${report.author?' data-i18n-skip lang="und"':''}>${esc(report.author || 'Anonymous')}</span></p></div>${own ? `<button type="button" class="community-delete button-quiet" data-delete-report="${esc(id)}" aria-label="Delete your report">Delete my report</button>` : ''}</div><p class="community-description">${esc(report.description)}</p><div class="community-metrics">${metric(report.deaths, 'Reported deaths')}${metric(report.injuries, 'Reported injuries')}${metric(report.damagedProperties, 'Properties damaged')}</div><p class="community-note">These are unverified individual reports. Counts may overlap other reports and are not official totals.</p>${source ? `<a class="community-source" href="${esc(source)}" target="_blank" rel="noopener noreferrer">View supporting source ↗</a>` : ''}${locationKnown ? `<button type="button" class="community-map-link" data-report-location="${esc(id)}">⌖ View reported location · ${report.latitude.toFixed(4)}, ${report.longitude.toFixed(4)}</button>` : '<p class="community-note">Exact location not provided.</p>'}<div class="community-media">${(Array.isArray(report.media) ? report.media : []).slice(0, MAX_FILES).map(mediaHtml).join('')}</div><details class="community-comments"><summary>${comments.length} ${comments.length === 1 ? 'comment' : 'comments'} · Join the discussion</summary><div class="community-comment-list">${comments.map(comment => `<div class="community-comment"><div><strong${comment.author?' data-i18n-skip lang="und"':''}>${esc(comment.author || 'Anonymous')}</strong><time>${esc(timeLabel(comment.receivedAt || comment.createdAt))}</time></div><p>${esc(comment.body)}</p></div>`).join('') || '<p class="community-note">No comments yet. Share useful local context.</p>'}</div><form class="community-comment-form" data-comment-report="${esc(id)}"><label>Your name or alias (optional)<input name="author" maxlength="60" autocomplete="nickname" placeholder="Anonymous"></label><label>Comment<textarea name="body" rows="2" minlength="2" maxlength="2000" required placeholder="Add local context or a correction. Avoid personal details."></textarea></label><button type="submit">Post comment</button><p class="community-comment-status" role="status" aria-live="polite"></p></form></details><p class="community-card-meta">Received ${esc(timeLabel(report.receivedAt || report.createdAt))}</p></article>`;
    return markup.replace('<details class="community-comments">', draft.open ? '<details class="community-comments" open>' : '<details class="community-comments">')
      .replace('<input name="author" maxlength="60" autocomplete="nickname" placeholder="Anonymous">', `<input name="author" maxlength="60" autocomplete="nickname" placeholder="Anonymous" value="${esc(draft.author || '')}">`)
      .replace('placeholder="Add local context or a correction. Avoid personal details."></textarea>', `placeholder="Add local context or a correction. Avoid personal details.">${esc(draft.body || '')}</textarea>`);
  }
  function captureCommentDrafts() {
    const forms = byId('community-feed-list')?.querySelectorAll?.('.community-comment-form') || [];
    for (const form of forms) {
      const id = form.dataset.commentReport;
      commentDrafts.set(id, { author: form.elements.author.value, body: form.elements.body.value, open: !!form.closest('details')?.open });
    }
    while (commentDrafts.size > 500) commentDrafts.delete(commentDrafts.keys().next().value);
  }
  function status(message, type = '') {
    const node = byId('community-status'); if (!node) return;
    node.textContent = message; node.className = 'community-status ' + (type ? 'community-status-' + type : '');
  }
  function renderFeed() {
    const list = byId('community-feed-list'); if (!list) return;
    captureCommentDrafts();
    const filtered = category === 'all' ? records : records.filter(report => report.category === category);
    for (const id of ['community-export-csv', 'community-export-geojson']) { const button = byId(id); if (button) button.disabled = filtered.length === 0; }
    byId('community-feed-title').textContent = scope === 'city' ? `${getCityName(cityId(cities[selected]))} community reports` : 'Reports across Somalia';
    byId('community-feed-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'report' : 'reports'} shown`;
    list.innerHTML = filtered.length ? filtered.map(report => renderReport(report)).join('') : `<div class="community-empty"><span aria-hidden="true">☂</span><h3>${loading ? 'Loading community reports…' : 'No reports to display'}</h3><p>${loading ? 'Connecting to the report service.' : 'No reports were returned for these filters. This does not mean there is no flooding.'}</p></div>`;
  }
  async function request(url, options = {}, timeoutMs = 20000) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
      let data; try { data = await response.json(); } catch { throw new Error('The report service returned an unreadable response.'); }
      if (!response.ok) throw new Error(data.error || data.message || `Report service returned ${response.status}.`);
      return data;
    } catch (error) { if (error.name === 'AbortError') throw new Error('The report service timed out. Refresh the feed before trying to submit again.'); throw error; }
    finally { clearTimeout(timer); }
  }
  function buildExport(reports, format = 'csv') {
    const safe = (Array.isArray(reports) ? reports : []).map(report => ({ id: String(report.id || ''), cityId: String(report.cityId || ''), category: String(report.category || ''), observedAt: report.observedAt || null, receivedAt: report.receivedAt || report.createdAt || null, status: 'unverified', author: report.author || 'Anonymous', description: report.description || '', latitude: finite(report.latitude) ? report.latitude : null, longitude: finite(report.longitude) ? report.longitude : null, deaths: Number.isSafeInteger(report.deaths) && report.deaths >= 0 ? report.deaths : null, injuries: Number.isSafeInteger(report.injuries) && report.injuries >= 0 ? report.injuries : null, damagedProperties: Number.isSafeInteger(report.damagedProperties) && report.damagedProperties >= 0 ? report.damagedProperties : null, sourceUrl: safeSource(report.sourceUrl) }));
    if (format === 'geojson') {
      const features = safe.filter(report => finite(report.latitude) && finite(report.longitude) && Math.abs(report.latitude) <= 90 && Math.abs(report.longitude) <= 180).map(report => ({ type: 'Feature', id: report.id, geometry: { type: 'Point', coordinates: [report.longitude, report.latitude] }, properties: report }));
      return { type: 'application/geo+json', extension: 'geojson', count: features.length, content: JSON.stringify({ type: 'FeatureCollection', disclaimer: 'Unverified community observations. Reports can overlap; impact counts are not official totals.', features }, null, 2) };
    }
    const keys = ['id', 'cityId', 'category', 'observedAt', 'receivedAt', 'status', 'author', 'description', 'latitude', 'longitude', 'deaths', 'injuries', 'damagedProperties', 'sourceUrl'];
    const cell = value => { const text = String(value ?? ''); return '"' + (typeof value === 'string' && /^[\s]*[=+@-]/.test(text) ? "'" + text : text).replace(/"/g, '""') + '"'; };
    return { type: 'text/csv;charset=utf-8', extension: 'csv', count: safe.length, content: [keys.map(cell).join(','), ...safe.map(report => keys.map(key => cell(report[key])).join(','))].join('\r\n') };
  }
  function exportReports(format) {
    const filtered = category === 'all' ? records : records.filter(report => report.category === category), output = buildExport(filtered, format);
    if (!output.count) { status(format === 'geojson' ? 'No reports with coordinates are available in the current filters.' : 'No reports are available in the current filters.'); return; }
    const url = URL.createObjectURL(new Blob([output.content], { type: output.type })), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `somalia-community-reports-${scope === 'city' ? cityId(cities[selected]) : 'all'}-${new Date().toISOString().slice(0, 10)}.${output.extension}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(`${output.count} unverified ${format === 'geojson' ? 'located reports' : 'reports'} exported. Unknown impact counts remain blank or null.`);
  }
  async function refresh() {
    if (!root) return;
    const sequence = ++requestSequence; loading = true; feedAvailable = false; feedError = null; notifyChange();
    const button = byId('community-refresh'); if (button) button.disabled = true;
    const requestUrl = '/api/community/reports' + (scope === 'city' ? '?city=' + encodeURIComponent(cityId(cities[selected])) : '');
    if (!records.length) renderFeed();
    status('Connecting to community reports…');
    try {
      if (!/^https?:$/.test(location.protocol)) throw new Error('Start the live app server to read and publish community reports.');
      const data = await request(requestUrl), reports = Array.isArray(data) ? data : data.reports;
      if (!Array.isArray(reports)) throw new Error('The report service returned an invalid list.');
      if (sequence !== requestSequence) return;
      records = reports.filter(report => report && typeof report.id === 'string' && typeof report.description === 'string');
      feedAvailable = true; feedFetchedAt = data.fetchedAt || new Date().toISOString(); feedTotal = Number.isInteger(data.total) ? data.total : records.length;
      status(`Report service connected · refreshed ${timeLabel(feedFetchedAt)}. Reports are unverified.${data.truncated ? ` Showing the newest ${records.length} of ${feedTotal} reports; filters apply to these loaded reports.` : ''}`, 'connected');
    } catch (error) {
      if (sequence !== requestSequence) return;
      records = []; feedAvailable = false; feedError = error.message;
      status(`Community reports unavailable: ${error.message}`, 'error');
    } finally {
      if (sequence === requestSequence) { loading = false; if (button) button.disabled = false; renderFeed(); notifyChange(); }
    }
  }
  function clearPreviews() { previewUrls.forEach(url => URL.revokeObjectURL(url)); previewUrls = []; }
  function renderPreviews() {
    clearPreviews();
    byId('community-upload-count').textContent = pendingFiles.length ? `${pendingFiles.length}/4 files · ${(pendingFiles.reduce((total, file) => total + file.size, 0) / 1048576).toFixed(1)} MB` : 'Up to 4 files · 50 MB combined';
    byId('community-previews').innerHTML = pendingFiles.map((file, index) => {
      const url = URL.createObjectURL(file); previewUrls.push(url);
      const media = file.type.startsWith('video/') ? `<video controls preload="metadata" playsinline src="${esc(url)}" aria-label="Preview ${esc(file.name)}"></video>` : `<img src="${esc(url)}" alt="Preview ${esc(file.name)}">`;
      return `<figure class="community-preview">${media}<figcaption><span data-i18n-skip>${esc(file.name)}</span><button type="button" data-remove-file="${index}" aria-label="Remove ${esc(file.name)}">Remove</button></figcaption></figure>`;
    }).join('');
  }
  function acceptFiles(files) {
    if (submitBusy) { byId('community-upload-error').textContent = 'Wait for the current report to finish uploading before adding more files.'; return; }
    const next = [...pendingFiles, ...Array.from(files || [])], validation = validateFiles(next);
    if (!validation.valid) { byId('community-upload-error').textContent = validation.errors.join(' '); return; }
    pendingFiles = next; byId('community-upload-error').textContent = ''; renderPreviews();
  }
  function formMessage(message, error = false) {
    const node = byId('community-form-status'); node.textContent = message;
    node.className = 'community-status' + (error ? ' community-status-error' : '');
  }
  async function submitReport(event) {
    event.preventDefault(); if (submitBusy) return;
    const form = event.currentTarget, draft = Object.fromEntries(new FormData(form));
    const validation = validateDraft(draft), filesValidation = validateFiles(pendingFiles);
    const errors = [...validation.errors, ...filesValidation.errors];
    if (!form.elements.publicConsent.checked) errors.push('Confirm that the report and media may be shared publicly.');
    if (errors.length) { formMessage(errors.join(' '), true); return; }
    if (!/^https?:$/.test(location.protocol)) { formMessage('Start the live app server to publish this report.', true); return; }
    const body = new FormData(); body.append('payload', JSON.stringify(validation.payload));
    pendingFiles.forEach(file => body.append('media', file, file.name));
    submitBusy = true; form.setAttribute('aria-busy', 'true'); Array.from(form.elements).forEach(input => { input.disabled = true; }); formMessage('Uploading your report…');
    try {
      const data = await request('/api/community/reports', { method: 'POST', body }, 120000);
      if (!data.report?.id) throw new Error('The service did not confirm a report ID. Refresh the feed before resubmitting.');
      const stored = storeReceipt(data.report.id, data.receiptToken || data.receipt);
      form.reset(); form.elements.cityId.value = cityId(cities[selected]); form.elements.observedAt.value = eatInput();
      pendingFiles = []; renderPreviews();
      formMessage(`Report published for ${getCityName(validation.payload.cityId)} as unverified. ${stored ? 'You can delete it from this browser using your saved receipt.' : 'Your deletion receipt could not be saved. Keep this page open if you need to delete the report.'}`);
      if (scope === 'city' && validation.payload.cityId !== cityId(cities[selected])) { scope = 'all'; byId('community-scope').value = 'all'; }
      await refresh();
    } catch (error) { formMessage(error.message, true); }
    finally { submitBusy = false; form.setAttribute('aria-busy', 'false'); Array.from(form.elements).forEach(input => { input.disabled = false; }); }
  }
  async function submitComment(event) {
    const form = event.target.closest('.community-comment-form'); if (!form) return;
    event.preventDefault(); const button = form.querySelector('button'), node = form.querySelector('.community-comment-status');
    if (button.disabled) return;
    const body = String(form.elements.body.value || '').trim(), author = String(form.elements.author.value || '').trim();
    if (body.length < 2 || body.length > 2000 || CONTROL.test(body)) { node.textContent = 'Write a comment using 2–2,000 printable characters.'; return; }
    if (author.length > 60 || CONTROL.test(author)) { node.textContent = 'Use a name or alias of up to 60 characters.'; return; }
    button.disabled = true; form.elements.author.disabled = true; form.elements.body.disabled = true; node.textContent = 'Posting comment…';
    try {
      const data = await request('/api/community/reports/' + encodeURIComponent(form.dataset.commentReport) + '/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ author, body }) });
      const reportId = form.dataset.commentReport;
      if (data.report?.id) records = records.map(current => current.id === data.report.id ? data.report : current);
      else if (data.comment?.id) records = records.map(current => current.id === reportId ? { ...current, comments: [...(current.comments || []).filter(comment => comment.id !== data.comment.id), data.comment] } : current);
      else throw new Error('The service did not confirm the comment. Refresh before trying again.');
      form.elements.body.value = '';
      const currentDetails = form.closest('details'); if (currentDetails) currentDetails.open = true;
      renderFeed(); const details = root.querySelector?.(`article[data-report="${CSS.escape(reportId)}"] details`); if (details) details.open = true;
      status('Comment published. Community comments remain unverified.');
      notifyChange();
    } catch (error) { node.textContent = error.message; button.disabled = false; form.elements.author.disabled = false; form.elements.body.disabled = false; }
  }
  async function deleteReport(id, button) {
    const receipt = readReceipt(id); if (!receipt) { status('This browser has no deletion receipt for this report.', 'error'); return; }
    if (!window.confirm(window.SiteLanguage?.translateText('Delete your report, uploaded media and its comments? This cannot be undone.')||'Delete your report, uploaded media and its comments? This cannot be undone.')) return;
    button.disabled = true;
    try {
      await request('/api/community/reports/' + encodeURIComponent(id), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ receiptToken: receipt }) });
      delete receipts[id]; try { localStorage.setItem(RECEIPT_KEY, JSON.stringify(receipts)); } catch {}
      records = records.filter(report => report.id !== id); renderFeed(); status('Your report and its media were deleted.'); notifyChange();
    } catch (error) { status(error.message, 'error'); button.disabled = false; }
  }
  function selectCity(index) {
    if (!Number.isInteger(index) || !cities[index]) return;
    reportFocusSequence++;
    selected = index;
    const input = byId('community-report-city');
    if (input) { if (input.value && input.value !== cityId(cities[index])) clearCoordinates(); input.value = cityId(cities[index]); }
    if (scope === 'city') { records = []; feedAvailable = false; notifyChange(); refresh(); } else renderFeed();
  }
  function prepareCityView(index) {
    if (!root || !Number.isInteger(index) || !cities[index]) return null;
    const focusSequence = ++reportFocusSequence, requestedCityId = cityId(cities[index]);
    selected = index;
    const input = byId('community-report-city');
    if (input) { if (input.value && input.value !== requestedCityId) clearCoordinates(); input.value = requestedCityId; }
    scope = 'city'; category = 'all';
    const scopeInput = byId('community-scope'), categoryInput = byId('community-category');
    if (scopeInput) scopeInput.value = 'city';
    if (categoryInput) categoryInput.value = 'all';
    records = []; feedAvailable = false; feedError = null; feedFetchedAt = null; feedTotal = 0;
    notifyChange();
    return {focusSequence, requestedCityId, index};
  }
  function isCurrentCityView(view) {
    return view.focusSequence === reportFocusSequence && selected === view.index && scope === 'city' && category === 'all';
  }
  async function showCity(index) {
    const view = prepareCityView(index);
    if (!view) return false;
    await refresh();
    return isCurrentCityView(view) && feedAvailable;
  }
  async function showReport(reportId, index) {
    if (typeof reportId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(reportId)) return false;
    const view = prepareCityView(index);
    if (!view) return false;
    await refresh();
    if (!isCurrentCityView(view) || !feedAvailable) return false;
    const requestedCityId = view.requestedCityId;
    const report = records.find(item => item.id === reportId && item.cityId === requestedCityId);
    const article = report ? byId('community-report-' + reportId) : null;
    if (!article) {
      status(`The requested report was not returned in the latest loaded reports for ${getCityName(requestedCityId)}. It may have been removed or be outside the loaded list.`);
      return false;
    }
    article.setAttribute?.('tabindex', '-1');
    article.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    article.focus?.({ preventScroll: true });
    return true;
  }
  function clearCoordinates() {
    const form = byId('community-report-form'); if (!form?.elements) return;
    const hadCoordinates = form.elements.latitude.value !== '' || form.elements.longitude.value !== '';
    form.elements.latitude.value = ''; form.elements.longitude.value = '';
    if (hadCoordinates) byId('community-location-status').textContent = 'The report city changed. Add coordinates for the new city if available.';
  }
  function setLocation(point) {
    if (!finite(point?.latitude) || !finite(point?.longitude) || point.latitude < -2 || point.latitude > 13 || point.longitude < 40 || point.longitude > 52) return false;
    const form = byId('community-report-form'); if (!form?.elements) return false;
    form.elements.latitude.value = point.latitude.toFixed(6); form.elements.longitude.value = point.longitude.toFixed(6);
    const details = root?.querySelector?.('.community-location'); if (details) details.open = true;
    byId('community-location-status').textContent = 'Map coordinates added. Check the city and location before publishing.';
    form.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); return true;
  }
  function init(options = {}) {
    reportFocusSequence++;
    root = byId('community-root'); if (!root) return;
    cities = Array.isArray(options.cities) ? options.cities : []; if (!cities.length) return;
    onLocation = typeof options.onLocation === 'function' ? options.onLocation : null;
    onChange = typeof options.onChange === 'function' ? options.onChange : null;
    selected = Number.isInteger(options.selectedCity) && cities[options.selectedCity] ? options.selectedCity : 0;
    root.innerHTML = `<div class="community-intro"><p>Share what you see on the ground. Photos, videos and local context can help people understand conditions.</p><p class="community-note">Community reports are public and unverified. For immediate danger, contact local emergency services or authorities directly.</p></div><div class="community-layout"><form id="community-report-form" class="community-compose"><div class="community-compose-heading"><span class="eyebrow">LOCAL OBSERVATIONS</span><h3>Report flooding or rain</h3></div><div class="community-field-grid"><label class="community-field">City<select id="community-report-city" name="cityId" required>${cities.map(city => `<option value="${esc(cityId(city))}">${esc(Array.isArray(city) ? city[0] : city.name)}</option>`).join('')}</select></label><label class="community-field">What happened?<select name="category" required><option value="flood">Flooding</option><option value="rain">Rainfall</option><option value="damage">Flood impact / damage</option></select></label><label class="community-field">Observed date & time · EAT<input name="observedAt" type="datetime-local" required value="${eatInput()}"></label><label class="community-field">Name or alias (optional)<input name="author" maxlength="60" autocomplete="nickname" placeholder="Anonymous"></label></div><label class="community-field">Describe your observation<textarea name="description" rows="4" minlength="10" maxlength="3000" required placeholder="Describe water levels, rain, affected roads or damage. Include a nearby landmark if useful."></textarea></label><div class="community-impact-section"><h4>Reported impact (optional)</h4><p class="community-note">Leave a count blank if unknown. Enter 0 only if you know there were none. Avoid names or identifying details of victims.</p><div class="community-counts"><label class="community-field">Deaths<input name="deaths" type="number" min="0" max="100000" step="1" inputmode="numeric" placeholder="Unknown"></label><label class="community-field">Injuries<input name="injuries" type="number" min="0" max="100000" step="1" inputmode="numeric" placeholder="Unknown"></label><label class="community-field">Properties damaged<input name="damagedProperties" type="number" min="0" max="100000" step="1" inputmode="numeric" placeholder="Unknown"></label></div></div><details class="community-location"><summary>⌖ Add exact location (optional)</summary><div class="community-location-actions"><button type="button" id="community-use-location" class="button-quiet">Use my device location</button><span id="community-location-status" role="status"></span></div><div class="community-field-grid"><label class="community-field">Latitude<input name="latitude" type="number" step="any" min="-2" max="13" inputmode="decimal" placeholder="e.g. 2.0469"></label><label class="community-field">Longitude<input name="longitude" type="number" step="any" min="40" max="52" inputmode="decimal" placeholder="e.g. 45.3182"></label></div><p class="community-note">Device location is used only when you tap the button. Coordinates you submit will be public; choose a safe location to share.</p></details><label class="community-field">Supporting link (optional)<input name="sourceUrl" type="url" maxlength="1000" placeholder="https://..."></label><div id="community-dropzone" class="community-dropzone"><span aria-hidden="true">▧</span><label class="community-upload-label" for="community-media-input">Add photos or videos</label><p>Choose files or drag them here</p><input id="community-media-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" multiple><p id="community-upload-count" class="community-note">Up to 4 files · 50 MB combined</p><p class="community-note">JPG, PNG, WebP, GIF, MP4 or WebM. Media is shared as uploaded and may contain location metadata.</p></div><p id="community-upload-error" class="community-status community-status-error" role="alert"></p><div id="community-previews" class="community-media community-previews"></div><label class="community-consent"><input type="checkbox" name="publicConsent" required><span>I have permission to share this media and understand that this report will be public and unverified.</span></label><div class="community-form-actions"><button id="community-submit" type="submit">Publish report</button><p id="community-form-status" class="community-status" role="status" aria-live="polite"></p></div></form><section class="community-feed" aria-label="Community reports"><div class="community-toolbar"><div><span class="eyebrow">COMMUNITY FEED</span><h3 id="community-feed-title"></h3><p id="community-feed-count" class="community-note"></p></div><button id="community-refresh" type="button" class="button-quiet" aria-label="Refresh community reports">↻ Refresh</button></div><div class="community-filter-controls"><label>Area<select id="community-scope"><option value="city">Selected city</option><option value="all">All cities</option></select></label><label>Report type<select id="community-category"><option value="all">All observations</option><option value="flood">Flooding</option><option value="rain">Rainfall</option><option value="damage">Flood impact</option></select></label></div><p id="community-status" class="community-status" role="status" aria-live="polite"></p><div id="community-feed-list"></div></section></div>`;
    byId('community-report-city').value = cityId(cities[selected]);
    byId('community-report-form').addEventListener('submit', submitReport);
    byId('community-report-city').addEventListener('change', clearCoordinates);
    byId('community-feed-list').addEventListener('submit', submitComment);
    byId('community-refresh').insertAdjacentHTML('afterend', '<div class="community-export-actions"><button id="community-export-csv" type="button" class="button-quiet">Export CSV</button><button id="community-export-geojson" type="button" class="button-quiet">Located GeoJSON</button></div>');
    byId('community-refresh').addEventListener('click', refresh);
    byId('community-export-csv').addEventListener('click', () => exportReports('csv'));
    byId('community-export-geojson').addEventListener('click', () => exportReports('geojson'));
    byId('community-scope').addEventListener('change', event => { reportFocusSequence++; scope = event.target.value === 'all' ? 'all' : 'city'; records = []; feedAvailable = false; notifyChange(); refresh(); });
    byId('community-category').addEventListener('change', event => { reportFocusSequence++; category = CATEGORIES.has(event.target.value) ? event.target.value : 'all'; renderFeed(); notifyChange(); });
    byId('community-media-input').addEventListener('change', event => { acceptFiles(event.target.files); event.target.value = ''; });
    const dropzone = byId('community-dropzone');
    ['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.add('community-dragging'); }));
    ['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.remove('community-dragging'); if (type === 'drop') acceptFiles(event.dataTransfer?.files); }));
    byId('community-use-location').addEventListener('click', () => {
      const button = byId('community-use-location'), node = byId('community-location-status');
      if (!navigator.geolocation) { node.textContent = 'Device location is unavailable. Enter coordinates manually.'; return; }
      button.disabled = true; node.textContent = 'Requesting device location…';
      navigator.geolocation.getCurrentPosition(position => {
        const latitude = position.coords.latitude, longitude = position.coords.longitude;
        if (latitude < -2 || latitude > 13 || longitude < 40 || longitude > 52) { node.textContent = 'Your device is outside the Somalia reporting area. Enter the event location manually.'; button.disabled = false; return; }
        const form = byId('community-report-form'); form.elements.latitude.value = latitude.toFixed(6); form.elements.longitude.value = longitude.toFixed(6);
        node.textContent = `Location added · accuracy about ${Math.round(position.coords.accuracy)} m. Check that the city matches.`; button.disabled = false;
      }, error => { node.textContent = error.code === 1 ? 'Location permission was declined. You can enter coordinates manually.' : 'Location could not be obtained. Enter coordinates manually.'; button.disabled = false; }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
    });
    root.addEventListener('click', event => {
      const remove = event.target.closest('[data-remove-file]');
      if (remove) { pendingFiles.splice(Number(remove.dataset.removeFile), 1); renderPreviews(); return; }
      const deletion = event.target.closest('[data-delete-report]'); if (deletion) { deleteReport(deletion.dataset.deleteReport, deletion); return; }
      const locationButton = event.target.closest('[data-report-location]');
      if (locationButton) { const report = records.find(report => report.id === locationButton.dataset.reportLocation); if (report && finite(report.latitude) && finite(report.longitude)) onLocation?.({ latitude: report.latitude, longitude: report.longitude, cityId: report.cityId, reportId: report.id }); }
    });
    window.addEventListener('pagehide', clearPreviews);
    window.addEventListener('pageshow', () => { if (pendingFiles.length) renderPreviews(); });
    renderFeed(); refresh();
  }
  window.CommunityReports = { init, selectCity, showCity, showReport, setLocation, refresh, validateDraft, validateFiles, renderReport, buildExport };
})();



