/* Date-aligned rainfall and discharge support for municipal flood planning. */
(function (global) {
  'use strict';
  const HOUR = 3600000, DAY = 86400000, FEED_AGE = 2 * HOUR;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const valueOrNull = value => finite(value) && value >= 0 ? value : null;
  const epoch = value => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
  function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(epoch(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value; }
  function todayEAT(now) { return new Date(now+3*HOUR).toISOString().slice(0,10); }
  function dayLabel(date, long = false) { return new Date(date+'T12:00:00Z').toLocaleDateString('en-GB', {timeZone:'UTC', weekday:long?'long':'short',day:'numeric',month:long?'long':'short'}); }
  function timeLabel(value) { return Number.isFinite(epoch(value)) ? new Date(value).toLocaleString('en-GB',{timeZone:'Africa/Mogadishu',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})+' EAT' : 'Retrieval time unavailable'; }
  function feedState(feed, now) {
    const lastSuccess = feed?.lastSuccess || feed?.fetchedAt || feed?.data?.fetchedAt || null, at = epoch(lastSuccess);
    const available = feed?.data !== null && feed?.data !== undefined;
    const stale = available && (!!feed?.stale || !!feed?.error || !Number.isFinite(at) || at > now+60000 || now-at > FEED_AGE);
    return {available,stale,fresh:available&&!stale,lastSuccess,error:feed?.error || null};
  }
  function dateMap(rows) {
    const result = new Map();
    for (const row of Array.isArray(rows) ? rows : []) if (validDate(row?.date) && !result.has(row.date)) result.set(row.date,row);
    return result;
  }
  const rainBand = value => value === null ? 'unknown' : value >= 25 ? 'elevated' : value >= 10 ? 'watch' : 'lower';
  const bandLabel = band => ({unknown:'Rainfall unavailable',elevated:'Elevated rainfall screen',watch:'Rainfall watch',lower:'Below rainfall screen'})[band];
  const format = value => value === null ? 'Unknown' : value.toFixed(1);
  function gaugeState(input, now, today) {
    const station = input.station, feed = feedState(input.stationFeed,now);
    if (!station) return {matched:false};
    const at = validDate(station.observedAt) ? epoch(station.observedAt+'T00:00:00+03:00') : epoch(station.observedAt);
    const observedDate = validDate(station.observedAt) ? station.observedAt : Number.isFinite(at) ? todayEAT(at) : null;
    const levelM = valueOrNull(station.levelM), current = feed.fresh && observedDate === today && Number.isFinite(at) && at <= now;
    const thresholds = [['Moderate',station.moderateM],['High',station.highM],['Bank full',station.bankFullM]].map(([label,value]) => ({label,value:finite(value)&&value>0?value:null}));
    const values = thresholds.filter(item=>item.value!==null).map(item=>item.value), thresholdsValid = !values.some((value,i)=>i>0&&value<values[i-1]);
    const reached = current && levelM!==null && thresholdsValid ? thresholds.filter(item=>item.value!==null&&levelM>=item.value).at(-1)?.label || null : null;
    return {matched:true,name:String(station.name || station.code || 'Matched gauge'),levelM,current,observedAt:station.observedAt || null,thresholds,thresholdsValid,reached};
  }
  const point = value => value && finite(value.lat) && finite(value.lon) && Math.abs(value.lat)<=90 && Math.abs(value.lon)<=180 ? {lat:value.lat,lon:value.lon} : null;
  // Spreadsheet-safe text: authored text that starts like a formula gets a leading apostrophe; numbers stay numbers.
  const csvCell = value => { const text = String(value ?? ''); return '"'+(typeof value==='string' && /^\s*[=+@-]/.test(text) && !Number.isFinite(Number(text)) ? "'"+text : text).replace(/"/g,'""')+'"'; };
  const WEATHER_SOURCE = 'Open-Meteo forecast API, https://open-meteo.com/';
  const RIVER_SOURCE = 'GloFAS river discharge model via the Open-Meteo flood API, https://open-meteo.com/en/docs/flood-api (modelled flow for the nearest model river cell, not a gauge reading)';
  function build(input = {}) {
    if (input?.kind === 'flood-planning-outlook') return input;
    const suppliedNow = input.now instanceof Date ? input.now.getTime() : finite(input.now) ? input.now : epoch(input.now);
    const now = Number.isFinite(suppliedNow) ? suppliedNow : Date.now(), today = todayEAT(now), start = epoch(today+'T00:00:00Z');
    const dates = Array.from({length:14},(_,index)=>new Date(start+index*DAY).toISOString().slice(0,10));
    const weather = feedState(input.weatherFeed,now), river = feedState(input.riverFeed,now), weatherRows = dateMap(input.weatherRows), riverRows = dateMap(input.riverRows);
    const selectedDate = dates.includes(input.selectedDate) ? input.selectedDate : today;
    const daily = dates.map((date,index)=>{
      const wx = weatherRows.get(date) || {}, flow = riverRows.get(date) || {}, rain = weather.available ? valueOrNull(wx.rain) : null;
      const discharge = river.available ? valueOrNull(flow.discharge) : null;
      const probability = weather.available && finite(wx.probability) && wx.probability>=0 && wx.probability<=100 ? wx.probability : null;
      const maxTemperature = weather.available && finite(wx.maxTemperature) ? wx.maxTemperature : null;
      return {date,label:dayLabel(date),index,week:index<7?1:2,rain,discharge,probability,maxTemperature,band:rainBand(rain),selected:date===selectedDate,lowerConfidence:index>=7,weatherStale:weather.stale,riverStale:river.stale};
    });
    weather.coveredDays=daily.filter(row=>row.rain!==null).length;
    river.coveredDays=daily.filter(row=>row.discharge!==null).length;
    const baseline = daily[0].discharge;
    for (const row of daily) {
      row.flowChange = baseline!==null && row.discharge!==null ? row.discharge-baseline : null;
      row.flowTrend = row.flowChange===null ? 'unknown' : row.flowChange>0 ? 'higher' : row.flowChange<0 ? 'lower' : 'same';
    }
    const weeks = [1,2].map(number=>{
      const rows = daily.filter(row=>row.week===number), rainfallComplete = rows.every(row=>row.rain!==null), riverComplete = rows.every(row=>row.discharge!==null);
      return {number,start:rows[0].date,end:rows.at(-1).date,rainfallComplete,riverComplete,rainTotal:rainfallComplete?rows.reduce((sum,row)=>sum+row.rain,0):null,watchDays:rainfallComplete?rows.filter(row=>row.rain>=10).length:null,elevatedDays:rainfallComplete?rows.filter(row=>row.rain>=25).length:null,peakDischarge:riverComplete?Math.max(...rows.map(row=>row.discharge)):null,lowerConfidence:number===2,rainDays:rows.filter(row=>row.rain!==null).length,riverDays:rows.filter(row=>row.discharge!==null).length};
    });
    return {kind:'flood-planning-outlook',cityName:String(input.cityName || 'Selected city'),region:String(input.region || 'Somalia'),today,now:new Date(now).toISOString(),dates,selectedDate,daily,weeks,weather,river,baseline,gauge:gaugeState(input,now,today),cityPoint:point(input.cityPoint),riverCell:point(input.riverCell),onDay:typeof input.onDay==='function'?input.onDay:null,onExport:typeof input.onExport==='function'?input.onExport:null};
  }
  function graph(model) {
    const left=54,right=994,top=30,bottom=234,width=right-left,height=bottom-top,step=width/14;
    const rainMax = Math.max(25,Math.ceil(Math.max(0,...model.daily.map(row=>row.rain??0))/5)*5);
    const flowMax = Math.max(1,...model.daily.map(row=>row.discharge??0));
    const x = index=>left+(index+.5)*step, rainY=value=>bottom-value/rainMax*height, flowY=value=>bottom-value/flowMax*height;
    const parts = ['<svg class="flood-outlook-chart" viewBox="0 0 1060 292" role="img" aria-label="Fourteen-day rainfall bars and modeled river discharge line. Rainfall is in millimetres on EAT days; discharge is in cubic metres per second on UTC model days. Gaps mean missing data."><title>14-day rainfall and river model outlook</title><desc>Two separate axes and different day boundaries. Colours show app rainfall screening levels only. The line does not show flood extent or river warning thresholds. Week two has lower forecast confidence. A detailed table follows.</desc>'];
    parts.push(`<rect x="${left+7*step}" y="${top}" width="${7*step}" height="${height}" fill="#dbeafe" opacity=".48"/>`);
    parts.push(`<rect x="${left+model.daily.findIndex(row=>row.selected)*step}" y="${top}" width="${step}" height="${height}" rx="7" fill="#93c5fd" opacity=".18"/>`);
    for (let index=0;index<=4;index++) {
      const y = bottom-index*height/4;
      parts.push(`<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="#cbd5e1" stroke-opacity=".7"/><text x="44" y="${y+4}" text-anchor="end" fill="#476582" font-size="12">${(rainMax*index/4).toFixed(1)}</text><text x="1006" y="${y+4}" fill="#476582" font-size="12">${(flowMax*index/4).toFixed(1)}</text>`);
    }
    parts.push(`<text x="${left}" y="17" fill="#476582" font-size="12">Rain mm · EAT</text><text x="${right}" y="17" text-anchor="end" fill="#476582" font-size="12">River m³/s · UTC</text>`);
    for (const threshold of [10,25]) if (threshold<=rainMax) parts.push(`<line x1="${left}" x2="${right}" y1="${rainY(threshold)}" y2="${rainY(threshold)}" stroke="#8498b0" stroke-dasharray="3 5" stroke-opacity=".5"/>`);
    model.daily.forEach(row=>{
      if (row.rain===null) parts.push(`<text x="${x(row.index)}" y="${bottom-12}" text-anchor="middle" fill="#8a99ac" font-size="18">?</text>`);
      else if (row.rain===0) parts.push(`<line x1="${x(row.index)-15}" x2="${x(row.index)+15}" y1="${bottom}" y2="${bottom}" stroke="#59bce8" stroke-width="3"/>`);
      else parts.push(`<rect x="${x(row.index)-15}" y="${rainY(row.rain)}" width="30" height="${bottom-rainY(row.rain)}" rx="4" fill="${{lower:'#59bce8',watch:'#f5bc4b',elevated:'#e96d58'}[row.band]}" opacity=".86"/>`);
      parts.push(`<text x="${x(row.index)}" y="257" text-anchor="middle" fill="#476582" font-size="12">${row.date.slice(8)}</text>`);
    });
    let segment=[]; const segments=[];
    model.daily.forEach(row=>{if(row.discharge!==null)segment.push(x(row.index)+','+flowY(row.discharge));else if(segment.length){segments.push(segment);segment=[];}});
    if(segment.length)segments.push(segment);
    segments.forEach(points=>parts.push(`<polyline points="${points.join(' ')}" fill="none" stroke="#174c9b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`));
    model.daily.forEach(row=>{if(row.discharge!==null)parts.push(`<circle cx="${x(row.index)}" cy="${flowY(row.discharge)}" r="3.5" fill="#174c9b" stroke="#fff" stroke-width="1.5"/>`);});
    parts.push(`<text x="${left+3.5*step}" y="282" text-anchor="middle" fill="#476582" font-size="12">Days 1–7</text><text x="${left+10.5*step}" y="282" text-anchor="middle" fill="#476582" font-size="12">Days 8–14 · lower confidence</text></svg>`);
    return parts.join('');
  }
  function feedHtml(label,feed) {
    const coverage = feed.coveredDays;
    const state = !feed.available ? 'Unavailable' : coverage===0 ? 'No usable forecast values' : coverage<14 ? 'Partial forecast coverage '+coverage+'/14' : feed.stale ? 'Last known data' : 'Refreshed model data';
    const staleNote = feed.available && feed.stale && coverage<14 ? ' · last known data' : '';
    return `<span class="flood-outlook-feed ${!feed.available||coverage===0?'is-missing':feed.stale?'is-stale':coverage<14?'is-partial':'is-fresh'}"><b>${esc(label)} · ${state}${staleNote}</b><small>${esc(timeLabel(feed.lastSuccess))}${feed.error?' · '+esc(feed.error):''}</small></span>`;
  }
  function weekHtml(week) {
    return `<article class="flood-outlook-week${week.lowerConfidence?' is-week-two':''}"><div><span>Week ${week.number} · ${esc(dayLabel(week.start))}–${esc(dayLabel(week.end))}</span><b>${week.lowerConfidence?'Lower confidence':'Near-term planning'}</b></div><strong>${format(week.rainTotal)}${week.rainTotal!==null?' <small>mm rainfall total</small>':''}</strong><p>${week.rainfallComplete?week.watchDays+' days ≥10 mm · '+week.elevatedDays+' days ≥25 mm':'Rainfall available for '+week.rainDays+'/7 days; total unknown'}</p><p>${week.riverComplete?'Highest modeled flow '+format(week.peakDischarge)+' m³/s':'River model available for '+week.riverDays+'/7 days; peak unknown'}</p></article>`;
  }
  function dayHtml(row) {
    const trend = {higher:'↑ Above day-one model flow',lower:'↓ Below day-one model flow',same:'→ Same as day-one model flow',unknown:'Flow comparison unavailable'}[row.flowTrend];
    return `<button type="button" class="flood-outlook-day flood-outlook-band-${row.band}${row.selected?' is-selected':''}${row.lowerConfidence?' is-week-two':''}" data-flood-day="${esc(row.date)}" aria-pressed="${row.selected}"><span class="flood-outlook-date">${esc(row.label)} <small>Day ${row.index+1}</small></span><strong>${row.rain===null?'—':format(row.rain)} <small>mm</small></strong><span class="flood-outlook-band">${esc(bandLabel(row.band))}${row.weatherStale?' · last known':''}</span><span class="flood-outlook-flow">${row.discharge===null?'River flow unknown':format(row.discharge)+' m³/s · UTC model'}${row.riverStale?' · last known':''}</span><small class="flood-outlook-trend">${esc(trend)}</small>${row.lowerConfidence?'<small class="flood-outlook-confidence">Lower confidence</small>':''}</button>`;
  }
  function tableHtml(model) {
    return `<div class="flood-outlook-table-wrap"><table class="flood-outlook-table"><caption>Forecast values by calendar date. Rainfall days use EAT; river model days use UTC. Unknown means unavailable.</caption><thead><tr><th scope="col">Date</th><th scope="col">Rain mm · EAT</th><th scope="col">Rain chance %</th><th scope="col">Daily high °C</th><th scope="col">Discharge m³/s · UTC</th><th scope="col">Rainfall screen</th><th scope="col">Horizon</th></tr></thead><tbody>${model.daily.map(row=>`<tr><th scope="row">${esc(row.date)}</th><td>${format(row.rain)}</td><td>${row.probability===null?'Unknown':row.probability.toFixed(0)}</td><td>${format(row.maxTemperature)}</td><td>${format(row.discharge)}</td><td>${esc(bandLabel(row.band))}${row.weatherStale?' · last known':''}</td><td>${row.lowerConfidence?'Lower confidence':'Days 1–7'}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function gaugeHtml(gauge) {
    if (!gauge.matched) return '<p class="flood-outlook-gauge">No matched river gauge: no observed gauge threshold is applied to this outlook.</p>';
    const thresholdText = !gauge.thresholdsValid ? ' · source thresholds could not be applied' : !gauge.thresholds.some(item=>item.value!==null) ? ' · no usable source thresholds supplied' : gauge.reached ? ' · source threshold reached: '+esc(gauge.reached) : ' · no supplied source threshold reached';
    return `<p class="flood-outlook-gauge"><b>${esc(gauge.name)} · observed gauge, separate from the forecast.</b> ${gauge.current&&gauge.levelM!==null?'Level on SWALIM’s update today '+gauge.levelM.toFixed(2)+' m'+thresholdText:'Current gauge status unknown; a today-dated usable observation is required.'}${!gauge.thresholdsValid?' Supplied threshold order is invalid.':''} Observed thresholds are not forecast river heights.</p>`;
  }
  function selectionHtml(model) {
    const row=model.daily.find(item=>item.selected) || model.daily[0];
    const planning={unknown:'Confirm the missing source data before using this day to prioritise inspections.',lower:'Keep monitoring forecasts and ground reports. Below the rainfall screening threshold does not establish safety.',watch:'Prepare drainage checks and review low-lying access routes alongside local observations.',elevated:'Prioritise ground checks at low-lying access routes and review response readiness with the relevant authority.'}[row.band];
    return `<article class="flood-outlook-selection" aria-live="polite"><div><span>Selected forecast day ${row.index+1}${row.lowerConfidence?' · lower confidence':''}</span><h3>${esc(dayLabel(row.date,true))}</h3><p>${esc(planning)}${row.weatherStale?' Rainfall values are retained from a previous retrieval.':''}</p></div><dl><div><dt>Rainfall · EAT</dt><dd>${format(row.rain)}${row.rain!==null?' mm':''}</dd></div><div><dt>Rain chance</dt><dd>${row.probability===null?'Unknown':row.probability.toFixed(0)+'%'}</dd></div><div><dt>Model flow · UTC</dt><dd>${format(row.discharge)}${row.discharge!==null?' m³/s':''}</dd></div><div><dt>Daily high</dt><dd>${format(row.maxTemperature)}${row.maxTemperature!==null?' °C':''}</dd></div></dl></article>`;
  }
  function html(input = {}) {
    const model=build(input);
    return `<section class="flood-outlook"><header class="flood-outlook-heading"><div><p class="flood-outlook-eyebrow">Two-week readiness</p><h2>14-day flood planning outlook</h2><p><span data-i18n-skip>${esc(model.cityName)}</span> · <span data-i18n-skip>${esc(model.region)}</span> · ${esc(dayLabel(model.dates[0]))}–${esc(dayLabel(model.dates.at(-1)))}</p></div><button type="button" class="flood-outlook-export" data-flood-export${!model.weather.available&&!model.river.available?' disabled':''}>Export 14 days</button></header><p class="flood-outlook-purpose">Daily rainfall and modeled river flow support planning. This outlook does not predict flood extent, depth, casualties or the probability of flooding.</p><div class="flood-outlook-feeds">${feedHtml('Rainfall',model.weather)}${feedHtml('River model',model.river)}</div><div class="flood-outlook-weeks">${model.weeks.map(weekHtml).join('')}</div><div class="flood-outlook-legend"><span><i class="flood-outlook-key is-rain"></i>Rainfall</span><span><i class="flood-outlook-key is-watch"></i>≥10 mm/day</span><span><i class="flood-outlook-key is-elevated"></i>≥25 mm/day</span><span><i class="flood-outlook-key is-river"></i>Modeled river flow</span><span>? Missing rainfall</span></div><div class="flood-outlook-chart-wrap">${graph(model)}</div>${selectionHtml(model)}<div class="flood-outlook-days" aria-label="Select a forecast date">${model.daily.map(dayHtml).join('')}</div>${gaugeHtml(model.gauge)}<details class="flood-outlook-details"><summary>Daily values & how to interpret this outlook</summary>${tableHtml(model)}<p>Rain chance is a weather probability, not flood probability. Rainfall colours are app screening levels: below 10, 10–24.9 and ≥25 mm/day; they are not official warnings. River arrows compare modeled discharge with the first forecast day only, without city-wide flood thresholds.</p><p>The approximately 5 km river grid may not represent the correct river channel or local drainage. EAT rainfall days and UTC river days are shown under their source calendar dates and cover different 24-hour periods. Retrieval times are when data were fetched, not model-run times. Days 8–14 have lower forecast confidence.</p><p>Use current observations, drainage checks and local authority advice to plan access, shelter and response. For emergency help, contact your local government or relevant authority.</p><p>Sources: <a href="https://open-meteo.com/en/docs" target="_blank" rel="noopener noreferrer">Open-Meteo weather</a> · <a href="https://open-meteo.com/en/docs/flood-api" target="_blank" rel="noopener noreferrer">GloFAS river model via Open-Meteo</a>.</p></details></section>`;
  }
  function csv(input = {}) {
    // Each row carries where its numbers came from, so a forwarded file can be traced: the source and product,
    // the city point that was asked for and the model river cell the flood API answered with, and when it was exported.
    const model=build(input), fields=['city','region','date','rain_mm_EAT','rain_probability_percent','daily_high_c','river_discharge_m3_s_UTC','rainfall_screen','confidence','weather_retrieved_at','weather_stale','river_retrieved_at','river_stale','river_change_vs_first_forecast_day_m3_s','weather_source','river_source','city_lat','city_lon','river_model_cell_lat','river_model_cell_lon','exported_at'];
    const city=model.cityPoint||{},cell=model.riverCell||{};
    const rows=[fields,...model.daily.map(row=>[model.cityName,model.region,row.date,row.rain??'',row.probability??'',row.maxTemperature??'',row.discharge??'',bandLabel(row.band),row.lowerConfidence?'lower':'days 1-7',model.weather.lastSuccess||'',model.weather.stale,model.river.lastSuccess||'',model.river.stale,row.flowChange??'',WEATHER_SOURCE,RIVER_SOURCE,city.lat??'',city.lon??'',cell.lat??'',cell.lon??'',model.now])];
    return rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
  }
  function download(input) {
    const model=build(input), document=global.document || (typeof globalThis.document!=='undefined'?globalThis.document:null);
    if(!document || typeof Blob==='undefined' || typeof URL?.createObjectURL!=='function')return csv(model);
    const blob=new Blob(['\ufeff'+csv(model)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=model.cityName.replace(/[^a-z0-9]+/gi,'-')+'-14-day-flood-planning-outlook.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return blob;
  }
  function bind(container,input) {
    if(!container)return;
    const model=build(input);
    container.onclick=event=>{
      const day=event.target?.closest?.('[data-flood-day]');
      if(day && model.dates.includes(day.dataset.floodDay)){
        const selectedDate=day.dataset.floodDay;
        if(model.onDay)model.onDay(selectedDate);
        else {
          model.selectedDate=selectedDate;model.daily.forEach(row=>{row.selected=row.date===selectedDate;});
          container.innerHTML=html(model);bind(container,model);
        }
        return;
      }
      const button=event.target?.closest?.('[data-flood-export]');
      if(button){if(model.onExport)model.onExport(csv(model),model);else download(model);}
    };
  }
  function render(input = {}) {
    const document=global.document || (typeof globalThis.document!=='undefined'?globalThis.document:null),container=document?.getElementById('mayor-flood-outlook');
    const model=build(input);if(!container)return model;
    container.innerHTML=html(model);bind(container,model);return model;
  }
  global.FloodOutlook={build,html,render,bind,csv,download};
})(typeof window!=='undefined'?window:globalThis);
