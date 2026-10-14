(function (global) {
  'use strict';
  const STALE_MS = 2 * 60 * 60 * 1000;
  const ALLOWED_HOSTS = new Set(['stac.dataspace.copernicus.eu', 'browser.dataspace.copernicus.eu', 'documentation.dataspace.copernicus.eu', 'dataspace.copernicus.eu']);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
  const validNumber = value => typeof value === 'number' && Number.isFinite(value);
  function sourceUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && ALLOWED_HOSTS.has(url.hostname.toLowerCase()) ? url.href : null;
    } catch { return null; }
  }
  function sourceTime(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  function timeLabel(value, utc = false) {
    const ms = sourceTime(value);
    if (ms === null) return 'Time unavailable';
    return new Date(ms).toLocaleString('en-GB', { timeZone: utc ? 'UTC' : 'Africa/Mogadishu', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }) + (utc ? ' UTC' : ' EAT');
  }
  function build({cityName = '', feed = {}, clearerOnly = false, now = new Date().toISOString()} = {}) {
    const nowMs = sourceTime(now) ?? Date.now(), data = feed.data, retrievedAt = feed.lastSuccess || data?.fetchedAt || null;
    const retrievedMs = sourceTime(retrievedAt);
    const stale = !!data && (!!feed.stale || !!feed.error || retrievedMs === null || nowMs - retrievedMs > STALE_MS || retrievedMs > nowMs + 60000);
    const groups = ['radar', 'optical'].map(key => {
      const mission = data?.missions?.[key], seen = new Set();
      const scenes = (Array.isArray(mission?.scenes) ? mission.scenes : []).filter(scene => {
        if (!scene || typeof scene !== 'object') return false;
        const identity = `${scene.id || ''}|${scene.datetime || ''}`;
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
      }).map(scene => {
        const acquiredMs = sourceTime(scene.datetime), cloud = key === 'optical' && validNumber(scene.cloudCoverPercent) && scene.cloudCoverPercent >= 0 && scene.cloudCoverPercent <= 100 ? scene.cloudCoverPercent : null;
        return {
          id:String(scene.id || 'Acquisition identifier unavailable'),
          datetime: acquiredMs === null ? null : scene.datetime,
          date: acquiredMs === null ? null : new Date(acquiredMs).toISOString().slice(0,10),
          acquiredAtLabel: timeLabel(scene.datetime), utcLabel:timeLabel(scene.datetime, true),
          ageLabel: acquiredMs === null ? 'Acquisition time unavailable' : acquiredMs > nowMs + 60000 ? 'Check future acquisition timestamp' : nowMs - acquiredMs > 2 * 86400000 ? 'Older observation · over 2 days' : 'Recent acquisition',
          older: acquiredMs !== null && nowMs - acquiredMs > 2 * 86400000,
          future: acquiredMs !== null && acquiredMs > nowMs + 60000,
          cloudCoverPercent:cloud,
          cloudLabel:key === 'radar' ? 'Radar can observe through clouds' : cloud === null ? 'Scene-wide cloud cover unknown' : `${cloud.toFixed(1)}% scene-wide cloud cover`,
          heavyCloud:key === 'optical' && cloud !== null && cloud > 70,
          platform: typeof scene.platform === 'string' ? scene.platform : null,
          orbitDirection: typeof scene.orbitDirection === 'string' ? scene.orbitDirection : null,
          polarizations: Array.isArray(scene.polarizations) ? scene.polarizations.filter(value => typeof value === 'string').join(' / ') : null,
          resolutionM: validNumber(scene.resolutionM) && scene.resolutionM > 0 ? scene.resolutionM : null,
          metadataUrl:sourceUrl(scene.metadataUrl), browserUrl:sourceUrl(scene.browserUrl), browserSelectionRequired:scene.browserSelectionRequired === true
        };
      }).sort((a,b) => (sourceTime(b.datetime) ?? -Infinity) - (sourceTime(a.datetime) ?? -Infinity));
      const visibleScenes = key === 'optical' && clearerOnly ? scenes.filter(scene => scene.cloudCoverPercent !== null && scene.cloudCoverPercent <= 30) : scenes;
      return {key, title:key === 'radar' ? 'Sentinel-1 radar' : 'Sentinel-2 optical', available:!!mission?.available, error:typeof mission?.error === 'string' ? mission.error : null, totalCount:scenes.length, scenes:visibleScenes, filtered:key === 'optical' && !!clearerOnly};
    });
    const availableCount = groups.filter(group => group.available).length;
    const stateLabel = !data ? feed.loading ? 'Connecting to Copernicus public API' : 'Copernicus catalogue unavailable' : stale ? 'Last known catalogue · refresh unavailable or old' : availableCount === 2 ? 'Copernicus public API connected' : availableCount === 1 ? 'Copernicus API partly available' : 'Copernicus catalogue unavailable';
    return {
      cityName:String(cityName), groups, stale, loading:!!feed.loading, error:typeof feed.error === 'string' ? feed.error : null, stateLabel,
      retrievedAt, retrievedLabel:retrievedAt ? timeLabel(retrievedAt) : 'Not yet retrieved',
      queryWindow: data?.queryWindow?.start && data?.queryWindow?.end ? `${timeLabel(data.queryWindow.start, true)} → ${timeLabel(data.queryWindow.end, true)}` : null,
      coverageNote:typeof data?.coverageNote === 'string' ? data.coverageNote : 'Acquisition metadata does not establish that flooding is present or absent. A scene footprint may only partly cover the city.',
      requiresCredentials:data?.processing?.requiresCredentials !== false,
      processingNote:typeof data?.processing?.note === 'string' ? data.processing.note : 'Custom Sentinel imagery processing requires Copernicus Data Space credentials configured on the server. This public catalogue connection does not need a key.'
    };
  }
  const icons = {
    radar:'<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m8 6 8 8-6 6-8-8 6-6Zm8 8 8 8-6 6-8-8 6-6Zm3-9 8 8m-4-12 8 8M10 24l-3 5m-1-5-4 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    optical:'<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 10h5l2-4h8l2 4h5v16H5V10Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="16" cy="18" r="5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M23 14h1" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>'
  };
  function sceneHtml(scene, group, canInspectRadar) {
    const details = [scene.platform, group.key === 'radar' ? scene.orbitDirection : null, group.key === 'radar' ? scene.polarizations : null].filter(Boolean).map(escape).join(' · ');
    const radarButton = group.key === 'radar' && scene.date && !scene.future && canInspectRadar ? `<button type="button" class="copernicus-radar-date" data-radar-date="${escape(scene.date)}" aria-label="Check the separate flood classification for ${escape(scene.date)} UTC">Check flood layer for this date</button>` : '';
    return `<article class="copernicus-scene"><div class="copernicus-scene-top"><time${scene.datetime ? ` datetime="${escape(scene.datetime)}"` : ''}>${escape(scene.acquiredAtLabel)}</time><span class="copernicus-age${scene.older || scene.future ? ' copernicus-age-old' : ''}">${escape(scene.ageLabel)}</span></div><div class="copernicus-scene-time">${escape(scene.utcLabel)}</div><div class="copernicus-condition${scene.heavyCloud ? ' copernicus-cloudy' : ''}">${escape(scene.cloudLabel)}${scene.heavyCloud ? ' · ground may be obscured' : ''}</div>${details ? `<div class="copernicus-scene-details">${details}</div>` : ''}<div class="copernicus-scene-links">${scene.browserUrl ? `<a href="${escape(scene.browserUrl)}" target="_blank" rel="noopener">${group.key === 'radar' && scene.browserSelectionRequired ? 'Open Browser · choose Sentinel-1 ↗' : `Inspect ${group.key === 'radar' ? 'radar' : 'optical'} imagery ↗`}</a>` : ''}${scene.metadataUrl ? `<a href="${escape(scene.metadataUrl)}" target="_blank" rel="noopener">Acquisition metadata ↗</a>` : ''}</div>${radarButton}<details class="copernicus-id"><summary>Acquisition identifier</summary><code>${escape(scene.id)}</code></details></article>`;
  }
  function render(input = {}) {
    const model = build(input), document = global.document, root = document?.getElementById('scenes'), status = document?.getElementById('copernicus-status');
    if (!root) return model;
    if (status) {
      status.textContent = `${model.stateLabel}${model.loading && model.retrievedAt ? ' · refreshing' : ''}. Last successful retrieval: ${model.retrievedLabel}.${model.error ? ` ${model.error}` : ''}`;
      status.className = `copernicus-status${model.stale || model.error ? ' copernicus-status-stale' : ''}`;
    }
    root.innerHTML = `<div class="copernicus-missions">${model.groups.map(group => {
      const empty = !group.available ? group.error || (model.loading ? 'Checking acquisition metadata…' : 'This mission catalogue is currently unavailable.') : group.filtered && group.totalCount ? 'No returned optical acquisitions meet the ≤30% scene-wide cloud filter. Radar acquisitions remain visible.' : `No ${group.key === 'radar' ? 'radar' : 'optical'} acquisitions returned for this city in the queried period. This does not establish that the city is flood-free.`;
      return `<section class="copernicus-mission copernicus-${group.key}" aria-label="${escape(group.title)} acquisitions for ${escape(model.cityName)}"><div class="copernicus-mission-head"><span class="copernicus-mission-icon">${icons[group.key]}</span><div><h4>${escape(group.title)}</h4><span>${group.key === 'radar' ? 'Cloud-independent observation · inspect interpretation' : 'True-colour inspection · clouds affect visibility'}</span></div><span class="copernicus-count">${group.scenes.length}${group.filtered ? ` / ${group.totalCount}` : ''}</span></div>${group.error && group.scenes.length ? `<p class="copernicus-source-error">${escape(group.error)} · retained acquisition metadata</p>` : ''}<div class="copernicus-scene-list">${group.scenes.length ? group.scenes.map(scene => sceneHtml(scene, group, typeof input.onInspectRadar === 'function')).join('') : `<p class="copernicus-empty">${escape(empty)}</p>`}</div></section>`;
    }).join('')}</div><p class="copernicus-note">${escape(model.coverageNote)}</p><p class="copernicus-note">Radar acquisitions listed here are catalogue records. Checking their date opens a separate CEMS flood classification; it does not prove that a listed acquisition was processed or that the city has classification coverage. Optical cloud percentages apply to the whole scene, not this location.</p>${model.queryWindow ? `<p class="copernicus-query"><b>Catalogue query:</b> ${escape(model.queryWindow)}</p>` : ''}<details class="copernicus-access"><summary>How this API connection works</summary><p>Public Sentinel-1 and Sentinel-2 acquisition metadata is retrieved from the Copernicus Data Space STAC API without a key. ${escape(model.processingNote)}</p><p>Store processing credentials only in the server configuration. Do not include them in reports, comments or browser code.</p><a href="https://documentation.dataspace.copernicus.eu/APIs/STAC.html" target="_blank" rel="noopener">Copernicus STAC API documentation ↗</a></details><div class="copernicus-action-status" aria-live="polite"></div>`;
    root.querySelectorAll?.('[data-radar-date]').forEach(button => button.addEventListener('click', async () => {
      const feedback = root.querySelector?.('.copernicus-action-status');
      const date = button.getAttribute('data-radar-date');
      button.disabled = true;
      try {
        const result = await input.onInspectRadar(date);
        if (feedback) feedback.textContent = result === false ? `The flood product does not offer ${date}. Select an available date in the satellite observation controls.` : `Requested the separate flood layer for ${date} UTC. Check its observation coverage, exclusions and source status on the map.`;
      } catch { if (feedback) feedback.textContent = 'The flood layer could not be selected. Use the satellite observation controls to check available dates.'; }
      finally { button.disabled = false; }
    }));
    return model;
  }
  global.CopernicusScenes = {build, render};
})(window);
