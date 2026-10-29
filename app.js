/* =====================================================================
   APP.JS — File principale: tab, diario, dashboard, ricerca avanzata,
   galleria foto, form cattura, modali generiche.
   ===================================================================== */

let currentTab = 'diario';

/* ===================== UTIL ===================== */

function fmtDate(iso){
  if(!iso) return '';
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('it-IT', {day:'2-digit', month:'short', year:'numeric'});
}

function monthKey(iso){ return iso.slice(0,7); }

function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>t.classList.remove('show'), 2200);
}

/* ===================== TABS ===================== */

function switchTab(name){
  currentTab = name;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  if(name==='diario') renderDiario();
  if(name==='pokedex') renderPokedex();
  if(name==='stats') renderStats();
  if(name==='map') renderMap();
}

/* ===================== DIARIO ===================== */

async function renderDailyForecastStrip(){
  const box = document.getElementById('dailyForecastStrip');
  if(!box) return;
  const loc = resolveWeatherLocation();
  const spot = loc;
  const spotLabel = loc.name ? loc.name : (loc.source==='spot' ? 'sul tuo spot' : 'a Spotorno');
  box.innerHTML = `<div class="daily-forecast-card"><h3>Previsioni <span class="cond-note">${spotLabel}</span></h3><div class="pred-body" style="color:var(--ink-soft); font-size:12px;">Carico...</div></div>`;
  let days, fc = null;
  try{
    /* previsione meteo dei 7 giorni e indice di pesca orario (stessa cache del pannello "ora per ora") in parallelo */
    const [dRes, fRes] = await Promise.allSettled([fetchDailyForecastFull(spot.lat, spot.lng, 7), getForecastData()]);
    if(dRes.status !== 'fulfilled') throw dRes.reason;
    days = dRes.value;
    fc = fRes.status === 'fulfilled' ? fRes.value : null;
  }catch(e){
    box.innerHTML = `<div class="daily-forecast-card"><h3>Previsioni <span class="cond-note">${spotLabel}</span></h3><div class="pred-body" style="color:var(--ink-soft); font-size:12px;">Previsioni non disponibili al momento.</div></div>`;
    return;
  }
  const dayShort = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
  const todayStr = localDateStr();
  const cardsHTML = days.map(d=>{
    const isToday = d.date === todayStr;
    const wd = dayShort[new Date(d.date+'T12:00:00').getDay()];
    const fish = fc && fc.byDate[d.date] ? fc.byDate[d.date] : null;
    const fishHTML = fish
      ? `<div class="df-fish" style="background:${scoreColor(fish.index)};" title="Indice di pesca ${fish.index}: ${fishingRating(fish.index)}">🎣 ${fish.index}</div><div class="df-rating" style="color:${scoreColor(fish.index)};">${fishingRating(fish.index)}</div>`
      : '';
    return `<div class="df-day" ${fish ? `style="cursor:pointer;" onclick="openDayForecast('${d.date}')"` : ''}>
      <div class="df-name">${isToday?'Oggi':wd}</div>
      <div class="df-icon">${d.weatherCode!=null? weatherEmoji(d.weatherCode) : '—'}</div>
      <div class="df-temp">${d.tempMax!=null?`<span class="max">${Math.round(d.tempMax)}°</span>`:''} ${d.tempMin!=null?`<span class="min">${Math.round(d.tempMin)}°</span>`:''}</div>
      <div class="df-wave">${d.waveHeight!=null? '🌊 '+d.waveHeight.toFixed(1)+'m' : ''}</div>
      ${fishHTML}
    </div>`;
  }).join('');
  box.innerHTML = `
    <div class="daily-forecast-card">
      <h3>Previsioni 7 giorni <span class="cond-note">${spotLabel}</span></h3>
      <div class="daily-forecast-strip">${cardsHTML}</div>
    </div>`;
}

function openWeatherLocationModal(){
  document.getElementById('weatherLocationSearch').value = '';
  document.getElementById('weatherLocationResults').innerHTML = '';
  openModal('modalWeatherLocation');
}

async function searchWeatherLocation(){
  const q = document.getElementById('weatherLocationSearch').value.trim();
  const results = document.getElementById('weatherLocationResults');
  if(!q){ toast('Scrivi il nome di una località'); return; }
  results.innerHTML = `<div class="pred-body" style="color:var(--ink-soft); font-size:12px;">Cerco...</div>`;
  try{
    const places = await geocodePlace(q);
    if(places.length===0){
      results.innerHTML = `<div class="pred-body" style="color:var(--ink-soft); font-size:12px;">Nessun risultato.</div>`;
      return;
    }
    results.innerHTML = places.map((p,i)=>
      `<div class="catch-card" style="margin-bottom:8px;" onclick='selectWeatherLocation(${JSON.stringify(p).replace(/'/g,"&apos;")})'>
        <div class="catch-thumb">📍</div>
        <div class="catch-info"><div class="row1"><div class="species">${p.name}</div></div></div>
      </div>`
    ).join('');
  }catch(e){
    results.innerHTML = `<div class="pred-body" style="color:var(--ink-soft); font-size:12px;">Ricerca non disponibile ora.</div>`;
  }
}

function selectWeatherLocation(place){
  data.weatherLocation = {name: place.name, lat: place.lat, lng: place.lng};
  saveData();
  closeModal('modalWeatherLocation');
  toast('Meteo impostato su ' + place.name);
  hourlyForecastData = null;
  renderConditionsCard();
  renderDailyForecastStrip();
  if(hourlyForecastOpen) renderHourlyForecastPanel();
}

function resetWeatherLocation(){
  data.weatherLocation = null;
  saveData();
  closeModal('modalWeatherLocation');
  toast('Tornato al comportamento automatico');
  hourlyForecastData = null;
  renderConditionsCard();
  renderDailyForecastStrip();
  if(hourlyForecastOpen) renderHourlyForecastPanel();
}

async function renderConditionsCard(){
  const box = document.getElementById('conditionsCard');
  if(!box) return;
  const loc = resolveWeatherLocation();
  const spot = loc;
  const spotLabel = loc.name ? loc.name : (loc.source==='spot' ? 'sul tuo spot preferito' : 'a Spotorno');
  const nowDate = new Date();
  const todayStr = localDateStr(nowDate);
  const nowHour = nowDate.getHours() + nowDate.getMinutes()/60;
  const moon = moonPhaseForDate(todayStr, nowHour);
  const illum = moonIllumination(todayStr, nowHour);
  const solunar = solunarPeriods(todayStr, spot.lat, spot.lng);

  const solunarHTML = `<div class="solunar-row">${solunar.map(s=>`<span class="sol-tag ${s.kind}" title="${s.label}">🎣 ${s.range}${s.kind==='minor'?' ·min':''}</span>`).join('')}</div>`;
  const header = `<h3>Condizioni di oggi <span class="cond-note" style="cursor:pointer; text-decoration:underline;" onclick="openWeatherLocationModal()">📍 ${spotLabel} · cambia</span></h3>`;
  const moonCell = `<div class="cst"><div class="v">${moon.emoji}</div><div class="k">${moon.name}</div><div class="s">${illum}% illuminata</div></div>`;
  const tideFallback = estimateTide(todayStr, nowHour);

  box.innerHTML = `
    <div class="conditions-card">
      ${header}
      <div class="conditions-grid">
        ${moonCell}
        <div class="cst"><div class="v">…</div><div class="k">Meteo</div></div>
        <div class="cst"><div class="v">…</div><div class="k">Mare</div></div>
      </div>
      ${solunarHTML}
    </div>`;

  let c = null;
  try{
    c = await fetchConditionsAt(spot.lat, spot.lng, todayStr, fmtHourMin(nowHour));
  }catch(e){ /* nessun dato: celle con trattino, la marea ripiega sulla stima */ }

  const trend = c ? pressureTrendInfo(c.pressureTrend) : null;
  const tideCell = c && c.tideState
    ? `<div class="cst"><div class="v" style="font-size:11.5px;">${c.tideState}</div><div class="k">Marea</div><div class="s">${c.nextHigh?'alta '+fmtTideTime(c.nextHigh, todayStr):''}${c.nextHigh&&c.nextLow?' · ':''}${c.nextLow?'bassa '+fmtTideTime(c.nextLow, todayStr):''}${c.tideRange!=null?'<br>escursione ~'+c.tideRange+' cm':''}</div></div>`
    : `<div class="cst"><div class="v" style="font-size:11.5px;">${tideFallback.status}</div><div class="k">Marea (stima)</div></div>`;

  box.innerHTML = `
    <div class="conditions-card">
      ${header}
      <div class="conditions-grid">
        <div class="cst"><div class="v">${c && c.temp!=null && c.code!=null ? weatherEmoji(c.code)+' '+c.temp+'°' : '—'}</div><div class="k">${c && c.code!=null ? weatherLabel(c.code) : 'Meteo'}</div></div>
        <div class="cst"><div class="v">${c && c.pressure!=null ? Math.round(c.pressure)+' hPa' : '—'}</div><div class="k">Pressione${trend ? ' '+trend.arrow+' '+trend.text : ''}</div>${c && c.pressureTrend!=null ? `<div class="s">${c.pressureTrend>0?'+':''}${c.pressureTrend.toFixed(1)} hPa in 3 h</div>` : ''}</div>
        <div class="cst"><div class="v">${c && c.windSpeed!=null ? '💨 '+Math.round(c.windSpeed)+' km/h' : '—'}</div><div class="k">Vento${c && c.windDir!=null ? ' da '+windCompass(c.windDir) : ''}</div>${c && c.windGust!=null ? `<div class="s">raffiche ${Math.round(c.windGust)} km/h</div>` : ''}</div>
        <div class="cst"><div class="v">${c && c.seaState ? '🌊 '+c.seaState : '—'}</div><div class="k">${c && c.waveHeight!=null ? c.waveHeight.toFixed(1)+' m' : 'Mare'}</div>${c && c.wavePeriod!=null ? `<div class="s">periodo ${c.wavePeriod.toFixed(0)} s${c.seaTemp!=null ? ' · acqua '+c.seaTemp.toFixed(1)+'°' : ''}</div>` : ''}</div>
        ${tideCell}
        ${moonCell}
      </div>
      ${solunarHTML}
      ${c && (c.sunrise || c.sunset) ? `<div class="sun-row"><span>🌅 alba ${c.sunrise||'—'}</span><span>🌇 tramonto ${c.sunset||'—'}</span></div>` : ''}
    </div>`;
}

function renderDashboard(){
  const container = document.getElementById('dashboardCards');
  const catches = data.catches;

  if(catches.length===0){
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12s4-6 10-6c4 0 7 3 10 6-3 3-6 6-10 6-6 0-10-6-10-6Z"/></svg>
        <p>Registra la tua prima cattura per vedere qui il tuo riepilogo.</p>
      </div>`;
    return;
  }

  const lastCatch = [...catches].sort((a,b)=>b.date.localeCompare(a.date))[0];
  const lastSp = speciesById(lastCatch.speciesId) || {name:lastCatch.speciesName||'Sconosciuta', glyph:'🐟'};

  const recordCatches = catches.filter(c=>catchIsPersonalRecord(c)).sort((a,b)=>b.date.localeCompare(a.date));
  const recentRecord = recordCatches[0] || null;
  const recentRecordSp = recentRecord ? (speciesById(recentRecord.speciesId)||{name:recentRecord.speciesName||'Sconosciuta',glyph:'🐟'}) : null;

  const speciesCounts = {};
  catches.forEach(c=> speciesCounts[c.speciesId]=(speciesCounts[c.speciesId]||0)+1);
  let topSpeciesId=null, topCount=0;
  Object.entries(speciesCounts).forEach(([sid,n])=>{ if(n>topCount){ topCount=n; topSpeciesId=sid; } });
  const topSpecies = topSpeciesId ? speciesById(topSpeciesId) : null;

  const geoCatches = catches.filter(c=>c.lat && c.lng);
  let favSpot = null, favSpotStat = null;
  if(geoCatches.length){
    const spots = buildSpots(geoCatches);
    favSpot = spots.reduce((a,b)=> (b.catches.length > (a ? a.catches.length : 0)) ? b : a, null);
    if(favSpot) favSpotStat = spotStats(favSpot);
  }

  const weights = catches.map(c=>parseFloat(c.weight)).filter(w=>!isNaN(w) && w>0);
  const avgWeight = weights.length ? (weights.reduce((a,b)=>a+b,0)/weights.length) : null;

  const currentYear = new Date().getFullYear();
  const outingsThisYear = new Set(catches.filter(c=>new Date(c.date+'T00:00:00').getFullYear()===currentYear).map(c=>c.date)).size;

  const unlockedList = allSpecies().map(s=>({s, stat:speciesStats(s.id)})).filter(x=>x.stat.unlocked);
  unlockedList.sort((a,b)=>b.stat.firstDate.localeCompare(a.stat.firstDate));
  const recentUnlock = unlockedList[0] || null;

  const cards = [];

  cards.push(`
    <div class="dash-card" onclick="openCatchModal('${lastCatch.id}')">
      <div class="dash-icon">${lastCatch.photo?`<img src="${lastCatch.photo}">`:lastSp.glyph}</div>
      <div class="dash-info">
        <div class="dash-label">Ultima uscita</div>
        <div class="dash-value">${lastSp.name}</div>
        <div class="dash-sub">${fmtDate(lastCatch.date)}${lastCatch.weight? ' · '+lastCatch.weight+' kg':''}${lastCatch.place? ' · '+lastCatch.place:''}</div>
      </div>
    </div>`);

  if(recentRecord){
    cards.push(`
      <div class="dash-card" onclick="openCatchModal('${recentRecord.id}')">
        <div class="dash-icon">${recentRecord.photo?`<img src="${recentRecord.photo}">`:'🏆'}</div>
        <div class="dash-info">
          <div class="dash-label">Record personale più recente</div>
          <div class="dash-value">${recentRecordSp.name} — ${recentRecord.weight} kg</div>
          <div class="dash-sub">${fmtDate(recentRecord.date)}</div>
        </div>
      </div>`);
  }

  if(topSpecies){
    cards.push(`
      <div class="dash-card" onclick="openSpeciesModal('${topSpecies.id}')">
        <div class="dash-icon">${topSpecies.glyph}</div>
        <div class="dash-info">
          <div class="dash-label">Specie più catturata</div>
          <div class="dash-value">${topSpecies.name}</div>
          <div class="dash-sub">${topCount} catture</div>
        </div>
      </div>`);
  }

  if(favSpot){
    const placeCounts = {};
    favSpot.catches.forEach(c=>{ if(c.place){ placeCounts[c.place]=(placeCounts[c.place]||0)+1; } });
    let mostPlace=null, n=0;
    Object.entries(placeCounts).forEach(([p,c])=>{ if(c>n){ n=c; mostPlace=p; } });
    cards.push(`
      <div class="dash-card" onclick="switchTab('map')">
        <div class="dash-icon">📍</div>
        <div class="dash-info">
          <div class="dash-label">Spot preferito</div>
          <div class="dash-value">${mostPlace || fmtCoords(favSpot.lat, favSpot.lng)}</div>
          <div class="dash-sub">${favSpotStat.count} catture qui</div>
        </div>
      </div>`);
  }

  if(recentUnlock){
    cards.push(`
      <div class="dash-card" onclick="openSpeciesModal('${recentUnlock.s.id}')">
        <div class="dash-icon">${recentUnlock.stat.photo?`<img src="${recentUnlock.stat.photo}">`:recentUnlock.s.glyph}</div>
        <div class="dash-info">
          <div class="dash-label">Specie sbloccata più di recente</div>
          <div class="dash-value">${recentUnlock.s.name}</div>
          <div class="dash-sub">${fmtDate(recentUnlock.stat.firstDate)}</div>
        </div>
      </div>`);
  }

  container.innerHTML = `
    <div class="dash-grid-2">
      <div class="summary-card"><div class="num">${avgWeight? avgWeight.toFixed(2):'—'}</div><div class="lbl">Peso medio (kg)</div></div>
      <div class="summary-card"><div class="num">${outingsThisYear}</div><div class="lbl">Uscite ${currentYear}</div></div>
    </div>
    ${cards.join('')}
  `;
}

/* ===================== RICERCA AVANZATA DIARIO ===================== */

let diarioFilters = {speciesId:'', year:'', month:'', place:'', bait:'', weightMin:'', weightMax:'', lengthMin:'', lengthMax:'', onlyPhoto:false};

let diarioFiltersOpen = false;

const MONTH_NAMES = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

function distinctPlaces(){ return [...new Set(data.catches.map(c=>c.place).filter(Boolean))].sort((a,b)=>a.localeCompare(b)); }

function distinctBaits(){ return [...new Set(data.catches.map(c=>c.bait).filter(Boolean))].sort((a,b)=>a.localeCompare(b)); }

function distinctYears(){ return [...new Set(data.catches.map(c=>c.date.slice(0,4)))].sort((a,b)=>b.localeCompare(a)); }

function activeFilterCount(){
  const f = diarioFilters;
  let n = 0;
  ['speciesId','year','month','place','bait','weightMin','weightMax','lengthMin','lengthMax'].forEach(k=>{ if(f[k]) n++; });
  if(f.onlyPhoto) n++;
  return n;
}

function getFilteredDiarioCatches(){
  let list = [...data.catches];
  const f = diarioFilters;
  if(f.speciesId) list = list.filter(c=>c.speciesId===f.speciesId);
  if(f.year) list = list.filter(c=>c.date.slice(0,4)===f.year);
  if(f.month) list = list.filter(c=>c.date.slice(5,7)===f.month);
  if(f.place) list = list.filter(c=>c.place===f.place);
  if(f.bait) list = list.filter(c=>c.bait===f.bait);
  if(f.weightMin) list = list.filter(c=> parseFloat(c.weight)>=parseFloat(f.weightMin));
  if(f.weightMax) list = list.filter(c=> parseFloat(c.weight)<=parseFloat(f.weightMax));
  if(f.lengthMin) list = list.filter(c=> parseFloat(c.length)>=parseFloat(f.lengthMin));
  if(f.lengthMax) list = list.filter(c=> parseFloat(c.length)<=parseFloat(f.lengthMax));
  if(f.onlyPhoto) list = list.filter(c=>!!c.photo);
  return list.sort((a,b)=> b.date.localeCompare(a.date));
}

function toggleDiarioFilters(){
  diarioFiltersOpen = !diarioFiltersOpen;
  renderDiarioFilterPanel();
}

let _diarioFilterDebounce = null;
function setDiarioFilter(key, value){
  diarioFilters[key] = value;
  clearTimeout(_diarioFilterDebounce);
  _diarioFilterDebounce = setTimeout(()=>{
    renderDiarioCatchList();
    updateFilterToggleLabel();
  }, 200);
}

function toggleDiarioOnlyPhoto(){
  diarioFilters.onlyPhoto = !diarioFilters.onlyPhoto;
  renderDiarioFilterPanel();
  renderDiarioCatchList();
}

function resetDiarioFilters(){
  diarioFilters = {speciesId:'', year:'', month:'', place:'', bait:'', weightMin:'', weightMax:'', lengthMin:'', lengthMax:'', onlyPhoto:false};
  renderDiarioFilterPanel();
  renderDiarioCatchList();
}

function updateFilterToggleLabel(){
  const n = activeFilterCount();
  const btn = document.getElementById('filterToggleLabel');
  if(btn) btn.textContent = n>0 ? `🔍 Filtri (${n})` : '🔍 Filtri';
}

function renderDiarioFilterPanel(){
  const panel = document.getElementById('diarioFilterPanel');
  updateFilterToggleLabel();
  if(!diarioFiltersOpen){ panel.style.display = 'none'; panel.innerHTML=''; return; }
  panel.style.display = 'block';
  const f = diarioFilters;
  const speciesOptions = [...SPECIES_DB].sort((a,b)=>a.name.localeCompare(b.name)).map(s=>`<option value="${s.id}" ${f.speciesId===s.id?'selected':''}>${s.glyph} ${s.name}</option>`).join('');
  const yearOptions = distinctYears().map(y=>`<option value="${y}" ${f.year===y?'selected':''}>${y}</option>`).join('');
  const monthOptions = MONTH_NAMES.map((m,i)=>{ const v = String(i+1).padStart(2,'0'); return `<option value="${v}" ${f.month===v?'selected':''}>${m}</option>`; }).join('');
  const placeOptions = distinctPlaces().map(p=>`<option value="${p}" ${f.place===p?'selected':''}>${p}</option>`).join('');
  const baitOptions = distinctBaits().map(b=>`<option value="${b}" ${f.bait===b?'selected':''}>${b}</option>`).join('');

  panel.innerHTML = `
    <div class="field">
      <label>Specie</label>
      <select onchange="setDiarioFilter('speciesId', this.value)">
        <option value="">Tutte le specie</option>
        ${speciesOptions}
      </select>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Anno</label>
        <select onchange="setDiarioFilter('year', this.value)">
          <option value="">Tutti</option>
          ${yearOptions}
        </select>
      </div>
      <div class="field">
        <label>Mese</label>
        <select onchange="setDiarioFilter('month', this.value)">
          <option value="">Tutti</option>
          ${monthOptions}
        </select>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Luogo</label>
        <select onchange="setDiarioFilter('place', this.value)">
          <option value="">Tutti</option>
          ${placeOptions}
        </select>
      </div>
      <div class="field">
        <label>Esca</label>
        <select onchange="setDiarioFilter('bait', this.value)">
          <option value="">Tutte</option>
          ${baitOptions}
        </select>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Peso minimo (kg)</label>
        <input type="number" step="0.01" min="0" value="${f.weightMin}" oninput="setDiarioFilter('weightMin', this.value)">
      </div>
      <div class="field">
        <label>Peso massimo (kg)</label>
        <input type="number" step="0.01" min="0" value="${f.weightMax}" oninput="setDiarioFilter('weightMax', this.value)">
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Lunghezza minima (cm)</label>
        <input type="number" step="0.5" min="0" value="${f.lengthMin}" oninput="setDiarioFilter('lengthMin', this.value)">
      </div>
      <div class="field">
        <label>Lunghezza massima (cm)</label>
        <input type="number" step="0.5" min="0" value="${f.lengthMax}" oninput="setDiarioFilter('lengthMax', this.value)">
      </div>
    </div>
    <div class="pokedex-filters" style="margin:0 0 12px;">
      <button class="filter-chip ${f.onlyPhoto?'active':''}" onclick="toggleDiarioOnlyPhoto()">📷 Solo con foto</button>
    </div>
    <button class="btn btn-secondary" onclick="resetDiarioFilters()">Reimposta filtri</button>
  `;
}

function renderDiarioCatchList(){
  const list = document.getElementById('catchList');
  const catches = getFilteredDiarioCatches();
  const countLabel = document.getElementById('diarioResultCount');
  if(countLabel){
    countLabel.textContent = activeFilterCount()>0 ? `${catches.length} risultat${catches.length===1?'o':'i'}` : '';
  }
  if(catches.length===0){
    list.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12s4-6 10-6c4 0 7 3 10 6-3 3-6 6-10 6-6 0-10-6-10-6Z"/></svg>
        <p>${activeFilterCount()>0 ? 'Nessuna cattura corrisponde ai filtri.' : 'Nessuna cattura registrata.<br>Tocca il pulsante + per aggiungere la tua prima uscita.'}</p>
      </div>`;
    return;
  }
  list.innerHTML = catches.map(c=>{
    const sp = speciesById(c.speciesId) || {name:c.speciesName||'Sconosciuta', glyph:'🐟'};
    const thumb = c.photo ? `<img src="${c.photo}" alt="" loading="lazy">` : sp.glyph;
    const metaBits = [];
    if(c.weight) metaBits.push(`⚖️ ${c.weight} kg`);
    if(c.length) metaBits.push(`📏 ${c.length} cm`);
    if(c.place) metaBits.push(`📍 ${c.place}`);
    if(c.weatherTemp!=null && c.weatherCode!=null) metaBits.push(`${weatherEmoji(c.weatherCode)} ${c.weatherTemp}°`);
    if(c.moonPhase) metaBits.push(`${(MOON_PHASES.find(m=>m.name===c.moonPhase)||{}).emoji||'🌙'} ${c.moonPhase}`);
    if(c.seaState) metaBits.push(`🌊 ${c.seaState}`);
    if(c.windSpeed!=null) metaBits.push(`💨 ${Math.round(c.windSpeed)} km/h${c.windDir!=null?' '+windCompass(c.windDir):''}`);
    return `
      <div class="catch-card" onclick="openCatchModal('${c.id}')">
        <div class="catch-thumb">${thumb}</div>
        <div class="catch-info">
          <div class="row1">
            <div class="species">${sp.name}</div>
            <div class="date">${fmtDate(c.date)}</div>
          </div>
          <div class="meta">${metaBits.map(m=>`<span>${m}</span>`).join('')}</div>
        </div>
      </div>`;
  }).join('');
}

/* ===================== GALLERIA ===================== */

let galleryFilters = {speciesId:'', year:'', place:''};

function getGalleryPhotos(){
  let list = data.catches.filter(c=>c.photo);
  const f = galleryFilters;
  if(f.speciesId) list = list.filter(c=>c.speciesId===f.speciesId);
  if(f.year) list = list.filter(c=>c.date.slice(0,4)===f.year);
  if(f.place) list = list.filter(c=>c.place===f.place);
  return list.sort((a,b)=> b.date.localeCompare(a.date));
}

function setGalleryFilter(key, value){
  galleryFilters[key] = value;
  renderGalleryGrid();
}

function renderGalleryFilters(){
  const panel = document.getElementById('galleryFilters');
  const f = galleryFilters;
  const photoSpeciesIds = new Set(data.catches.filter(c=>c.photo).map(c=>c.speciesId));
  const speciesOptions = allSpecies().filter(s=>photoSpeciesIds.has(s.id)).sort((a,b)=>a.name.localeCompare(b.name))
    .map(s=>`<option value="${s.id}" ${f.speciesId===s.id?'selected':''}>${s.glyph||'🐟'} ${s.name}</option>`).join('');
  const yearOptions = distinctYears().map(y=>`<option value="${y}" ${f.year===y?'selected':''}>${y}</option>`).join('');
  const placeOptions = distinctPlaces().map(p=>`<option value="${p}" ${f.place===p?'selected':''}>${p}</option>`).join('');
  panel.innerHTML = `
    <div class="field-row">
      <div class="field">
        <label>Specie</label>
        <select onchange="setGalleryFilter('speciesId', this.value)">
          <option value="">Tutte</option>
          ${speciesOptions}
        </select>
      </div>
      <div class="field">
        <label>Anno</label>
        <select onchange="setGalleryFilter('year', this.value)">
          <option value="">Tutti</option>
          ${yearOptions}
        </select>
      </div>
    </div>
    <div class="field">
      <label>Luogo</label>
      <select onchange="setGalleryFilter('place', this.value)">
        <option value="">Tutti</option>
        ${placeOptions}
      </select>
    </div>
  `;
}

function renderGalleryGrid(){
  const grid = document.getElementById('galleryGrid');
  const photos = getGalleryPhotos();
  if(photos.length===0){
    grid.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12s4-6 10-6c4 0 7 3 10 6-3 3-6 6-10 6-6 0-10-6-10-6Z"/></svg>
        <p>${data.catches.some(c=>c.photo) ? 'Nessuna foto corrisponde ai filtri.' : 'Nessuna foto ancora. Aggiungi una foto quando registri una cattura.'}</p>
      </div>`;
    return;
  }
  grid.innerHTML = `<div class="gallery-grid">${photos.map(c=>
    `<div class="gallery-thumb" onclick="openGalleryPhoto('${c.id}')"><img src="${c.photo}" alt="" loading="lazy"></div>`
  ).join('')}</div>`;
}

function openGalleryPhoto(id){
  const c = data.catches.find(x=>x.id===id);
  if(!c) return;
  const sp = speciesById(c.speciesId) || {name:c.speciesName||'Sconosciuta'};
  document.getElementById('galleryPhotoContent').innerHTML = `
    <img src="${c.photo}" style="width:100%;border-radius:14px;margin-bottom:14px; display:block;">
    <div class="detail-stats">
      <div class="st"><div class="v">${c.weight? c.weight+' kg':'—'}</div><div class="k">Peso</div></div>
      <div class="st"><div class="v">${c.length? c.length+' cm':'—'}</div><div class="k">Lunghezza</div></div>
      <div class="st"><div class="v">${fmtDate(c.date)}</div><div class="k">Data</div></div>
    </div>
    <div class="desc-box">
      <b>Specie:</b> ${sp.name}<br>
      <b>Luogo:</b> ${c.place || '—'}<br>
      <b>Note:</b> ${c.notes || '—'}
    </div>
  `;
  openModal('modalGalleryPhoto');
}

function renderDiario(){
  const summary = document.getElementById('summaryStrip');

  const totalW = data.catches.reduce((s,c)=> s + (parseFloat(c.weight)||0), 0);
  const speciesCaught = new Set(data.catches.map(c=>c.speciesId)).size;
  summary.innerHTML = `
    <div class="summary-card"><div class="num">${data.catches.length}</div><div class="lbl">Catture</div></div>
    <div class="summary-card"><div class="num">${speciesCaught}</div><div class="lbl">Specie</div></div>
    <div class="summary-card"><div class="num">${totalW.toFixed(1)}</div><div class="lbl">Kg totali</div></div>
  `;

  renderDashboard();
  renderConditionsCard();
  renderDailyForecastStrip();
  renderPrediction();
  renderDiarioFilterPanel();
  renderDiarioCatchList();
}

/* ===================== MODAL CATTURA ===================== */

function populateSpeciesSelect(){
  const sel = document.getElementById('fSpecies');
  let html = `<optgroup label="Specie di mare">`;
  [...SPECIES_DB].sort((a,b)=>a.name.localeCompare(b.name)).forEach(s=>{
    html += `<option value="${s.id}">${s.glyph} ${s.name}</option>`;
  });
  html += `</optgroup>`;
  if(data.customSpecies.length){
    html += `<optgroup label="Aggiunte da te">`;
    data.customSpecies.forEach(s=> html += `<option value="${s.id}">🐟 ${s.name}</option>`);
    html += `</optgroup>`;
  }
  html += `<option value="__altro">➕ Altra specie...</option>`;
  sel.innerHTML = html;
}

function openCatchModal(id){
  populateSpeciesSelect();
  const title = document.getElementById('catchModalTitle');
  const delBtn = document.getElementById('deleteCatchBtn');
  document.getElementById('fCustomSpeciesWrap').style.display = 'none';
  document.getElementById('fCustomSpecies').value = '';
  document.getElementById('weatherPreview').innerHTML = '';
  document.getElementById('fWeatherTemp').value = '';
  document.getElementById('fWeatherCode').value = '';
  document.getElementById('fWeatherPressure').value = '';
  document.getElementById('fConditions').value = '';
  document.getElementById('fAccuracy').value = '';
  showGpsAccuracy(null);
  clearTimeout(_condDebounce);
  _condReqToken++; // scarta eventuali risposte meteo ancora in volo di un'apertura precedente
  document.getElementById('photoPickerText').textContent = 'Tocca per aggiungere una foto';
  document.getElementById('photoPicker').innerHTML = `<span id="photoPickerText">Tocca per aggiungere una foto</span><input type="file" id="fPhotoInput" accept="image/*" capture="environment" style="display:none" onchange="handlePhotoInput(event)">`;

  if(id){
    const c = data.catches.find(x=>x.id===id);
    title.textContent = 'Modifica cattura';
    delBtn.style.display = 'block';
    document.getElementById('catchId').value = c.id;
    document.getElementById('fSpecies').value = SPECIES_DB.some(s=>s.id===c.speciesId) || data.customSpecies.some(s=>s.id===c.speciesId) ? c.speciesId : '__altro';
    if(document.getElementById('fSpecies').value === '__altro'){
      document.getElementById('fCustomSpeciesWrap').style.display='block';
      document.getElementById('fCustomSpecies').value = c.speciesName||'';
    }
    document.getElementById('fDate').value = c.date;
    document.getElementById('fTime').value = c.time || '';
    document.getElementById('fWeight').value = c.weight||'';
    document.getElementById('fLength').value = c.length||'';
    document.getElementById('fBait').value = c.bait||'';
    document.getElementById('fSeaState').value = c.seaState||'';
    document.getElementById('fPlace').value = c.place||'';
    document.getElementById('fLat').value = c.lat||'';
    document.getElementById('fLng').value = c.lng||'';
    document.getElementById('fWeatherTemp').value = c.weatherTemp||'';
    document.getElementById('fWeatherCode').value = c.weatherCode!=null ? c.weatherCode : '';
    document.getElementById('fWeatherPressure').value = c.pressure!=null ? c.pressure : '';
    document.getElementById('fAccuracy').value = c.accuracy!=null ? c.accuracy : '';
    showGpsAccuracy(c.accuracy);
    const extras = {};
    CONDITION_EXTRA_KEYS.forEach(k=>{ if(c[k]!==undefined) extras[k] = c[k]; });
    document.getElementById('fConditions').value = JSON.stringify(extras);
    document.getElementById('weatherPreview').innerHTML = conditionsBadgesHTML(c);
    document.getElementById('fNotes').value = c.notes||'';
    if(c.photo){
      document.getElementById('photoPicker').innerHTML = `<img src="${c.photo}"><input type="file" id="fPhotoInput" accept="image/*" capture="environment" style="display:none" onchange="handlePhotoInput(event)">`;
    }
  } else {
    title.textContent = 'Nuova cattura';
    delBtn.style.display = 'none';
    document.getElementById('catchId').value = '';
    document.getElementById('fSpecies').selectedIndex = 0;
    document.getElementById('fDate').value = localDateStr();
    document.getElementById('fTime').value = '';
    document.getElementById('fWeight').value = '';
    document.getElementById('fLength').value = '';
    document.getElementById('fBait').value = '';
    document.getElementById('fSeaState').value = '';
    document.getElementById('fPlace').value = '';
    document.getElementById('fLat').value = '';
    document.getElementById('fLng').value = '';
    document.getElementById('fNotes').value = '';
    document.getElementById('fAccuracy').value = '';
  }
  document.getElementById('fSpecies').onchange = (e)=>{
    document.getElementById('fCustomSpeciesWrap').style.display = e.target.value==='__altro' ? 'block' : 'none';
  };
  refreshConditionsBtn();
  openModal('modalCatch');
}

function handlePhotoInput(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = function(ev){
    const img = new Image();
    img.onload = function(){
      const maxDim = 640;
      let w = img.width, h = img.height;
      if(w>h && w>maxDim){ h = h*maxDim/w; w=maxDim; }
      else if(h>=w && h>maxDim){ w = w*maxDim/h; h=maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width=w; canvas.height=h;
      canvas.getContext('2d').drawImage(img,0,0,w,h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
      document.getElementById('photoPicker').innerHTML = `<img src="${dataUrl}"><input type="file" id="fPhotoInput" accept="image/*" capture="environment" style="display:none" onchange="handlePhotoInput(event)">`;
      document.getElementById('photoPicker').dataset.photo = dataUrl;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

/* Open-Meteo: API meteo gratuita, senza chiave, CORS abilitato */

function saveCatch(){
  const speciesSel = document.getElementById('fSpecies').value;
  const date = document.getElementById('fDate').value;
  if(!date){ toast('Inserisci una data'); return; }

  let speciesId = speciesSel;
  let speciesName = null;
  if(speciesSel === '__altro'){
    const customName = document.getElementById('fCustomSpecies').value.trim();
    if(!customName){ toast('Inserisci il nome della specie'); return; }
    let existing = data.customSpecies.find(s=>s.name.toLowerCase()===customName.toLowerCase());
    if(!existing){
      existing = {id:'custom_'+uid(), name:customName};
      data.customSpecies.push(existing);
    }
    speciesId = existing.id;
    speciesName = existing.name;
  }

  const photoEl = document.getElementById('photoPicker').querySelector('img');
  const id = document.getElementById('catchId').value;
  const isNewCatch = !id;
  const wasSpeciesUnlocked = data.catches.some(c=>c.speciesId===speciesId);
  let extras = {};
  try{
    const parsed = JSON.parse(document.getElementById('fConditions').value || '{}') || {};
    CONDITION_EXTRA_KEYS.forEach(k=>{ if(parsed[k]!==undefined) extras[k] = parsed[k]; }); // solo i campi previsti, mai altro
  }catch(e){ extras = {}; }
  const timeVal = document.getElementById('fTime').value || null;
  const timeHour = timeVal ? parseInt(timeVal.slice(0,2),10) + parseInt(timeVal.slice(3,5),10)/60 : null;
  const record = {
    id: id || uid(),
    speciesId, speciesName,
    date,
    weight: document.getElementById('fWeight').value,
    time: timeVal,
    length: document.getElementById('fLength').value,
    bait: document.getElementById('fBait').value,
    seaState: document.getElementById('fSeaState').value || null,
    moonPhase: moonPhaseForDate(date, timeHour).name,
    accuracy: document.getElementById('fAccuracy').value !== '' ? parseFloat(document.getElementById('fAccuracy').value) : null,
    ...extras,
    place: document.getElementById('fPlace').value,
    lat: document.getElementById('fLat').value ? parseFloat(document.getElementById('fLat').value) : null,
    lng: document.getElementById('fLng').value ? parseFloat(document.getElementById('fLng').value) : null,
    weatherTemp: document.getElementById('fWeatherTemp').value || null,
    weatherCode: document.getElementById('fWeatherCode').value !== '' ? parseInt(document.getElementById('fWeatherCode').value) : null,
    pressure: document.getElementById('fWeatherPressure').value !== '' ? parseFloat(document.getElementById('fWeatherPressure').value) : null,
    notes: document.getElementById('fNotes').value,
    photo: photoEl ? photoEl.src : null,
  };

  if(id){
    const idx = data.catches.findIndex(c=>c.id===id);
    data.catches[idx] = record;
    toast('Cattura aggiornata');
  } else {
    data.catches.push(record);
    toast('Cattura salvata 🎣');
  }
  saveData();
  closeModal('modalCatch');
  refreshCurrentView();
  if(isNewCatch && !wasSpeciesUnlocked){
    setTimeout(()=> showUnlockAnimation(speciesId), 350);
  }
}

function deleteCatch(){
  const id = document.getElementById('catchId').value;
  if(!id) return;
  if(!confirm('Eliminare questa cattura?')) return;
  data.catches = data.catches.filter(c=>c.id!==id);
  saveData();
  closeModal('modalCatch');
  toast('Cattura eliminata');
  refreshCurrentView();
}

function refreshCurrentView(){
  if(currentTab==='diario') renderDiario();
  if(currentTab==='pokedex') renderPokedex();
  if(currentTab==='stats') renderStats();
  if(currentTab==='map') renderMap();
}

/* ===================== MODALI GENERICI ===================== */

function openModal(id){ document.getElementById(id).classList.add('open'); }

function closeModal(id){ document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-backdrop').forEach(m=>{
  m.addEventListener('click', e=>{ if(e.target===m) closeModal(m.id); });
});

function openSettings(){ openModal('modalSettings'); }
