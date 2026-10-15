window.MapContext=(()=>{
  let lastInput={};
  const el=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const DAY=86400000;
  function observationTime(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.test(value))return null;
    const calendar=new Date(value.slice(0,10)+'T00:00:00.000Z');
    if(!Number.isFinite(calendar.getTime())||calendar.toISOString().slice(0,10)!==value.slice(0,10))return null;
    const time=Date.parse(value.length===10?value+'T00:00:00.000Z':value);
    return Number.isFinite(time)?time:null;
  }
  function buildCopernicusBrowserUrl({lat,lon,observationDatetime=null,now=new Date(),zoom=12,mission='optical',cloudCoverage=100,panel='layers'}={}){
    if(!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lon)||Math.abs(lon)>180)throw new TypeError('Valid satellite-view coordinates are required.');
    if(!['optical','radar'].includes(mission))throw new TypeError('Select optical or radar imagery.');
    const nowMs=new Date(now).getTime();if(!Number.isFinite(nowMs))throw new TypeError('A valid satellite-view retrieval time is required.');
    const observationMs=observationTime(observationDatetime),hasObservation=observationMs!==null&&observationMs<=nowMs;
    const from=hasObservation?new Date(new Date(observationMs).toISOString().slice(0,10)+'T00:00:00.000Z'):new Date(nowMs-14*DAY);
    const to=new Date(hasObservation?Math.min(from.getTime()+DAY-1,nowMs):nowMs);
    const url=new URL('https://browser.dataspace.copernicus.eu/');
    url.search=new URLSearchParams({lat,lng:lon,zoom:Number.isFinite(zoom)&&zoom>=1&&zoom<=20?zoom:12,themeId:'DEFAULT-THEME',fromTime:from.toISOString(),toTime:to.toISOString(),dateMode:'TIME RANGE',panel:panel==='search'?'search':'layers'});
    if(mission==='optical'){
      url.searchParams.set('datasetId','S2_L2A_CDAS');url.searchParams.set('layerId','1_TRUE_COLOR');
      url.searchParams.set('cloudCoverage',String(Number.isFinite(cloudCoverage)&&cloudCoverage>=0&&cloudCoverage<=100?cloudCoverage:100));
    }
    // Do not guess a Sentinel-1 dataset/layer identifier; select radar in the Browser.
    return url.href;
  }
  function links({city,point,observationDatetime=null,now}){const validPoint=Number.isFinite(point?.lat)&&Math.abs(point.lat)<=90&&Number.isFinite(point?.lon)&&Math.abs(point.lon)<=180,lat=validPoint?point.lat:city[2],lon=validPoint?point.lon:city[3],coord=`${lat.toFixed(5)},${lon.toFixed(5)}`;
    const street=new URL('https://www.google.com/maps/@');street.search=new URLSearchParams({api:1,map_action:'pano',viewpoint:coord});
    const earth='https://earth.google.com/web/search/'+encodeURIComponent(coord);
    const satellite=new URL('https://www.google.com/maps/@');satellite.search=new URLSearchParams({api:1,map_action:'map',center:coord,zoom:13,basemap:'satellite'});
    const copernicus=new URL(buildCopernicusBrowserUrl({lat,lon,observationDatetime,now})),fromTime=copernicus.searchParams.get('fromTime'),toTime=copernicus.searchParams.get('toTime');
    // Google Flood Hub at the same place (its own map: /floods/l/<lat>/<lng>/<zoom>).
    const floodHub=`https://sites.research.google/floods/l/${lat.toFixed(4)}/${lon.toFixed(4)}/10`;
    const imageryDateLabel=fromTime.slice(0,10)===toTime.slice(0,10)?fromTime.slice(0,10)+' UTC':fromTime.slice(0,10)+' to '+toTime.slice(0,10)+' UTC';
    return{coord,lat,lon,pointSelected:validPoint,earth,floodHub,street:street.href,satellite:satellite.href,copernicus:copernicus.href,fromTime,toTime,imageryDateLabel};
  }
  function render(input){input={...lastInput,...input};lastInput=input;const node=el('map-context-links');if(!node||!input.city)return;const l=links(input);node.innerHTML=`<p><b>${esc(l.pointSelected?'Selected map point':input.city[0])}</b> · ${esc(l.coord)}</p><div class="context-link-grid"><a href="${esc(l.earth)}" target="_blank" rel="noopener">◉ Google Earth <span>Terrain &amp; 3D context ↗</span></a><a href="${esc(l.street)}" target="_blank" rel="noopener">⌖ Street View <span>Available panoramas ↗</span></a><a href="${esc(l.satellite)}" target="_blank" rel="noopener">▧ Google satellite <span>Land use &amp; access ↗</span></a><a href="${esc(l.copernicus)}" target="_blank" rel="noopener">◈ Copernicus Browser <span>Inspect dated optical scenes ↗</span></a><a class="context-link-floodhub" href="${esc(l.floodHub)}" target="_blank" rel="noopener">≈ Google Flood Hub <span>River flood forecasts near here · not an official warning ↗</span></a></div><p class="note">Optical observation window: <b>${esc(l.imageryDateLabel)}</b>. All cloud-cover levels are included; clouds may obscure the ground. These scenes do not establish local flooding.</p><div class="context-actions"><button id="copy-city-link" type="button">Copy city &amp; forecast link</button><button id="report-map-location" type="button">Report at this location</button></div><span id="share-status" role="status"></span><p class="note">Earth, satellite basemaps and Street View are geographic context, with varying imagery dates and local coverage. They do not show live water levels or verified safe routes. Check the dated flood layers and local conditions.</p>`;
    el('copy-city-link').onclick=async()=>{const share=new URL(location.href);share.hash=new URLSearchParams({city:input.city[0],...(input.date?{day:input.date}:{}),...(Number.isInteger(input.hour)?{hour:input.hour}:{}),scenario:input.scenario||'live',view:'mayor',tool:'map'});try{await navigator.clipboard.writeText(share.href);el('share-status').textContent=' City link copied.'}catch{el('share-status').textContent=' Copy this city link: '+share.href}};
    el('report-map-location').textContent=l.pointSelected?'Use map point in report':'Report for this city';
    el('report-map-location').onclick=()=>{window.MayorNavigation?.open?.('community');if(l.pointSelected)window.CommunityReports?.setLocation({latitude:l.lat,longitude:l.lon});else document.getElementById('community-report-form')?.scrollIntoView({behavior:'smooth',block:'start'})};
  }
  return{render,links,buildCopernicusBrowserUrl};
})();
