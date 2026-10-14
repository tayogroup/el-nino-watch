/* SWALIM terrain exploration: point evidence is kept separate from city-wide risk. */
window.FloodTerrain = (() => {
  const fallbackClasses = [
    {value: 4, label: 'Very high potential', color: '#c1341c'},
    {value: 3, label: 'High potential', color: '#f4a259'},
    {value: 2, label: 'Moderate potential', color: '#fde3a7'},
    {value: 1, label: 'Low / not indicated', color: '#b9bfc5'}
  ];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
  const element = id => document.getElementById(id);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const sourceLink = value => /^https:\/\//.test(String(value || '')) ? escape(value) : '';
  let options = {}, cityIndex = 0, source = null, sourceState = {}, sample = null, pending = null;

  function cityContext(city = []) {
    const context = String(city[4] || 'Terrain and drainage context');
    const kind = /river|confluence/i.test(context) ? 'River corridor' : /coastal/i.test(context) ? 'Coastal drainage' : 'Inland drainage';
    const guidance = kind === 'River corridor'
      ? 'Explore ground beside river channels, drainage outlets and historical flood footprints. Upstream rainfall and river conditions also matter.'
      : kind === 'Coastal drainage'
        ? 'Explore drainage depressions, blocked outlets and locally low ground. Coastal proximity alone does not establish flood exposure.'
        : 'Explore seasonal channels, drainage crossings and depressions. Locally low ground can collect water even in a high-elevation city.';
    return {name: String(city[0] || 'Selected city'), region: String(city[1] || ''), context, kind, guidance};
  }

  function pointEvidence(data, classes = fallbackClasses) {
    const classification = classes.find(item => item.value === data?.susceptibility?.value);
    const known = Boolean(classification && [1, 2, 3, 4].includes(classification.value));
    const high = known && classification.value >= 3;
    const historical = data?.historical?.intersects;
    return {
      known, high, classValue: known ? classification.value : null,
      classLabel: known ? classification.label : 'Mapped terrain class unavailable',
      color: known ? classification.color : '#7b8b9e',
      elevationM: finite(data?.elevationM) ? data.elevationM : null,
      history: historical === true ? 'Inside a mapped historical footprint'
        : historical === false ? 'No historical feature returned at this point; flooding is still possible'
          : 'Historical query unavailable',
      description: high ? 'This sampled cell has higher terrain susceptibility. Check the surrounding drainage and verify conditions locally.'
        : known ? 'This sampled cell is in a lower terrain class. This does not establish that the location is safe.'
          : 'No terrain class is inferred from elevation or missing source data.'
    };
  }

  function renderEvidence() {
    if (pending) return `<div class="terrain-evidence terrain-evidence-pending"><b>Checking selected ${pending.sampleKind === 'city-center' ? 'city centre' : 'map point'}…</b><p>${pending.lat.toFixed(5)}, ${pending.lon.toFixed(5)} · reading elevation and source hazard layers.</p></div>`;
    if (!sample) return '<div class="terrain-evidence terrain-evidence-empty"><b>Inspect a point to identify its mapped class</b><p>Click an orange or red ground cell, or inspect the selected city centre. A city-centre sample describes one point, not the whole city.</p></div>';
    const evidence = pointEvidence(sample, source?.classLegend || fallbackClasses);
    const centre = sample.sampleKind === 'city-center';
    const coordinates = finite(sample.lat) && finite(sample.lon) ? `${sample.lat.toFixed(5)}, ${sample.lon.toFixed(5)}` : 'Coordinates unavailable';
    const label = centre ? `${cityContext(options.cities?.[sample.cityIndex] || options.cities?.[cityIndex]).name} city centre · one sampled point` : 'Selected map point · one sampled cell';
    const susceptibilityUrl = sourceLink(sample.susceptibility?.sourceUrl || source?.layers?.susceptibility?.sourceUrl);
    const elevationUrl = sourceLink(sample.elevationSource?.sourceUrl);
    return `<div class="terrain-evidence ${evidence.high ? 'terrain-evidence-high' : ''}"><div class="terrain-evidence-head"><b>${escape(label)}</b><span>${coordinates}</span></div><div class="terrain-evidence-grid"><div><small>SWALIM terrain class</small><strong><i class="terrain-swatch" style="background:${escape(evidence.color)}"></i>${escape(evidence.classLabel)}</strong></div><div><small>Modelled ground elevation</small><strong>${evidence.elevationM === null ? 'Unavailable' : `${evidence.elevationM.toFixed(1)} m above sea level`}</strong></div></div><p>${escape(evidence.description)}</p><p class="terrain-history">${escape(evidence.history)}.</p><small>Static 30 m terrain screening · elevation is a separate 90 m DEM estimate. Neither shows current water, flood depth or a safe diversion route.</small>${susceptibilityUrl || elevationUrl ? `<div class="terrain-source-links">${susceptibilityUrl ? `<a href="${susceptibilityUrl}" target="_blank" rel="noopener">SWALIM source ↗</a>` : ''}${elevationUrl ? `<a href="${elevationUrl}" target="_blank" rel="noopener">Elevation source ↗</a>` : ''}</div>` : ''}${sample.errors?.length ? `<p class="terrain-query-note">${escape(sample.errors.join(' · '))}</p>` : ''}</div>`;
  }

  function render() {
    const target = element('terrain-summary');
    if (!target) return;
    const city = cityContext(options.cities?.[cityIndex]);
    const classes = source?.classLegend || fallbackClasses;
    const status = sourceState.error ? `Terrain overlays unavailable: ${sourceState.error}. No class is inferred.`
      : !source ? 'Connecting to FAO SWALIM terrain layers…'
        : sourceState.active ? `Terrain susceptibility visible · ${sourceState.susceptibility || 'connecting to map tiles'}.`
          : 'Terrain susceptibility hidden. Select “Show flood-prone terrain” to view the source overlay.';
    target.innerHTML = `<div class="terrain-context"><span class="terrain-context-tag">${escape(city.kind)}</span><p><b>${escape(city.name)}</b> · ${escape(city.region)}<br>${escape(city.guidance)}</p></div><div class="terrain-class-key" role="list" aria-label="SWALIM terrain susceptibility classes">${classes.map(item => `<span role="listitem"><i class="terrain-swatch" style="background:${escape(item.color)}"></i>${escape(item.label)}</span>`).join('')}<span role="listitem"><i class="terrain-swatch terrain-no-data"></i>Unmapped / no data</span></div><p class="terrain-reading">Orange and red ground cells show higher <b>terrain susceptibility</b>; city dots show rainfall screening. SWALIM uses height above nearby drainage, slope, depressions and flow pathways to locate flood-prone terrain. Absolute elevation alone cannot identify it.</p><p class="terrain-time-label">Static terrain potential · historical footprints cover 2013–2023 · neither layer shows flooding now.</p>${element('terrain-status') ? '' : `<p class="terrain-layer-status" role="status">${escape(status)}</p>`}${element('terrain-evidence') ? '' : renderEvidence()}`;
    if (element('terrain-status')) element('terrain-status').textContent = status;
    if (element('terrain-evidence')) element('terrain-evidence').innerHTML = renderEvidence();
    if (element('terrain-city')) element('terrain-city').value = String(cityIndex);
  }

  function validIndex(index) {
    return Number.isInteger(Number(index)) && Number(index) >= 0 && Number(index) < (options.cities?.length || 0);
  }

  function init(settings = {}) {
    options = settings;
    cityIndex = validIndex(settings.cityIndex) ? Number(settings.cityIndex) : 0;
    const select = element('terrain-city');
    if (select) {
      select.innerHTML = (options.cities || []).map((city, index) => `<option value="${index}">${escape(city[0])}</option>`).join('');
      select.onchange = event => {
        if (!validIndex(event.target.value)) return;
        updateCity(Number(event.target.value));
        options.onSelectCity?.(cityIndex);
      };
    }
    if (element('terrain-focus')) element('terrain-focus').onclick = () => options.onFocus?.(cityIndex);
    if (element('terrain-inspect')) element('terrain-inspect').onclick = () => options.onInspect?.(cityIndex);
    render();
  }

  function updateCity(index) {
    if (!validIndex(index)) return;
    if (cityIndex !== Number(index)) { sample = null; pending = null; }
    cityIndex = Number(index);
    render();
  }

  function setSource(config, state = {}) { source = config; sourceState = state; render(); }
  function loading(lat, lon, metadata = {}) {
    if (!finite(lat) || !finite(lon)) return;
    pending = {lat, lon, ...metadata}; sample = null; render();
  }
  function point(data) { sample = data || null; pending = null; render(); }
  function clearPoint() { sample = null; pending = null; render(); }
  return {init, updateCity, setSource, loading, point, clearPoint, cityContext, pointEvidence};
})();
