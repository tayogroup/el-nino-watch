(function (root) {
  'use strict';

  const sources = {
    safety: { title: 'NWS flood preparedness and safety', url: 'https://www.weather.gov/jan/beprepared-flooding' },
    drains: { title: 'Environment Agency: asset maintenance principles', url: 'https://www.gov.uk/government/publications/flood-risk-asset-maintenance-and-inspection-good-practice-guidance/flood-risk-asset-maintenance-and-inspection-good-practice-guidance' },
    urban: { title: 'WMO / Cap-Net: Integrated Urban Flood Management', url: 'https://www.floodmanagement.info/floodmanagement/wp-content/uploads/2020/06/Cap-Net-WMO-Integrated-Urban-Flood-Management.pdf' },
    diversion: { title: 'WMO / APFM: environmental aspects of flood management', url: 'https://www.floodmanagement.info/publications/policy/ifm_env_aspects/Environmental_Aspects_of_IFM_En.pdf' },
    somalia: { title: 'FAO: Somalia flood management and modelling', url: 'https://www.fao.org/africa/news-stories/news-detail/Reducing-displacement-and-helping-communities-to-cope-with-a-changing-climate-in-rural-Somalia/en' }
  };
  const scenarios = {
    live: { label: 'Live conditions', assumption: 'Recommendations use the available live evidence and mapped susceptibility screening.' },
    'heavy-rain': { label: 'Heavy rain exercise', assumption: 'Hypothetical exercise: intense local rain tests preparedness. This does not change the live rainfall forecast or estimate flood depth.' },
    'river-rise': { label: 'River rise exercise', assumption: 'Hypothetical exercise: rising river water tests preparedness. No river level, flood extent or depth is simulated.' },
    'blocked-drains': { label: 'Blocked drains exercise', assumption: 'Hypothetical exercise: obstructed drainage tests preparedness. No blockage has been verified by this app.' }
  };
  const urgency = {
    routine: { label: 'Routine preparedness', color: '#176b54', background: '#e7f3ee' },
    prepare: { label: 'Prepare and verify', color: '#765809', background: '#fff4cc' },
    agency: { label: 'Agency / engineer review', color: '#854923', background: '#fae7d6' },
    contact: { label: 'Contact authorities / verify', color: '#9c2f1c', background: '#fce4df' }
  };
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const dateOnly = d => {
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    const parsed = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === d ? d : null;
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : null; } catch { return null; } };
  const number = n => finite(n) ? n.toFixed(1) : 'unavailable';
  const action = (id, title, text, level, owner, source) => ({ id, title, text, urgency: urgency[level], owner, source: sources[source] });
  // Export-only provenance keeps proper station names out of translation while
  // leaving the model and its English text/schema unchanged.
  const exportSourceParts = new WeakMap();

  function build(input = {}) {
    const city = input.city || {};
    const cityName = String(city.name || 'Selected city');
    const scenarioKnown = Object.prototype.hasOwnProperty.call(scenarios, input.scenario);
    const scenario = scenarioKnown ? input.scenario : 'live';
    const liveRisk = ['Lower', 'Watch', 'Elevated', 'Unavailable'].includes(input.risk) ? input.risk : 'Unavailable';
    const date = dateOnly(input.selectedDate);
    const scenarioInfo = scenarios[scenario];
    const riverine = /river corridor/i.test(city.context || '');
    const coastal = /coastal/i.test(city.context || '');
    const station = input.station || null;
    const terrain = input.terrain || null;
    const point = input.selectedPoint || null;
    const generatedAt = new Date().toISOString();
    const generatedDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Mogadishu' });
    const observedAt = dateOnly(station?.observedAt);
    const ageDays = observedAt ? (Date.parse(`${generatedDate}T00:00:00Z`) - Date.parse(`${observedAt}T00:00:00Z`)) / 86400000 : null;
    const stationReliable = !!station && finite(station.levelM) && ageDays !== null && ageDays >= 0 && ageDays <= 2 && !input.stationFeedStale;
    const stationReliableHigh = stationReliable && finite(station.highM) && station.levelM >= station.highM;
    const mappedClass = point?.susceptibility?.label || point?.terrainClass;
    const mappedAvailable = typeof mappedClass === 'string' && !!mappedClass.trim() && !/unavailable|no.?data|unknown/i.test(mappedClass);
    const evidence = [
      `Selected planning day: ${date || 'unavailable'}.`,
      `Live rainfall screen: ${liveRisk}${input.forecastStale ? ' · stale / last known response' : ''}. This screen is not an official flood warning.`,
      `Selected-day rainfall model: ${number(input.rainMm)}${finite(input.rainMm) ? ' mm' : ''}.`,
      `Forecast retrieved: ${input.forecastRetrievedAt || 'retrieval timestamp unavailable'}.`
    ];
    if (station && finite(station.levelM)) {
      evidence.push(`Matched gauge: ${station.name || 'name unavailable'} · ${number(station.levelM)} m · observed ${observedAt || 'date unavailable'}${ageDays !== null && ageDays > 2 ? ' · OLD OBSERVATION' : ''}${ageDays !== null && ageDays < 0 ? ' · FUTURE-DATED OBSERVATION' : ''}${input.stationFeedStale ? ' · FEED STALE / last known response' : ''}. Gauge stage is not flood depth at this city or map point.`);
      if (stationReliableHigh) evidence.push(`The recent gauge reading is at or above the source high-risk threshold (${number(station.highM)} m). Contact local authorities to verify the latest situation; this app does not issue a flood warning.`);
      else if (!stationReliable) evidence.push('Gauge freshness is insufficient to confirm present river conditions. Obtain a current dated reading and local advice.');
    } else evidence.push('Matched river observation: unavailable. River-rise conditions cannot be confirmed from this evidence.');
    if (mappedAvailable) evidence.push(`SWALIM mapped flood susceptibility at the selected point: ${mappedClass}. This static HAND / DEM-derived screening layer is not current floodwater, a forecast or water depth.`);
    if (terrain?.available && Number.isInteger(terrain.lowCells) && Number.isInteger(terrain.sampleCount) && terrain.sampleCount > 0 && terrain.lowCells >= 0 && terrain.lowCells <= terrain.sampleCount) {
      evidence.push(`Terrain screening: ${terrain.lowCells} of ${terrain.sampleCount} sampled locations are relatively low. These are inspection priorities; no inundation is inferred.`);
    } else if (!mappedAvailable) evidence.push('Point susceptibility query: unavailable or no point selected. Inspect the mapped layer and verify low areas through a local survey and drainage information.');
    if (point && finite(point.lat) && finite(point.lon)) {
      evidence.push(`Selected map point: ${point.lat.toFixed(5)}, ${point.lon.toFixed(5)} · elevation ${number(point.elevationM)}${finite(point.elevationM) ? ' m' : ''}${finite(point.relativeM) ? ` · relative elevation ${number(point.relativeM)} m` : ''}.`);
      if (typeof point.historical?.intersects === 'boolean') evidence.push(point.historical.intersects ? 'Historical layer: this point intersects a mapped past flood extent; this does not establish current flooding.' : 'Historical layer: no mapped past flood feature was returned at this point; flooding is still possible.');
      if (point.sourceNote) evidence.push(`Map source note: ${point.sourceNote}`);
    }
    const prepare = scenario !== 'live' || ['Watch', 'Elevated', 'Unavailable'].includes(liveRisk) || !!input.forecastStale || stationReliableHigh;
    const actions = [
      action('prepare', 'Plan access and protect essentials', 'Verify a route and shelter on higher ground with local authorities. Include children, older people, people with disabilities and livestock. Keep water, medicine and documents accessible. Follow SoDMA and local instructions; never walk or drive through floodwater.', prepare ? 'prepare' : 'routine', 'Households + local disaster committee', 'safety'),
      action('drains', scenario === 'blocked-drains' ? 'Inspect the assumed blockage safely' : 'Check existing drains before rain', 'Report blocked inlets, culverts and damaged drains from dry, safe ground. Municipal crews should clear debris and restore the existing designed system, with safe waste disposal. Do not enter culverts, manholes or floodwater, or alter a drain outlet yourself.', scenario === 'blocked-drains' ? 'prepare' : 'routine', 'Municipal drainage / public works team', 'drains'),
      action('storage', 'Keep space for water', 'Protect natural depressions and flood storage from filling or building. Ask engineers to assess detention, retention or roof-water storage with controlled overflow, maintenance and water-quality checks. Storage can slow runoff; unsuitable infiltration can harm foundations or groundwater.', 'agency', 'Municipality + water / environmental engineer', 'urban'),
      riverine || scenario === 'river-rise'
        ? action('river', 'Review river protection and escape routes', riverine ? 'Ask the responsible water authority to inspect embankments, existing canals and known breakage points. Coordinate repairs and vegetation protection through an approved programme. Use local river warnings to prepare movement before access is lost.' : 'This city is not labelled as a river corridor in the app. Verify the actual river or seasonal channel and exposed neighbourhoods with local authorities before applying river-rise planning.', 'agency', 'Water authority + local disaster committee', 'somalia')
        : action('runoff', 'Check local flow paths and outfalls', coastal ? 'Inspect streets, seasonal channels and existing coastal outfalls with public works. Engineers should check tide or sea-level backwater, erosion and outfall capacity before proposing changes. Keep channel corridors clear of development.' : 'Map seasonal channels, road crossings and repeated ponding with public works and residents. Confirm actual flow paths and keep natural drainage corridors open. Prioritise verified access constraints rather than assuming every low point floods.', 'agency', 'Public works + water engineer', 'urban'),
      action('diversion', 'Assess diversion as a designed option', 'A bypass, restored canal or protected outfall can transfer risk downstream. Any physical diversion needs a site survey, hydraulic modelling, agency and engineer review, community consultation and required permits. Check receiving capacity, erosion, backwater, land rights and downstream impacts. Do not cut embankments or dig an unplanned canal.', 'agency', 'Water authority + qualified hydraulic engineer', 'diversion')
    ];
    if (stationReliableHigh) actions.unshift({
      ...action('contact', 'Verify the high gauge reading with authorities', `The ${station.name || 'matched'} gauge reading from ${observedAt} meets the source high-risk threshold. Contact the local disaster committee and water authority for current conditions, access and protective actions. Follow their instructions; a gauge reading alone is not a city-wide evacuation order.`, 'contact', 'Local disaster committee + water authority', 'somalia'),
      source: { title: 'SWALIM river gauge thresholds', url: safeUrl(station.sourceUrl) || 'https://frrims.faoswalim.org/' }
    });
    const limits = [
      'This is a planning checklist, not a drainage design, official warning or evacuation order. Confirm local conditions and agency advice.',
      'DEM and susceptibility layers cannot resolve drains, culverts, protective embankments or building levels. They do not establish flood depth, safe shelter or diversion alignment. Point elevation and national terrain classes require field verification.',
      'Live forecasts are model estimates. Later forecast days are less certain; missing or old observations must remain unknown.',
      'Drainage guidance draws on general maintenance principles; the cited England guidance does not establish Somali legal requirements.'
    ];
    if (!scenarioKnown) limits.unshift('Scenario was missing or unrecognised; live-evidence planning is shown.');
    if (scenario !== 'live') limits.unshift('Scenario actions are hypothetical. The live forecast and live rainfall screen have not been altered.');
    const usedSources = [...new Set(actions.map(a => a.source))];
    const dataSources = [
      { title: 'Rainfall: Open-Meteo weather model API', url: 'https://open-meteo.com/en/docs', date: input.forecastRetrievedAt || 'retrieval timestamp unavailable' },
      { title: 'River observation: SWALIM', url: safeUrl(station?.sourceUrl) || 'https://frrims.faoswalim.org/', date: dateOnly(station?.observedAt) || 'observation unavailable' }
    ];
    if (mappedAvailable) dataSources.push({ title: 'Mapped susceptibility: FAO SWALIM, 30 m HAND / DEM-derived layer', url: safeUrl(point?.susceptibility?.sourceUrl) || 'https://spatial.faoswalim.org/catalogue/#/dataset/609', date: 'Static screening · published 8 September 2026' });
    if (typeof point?.historical?.intersects === 'boolean') dataSources.push({ title: 'Historical flood extents: FAO SWALIM', url: 'https://spatial.faoswalim.org/catalogue/#/dataset/295', date: 'Historical extents 2013–2023 · not current floodwater' });
    if (point && finite(point.elevationM)) dataSources.push({ title: 'Point elevation: Open-Meteo / Copernicus DEM GLO-90', url: 'https://open-meteo.com/en/docs/elevation-api', date: 'Static elevation · approximately 90 m grid' });
    const plan = {
      city: cityName, region: String(city.region || ''), scenario, scenarioLabel: scenarioInfo.label,
      hypothetical: scenario !== 'live', assumption: scenarioInfo.assumption, liveRisk, selectedDate: date,
      generatedAt, stationReliableHigh, evidence, actions, limits, sources: usedSources, dataSources
    };
    exportSourceParts.set(plan, { stationName: station?.name ? String(station.name) : null, cityNameProvided: Boolean(city.name) });
    plan.text = [
      `SOMALIA FLOOD WATCH — PLANNING CHECKLIST`, `${plan.city}${plan.region ? `, ${plan.region}` : ''}`,
      `Generated: ${generatedAt}`, `Planning day: ${date || 'unavailable'}`, `Mode: ${scenarioInfo.label}`,
      scenarioInfo.assumption, '', 'EVIDENCE', ...evidence, '', 'ACTIONS',
      ...actions.flatMap((a, i) => [`${i + 1}. ${a.title} [${a.urgency.label}]`, `Responsible: ${a.owner}`, a.text, `Guidance: ${a.source.title} — ${a.source.url}`, '']),
      'LIMITS', ...limits, '', 'DATA SOURCES', ...dataSources.map(s => `${s.title} — ${s.url} — ${s.date}`),
      '', 'No dimensions, water depths, construction alignment or design approval are provided.'
    ].join('\n');
    return plan;
  }

  function checklistText(plan) {
    if (!plan || typeof plan.text !== 'string') return '';
    const language = root.SiteLanguage;
    if (language?.getLanguage?.() !== 'so' || typeof language.translateText !== 'function') return plan.text;
    const t = value => language.translateText(String(value ?? ''));
    // Translate a UI template first, then insert data. Values inserted here are
    // never sent through the translator, so quotes, URLs and identities survive.
    const formatLabel = (template, ...values) => t(template).replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)] ?? ''));
    const sourceParts = exportSourceParts.get(plan);
    const protectName = (text, prefix, name) => {
      if (!name || !text.startsWith(prefix + name)) return t(text);
      const marker = '\uE100STATION\uE101';
      const masked = prefix + marker + text.slice(prefix.length + name.length);
      return t(masked).replaceAll(marker, name);
    };
    const evidenceText = item => {
      const text = String(item);
      if (text.startsWith('Map source note: ')) return formatLabel('Map source note: {0}', text.slice('Map source note: '.length));
      if (text.startsWith('Matched gauge: ')) {
        const prefix = 'Matched gauge: ';
        const name = sourceParts ? sourceParts.stationName : text.slice(prefix.length).split(' · ')[0];
        const marker = '\uE100STATION\uE101';
        let prepared = name ? prefix + marker + text.slice(prefix.length + name.length) : text.replace(prefix + 'name unavailable', prefix + t('name unavailable'));
        // These are app-added freshness labels, outside the protected source name.
        for (const label of ['OLD OBSERVATION','FUTURE-DATED OBSERVATION','FEED STALE / last known response','date unavailable']) prepared = prepared.replaceAll(label,t(label));
        return t(prepared).replaceAll(marker,name || '');
      }
      return t(text);
    };
    const actionText = item => {
      if (item.id !== 'contact') return t(item.text);
      if (sourceParts?.stationName) return protectName(String(item.text),'The ',sourceParts.stationName);
      return t(sourceParts ? String(item.text).replace(/^The matched gauge/,'The ' + t('matched') + ' gauge') : item.text);
    };
    const cityLabel = sourceParts?.cityNameProvided === false ? t(plan.city) : plan.city;
    return [
      t('SOMALIA FLOOD WATCH — PLANNING CHECKLIST'), `${cityLabel}${plan.region ? `, ${plan.region}` : ''}`,
      formatLabel('Generated: {0}',plan.generatedAt), formatLabel('Planning day: {0}',plan.selectedDate || t('unavailable')),
      formatLabel('Mode: {0}',t(plan.scenarioLabel)), t(plan.assumption), '', t('EVIDENCE'), ...plan.evidence.map(evidenceText), '', t('ACTIONS'),
      ...plan.actions.flatMap((item,index) => [
        `${index + 1}. ${t(item.title)} [${t(item.urgency.label)}]`,
        formatLabel('Responsible: {0}',t(item.owner)), actionText(item),
        formatLabel('Guidance: {0}',`${t(item.source.title)} — ${item.source.url}`), ''
      ]),
      t('LIMITS'), ...plan.limits.map(t), '', t('DATA SOURCES'),
      ...plan.dataSources.map(item => `${t(item.title)} — ${item.url} — ${t(item.date)}`), '',
      t('No dimensions, water depths, construction alignment or design approval are provided.')
    ].join('\n');
  }

  let currentPlan = null;
  function render(input) {
    const plan = build(input);
    currentPlan = plan;
    const document = root.document;
    if (!document) return plan;
    const summary = document.getElementById('planning-summary');
    const cards = document.getElementById('planning-actions');
    const limits = document.getElementById('planning-limits');
    const download = document.getElementById('plan-download');
    if (summary) summary.innerHTML = `<div class="planning-mode ${plan.hypothetical ? 'scenario-mode' : 'live-mode'}"><b>${escape(plan.scenarioLabel)} · ${escape(plan.city)}</b><p>${escape(plan.assumption)}</p></div><details class="planning-evidence"><summary>Evidence used for this plan</summary><ul>${plan.evidence.map(item => `<li>${escape(item)}</li>`).join('')}</ul></details>`;
    if (cards) cards.innerHTML = plan.actions.map(a => `<article class="planning-card" style="border-left:3px solid ${a.urgency.color}"><span class="badge planning-urgency" style="background:${a.urgency.background};color:${a.urgency.color}">${escape(a.urgency.label)}</span><h3>${escape(a.title)}</h3><p>${escape(a.text)}</p><small>Responsible: ${escape(a.owner)}</small><a href="${escape(a.source.url)}" target="_blank" rel="noopener noreferrer" class="planning-source">${escape(a.source.title)} ↗</a></article>`).join('');
    if (limits) limits.innerHTML = `<details><summary>Planning limits and review requirements</summary><ul>${plan.limits.map(item => `<li>${escape(item)}</li>`).join('')}</ul></details>`;
    if (download) download.onclick = function () {
      if (!currentPlan) return;
      const blob = new Blob([checklistText(currentPlan)], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Somalia-Flood-Plan-${currentPlan.city.replace(/[^a-z0-9]+/gi, '-')}-${currentPlan.selectedDate || 'undated'}.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    return plan;
  }
  root.FloodPlanning = { build, render, checklistText };
})(typeof window !== 'undefined' ? window : globalThis);
