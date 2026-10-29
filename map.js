/* =====================================================================
   MAP.JS — Mappa Leaflet: marker delle catture raggruppati per spot,
   punti di interesse, posizione GPS live, layer batimetria.
   ===================================================================== */

let mapInstance = null;

let mapMarkersLayer = null;

/* ===================== MAPPA ===================== */

let pinMode = false;

let livePosWatchId = null;

let liveMarker = null;

let poiLayer = null;

let pendingPoiLatLng = null;

let bathyLayer = null;

let bathyOn = false;

function fmtCoords(lat, lng){
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function renderMap(){
  if(!mapInstance){
    mapInstance = L.map('map', {zoomControl:true}).fitBounds([[44.145,8.30],[44.335,8.50]]); // default: Finale Ligure – Savona
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom:18
    }).addTo(mapInstance);
    mapMarkersLayer = L.layerGroup().addTo(mapInstance);
    poiLayer = L.layerGroup().addTo(mapInstance);
    mapInstance.on('click', onMapClick);
    setTimeout(()=>mapInstance.invalidateSize(), 200);
  } else {
    setTimeout(()=>mapInstance.invalidateSize(), 50);
  }

  renderMapFilters();

  mapMarkersLayer.clearLayers();
  currentSpots = buildSpots(getFilteredCatchesForMap());
  currentSpots.forEach(spot=>{
    const stat = spotStats(spot);
    const color = stat.dominantSpeciesId ? speciesColorFor(stat.dominantSpeciesId) : '#5B6660';
    const label = stat.count > 1 ? stat.count : '🎣';
    const icon = L.divIcon({
      html: `<div style="width:30px;height:30px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:#fff;font-family:var(--font-mono);font-weight:700;font-size:${stat.count>1?'13px':'14px'};">${label}</div>`,
      className:'', iconSize:[30,30], iconAnchor:[15,15]
    });
    const m = L.marker([spot.lat, spot.lng], {icon}).addTo(mapMarkersLayer);
    m.on('click', ()=> openSpotModal(spot.id));
  });

  const showPoi = (mapFilter==='tutte' || mapFilter==='poi');
  poiLayer.clearLayers();
  if(showPoi){
    const poiIcon = L.divIcon({html:'📌', className:'', iconSize:[24,24], iconAnchor:[12,22]});
    data.poi.forEach(p=>{
      const m = L.marker([p.lat, p.lng], {icon:poiIcon}).addTo(poiLayer);
      m.bindPopup(`<b>${p.name}</b>${p.notes? '<br>'+p.notes : ''}<div class="coords">📍 ${fmtCoords(p.lat,p.lng)}</div><button class="popup-del" onclick="deletePoi('${p.id}')">Elimina punto</button>`);
    });
  }

  const allPts = [...currentSpots.map(s=>[s.lat,s.lng]), ...(showPoi ? data.poi.map(p=>[p.lat,p.lng]) : [])];
  if(allPts.length){
    mapInstance.fitBounds(L.latLngBounds(allPts).pad(0.3));
  }
}

/* ===================== CLUSTERING SPOT & FILTRI MAPPA ===================== */

let mapFilter = 'tutte'; // 'tutte' | 'specie' | 'record' | 'poi'

let mapFilterSpecies = null;

let currentSpots = [];

function haversineMeters(lat1, lng1, lat2, lng2){
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2-lat1), dLng = toRad(lng2-lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/* Raggio di fusione degli spot: catture entro questa distanza dal centro dello spot finiscono nello stesso spot */
const SPOT_RADIUS_M = 10;

function buildSpots(catchList){
  const spots = [];
  /* ordine deterministico: il risultato non dipende dall'ordine di inserimento delle catture */
  const sorted = [...catchList].sort((a,b)=> a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  sorted.forEach(c=>{
    let found = null, foundDist = Infinity;
    for(const s of spots){
      const d = haversineMeters(s.lat, s.lng, c.lat, c.lng);
      if(d <= SPOT_RADIUS_M && d < foundDist){ found = s; foundDist = d; } // lo spot più vicino, non il primo
    }
    if(found){
      found.catches.push(c);
      found.lat = found.catches.reduce((sum,x)=>sum+x.lat,0)/found.catches.length;
      found.lng = found.catches.reduce((sum,x)=>sum+x.lng,0)/found.catches.length;
    } else {
      spots.push({id:'spot_'+uid(), lat:c.lat, lng:c.lng, catches:[c]});
    }
  });
  return spots;
}

function spotStats(spot){
  const catches = spot.catches;
  const speciesIds = [...new Set(catches.map(c=>c.speciesId))];
  const weights = catches.map(c=>parseFloat(c.weight)).filter(w=>!isNaN(w) && w>0);
  const avgWeight = weights.length ? (weights.reduce((a,b)=>a+b,0)/weights.length) : null;
  const maxWeight = weights.length ? Math.max(...weights) : null;
  const lastCatch = catches.reduce((a,b)=> a.date > b.date ? a : b);
  const baitCounts = {};
  catches.forEach(c=>{ if(c.bait && c.bait.trim()){ const b=c.bait.trim(); baitCounts[b]=(baitCounts[b]||0)+1; } });
  let topBait = null, topBaitCount = 0;
  Object.entries(baitCounts).forEach(([b,n])=>{ if(n>topBaitCount){ topBait=b; topBaitCount=n; } });
  const speciesCounts = {};
  catches.forEach(c=> speciesCounts[c.speciesId] = (speciesCounts[c.speciesId]||0)+1);
  let dominantSpeciesId = null, domCount = 0;
  Object.entries(speciesCounts).forEach(([sid,n])=>{ if(n>domCount){ domCount=n; dominantSpeciesId=sid; } });
  return {count:catches.length, speciesIds, avgWeight, maxWeight, lastCatch, topBait, dominantSpeciesId};
}

function catchIsPersonalRecord(c){
  const stat = speciesStats(c.speciesId);
  const w = parseFloat(c.weight);
  return stat.unlocked && stat.bestWeight>0 && !isNaN(w) && w === stat.bestWeight;
}

function speciesColorFor(speciesId){
  const idx = allSpecies().findIndex(s=>s.id===speciesId);
  const hue = (idx>=0 ? idx : 0) * 137.508 % 360; // angolo aureo: colori ben distinti tra loro
  return `hsl(${hue}, 62%, 42%)`;
}

function getFilteredCatchesForMap(){
  let list = data.catches.filter(c=>c.lat && c.lng);
  if(mapFilter==='specie' && mapFilterSpecies){
    list = list.filter(c=>c.speciesId===mapFilterSpecies);
  } else if(mapFilter==='record'){
    list = list.filter(c=>catchIsPersonalRecord(c));
  } else if(mapFilter==='poi'){
    list = [];
  }
  return list;
}

function renderMapFilters(){
  const wrap = document.getElementById('mapFilters');
  const cats = [['tutte','Tutte le specie'],['specie','Solo una specie'],['record','Solo record'],['poi','Solo punti di interesse']];
  wrap.innerHTML = cats.map(([k,l])=>`<button class="filter-chip ${mapFilter===k?'active':''}" onclick="setMapFilter('${k}')">${l}</button>`).join('');
  const speciesWrap = document.getElementById('mapSpeciesFilterWrap');
  speciesWrap.style.display = (mapFilter==='specie') ? 'block' : 'none';
  if(mapFilter==='specie'){
    const sel = document.getElementById('mapSpeciesFilterSelect');
    if(!sel.dataset.filled){
      sel.innerHTML = [...SPECIES_DB].sort((a,b)=>a.name.localeCompare(b.name)).map(s=>`<option value="${s.id}">${s.glyph} ${s.name}</option>`).join('');
      sel.dataset.filled = '1';
      if(!mapFilterSpecies) mapFilterSpecies = sel.value;
    }
    sel.value = mapFilterSpecies;
  }
}

function setMapFilter(f){
  mapFilter = f;
  if(f==='specie' && !mapFilterSpecies) mapFilterSpecies = SPECIES_DB[0].id;
  renderMap();
}

function setMapFilterSpecies(id){
  mapFilterSpecies = id;
  renderMap();
}

function openSpotModal(id){
  const spot = currentSpots.find(s=>s.id===id);
  if(!spot) return;
  const stat = spotStats(spot);
  const content = document.getElementById('spotDetailContent');
  const imprecise = spot.catches.filter(c=> c.accuracy!=null && c.accuracy > 15).length;
  const speciesChips = stat.speciesIds.map(sid=>{
    const sp = speciesById(sid);
    return `<span class="badge" style="background:${speciesColorFor(sid)};">${sp?sp.glyph+' '+sp.name:'—'}</span>`;
  }).join(' ');
  content.innerHTML = `
    <div class="species-detail-head">
      <div class="glyph">📍</div>
      <h2>${stat.speciesIds.length===1 ? (speciesById(stat.speciesIds[0])?.name || 'Spot') : 'Spot misto'}</h2>
      <div class="latin">${fmtCoords(spot.lat, spot.lng)}</div>
    </div>
    <div style="display:flex; flex-wrap:wrap; gap:6px; justify-content:center; margin-bottom:14px;">${speciesChips}</div>
    <div class="detail-stats">
      <div class="st"><div class="v">${stat.count}</div><div class="k">Catture</div></div>
      <div class="st"><div class="v">${stat.avgWeight? stat.avgWeight.toFixed(2)+' kg' : '—'}</div><div class="k">Peso medio</div></div>
      <div class="st"><div class="v">${stat.maxWeight? stat.maxWeight+' kg' : '—'}</div><div class="k">Peso max</div></div>
    </div>
    <div class="desc-box">
      <b>Ultima cattura:</b> ${fmtDate(stat.lastCatch.date)}<br>
      <b>Esca più usata:</b> ${stat.topBait || '—'}
      ${imprecise ? `<br><span style="color:var(--copper-dark);">⚠️ ${imprecise} ${imprecise===1?'cattura ha':'catture hanno'} una posizione GPS imprecisa (oltre 15 m)</span>` : ''}
    </div>`;
  openModal('modalSpot');
}

function toggleBathymetry(){
  const btn = document.getElementById('btnBathy');
  bathyOn = !bathyOn;
  btn.classList.toggle('active', bathyOn);
  if(bathyOn){
    if(!bathyLayer){
      /* EMODnet Bathymetry: colore continuo della profondità (più sensibile ai piccoli dislivelli rispetto alle isobate generalizzate), WMS pubblico gratuito */
      bathyLayer = L.tileLayer.wms('https://ows.emodnet-bathymetry.eu/wms', {
        layers: 'emodnet:mean_multicolour',
        format: 'image/png',
        transparent: true,
        version: '1.1.1',
        opacity: 0.8,
        detectRetina: true,
        attribution: 'Profondità: EMODnet Bathymetry Consortium'
      });
      let tileErrorShown = false;
      bathyLayer.on('tileerror', ()=>{
        if(!tileErrorShown){ tileErrorShown = true; toast('Dati profondità non disponibili in questa zona/zoom'); }
      });
    }
    bathyLayer.addTo(mapInstance);
    toast('Profondità attivata — colori più scuri = più fondo');
  } else {
    if(bathyLayer) mapInstance.removeLayer(bathyLayer);
    toast('Profondità disattivata');
  }
}

function openPoiModal(latlng){
  document.getElementById('poiName').value = '';
  document.getElementById('poiNotes').value = '';
  document.getElementById('poiLat').value = latlng ? latlng.lat.toFixed(6) : '';
  document.getElementById('poiLng').value = latlng ? latlng.lng.toFixed(6) : '';
  openModal('modalPoi');
}

function onMapClick(e){
  openPoiModal(e.latlng);
}

async function usePoiCurrentLocation(){
  if(!navigator.geolocation){ toast('Geolocalizzazione non disponibile'); return; }
  toast('Rilevo posizione GPS...');
  try{
    const pos = await getBestPosition();
    document.getElementById('poiLat').value = pos.lat.toFixed(6);
    document.getElementById('poiLng').value = pos.lng.toFixed(6);
    toast('Posizione rilevata (±' + Math.round(pos.accuracy) + ' m)');
  }catch(err){
    toast('GPS: ' + (GPS_ERRORS[err && err.code] || 'errore sconosciuto'));
  }
}

function savePoi(){
  const name = document.getElementById('poiName').value.trim();
  const lat = parseFloat(document.getElementById('poiLat').value);
  const lng = parseFloat(document.getElementById('poiLng').value);
  if(!name){ toast('Dai un nome al punto'); return; }
  if(isNaN(lat) || isNaN(lng)){ toast('Inserisci delle coordinate valide (o usa il GPS)'); return; }
  data.poi.push({
    id: uid(),
    name,
    notes: document.getElementById('poiNotes').value,
    lat, lng,
  });
  saveData();
  closeModal('modalPoi');
  toast('Punto salvato 📌');
  renderMap();
}

function deletePoi(id){
  if(!confirm('Eliminare questo punto?')) return;
  data.poi = data.poi.filter(p=>p.id!==id);
  saveData();
  renderMap();
  toast('Punto eliminato');
}

function toggleLiveLocation(){
  const btn = document.getElementById('btnMyLoc');
  if(livePosWatchId !== null){
    navigator.geolocation.clearWatch(livePosWatchId);
    livePosWatchId = null;
    if(liveMarker){ mapInstance.removeLayer(liveMarker); liveMarker = null; }
    btn.classList.remove('active');
    toast('Posizione in tempo reale disattivata');
    return;
  }
  if(!navigator.geolocation){ toast('Geolocalizzazione non disponibile su questo browser'); return; }
  if(!window.isSecureContext){ toast('Serve HTTPS (o localhost) per usare il GPS: apri l\'app dall\'indirizzo https del sito'); return; }
  btn.classList.add('active');
  toast('Rilevo la posizione GPS...');
  const noFixTimeout = setTimeout(()=>{
    toast('GPS lento a rispondere: assicurati di essere all\'aperto e di aver dato il permesso');
  }, 8000);
  livePosWatchId = navigator.geolocation.watchPosition(pos=>{
    clearTimeout(noFixTimeout);
    const {latitude, longitude} = pos.coords;
    if(!liveMarker){
      const dotIcon = L.divIcon({html:'<div class="live-dot-wrap"><div class="live-dot-pulse"></div><div class="live-dot"></div></div>', className:'', iconSize:[26,26], iconAnchor:[13,13]});
      liveMarker = L.marker([latitude, longitude], {icon:dotIcon, zIndexOffset:1000}).addTo(mapInstance);
      liveMarker.bindPopup(`La mia posizione<div class="coords">📍 ${fmtCoords(latitude, longitude)}</div>`);
      mapInstance.setView([latitude, longitude], 15);
      liveMarker.openPopup();
      toast('Posizione trovata 📍');
    } else {
      liveMarker.setLatLng([latitude, longitude]);
      liveMarker.setPopupContent(`La mia posizione<div class="coords">📍 ${fmtCoords(latitude, longitude)}</div>`);
    }
  }, err=>{
    clearTimeout(noFixTimeout);
    const reasons = {1:'Permesso negato dal browser', 2:'Posizione non disponibile', 3:'Timeout nel rilevamento'};
    toast('GPS: ' + (reasons[err.code] || 'errore sconosciuto'));
    btn.classList.remove('active');
    livePosWatchId = null;
  }, {enableHighAccuracy:true, timeout:15000, maximumAge:5000});
}
