/* Live warning notices, source observations and explicitly labelled app screening. */
(function (root) {
  'use strict';
  const MAX_FEED_AGE = 2 * 60 * 60 * 1000, MAX_GAUGE_AGE = 2 * 86400000;
  const GAUGE_CITY = { SH001: 'Beledweyne', SH004: 'Jowhar', SH006: 'Afgooye', JB001: 'Luuq' };
  const valid = value => typeof value === 'number' && Number.isFinite(value);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const url = value => { try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; } };
  const epoch = value => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
  const time = value => Number.isFinite(epoch(value)) ? new Date(value).toLocaleString('en-GB', { timeZone: 'Africa/Mogadishu', hour12: false }) + ' EAT' : 'Date unavailable';
  const cityName = city => Array.isArray(city) ? city[0] : city?.name || '';
  const normalized = value => String(value || '').toLowerCase().replace(/[\s'-]/g, '').replace('gaalkacyo', 'galkayo').replace('mogadiscio', 'mogadishu');
  function fresh(feed, now) {
    const t = epoch(feed?.lastSuccess || feed?.fetchedAt);
    return !!feed?.data && !feed.error && !feed.stale && Number.isFinite(t) && t <= now && now - t <= MAX_FEED_AGE;
  }
  function daysAt(now) {
    const d = new Date(now + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const start = Date.parse(d + 'T00:00:00Z');
    return Array.from({ length: 3 }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10));
  }
  function rank(severity) {
    return ({ extreme: 4, severe: 3, high: 3, moderate: 2, elevated: 2, minor: 1, watch: 1 })[String(severity || '').toLowerCase()] || 0;
  }
  const SEVERITY_LEVELS = { high: 3, medium: 2, low: 1, unknown: 0 };
  const SOURCE_KEYS = ['moewr', 'floodhub', 'icpac', 'gdacs', 'swalim', 'open-meteo'];
  // Date range: whole days in East Africa Time. An alert applies from its start (or, without one, its
  // issue or observation time) to its expiry: an ICPAC or GDACS validity period, the app screen's
  // forecast day, a river gauge's observation. It is shown when that period touches the range.
  const DAY_MS = 86400000;
  const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && Number.isFinite(Date.parse(value + 'T00:00:00+03:00')) ? value : '';
  function appliesBetween(a, fromDay, toDay) {
    if (!fromDay && !toDay) return true;
    const start = Number.isFinite(epoch(a.startsAt)) ? epoch(a.startsAt) : epoch(a.issuedAt);
    if (!Number.isFinite(start)) return false;
    const end = Number.isFinite(epoch(a.endsAt)) ? epoch(a.endsAt) : start;
    return (!fromDay || end >= Date.parse(fromDay + 'T00:00:00+03:00')) && (!toDay || start < Date.parse(toDay + 'T00:00:00+03:00') + DAY_MS);
  }
  const severityLevel = severity => Math.min(rank(severity), 3);
  function css(severity) { return rank(severity) >= 3 ? 'alert-high' : rank(severity) === 2 ? 'alert-warning' : rank(severity) === 1 ? 'alert-watch' : 'alert-info'; }
  // Styling hook for the card's source tier; only MOEWR is official.
  function tier(alert) { return alert.official ? 'is-official' : alert.basis === 'observed-gauge' ? 'is-observed' : alert.basis === 'rainfall-screen' ? 'is-screening' : 'is-regional'; }
  function feedMessage(label, feed, now) {
    if (!feed?.data) return `${label}: unavailable${feed?.error ? ' — ' + feed.error : ' or connecting'}.`;
    if (!fresh(feed, now)) return `${label}: ${feed.error ? 'refresh failed — ' + feed.error : 'last response is stale or its retrieval date is invalid'}. Active signals are withheld.`;
    return null;
  }
  function build(input = {}) {
    const now = Number.isFinite(epoch(input.now)) ? epoch(input.now) : Date.now();
    const cities = Array.isArray(input.cities) ? input.cities : [], index = Number.isInteger(input.selectedCity) && cities[input.selectedCity] ? input.selectedCity : 0;
    const selected = cityName(cities[index]), scope = input.scope === 'all' ? 'all' : 'city', type = ['source', 'screen'].includes(input.type) ? input.type : 'all';
    const weather = input.weatherFeed, stations = input.stationFeed, official = input.officialFeed;
    const weatherFresh = fresh(weather, now), stationFresh = fresh(stations, now), officialFresh = fresh(official, now);
    const messages = [feedMessage('Forecast / event API', official, now), feedMessage('Rainfall forecast', weather, now), feedMessage('River observations', stations, now)].filter(Boolean);
    const alerts = [], forecastDates = daysAt(now), weatherCoverage = [];
    if (officialFresh) {
      const sources = official.data?.sources || [];
      for (const a of official.data?.alerts || []) {
        const issued = epoch(a.issuedAt), end = epoch(a.endsAt), start = epoch(a.startsAt);
        if (a.status !== 'active' || !Number.isFinite(issued) || issued > now || !Number.isFinite(end) || end <= now) continue;
        if (!['regional-forecast', 'model-event', 'event-monitoring', 'national-hydrological-forecast', 'river-forecast'].includes(a.basis)) continue;
        if (a.scope?.country && normalized(a.scope.country) !== 'somalia') continue;
        const sourceId = a.sourceId || (a.basis === 'regional-forecast' ? 'icpac' : 'gdacs');
        const source = sources.find(s => s.id === sourceId);
        if (source && (!source.available || source.error || !fresh({ data: true, fetchedAt: source.fetchedAt }, now))) continue;
        const names = Array.isArray(a.scope?.cities) ? a.scope.cities.filter(c => typeof c === 'string' && c.trim()) : [];
        const national = a.basis === 'national-hydrological-forecast', river = a.basis === 'river-forecast';
        alerts.push({ ...a, sourceKey: sourceId, id: String(a.id || `${sourceId}:${a.title}:${a.issuedAt}`), kind: 'source', cityNames: names, regionOnly: (national || river) && !names.length, official: national, severityLabel: national || river ? String(a.severityText || '') : '',
          severity: String(a.severity || 'unknown').toLowerCase(), sourceUrl: url(a.sourceUrl),
          // A Flood Hub card links to its gauge's own page (floodhub-feed.mjs), and says so.
          linkLabel: river && /\/floods\/l\/[^/]+\/[^/]+\/[^/]+\/g\/[^/]+$/.test(String(url(a.sourceUrl) || '')) ? 'Open gauge on Flood Hub ↗' : '',
          badge: national ? 'Official · National hydrological forecast (MOEWR)' : river ? 'River forecast · Google Flood Hub' : a.basis === 'regional-forecast' ? 'Regional forecast · ICPAC' : a.basis === 'model-event' ? 'GDACS model-based signal' : 'GDACS event monitoring',
          scopeLabel: river && a.scope?.gauge ? `${names.length ? names.join(', ') + ' · ' : ''}${a.scope.gauge}` : national && a.scope?.region ? `${names.length ? names.join(', ') + ' · ' : ''}${a.scope.region} region` : names.length ? names.join(', ') : `Somalia country-level · city extent unspecified${a.scope?.areaDescription ? ' · source area: ' + String(a.scope.areaDescription) : ''}`,
          timingLabel: `${Number.isFinite(start) && start > now ? 'Starts ' + time(a.startsAt) + ' · ' : ''}Issued ${time(a.issuedAt)} · expires ${time(a.endsAt)}`,
          guidance: national ? 'Official national flood forecast. Follow the instructions of MOEWR, SoDMA and local authorities, and act early where anticipatory action is activated.' : river ? 'AI model forecast of the river at this gauge, not an official warning. Follow MOEWR, SoDMA and local authority advice, and check routes away from the river.' : a.basis === 'regional-forecast' ? 'Regional model forecast for this week, not an official warning. Check local conditions and follow local authority advice.' : 'Review the linked source. This signal does not establish which city or neighbourhood is flooded.',
          notificationKey: `${a.id || a.title}:${a.basis}:${a.severity || 'unknown'}` });
      }
      for (const s of official.data?.sources || []) {
        if (!s.available || s.error || !fresh({ data: true, fetchedAt: s.fetchedAt }, now)) messages.push(`${s.name || s.id}: ${s.error || 'unavailable or stale'}. Coverage is incomplete.`);
        else if (s.notice) messages.push(`${s.name || s.id}: ${s.notice}`);
      }
    }
    if (weatherFresh) {
      cities.forEach((city, i) => {
        const name = cityName(city), daily = weather.data?.[i]?.daily;
        let complete = true;
        for (const date of forecastDates) {
          const k = daily?.time?.indexOf(date) ?? -1, rain = k >= 0 ? daily.precipitation_sum?.[k] : null;
          if (!valid(rain) || rain < 0) { complete = false; continue; }
          if (rain < 10) continue;
          const severity = rain >= 25 ? 'elevated' : 'watch';
          alerts.push({ id: `rain:${normalized(name)}:${date}`, kind: 'screen', basis: 'rainfall-screen', cityNames: [name],
            title: `${name} · ${severity === 'elevated' ? 'Elevated rainfall' : 'Rainfall watch'}`, severity,
            source: 'Open-Meteo weather forecast', sourceKey: 'open-meteo', sourceUrl: 'https://open-meteo.com/en/docs', issuedAt: weather.lastSuccess,
            startsAt: date + 'T00:00:00+03:00', endsAt: date + 'T23:59:59+03:00',
            description: `${rain.toFixed(1)} mm forecast for ${date} (daily total). App screening thresholds: Watch ≥10 mm/day; Elevated ≥25 mm/day. These are screening rules, not flood probabilities or official warning thresholds.`,
            badge: 'App rainfall screening', scopeLabel: name, timingLabel: `Forecast day ${date} · retrieved ${time(weather.lastSuccess)}`,
            guidance: 'Check low points, drains and safe routes. Flooding also depends on rainfall intensity, terrain, upstream flow and drainage capacity.',
            notificationKey: `rain:${normalized(name)}:${date}:${severity}` });
        }
        weatherCoverage.push({ city: name, complete });
      });
    }
    if (stationFresh) {
      for (const s of stations.data?.stations || []) {
        const name = GAUGE_CITY[s.code];
        if (!name || !cities.some(c => normalized(cityName(c)) === normalized(name)) || !valid(s.levelM) || s.levelM < 0) continue;
        const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s.observedAt || '');
        const observedAt = dateOnly ? s.observedAt + 'T00:00:00+03:00' : s.observedAt;
        const observed = epoch(observedAt);
        if (!Number.isFinite(observed) || observed > now || now - observed > MAX_GAUGE_AGE) continue;
        const ordered = [s.moderateM, s.highM, s.bankFullM].filter(value => valid(value) && value > 0);
        if (ordered.some((value, i) => i > 0 && value < ordered[i - 1])) continue;
        const thresholds = [['bank full', s.bankFullM, 'high'], ['high-risk', s.highM, 'high'], ['moderate-risk', s.moderateM, 'elevated']];
        const threshold = thresholds.find(([, value]) => valid(value) && value > 0 && s.levelM >= value);
        if (!threshold) continue;
        alerts.push({ id: `gauge:${s.code}:${s.observedAt}`, kind: 'source', basis: 'observed-gauge', cityNames: [name], severity: threshold[2],
          title: `${name} · river ${threshold[0]} threshold reached`, source: 'FAO SWALIM river observation', sourceKey: 'swalim', sourceUrl: url(s.sourceUrl), issuedAt: observedAt,
          badge: 'SWALIM observation · station threshold', scopeLabel: `${name} · ${s.name || s.code} gauge`,
          timingLabel: `Observed ${dateOnly ? s.observedAt + ' (source gives date only)' : time(observedAt)} · retrieved ${time(stations.lastSuccess)}`,
          description: `${s.name || s.code}: ${s.levelM.toFixed(2)} m; published ${threshold[0]} threshold ${threshold[1].toFixed(2)} m. A gauge threshold is a river risk indicator, not a measured flood footprint.`,
          guidance: 'Follow SWALIM and local authority updates. Review routes away from the river; confirm any inundation with current mapped or field evidence.',
          notificationKey: `gauge:${s.code}:${s.observedAt}:${threshold[0]}` });
      }
    }
    const relevant = alerts.filter(a => scope === 'all' || (!a.cityNames.length && !a.regionOnly) || a.cityNames.some(n => normalized(n) === normalized(selected)));
    const severity = Object.hasOwn(SEVERITY_LEVELS, input.severity) ? input.severity : 'all';
    const sourceFilter = SOURCE_KEYS.includes(input.source) ? input.source : 'all';
    const cityOptions = scope === 'all' ? [...new Map(relevant.flatMap(a => a.cityNames).map(n => [normalized(n), n])).values()].sort((a, b) => a.localeCompare(b)) : [];
    const cityFilter = cityOptions.find(n => normalized(n) === normalized(input.city)) || 'all';
    let dateFrom = validDay(input.from), dateTo = validDay(input.to);
    if (dateFrom && dateTo && dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
    const visible = relevant.filter(a => appliesBetween(a, dateFrom, dateTo) && (cityFilter === 'all' || (!a.cityNames.length && !a.regionOnly) || a.cityNames.some(n => normalized(n) === normalized(cityFilter))) && (sourceFilter === 'all' || a.sourceKey === sourceFilter) && (type === 'all' || a.kind === type) && (severity === 'all' || severityLevel(a.severity) === SEVERITY_LEVELS[severity])).sort((a, b) => rank(b.severity) - rank(a.severity) || epoch(b.issuedAt) - epoch(a.issuedAt));
    const count = basis => relevant.filter(a => a.basis === basis).length;
    return { alerts: visible, allAlerts: relevant, selectedCity: selected, scope, type, severity, sourceFilter, cityFilter, cityOptions, dateFrom, dateTo, now: new Date(now).toISOString(),
      forecastDates, weatherCoverage, messages: [...new Set(messages)],
      coverageNote: official?.data?.coverageNote || 'Forecast and event coverage may be incomplete. No returned signal does not establish safety.',
      sourceStatus: (official?.data?.sources || []).map(s => ({ name: s.name || s.id, publishedAt: s.publishedAt || s.lastBuildAt || null, rejectedExpired: Number.isInteger(s.rejectedExpired) ? s.rejectedExpired : 0 })),
      counts: { national: count('national-hydrological-forecast'), rivers: count('river-forecast'), regional: count('regional-forecast'), events: count('event-monitoring') + count('model-event'), gauges: count('observed-gauge'), screens: count('rainfall-screen') },
      fresh: { weather: weatherFresh, stations: stationFresh, official: officialFresh },
      floodHubEnabled: (official?.data?.sources || []).some(s => s.id === 'floodhub'),
      scopeLabel: scope === 'all' ? `${cities.length} cities + Somalia-wide notices` : `${selected || 'Selected city'} + Somalia-wide notices` };
  }

  let lastInput = null, notificationEnabled = false, notificationError = '', restored = false;
  const seen = new Set(), SEEN_KEY = 'somalia-flood-alerts-seen-v1', SEEN_LIMIT = 400;
  function restoreSeen() {
    if (restored) return;
    restored = true;
    try { const values = JSON.parse(root.localStorage?.getItem(SEEN_KEY) || '[]'); if (Array.isArray(values)) values.slice(-SEEN_LIMIT).forEach(v => { if (typeof v === 'string') seen.add(v); }); } catch {}
  }
  function remember(key) {
    seen.add(key); while (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value);
    try { root.localStorage?.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch {}
  }
  function notificationButton(node) {
    if (!node) return;
    const API = root.Notification;
    node.disabled = !API || API.permission === 'denied';
    node.textContent = !API ? 'Browser notifications unavailable' : API.permission === 'denied' ? 'Notifications blocked in browser' : notificationEnabled ? 'Disable browser alerts' : 'Enable browser alerts';
    node.title = 'While this app is open, show up to 3 browser notices per refresh for new dated source signals or app screening severities in the selected scope. Enabling may show current signals once. All signals remain visible here.';
    node.onclick = async () => {
      if (notificationEnabled) { notificationEnabled = false; notificationError = ''; if (lastInput) render(lastInput); return; }
      if (!API) return;
      try {
        const permission = API.permission === 'granted' ? 'granted' : await API.requestPermission();
        notificationEnabled = permission === 'granted';
        notificationError = permission === 'granted' ? '' : 'Browser permission was not granted. In-app alerts remain available.';
      } catch (e) { notificationError = 'Browser notifications could not be enabled: ' + e.message; }
      if (lastInput) render(lastInput);
    };
  }
  function notify(model) {
    if (!notificationEnabled || !root.Notification || root.Notification.permission !== 'granted') return;
    restoreSeen();
    // At most three popups per render; record this batch to avoid retrieval-time repeats.
    let count = 0;
    for (const a of model.alerts) {
      if (seen.has(a.notificationKey)) continue;
      if (count < 3) {
        try { new root.Notification(['model-event','event-monitoring'].includes(a.basis)?a.title:(root.SiteLanguage?.translateText(a.title)||a.title), { body: `${root.SiteLanguage?.translateText(a.badge)||a.badge} · ${root.SiteLanguage?.translateText(a.scopeLabel)||a.scopeLabel}\n${['model-event','event-monitoring'].includes(a.basis)?a.description:(root.SiteLanguage?.translateText(a.description)||a.description)}`, tag: a.notificationKey }); count++; }
        catch (e) { notificationError = 'Browser notification failed: ' + e.message; return; }
      }
      remember(a.notificationKey);
    }
  }
  // The post for an alert's Share row (share.js): the title; the place only when the title does not
  // already begin with it; when it applies, without the app's own "retrieved" time; the source; and the
  // disclaimer. GDACS event titles stay as published.
  function shareLines(a) {
    const title = String(a.title || ''), scope = String(a.scopeLabel || ''), lines = [];
    lines.push([['model-event', 'event-monitoring'].includes(a.basis) ? title : {t: title}]);
    if (scope && !title.startsWith(scope + ' ·') && title !== scope) lines.push([{t: scope}]);
    const timing = String(a.timingLabel || '').replace(/ · retrieved .*$/, '');
    lines.push([...(timing ? [{t: timing}, ' · '] : []), String(a.source || '')]);
    lines.push([{t: a.official ? 'Official national flood forecast (MOEWR).' : 'Not an official warning.'}]);
    return lines;
  }
  function render(input = {}) {
    lastInput = input;
    const model = build(input), doc = root.document;
    if (!doc?.getElementById) return model;
    const summary = doc.getElementById('alerts-summary'), list = doc.getElementById('alerts-list'), status = doc.getElementById('alerts-status');
    const scope = doc.getElementById('alerts-scope'), type = doc.getElementById('alerts-type'), button = doc.getElementById('alerts-notify');
    if (scope) { scope.value = model.scope; scope.onchange = event => input.onScope?.(event.target.value); }
    if (type) { type.value = model.type; type.onchange = event => input.onType?.(event.target.value); }
    const severity = doc?.getElementById?.('alerts-severity');
    if (severity) { severity.value = model.severity; severity.onchange = event => input.onSeverity?.(event.target.value); }
    const citySelect = doc?.getElementById?.('alerts-city'), cityField = doc?.getElementById?.('alerts-city-field');
    if (citySelect) {
      const options = '<option value="all">All cities</option>' + model.cityOptions.map(n => `<option value="${esc(n)}" data-i18n-skip>${esc(n)}</option>`).join('');
      if (citySelect.dataset?.options !== options) { citySelect.innerHTML = options; if (citySelect.dataset) citySelect.dataset.options = options; }
      citySelect.value = model.cityFilter; citySelect.onchange = event => input.onCity?.(event.target.value);
    }
    if (cityField) cityField.hidden = !model.cityOptions.length;
    const fromInput = doc?.getElementById?.('alerts-from'), toInput = doc?.getElementById?.('alerts-to');
    if (fromInput && toInput) {
      fromInput.value = model.dateFrom; toInput.value = model.dateTo;
      fromInput.max = model.dateTo; toInput.min = model.dateFrom;
      const changed = () => input.onDates?.(validDay(fromInput.value), validDay(toInput.value));
      fromInput.onchange = changed; toInput.onchange = changed;
    }
    const sourceSelect = doc?.getElementById?.('alerts-source');
    if (sourceSelect) { sourceSelect.value = model.sourceFilter; sourceSelect.onchange = event => input.onSource?.(event.target.value); }
    // Google Flood Hub is offered only once the server has its key (floodhub-feed.mjs).
    const floodHubOption = sourceSelect?.querySelector?.('option[value="floodhub"]');
    if (floodHubOption) floodHubOption.hidden = !model.floodHubEnabled;
    if (summary) summary.innerHTML = `<div class="alert-metrics"><span><b>${model.counts.national}</b> National flood forecasts (MOEWR)</span>${model.floodHubEnabled ? `<span><b>${model.counts.rivers}</b> River forecasts (Google Flood Hub)</span>` : ''}<span><b>${model.counts.regional}</b> ICPAC forecasts</span><span><b>${model.counts.events}</b> Source event signals</span><span><b>${model.counts.gauges}</b> River thresholds</span><span><b>${model.counts.screens}</b> App rainfall screens</span></div><p class="note">${esc(model.scopeLabel)} · next 3 forecast days: ${model.forecastDates[0]}–${model.forecastDates[2]} (including full today). Source signals and app screening are distinct.</p>`;
    if (list) list.innerHTML = model.alerts.length ? model.alerts.map(a => `<article class="alert-card ${css(a.severity)} ${tier(a)}"><div class="alert-card-head"><span class="badge">${esc(a.badge)}</span><span class="badge">${esc(a.severityLabel || a.severity)}</span></div><h3${['model-event','event-monitoring'].includes(a.basis)?' data-i18n-skip lang="und"':''}>${esc(a.title)}</h3><p class="alert-scope">${esc(a.scopeLabel)}</p><p${['model-event','event-monitoring'].includes(a.basis)?' data-i18n-skip lang="und"':''}>${esc(a.description || 'Read the source notice for details.')}</p><small>${esc(a.timingLabel)} · ${esc(a.source)}</small><p class="alert-guidance">${esc(a.guidance)}</p>${a.sourceUrl ? `<a href="${esc(a.sourceUrl)}" target="_blank" rel="noopener">${esc(a.linkLabel || 'Read source ↗')}</a>` : ''}${root.SiteShare?.row ? root.SiteShare.row(shareLines(a), 'alerts', a.official ? {t: 'Official forecast (MOEWR).'} : undefined) : ''}</article>`).join('') : `<div class="alert-card alert-info"><h3>No active signals returned for this view</h3><p>${model.messages.length ? 'Some feeds are unavailable or stale; check the status below.' : 'No matching source notice or app threshold is present in the fresh responses.'} This does not confirm that an area is safe or free from flooding.</p></div>`;
    notificationButton(button);
    root.WhatsAppAlerts?.update?.(model.selectedCity);
    notify(model);
    if (status) {
      const incomplete = model.weatherCoverage.filter(row => (model.scope === 'all' || normalized(row.city) === normalized(model.selectedCity)) && !row.complete);
      status.innerHTML = `<p>${esc(model.coverageNote)}</p>${model.sourceStatus.map(s => `<p class="note">${esc(s.name)} · latest published notice / feed date: ${esc(time(s.publishedAt))}${s.rejectedExpired ? ' · ' + s.rejectedExpired + ' expired records excluded' : ''}. A new API retrieval is not a new warning.</p>`).join('')}${incomplete.length ? `<p class="feed-error">Rainfall screening incomplete for ${esc(incomplete.map(row => row.city).join(', '))}: missing values were not treated as zero.</p>` : ''}${model.messages.map(message => `<p class="feed-error">${esc(message)}</p>`).join('')}<p>Browser alerts ${notificationEnabled ? 'enabled' : 'off'} · only while this app is open · the selected filters · up to 3 notices per refresh. ${esc(notificationError)}</p>`;
    }
    return model;
  }
  // The public health alert (index.html #health-alert) is static; its Share row is drawn once here. Each
  // language's post fits X's limit whole, so no line is ever dropped (health-alert.test.mjs).
  const HEALTH_SHARE = [[{t: "Public health alert: flooding raises the risk of cholera, malaria and dengue in Somalia."}], [{t: "Drink boiled or treated water, keep ORS ready and use bed nets."}], [{t: "Health guidance from WHO, not an outbreak report."}]];
  const healthShare = root.document?.getElementById?.('health-share');
  if (healthShare && root.SiteShare?.row) healthShare.innerHTML = root.SiteShare.row(HEALTH_SHARE, 'alerts', {t: "Health guidance from WHO, not an outbreak report."});
  root.FloodAlerts = { build, render, shareLines, appliesBetween, healthShareLines: HEALTH_SHARE };
})(typeof window === 'object' ? window : globalThis);
