/* Comparable city priorities from date-aligned rainfall and submitted reports. */
(function (global) {
  'use strict';
  const HOUR = 3600000, DAY = 86400000, MAX_AGE = 2 * HOUR;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const amount = value => finite(value) && value >= 0 ? value : null;
  const epoch = value => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
  const eatDate = time => new Date(time + 3 * HOUR).toISOString().slice(0,10);
  const slug = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(epoch(date+'T00:00:00Z')) && new Date(date+'T00:00:00Z').toISOString().slice(0,10) === date;
  const dayLabel = date => new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{timeZone:'UTC',day:'numeric',month:'short'});
  const timeLabel = value => Number.isFinite(epoch(value)) ? new Date(value).toLocaleString('en-GB',{timeZone:'Africa/Mogadishu',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})+' EAT' : 'Retrieval time unavailable';
  const alphabetic = (a,b) => a.name.localeCompare(b.name,'en',{sensitivity:'base'}) || a.index-b.index;
  function feedState(feed,now,available) {
    const lastSuccess = feed?.lastSuccess || feed?.fetchedAt || feed?.data?.fetchedAt || null, at = epoch(lastSuccess);
    const stale = available && (!!feed?.stale || !!feed?.error || !Number.isFinite(at) || at > now+60000 || now-at > MAX_AGE);
    return {available,stale,loading:!!feed?.loading,lastSuccess,error:feed?.error ? String(feed.error) : null};
  }
  function dateMap(rows) {
    const result = new Map();
    for (const row of Array.isArray(rows) ? rows : []) if (validDate(row?.date) && !result.has(row.date)) result.set(row.date,row);
    return result;
  }
  function knownCities(input) {
    const seen = new Set(), result = [];
    (Array.isArray(input) ? input : []).slice(0,30).forEach((city,index)=>{
      const name = String(Array.isArray(city) ? city[0] ?? '' : city?.name ?? '').trim(), id = slug(name);
      if (!name || !id || seen.has(id)) return;
      seen.add(id);result.push({index,id,name,region:String(Array.isArray(city) ? city[1] ?? '' : city?.region ?? '')});
    });
    return result;
  }
  function reportsState(feed,now,today,cities) {
    const data = feed?.data, records = Array.isArray(data) ? data : Array.isArray(data?.reports) ? data.reports : Array.isArray(feed?.records) ? feed.records : null;
    const sourceCity = feed?.cityId ?? data?.cityId ?? null;
    const hasAllScope = (feed?.cityId === null || data?.cityId === null || feed?.scope === 'all') && !sourceCity && feed?.scope !== 'city';
    const category = feed?.category ?? 'all', allCategories = category === 'all' || category === 'flood';
    const available = !!records && feed?.available !== false && hasAllScope && allCategories;
    const source = feedState(feed,now,available), totalValue = feed?.total ?? data?.total;
    const total = Number.isSafeInteger(totalValue) && totalValue >= 0 ? totalValue : null;
    const truncated = !!(feed?.truncated || data?.truncated || total !== null && records && total > records.length);
    const counts = new Map(), known = new Map(cities.map(city=>[city.id,city])), seen = new Set();
    if (available) for (const report of records) {
      if (report?.category !== 'flood' || typeof report.id !== 'string' || !report.id.trim() || seen.has(report.id) || !known.has(report.cityId)) continue;
      // API observations include an explicit UTC offset. Bare local dates are ambiguous.
      if (typeof report.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(report.observedAt) || !validDate(report.observedAt.slice(0,10))) continue;
      const at = epoch(report.observedAt);
      if (!Number.isFinite(at) || at > now || eatDate(at) !== today) continue;
      seen.add(report.id);counts.set(report.cityId,(counts.get(report.cityId)||0)+1);
    }
    const rows = [...counts].map(([id,count])=>({...known.get(id),count})).sort((a,b)=>b.count-a.count || alphabetic(a,b));
    return {...source,scopeValid:hasAllScope,categoryValid:allCategories,total,loaded:records?.length ?? 0,truncated,comparisonAvailable:available&&!truncated,rows:truncated?[]:rows.slice(0,5),eligibleCities:rows.length,eligibleReports:[...counts.values()].reduce((sum,count)=>sum+count,0)};
  }
  function build(input = {}) {
    if (input?.kind === 'city-rankings') return input;
    const suppliedNow = input.now instanceof Date ? input.now.getTime() : finite(input.now) ? input.now : epoch(input.now);
    const now = Number.isFinite(suppliedNow) ? suppliedNow : Date.now(), today = eatDate(now), midnight = epoch(today+'T00:00:00Z');
    const weekDates = Array.from({length:7},(_,index)=>new Date(midnight+(index+1)*DAY).toISOString().slice(0,10));
    const cities = knownCities(input.cities), totalCities = cities.length;
    const weather = feedState(input.weatherFeed,now,input.weatherFeed?.data !== null && input.weatherFeed?.data !== undefined && input.weatherFeed?.available !== false);
    const todayRows = [], weekRows = [];
    for (const city of cities) {
      const rows = dateMap(input.weatherRowsByCity?.[city.index]), rain = weather.available ? amount(rows.get(today)?.rain) : null;
      if (rain !== null) todayRows.push({...city,rain});
      const values = weekDates.map(date=>weather.available ? amount(rows.get(date)?.rain) : null);
      const total = values.every(value=>value!==null) ? values.reduce((sum,value)=>sum+value,0) : null;
      if (amount(total)!==null) weekRows.push({...city,total,peak:Math.max(...values),watchDays:values.filter(value=>value>=10).length});
    }
    todayRows.sort((a,b)=>b.rain-a.rain || alphabetic(a,b));
    weekRows.sort((a,b)=>b.total-a.total || alphabetic(a,b));
    const watchRows = weekRows.filter(row=>row.watchDays>0).sort((a,b)=>b.peak-a.peak || b.watchDays-a.watchDays || b.total-a.total || alphabetic(a,b));
    const floodMode = input.floodMode === 'indicators' ? 'indicators' : 'verified';
    return {kind:'city-rankings',now:new Date(now).toISOString(),today,weekDates,totalCities,floodMode,weather,
      rainToday:{rows:todayRows.slice(0,5),coverage:todayRows.length},rainWeek:{rows:weekRows.slice(0,5),coverage:weekRows.length},
      floodToday:reportsState(input.communityFeed,now,today,cities),floodWeek:{rows:watchRows.slice(0,5),eligibleCities:watchRows.length,coverage:weekRows.length},
      onSelectCity:typeof input.onSelectCity==='function'?input.onSelectCity:null,onOpenMap:typeof input.onOpenMap==='function'?input.onOpenMap:null};
  }
  const icons = {
    rain:'<path d="M7 15a4 4 0 0 1 0-8 5 5 0 0 1 9-1 4 4 0 1 1 1 9"/><path d="m8 18-1 3m6-3-1 3m6-3-1 3"/>',
    calendar:'<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16m-11 4h2m3 0h2m-7 3h2"/>',
    flood:'<path d="M3 17c3-3 3 3 6 0s3 3 6 0 3 3 6 0M3 21c3-3 3 3 6 0s3 3 6 0 3 3 6 0M6 13V9l6-5 6 5v4M10 13V9h4v4"/>',
    watch:'<path d="M12 3 2 20h20L12 3Z"/><path d="M12 9v5m0 3v.1"/>'
  };
  function icon(kind) { return `<span class="city-rankings-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[kind]}</svg></span>`; }
  function sourceHtml(feed,label) {
    const status = !feed.available ? feed.loading ? 'Connecting…' : 'Unavailable' : feed.stale ? 'Last known data · stale' : feed.loading ? 'Updating · previous retrieval shown' : 'Refreshed data';
    return `<div class="city-rankings-source ${!feed.available?'is-missing':feed.stale?'is-stale':'is-current'}"><span>${esc(label)} · ${esc(status)}</span><small>${esc(timeLabel(feed.lastSuccess))}${feed.error?' · '+esc(feed.error):''}</small></div>`;
  }
  function listHtml(rows,kind,key,unit,detail) {
    const max = Math.max(0,...rows.map(row=>row[key]));
    return `<ol class="city-rankings-list">${rows.map((row,index)=>`<li><button type="button" class="city-rankings-row" data-ranking-city="${row.index}" data-ranking-kind="${kind}"><span class="city-rankings-position" aria-label="Rank ${index+1}">${index+1}</span><span class="city-rankings-city"><b>${esc(row.name)}</b><small>${esc(detail(row))}</small><span class="city-rankings-track" aria-hidden="true"><i style="width:${max>0?(row[key]/max*100).toFixed(2):0}%"></i></span></span><span class="city-rankings-value">${row[key].toFixed(unit==='reports'?0:1)}<small>${unit==='reports'?(row[key]===1?'report':'reports'):unit}</small></span><span class="city-rankings-arrow" aria-hidden="true">↗</span></button></li>`).join('')}</ol>`;
  }
  function emptyHtml(text) { return `<div class="city-rankings-empty"><strong>Ranking unavailable</strong><p>${esc(text)}</p></div>`; }
  function cardHeader(number,title,subtitle,kind,date) { return `<header class="city-rankings-card-heading">${icon(kind)}<div><span class="city-rankings-kicker">TOP 5 · ${number}</span><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div></header><p class="city-rankings-date">${esc(date)}</p>`; }
  function verifiedCard(model,future) {
    const title = future?'Flooding · next 7 days':'Flooding today', date = future?dayLabel(model.weekDates[0])+'–'+dayLabel(model.weekDates.at(-1))+' · EAT':dayLabel(model.today)+' · EAT';
    return `<article class="city-rankings-card is-unavailable">${cardHeader(future?'04':'03',title,future?'Verified flood forecast':'Verified flooded-area ranking',future?'watch':'flood',date)}${emptyHtml(future?'A calibrated city flood-extent or severity forecast is not available from the connected feeds.':'Comparable, verified city-wide flooded-area measurements for today are not available from the connected feeds.')}<p class="city-rankings-note">${future?'Rainfall and modeled river flow alone cannot establish which cities will have the most flooding.':'Satellite acquisition dates, cloud/exclusion masks and ground verification limit current flood comparisons.'}</p><a class="city-rankings-map" href="#map-panel" data-ranking-map>Review flood observation map <span aria-hidden="true">↗</span></a></article>`;
  }
  // A share row for a top-5 list (dist/share.js); nothing when the list is empty or sharing is unavailable.
  function shareList(title, date, rows, value, note) {
    if (!rows.length || !global.SiteShare?.row) return '';
    return global.SiteShare.row([['El Nino Watch · ', {t: title}, ' · ' + date], ...rows.map((row, index) => [`${index + 1}. ${row.name} — `, ...[].concat(value(row))]), [{t: note}]], 'overview');
  }
  function html(input = {}) {
    const model = build(input), todayDate = dayLabel(model.today)+' · EAT', weekDate = dayLabel(model.weekDates[0])+'–'+dayLabel(model.weekDates.at(-1))+' · EAT';
    const rainToday = `<article class="city-rankings-card">${cardHeader('01','Rainfall today','Forecast full-day rainfall','rain',todayDate)}<div class="city-rankings-coverage"><b>${model.rainToday.coverage}/${model.totalCities}</b> cities with usable daily rainfall</div>${model.rainToday.rows.length?listHtml(model.rainToday.rows,'rain-today','rain','mm',row=>row.region):emptyHtml('No usable rainfall forecast for today. Missing rainfall is unknown, not zero.')}<p class="city-rankings-note">Full-day forecast total; not rainfall already observed today. Ties are listed alphabetically.</p>${sourceHtml(model.weather,'Weather forecast')}${shareList('Rainfall today',todayDate,model.rainToday.rows,row=>row.rain.toFixed(1)+' mm','Forecast model estimates, not observed rainfall or an official warning.')}</article>`;
    const rainWeek = `<article class="city-rankings-card">${cardHeader('02','Rainfall · next 7 days','Highest seven-day forecast totals','calendar',weekDate)}<div class="city-rankings-coverage"><b>${model.rainWeek.coverage}/${model.totalCities}</b> cities with all 7 daily values</div>${model.rainWeek.rows.length?listHtml(model.rainWeek.rows,'rain-week','total','mm',row=>'7-day total · peak '+row.peak.toFixed(1)+' mm/day'):emptyHtml('Seven usable daily rainfall values are required. Cities with incomplete forecasts are excluded.')}<p class="city-rankings-note">Seven days starting tomorrow; excludes today. Ties are listed alphabetically.</p>${sourceHtml(model.weather,'Weather forecast')}${shareList('Rainfall · next 7 days',weekDate,model.rainWeek.rows,row=>row.total.toFixed(1)+' mm','Forecast model estimates, not observed rainfall or an official warning.')}</article>`;
    let floodToday, floodWeek;
    if (model.floodMode === 'verified') { floodToday=verifiedCard(model,false);floodWeek=verifiedCard(model,true); }
    else {
      const reports = model.floodToday;
      let missing = !reports.scopeValid?'An all-city report feed is required; a selected-city feed cannot support a national ranking.':!reports.categoryValid?'The report feed does not include flooding reports.':!reports.available?'The all-city community report feed is unavailable.':reports.truncated?'Incomplete report feed; city totals cannot be compared.':'No eligible flood reports observed today were loaded. This does not establish that no flooding occurred.';
      floodToday = `<article class="city-rankings-card is-community">${cardHeader('03','Flooding today','Community report activity · unverified','flood',todayDate)}<div class="city-rankings-coverage"><b>${reports.eligibleCities}/${model.totalCities}</b> cities with eligible loaded flood reports</div>${reports.rows.length?listHtml(reports.rows,'reports','count','reports',row=>row.region+' · distinct report IDs'):emptyHtml(missing)}<p class="city-rankings-note">Counts measure submitted report activity, not flood severity, water depth or flooded area. Voluntary reporting has incomplete geographic coverage. Equal counts are listed alphabetically.</p><p class="city-rankings-report-coverage${reports.truncated?' is-partial':''}">Loaded ${reports.loaded}${reports.total!==null?' of '+reports.total:''} reports across all dates/types.${reports.truncated?' Feed is truncated; the ranking is withheld until a complete report set is available.':''}</p>${sourceHtml(reports,'Community reports')}${reports.truncated?'':shareList('Flooding today',todayDate,reports.rows,row=>[row.count+' ',{t:row.count===1?'report':'reports'}],'Unverified community reports: counts show report activity, not flood severity or an official warning.')}</article>`;
      floodWeek = `<article class="city-rankings-card is-watch">${cardHeader('04','Flood watch · next 7 days','Rainfall-based planning priorities','watch',weekDate)}<div class="city-rankings-coverage"><b>${model.floodWeek.coverage}/${model.totalCities}</b> cities with all 7 daily values · ${model.floodWeek.eligibleCities} screen positive</div>${model.floodWeek.rows.length?listHtml(model.floodWeek.rows,'watch','peak','mm/day',row=>row.watchDays+' day'+(row.watchDays===1?'':'s')+' ≥10 mm · '+row.total.toFixed(1)+' mm total'):emptyHtml(model.floodWeek.coverage?'No complete city forecast reaches the ≥10 mm/day rainfall screen. This does not establish flood safety.':'Seven usable rainfall days are required to apply the planning screen.')}<p class="city-rankings-note">Rainfall screen: ≥10 mm/day. Ordered by highest daily rainfall, then number of days ≥10 mm, then 7-day total, then alphabetically. Not predicted inundation or calibrated flood probability.</p>${sourceHtml(model.weather,'Weather forecast')}${shareList('Flood watch · next 7 days',weekDate,model.floodWeek.rows,row=>row.peak.toFixed(1)+' mm/day','Rainfall-based planning screen (≥10 mm/day), not a flood forecast or an official warning.')}</article>`;
    }
    return `<section class="city-rankings" aria-labelledby="city-rankings-heading"><div class="city-rankings-heading"><div><p class="city-rankings-eyebrow">CITY PRIORITIES</p><h2 id="city-rankings-heading">Rainfall & flood watch</h2><p>Compare the ${model.totalCities} monitored cities. Select a ranked city to explore its data.</p></div><span class="city-rankings-timezone">EAT · UTC+3</span></div><div class="city-rankings-grid">${rainToday}${rainWeek}${floodToday}${floodWeek}</div><p class="city-rankings-purpose">Rankings cover only cities with usable data; excluded cities could rank higher. Missing cities are not assumed dry or safe. These comparisons support planning; use local observations and relevant authority advice for emergency decisions.</p></section>`;
  }
  function render(input = {}) {
    const model = build(input), document = global.document || (typeof globalThis.document!=='undefined'?globalThis.document:null), root = document?.getElementById('city-rankings-root');
    if (!root) return model;
    root.innerHTML = html(model);
    root.onclick = event=>{
      const city = event.target?.closest?.('[data-ranking-city]');
      if (city) {
        const index = Number(city.dataset.rankingCity), kind = city.dataset.rankingKind;
        const rows = {'rain-today':model.rainToday.rows,'rain-week':model.rainWeek.rows,'reports':model.floodMode==='indicators'?model.floodToday.rows:[],'watch':model.floodMode==='indicators'?model.floodWeek.rows:[]}[kind];
        if (Number.isInteger(index) && rows?.some(row=>row.index===index)) model.onSelectCity?.(index,kind);
        return;
      }
      if (event.target?.closest?.('[data-ranking-map]') && model.onOpenMap) { event.preventDefault?.();model.onOpenMap(); }
    };
    return model;
  }
  global.CityRankings = {build,html,render};
})(typeof window!=='undefined'?window:globalThis);
