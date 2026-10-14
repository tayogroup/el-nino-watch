(function (global) {
  'use strict';
  const DAILY = ['weather_code','temperature_2m_max','temperature_2m_min','apparent_temperature_max','apparent_temperature_min','precipitation_sum','precipitation_probability_max','wind_speed_10m_max','wind_gusts_10m_max','uv_index_max'];
  const HOURLY = ['temperature_2m','relative_humidity_2m','apparent_temperature','precipitation_probability','precipitation','weather_code','cloud_cover','wind_speed_10m','wind_direction_10m','wind_gusts_10m','pressure_msl','visibility','dew_point_2m','is_day'];
  const isNumber = value => typeof value === 'number' && Number.isFinite(value);
  const number = value => isNumber(value) ? value : null;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const format = (value, digits = 0) => isNumber(value) ? value.toFixed(digits) : '—';
  const isoDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const localClock = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ? value.slice(11,16) : '—';
  const compass = value => !isNumber(value) ? '—' : ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round((((value % 360) + 360) % 360) / 22.5) % 16];
  function dayData(forecast, date) {
    const daily = forecast?.daily;
    const index = Array.isArray(daily?.time) && isoDate(date) ? daily.time.indexOf(date) : -1;
    const result = {date,index,sourceTime:index >= 0 ? daily.time[index] : null};
    DAILY.forEach(field => result[field] = index >= 0 ? number(daily[field]?.[index]) : null);
    ['sunrise','sunset'].forEach(field => {
      const value = index >= 0 ? daily[field]?.[index] : null;
      result[field] = typeof value === 'string' && value.slice(0,10) === date && localClock(value) !== '—' ? value : null;
    });
    return result;
  }
  function hourData(forecast, date) {
    const hourly = forecast?.hourly;
    const positions = new Map();
    if (isoDate(date) && Array.isArray(hourly?.time)) hourly.time.forEach((value,index) => {
      if (typeof value !== 'string') return;
      const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):00(?::00)?$/.exec(value);
      if (match && match[1] === date && Number(match[2]) < 24 && !positions.has(Number(match[2]))) positions.set(Number(match[2]),index);
    });
    return Array.from({length:24}, (_,hour) => {
      const index = positions.has(hour) ? positions.get(hour) : -1;
      const row = {hour,index,time:index >= 0 ? hourly.time[index] : null};
      HOURLY.forEach(field => row[field] = index >= 0 ? number(hourly[field]?.[index]) : null);
      return row;
    });
  }
  const sun = '<circle cx="35" cy="31" r="12" fill="#fbbf24" stroke="#f59e0b" stroke-width="2"/><path d="M35 11V5M35 57v-6M15 31H9M61 31h-6M21 17l-4-4M53 49l-4-4M49 17l4-4M17 49l4-4" stroke="#fbbf24" stroke-width="3" stroke-linecap="round"/>';
  const moon = '<path d="M45 13a21 21 0 1 0 13 34A23 23 0 0 1 45 13Z" fill="#bfdbfe" stroke="#60a5fa" stroke-width="2"/><circle cx="56" cy="17" r="2" fill="#bfdbfe"/>';
  const cloud = '<path d="M19 47a11 11 0 0 1 1-22 16 16 0 0 1 30-3 12 12 0 0 1 4 25Z" fill="#dbeafe" stroke="#60a5fa" stroke-width="2.4" stroke-linejoin="round"/>';
  const smallCloud = '<path d="M28 51a10 10 0 0 1 1-20 14 14 0 0 1 27-3 11 11 0 0 1 2 23Z" fill="#dbeafe" stroke="#60a5fa" stroke-width="2.4"/>';
  const rain = '<path d="m25 54-4 8m18-8-4 8m18-8-4 8" stroke="#38bdf8" stroke-width="3" stroke-linecap="round"/>';
  const snow = '<path d="M25 53v12m-5-9 10 6m-10 0 10-6M48 53v12m-5-9 10 6m-10 0 10-6" stroke="#7dd3fc" stroke-width="2" stroke-linecap="round"/>';
  function weatherInfo(code, isDay = 1) {
    const nighttime = isDay === 0;
    let kind = 'unknown', label = 'Weather unavailable';
    if (code === 0) {kind = 'clear';label = nighttime ? 'Clear night' : 'Clear sky';}
    else if (code === 1) {kind = 'partly-cloudy';label = 'Mainly clear';}
    else if (code === 2) {kind = 'partly-cloudy';label = 'Partly cloudy';}
    else if (code === 3) {kind = 'cloudy';label = 'Overcast';}
    else if ([45,48].includes(code)) {kind = 'fog';label = code === 48 ? 'Rime fog' : 'Fog';}
    else if ([51,53,55].includes(code)) {kind = 'drizzle';label = ({51:'Light drizzle',53:'Moderate drizzle',55:'Dense drizzle'})[code];}
    else if ([56,57].includes(code)) {kind = 'freezing-rain';label = 'Freezing drizzle';}
    else if ([61,63,65].includes(code)) {kind = 'rain';label = ({61:'Light rain',63:'Moderate rain',65:'Heavy rain'})[code];}
    else if ([66,67].includes(code)) {kind = 'freezing-rain';label = 'Freezing rain';}
    else if ([71,73,75,77].includes(code)) {kind = 'snow';label = ({71:'Light snow',73:'Moderate snow',75:'Heavy snow',77:'Snow grains'})[code];}
    else if ([80,81,82].includes(code)) {kind = 'showers';label = ({80:'Light rain showers',81:'Moderate rain showers',82:'Violent rain showers'})[code];}
    else if ([85,86].includes(code)) {kind = 'snow';label = code === 85 ? 'Light snow showers' : 'Heavy snow showers';}
    else if ([95,96,99].includes(code)) {kind = 'thunder';label = code === 95 ? 'Thunderstorm' : 'Thunderstorm with hail';}
    let drawing = '<circle cx="36" cy="36" r="23" fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="3 4"/><text x="36" y="44" text-anchor="middle" fill="#94a3b8" font-size="26" font-family="sans-serif">?</text>';
    if (kind === 'clear') drawing = nighttime ? moon : sun;
    else if (kind === 'partly-cloudy') drawing = (nighttime ? moon : sun) + smallCloud;
    else if (kind === 'cloudy') drawing = cloud;
    else if (kind === 'fog') drawing = cloud + '<path d="M18 54h38M22 61h29" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/>';
    else if (kind === 'snow') drawing = cloud + snow;
    else if (kind === 'thunder') drawing = cloud + '<path d="m40 44-11 13h9l-3 12 16-18H41l5-7Z" fill="#fbbf24" stroke="#f59e0b" stroke-width="1"/>';
    else drawing = (kind === 'showers' ? (nighttime ? moon : sun) + smallCloud : cloud) + rain;
    if (kind === 'freezing-rain') drawing += '<circle cx="59" cy="58" r="4" fill="#dbeafe"/>';
    return {code:isNumber(code) ? code : null,kind,label,icon:'<svg class="weather-icon" viewBox="0 0 72 72" role="img" aria-label="'+escape(label)+'"><title>'+escape(label)+'</title>'+drawing+'</svg>'};
  }
  function dateLabel(date, long = false) {
    if (!isoDate(date)) return 'Date unavailable';
    return new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{timeZone:'UTC',weekday:long ? 'long' : 'short',day:'numeric',month:long ? 'long' : 'short'});
  }
  function retrievedLabel(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return 'Retrieval time unavailable';
    return new Date(value).toLocaleString('en-GB',{timeZone:'Africa/Mogadishu',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:false})+' EAT';
  }
  function uvInfo(value) {
    if (!isNumber(value)) return {label:'UV unavailable',level:'unknown'};
    return value < 3 ? {label:'Low',level:'low'} : value < 6 ? {label:'Moderate',level:'moderate'} : value < 8 ? {label:'High',level:'high'} : value < 11 ? {label:'Very high',level:'very-high'} : {label:'Extreme',level:'extreme'};
  }
  function rainInfo(value) {
    if (!isNumber(value)) return {label:'Rainfall unavailable',level:'unknown'};
    return value >= 25 ? {label:'Elevated daily rainfall',level:'elevated'} : value >= 10 ? {label:'Watch daily rainfall',level:'watch'} : {label:'Lower daily rainfall',level:'lower'};
  }
  function metric(title, value, note) {
    return '<div class="hour-metric"><span>'+escape(title)+'</span><strong>'+value+'</strong>'+(note ? '<small>'+escape(note)+'</small>' : '')+'</div>';
  }
  function plot(rows, selectedHour) {
    const left=54,right=995,top=25,bottom=204,width=right-left,height=bottom-top,step=width/23;
    const values=rows.map(row=>row.temperature_2m).filter(isNumber),rainValues=rows.map(row=>row.precipitation).filter(isNumber);
    let lo=values.length ? Math.floor((Math.min(...values)-2)/5)*5 : 0;
    let hi=values.length ? Math.ceil((Math.max(...values)+2)/5)*5 : 40;
    if(hi<=lo) hi=lo+5;
    const rainMax=Math.max(5,Math.ceil((rainValues.length ? Math.max(...rainValues) : 0)/5)*5);
    const x=hour=>left+hour*step, y=temp=>bottom-(temp-lo)/(hi-lo)*height;
    let parts=['<svg class="weather-chart" viewBox="0 0 1060 250" role="img" aria-labelledby="hourly-weather-chart-title hourly-weather-chart-description"><title id="hourly-weather-chart-title">Hourly temperature and precipitation</title><desc id="hourly-weather-chart-description">Blue line is temperature in degrees Celsius on the left axis. Cyan bars are precipitation in millimetres on the right axis. All times are East Africa Time. Gaps indicate unavailable values. Select an hour for its details.</desc>'];
    parts.push('<rect x="'+Math.max(left,x(selectedHour)-step/2)+'" y="'+top+'" width="'+step+'" height="'+height+'" rx="8" fill="#93c5fd" opacity=".16"/>');
    for(let i=0;i<=4;i++){
      const yy=bottom-i*height/4;
      parts.push('<line x1="'+left+'" x2="'+right+'" y1="'+yy+'" y2="'+yy+'" stroke="currentColor" stroke-opacity=".12"/><text x="42" y="'+(yy+4)+'" text-anchor="end" fill="currentColor" font-size="12">'+format(lo+(hi-lo)*i/4,0)+'°</text><text x="1007" y="'+(yy+4)+'" fill="currentColor" font-size="12">'+format(rainMax*i/4,1)+'</text>');
    }
    parts.push('<text x="'+left+'" y="15" fill="currentColor" font-size="12">°C</text><text x="1007" y="15" fill="currentColor" font-size="12">mm</text>');
    rows.forEach(row=>{if(isNumber(row.precipitation)&&row.precipitation>=0){const barHeight=row.precipitation/rainMax*height;parts.push('<rect x="'+(x(row.hour)-9)+'" y="'+(bottom-barHeight)+'" width="18" height="'+barHeight+'" rx="3" fill="#38bdf8" opacity=".48"/>')}});
    const segments=[];let segment=[];
    rows.forEach(row=>{if(isNumber(row.temperature_2m)){segment.push(x(row.hour)+','+y(row.temperature_2m))}else if(segment.length){segments.push(segment);segment=[]}});
    if(segment.length) segments.push(segment);
    segments.forEach(points=>parts.push('<polyline points="'+points.join(' ')+'" fill="none" stroke="#2563eb" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>'));
    rows.forEach(row=>{if(isNumber(row.temperature_2m))parts.push('<circle cx="'+x(row.hour)+'" cy="'+y(row.temperature_2m)+'" r="'+(row.hour===selectedHour?5:3)+'" fill="'+(row.hour===selectedHour?'#0f172a':'#2563eb')+'" stroke="#e0f2fe" stroke-width="1.5"/>');if(row.hour%3===0||row.hour===23)parts.push('<text x="'+x(row.hour)+'" y="229" text-anchor="middle" fill="currentColor" font-size="12">'+String(row.hour).padStart(2,'0')+':00</text>')});
    rows.forEach(row=>{const label=String(row.hour).padStart(2,'0')+':00 EAT, temperature '+(isNumber(row.temperature_2m)?format(row.temperature_2m,1)+' °C':'unavailable')+', rainfall '+(isNumber(row.precipitation)?format(row.precipitation,1)+' mm':'unavailable');parts.push('<g data-wx-hour="'+row.hour+'" role="button" tabindex="0" aria-label="'+escape(label)+'"><title>'+escape(label)+'</title><rect x="'+Math.max(left-step/2,x(row.hour)-step/2)+'" y="'+top+'" width="'+step+'" height="'+height+'" fill="transparent"/></g>')});
    parts.push('</svg>');return parts.join('');
  }
  function table(rows) {
    return '<table class="hourly-table"><caption>Detailed hourly model forecast · all times EAT · — means unavailable</caption><thead><tr><th scope="col">Time</th><th scope="col">Conditions</th><th scope="col">Temp °C</th><th scope="col">Feels °C</th><th scope="col">Rain mm</th><th scope="col">Rain chance %</th><th scope="col">Humidity %</th><th scope="col">Wind km/h</th><th scope="col">Gust km/h</th><th scope="col">Direction</th><th scope="col">Cloud %</th><th scope="col">Pressure hPa</th><th scope="col">Visibility km</th><th scope="col">Dew point °C</th></tr></thead><tbody>'+rows.map(row=>'<tr><th scope="row">'+String(row.hour).padStart(2,'0')+':00</th><td>'+escape(weatherInfo(row.weather_code,row.is_day).label)+'</td><td>'+format(row.temperature_2m,1)+'</td><td>'+format(row.apparent_temperature,1)+'</td><td>'+format(row.precipitation,1)+'</td><td>'+format(row.precipitation_probability)+'</td><td>'+format(row.relative_humidity_2m)+'</td><td>'+format(row.wind_speed_10m,1)+'</td><td>'+format(row.wind_gusts_10m,1)+'</td><td>'+compass(row.wind_direction_10m)+(isNumber(row.wind_direction_10m)?' '+format(row.wind_direction_10m)+'°':'')+'</td><td>'+format(row.cloud_cover)+'</td><td>'+format(row.pressure_msl,1)+'</td><td>'+format(isNumber(row.visibility)?row.visibility/1000:null,1)+'</td><td>'+format(row.dew_point_2m,1)+'</td></tr>').join('')+'</tbody></table>';
  }
  function exportHours(state,rows) {
    const fields=['city','forecast_date','hour_EAT','source_timestamp','source_timezone','provider','retrieved_at','stale','temperature_c','feels_like_c','precipitation_mm','precipitation_probability_percent','relative_humidity_percent','wind_speed_kmh','wind_gusts_kmh','wind_direction_degrees','cloud_cover_percent','pressure_msl_hpa','visibility_m','dew_point_c','weather_code','is_day'];
    const lines=[fields,...rows.map(row=>[state.city?.name || '',state.date,String(row.hour).padStart(2,'0')+':00',row.time || '',state.forecast?.timezone || 'Africa/Mogadishu','Open-Meteo',state.loadedAt || '',!!state.stale,...['temperature_2m','apparent_temperature','precipitation','precipitation_probability','relative_humidity_2m','wind_speed_10m','wind_gusts_10m','wind_direction_10m','cloud_cover','pressure_msl','visibility','dew_point_2m','weather_code','is_day'].map(field=>isNumber(row[field]) ? row[field] : '')])];
    const csv=lines.map(line=>line.map(value=>'"'+String(value).replace(/"/g,'""')+'"').join(',')).join('\r\n');
    const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=(state.city?.name || 'city').replace(/[^a-z0-9]+/gi,'-')+'-'+state.date+'-hourly-weather.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return blob;
  }
  function render(state) {
    const get=id=>document.getElementById(id);
    if(!get('daily-summary')) return;
    const city=state.city || {},date=state.date,days=(state.days || []).filter(isoDate).slice(0,14),forecast=state.forecast;
    const daily=dayData(forecast,date),rows=hourData(forecast,date),selectedHour=Math.max(0,Math.min(23,Number.isInteger(state.selectedHour)?state.selectedHour:12));
    const dayWeather=weatherInfo(daily.weather_code),rain=rainInfo(daily.precipitation_sum),uv=uvInfo(daily.uv_index_max);
    if(get('daily-title'))get('daily-title').textContent='Detailed daily weather';
    if(get('daily-city') && get('daily-city').tagName !== 'SELECT')get('daily-city').textContent=(city.name || 'Selected city')+' · '+(city.region || 'Somalia');
    if(get('daily-date-tabs')){
      get('daily-date-tabs').classList.add('daily-tabs');
      get('daily-date-tabs').innerHTML=days.map((day,index)=>{const data=dayData(forecast,day),weather=weatherInfo(data.weather_code);return '<button type="button" class="day-tab'+(day===date?' selected':'')+'" data-wx-day="'+index+'" aria-pressed="'+(day===date)+'" aria-label="'+escape(dateLabel(day,true)+', '+weather.label+', maximum '+(isNumber(data.temperature_2m_max)?format(data.temperature_2m_max)+' °C':'unavailable')+', rainfall '+(isNumber(data.precipitation_sum)?format(data.precipitation_sum,1)+' mm':'unavailable'))+'"><span class="day-tab-date">'+escape(dateLabel(day))+'</span><span class="day-tab-icon">'+weather.icon+'</span><span class="day-tab-temp">'+format(data.temperature_2m_max)+'° <small>'+format(data.temperature_2m_min)+'°</small></span><span class="day-tab-rain">'+format(data.precipitation_sum,1)+' mm</span></button>'}).join('');
      get('daily-date-tabs').onclick=event=>{const button=event.target.closest('[data-wx-day]');if(button&&typeof state.onDay==='function')state.onDay(Number(button.dataset.wxDay))};
    }
    get('daily-summary').classList.add('daily-summary-grid');
    get('daily-summary').innerHTML='<article class="weather-hero"><div class="weather-hero-main"><div class="weather-hero-copy"><p class="daily-date-badge">'+escape(dateLabel(date,true))+' · EAT</p><h3>'+escape(dayWeather.label)+'</h3><div class="weather-hero-temperature">'+format(daily.temperature_2m_max)+'<span>°C</span></div><p class="weather-high-low">Daily high '+format(daily.temperature_2m_max)+'° · low '+format(daily.temperature_2m_min)+'°</p><p>Feels like '+format(daily.apparent_temperature_max)+'° / '+format(daily.apparent_temperature_min)+'°</p></div><div class="weather-hero-side">'+dayWeather.icon+'<span class="daily-chip '+rain.level+'">'+escape(rain.label)+'</span></div></div><p class="weather-source-note">Daily rainfall screening only. Flood risk also depends on rivers, drainage and terrain.</p></article>'+
      '<article class="weather-stat"><span>Rainfall & probability</span><strong>'+format(daily.precipitation_sum,1)+' <small>mm</small></strong><p>'+format(daily.precipitation_probability_max)+'% maximum chance</p><small>Daily total · model estimate</small></article>'+
      '<article class="weather-stat"><span>Wind & gusts</span><strong>'+format(daily.wind_speed_10m_max)+' <small>km/h</small></strong><p>Gusts up to '+format(daily.wind_gusts_10m_max)+' km/h</p><small>Daily maximum at 10 m</small></article>'+
      '<article class="weather-stat"><span>Sunrise & sunset</span><strong>'+localClock(daily.sunrise)+' <small>↑ EAT</small></strong><p>'+localClock(daily.sunset)+' sunset ↓ EAT</p><small>Sun times for selected city</small></article>'+
      '<article class="weather-stat"><span>Maximum UV index</span><strong>'+format(daily.uv_index_max,1)+' <small>'+escape(uv.label)+'</small></strong><p>'+(isNumber(daily.uv_index_max)&&daily.uv_index_max>=3?'Seek shade; use sun protection.':isNumber(daily.uv_index_max)?'Lower UV exposure expected.':'UV forecast unavailable.')+'</p><small>UV is separate from flood risk</small></article>';
    if(get('hourly-chart'))get('hourly-chart').innerHTML='<div class="hourly-header"><div><p class="eyebrow">THE DAY, HOUR BY HOUR</p><h3>Temperature & rainfall</h3></div><span class="hourly-time-caption">24 hours · East Africa Time (UTC+3)</span></div><div class="chart-legend"><span><i style="background:#2563eb"></i> Temperature · °C</span><span><i style="background:#38bdf8"></i> Rainfall · mm</span><span>Gaps = unavailable</span></div><div class="hourly-chart-wrap">'+plot(rows,selectedHour)+'</div><div class="hourly-time-list" aria-label="Select forecast hour">'+rows.map(row=>'<button type="button" class="hour-choice'+(row.hour===selectedHour?' selected':'')+'" data-wx-hour="'+row.hour+'" aria-pressed="'+(row.hour===selectedHour)+'"><span>'+String(row.hour).padStart(2,'0')+':00</span>'+weatherInfo(row.weather_code,row.is_day).icon+'<strong>'+format(row.temperature_2m)+'°</strong><small>'+format(row.precipitation,1)+' mm</small></button>').join('')+'</div>';
    const hour=rows[selectedHour],hourWeather=weatherInfo(hour.weather_code,hour.is_day);
    if(get('hourly-detail'))get('hourly-detail').innerHTML='<div class="hourly-header"><div><p class="eyebrow">SELECTED HOUR</p><h3>'+String(selectedHour).padStart(2,'0')+':00 EAT · '+escape(hourWeather.label)+'</h3></div>'+hourWeather.icon+'</div><div class="hourly-metrics">'+metric('Temperature',format(hour.temperature_2m,1)+' <small>°C</small>','Feels like '+format(hour.apparent_temperature,1)+' °C')+metric('Precipitation',format(hour.precipitation,1)+' <small>mm</small>',format(hour.precipitation_probability)+'% chance')+metric('Wind',format(hour.wind_speed_10m,1)+' <small>km/h</small>',compass(hour.wind_direction_10m)+(isNumber(hour.wind_direction_10m)?' '+format(hour.wind_direction_10m)+'°':'')+' · gust '+format(hour.wind_gusts_10m,1)+' km/h')+metric('Humidity',format(hour.relative_humidity_2m)+' <small>%</small>','Dew point '+format(hour.dew_point_2m,1)+' °C')+metric('Cloud cover',format(hour.cloud_cover)+' <small>%</small>','Optical imagery may be obscured')+metric('Pressure',format(hour.pressure_msl,1)+' <small>hPa</small>','Mean sea level')+metric('Visibility',format(isNumber(hour.visibility)?hour.visibility/1000:null,1)+' <small>km</small>','Model visibility estimate')+'</div>';
    if(get('hourly-table')){const wasOpen=!!get('hourly-table').querySelector('details')?.open;get('hourly-table').innerHTML='<details class="hourly-table-toggle"'+(wasOpen?' open':'')+'><summary>View all 24 hours in detail</summary><div class="hourly-table-wrap">'+table(rows)+'</div></details>'}
    const selectHour=event=>{const button=event.target.closest('[data-wx-hour]');if(button&&typeof state.onHour==='function')state.onHour(Number(button.dataset.wxHour))};
    if(get('hourly-chart')){get('hourly-chart').onclick=selectHour;get('hourly-chart').onkeydown=event=>{if(event.target.closest('svg [data-wx-hour]')&&(event.key==='Enter'||event.key===' ')){event.preventDefault();selectHour(event)}}}
    const hoursPresent=rows.filter(row=>row.index>=0).length,tempCount=rows.filter(row=>isNumber(row.temperature_2m)).length,rainCount=rows.filter(row=>isNumber(row.precipitation)).length,weatherCount=rows.filter(row=>weatherInfo(row.weather_code).kind!=='unknown').length;
    const status=[];
    if(state.loading)status.push(forecast?'Refreshing detailed weather; showing the last response.':'Connecting to detailed weather…');
    if(state.error)status.push('Detailed weather refresh failed: '+String(state.error));
    if(state.stale&&forecast)status.push('Showing last known model data; retrieval is stale.');
    if(!forecast&&!state.loading)status.push('Detailed weather is unavailable.');
    if(forecast&&daily.index<0)status.push('Daily summary unavailable for this date.');
    if(forecast&&(hoursPresent<24||tempCount<24||rainCount<24||weatherCount<24))status.push('Partial hourly coverage: '+hoursPresent+'/24 timestamps, '+tempCount+'/24 temperatures, '+rainCount+'/24 rainfall values, '+weatherCount+'/24 weather conditions. Later forecast days may have fewer fields.');
    if(forecast&&forecast.timezone&&forecast.timezone!=='Africa/Mogadishu'&&forecast.utc_offset_seconds!==10800)status.push('Source timezone is '+forecast.timezone+'; verify times before use.');
    if(get('daily-status')){get('daily-status').className='daily-status'+(state.error||state.stale||forecast&&(tempCount<24||rainCount<24)?' daily-warning':'');get('daily-status').innerHTML='<p>'+escape(status.join(' '))+'</p><p class="weather-source-note"><a class="source-link" href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo weather model forecast ↗</a> · '+escape(retrievedLabel(state.loadedAt))+'. Values are model estimates, not station observations. — means unavailable.</p>'}
    const exportButton=get('hourly-export');if(exportButton){exportButton.disabled=hoursPresent===0;exportButton.onclick=()=>exportHours(state,rows)}
    const reference=get('meteoblue-link');if(reference){const galkayo=/^(galkayo|gaalkacyo)$/i.test(city.name || '');reference.hidden=!galkayo;if(galkayo){reference.href='https://www.meteoblue.com/en/weather/today/gaalkacyo_somalia_59611';reference.textContent='Compare Galkayo on meteoblue ↗';reference.target='_blank';reference.rel='noopener noreferrer'}else reference.removeAttribute('href')}
  }
  global.DailyWeather={render,weatherInfo,dayData,hourData};
})(typeof window !== 'undefined' ? window : globalThis);
