/* =====================================================================
   STATS.JS — Grafici (Chart.js) e analisi automatica dei dati salvati.
   ===================================================================== */

let chartSpecies = null, chartByYear = null;

/* ===================== STATS ===================== */

/* ===================== ANALISI AUTOMATICA ===================== */

const WEEKDAY_NAMES_IT = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];

function timeBucket(timeStr){
  if(!timeStr) return null;
  const h = parseInt(timeStr.split(':')[0], 10);
  if(isNaN(h)) return null;
  if(h>=5 && h<12) return 'Mattina';
  if(h>=12 && h<18) return 'Pomeriggio';
  if(h>=18 && h<24) return 'Sera';
  return 'Notte';
}

/* Fasce di vento (km/h) e raggruppamenti per condizione registrata (pressione, vento, marea) */
const WIND_BUCKET_LABELS = {
  calmo: 'vento calmo (sotto 10 km/h)',
  debole: 'vento debole (10–20 km/h)',
  moderato: 'vento moderato (20–30 km/h)',
  forte: 'vento forte (oltre 30 km/h)',
};
function windBucketFor(kmh){
  if(kmh < 10) return 'calmo';
  if(kmh < 20) return 'debole';
  if(kmh < 30) return 'moderato';
  return 'forte';
}
function capitalize(s){ return s.charAt(0).toUpperCase() + s.slice(1); }

/* chiave di raggruppamento di una cattura: null se il dato non è stato registrato */
function pressureKeyOf(c){ const i = pressureTrendInfo(numOrNull(c.pressureTrend)); return i ? i.text : null; }
function windKeyOf(c){ const v = numOrNull(c.windSpeed); return v==null ? null : windBucketFor(v); }
function tideKeyOf(c){ return c.tideState || null; }

/* gruppo con peso medio più alto (almeno minCount catture con peso), come per meteo e stato del mare */
function bestGroupByAvgWeight(catches, keyFn, minCount){
  const groups = {};
  catches.forEach(c=>{ const k = keyFn(c); if(k){ (groups[k] = groups[k] || []).push(c); } });
  let best = null;
  Object.entries(groups).forEach(([k,list])=>{
    if(list.length < minCount) return;
    const w = list.map(c=>parseFloat(c.weight)).filter(x=>!isNaN(x) && x>0);
    if(w.length===0) return;
    const avg = w.reduce((a,x)=>a+x,0) / w.length;
    if(!best || avg > best.avg) best = {key:k, avg, count:list.length};
  });
  return best;
}

function computeAnalysis(){
  const catches = data.catches;
  if(catches.length===0) return null;

  const speciesCounts = {};
  catches.forEach(c=> speciesCounts[c.speciesId] = (speciesCounts[c.speciesId]||0)+1);
  let topSpeciesId=null, topCount=0;
  Object.entries(speciesCounts).forEach(([sid,n])=>{ if(n>topCount){ topCount=n; topSpeciesId=sid; } });
  const topSpecies = topSpeciesId ? speciesById(topSpeciesId) : null;

  const monthCounts = {};
  catches.forEach(c=>{ const m=c.date.slice(5,7); monthCounts[m]=(monthCounts[m]||0)+1; });
  let bestMonthNum=null, bestMonthCount=0;
  Object.entries(monthCounts).forEach(([m,n])=>{ if(n>bestMonthCount){ bestMonthCount=n; bestMonthNum=m; } });
  const bestMonthName = bestMonthNum ? MONTH_NAMES[parseInt(bestMonthNum,10)-1] : null;

  const weekdayCounts = {};
  catches.forEach(c=>{ const wd = new Date(c.date+'T12:00:00').getDay(); weekdayCounts[wd]=(weekdayCounts[wd]||0)+1; });
  let bestWeekdayNum=null, bestWeekdayCount=0;
  Object.entries(weekdayCounts).forEach(([wd,n])=>{ if(n>bestWeekdayCount){ bestWeekdayCount=n; bestWeekdayNum=parseInt(wd,10); } });
  const bestWeekdayName = bestWeekdayNum!=null ? WEEKDAY_NAMES_IT[bestWeekdayNum] : null;

  const baitGroups = {};
  catches.forEach(c=>{ if(c.bait && c.bait.trim()){ const b=c.bait.trim(); if(!baitGroups[b]) baitGroups[b]=[]; baitGroups[b].push(c); } });
  let bestBaitName=null, bestBaitAvg=null, bestBaitCount=0;
  Object.entries(baitGroups).forEach(([b,list])=>{
    const weights = list.map(c=>parseFloat(c.weight)).filter(w=>!isNaN(w)&&w>0);
    if(weights.length===0 || list.length<2) return;
    const avg = weights.reduce((a,x)=>a+x,0)/weights.length;
    if(bestBaitAvg===null || avg>bestBaitAvg){ bestBaitAvg=avg; bestBaitName=b; bestBaitCount=list.length; }
  });
  if(!bestBaitName){
    let maxN=0;
    Object.entries(baitGroups).forEach(([b,list])=>{ if(list.length>maxN){ maxN=list.length; bestBaitName=b; bestBaitCount=list.length; } });
  }

  const avgWeightPerSpecies = allSpecies().map(s=>{
    const list = catches.filter(c=>c.speciesId===s.id);
    const weights = list.map(c=>parseFloat(c.weight)).filter(w=>!isNaN(w)&&w>0);
    const lengths = list.map(c=>parseFloat(c.length)).filter(l=>!isNaN(l)&&l>0);
    if(weights.length===0 && lengths.length===0) return null;
    return {
      s,
      avg: weights.length ? weights.reduce((a,x)=>a+x,0)/weights.length : null,
      avgLength: lengths.length ? lengths.reduce((a,x)=>a+x,0)/lengths.length : null,
      count: list.length
    };
  }).filter(Boolean).sort((a,b)=> (b.avg||0)-(a.avg||0));

  const heaviestSpecies = avgWeightPerSpecies.find(x=>x.avg!=null) || null;

  const geo = catches.filter(c=>c.lat && c.lng);
  let bestSpot=null, bestSpotStat=null, bestSpotPlace=null;
  if(geo.length){
    const spots = buildSpots(geo);
    bestSpot = spots.reduce((a,b)=> (b.catches.length > (a?a.catches.length:0)) ? b : a, null);
    if(bestSpot){
      bestSpotStat = spotStats(bestSpot);
      const placeCounts = {};
      bestSpot.catches.forEach(c=>{ if(c.place){ placeCounts[c.place]=(placeCounts[c.place]||0)+1; } });
      let n=0;
      Object.entries(placeCounts).forEach(([p,c])=>{ if(c>n){ n=c; bestSpotPlace=p; } });
    }
  }

  const yearCounts = {};
  catches.forEach(c=>{ const y=c.date.slice(0,4); yearCounts[y]=(yearCounts[y]||0)+1; });
  const years = Object.keys(yearCounts).sort();

  // mese/i migliore/i: se il secondo mese è vicino al primo (>=70%), li mostriamo entrambi come intervallo
  const monthEntries = Object.entries(monthCounts).sort((a,b)=>b[1]-a[1]);
  let bestMonths = [];
  if(monthEntries.length){
    bestMonths.push(MONTH_NAMES[parseInt(monthEntries[0][0],10)-1]);
    if(monthEntries[1] && monthEntries[1][1] >= monthEntries[0][1]*0.7){
      bestMonths.push(MONTH_NAMES[parseInt(monthEntries[1][0],10)-1]);
    }
  }

  const timeGroups = {};
  catches.forEach(c=>{ const tb=timeBucket(c.time); if(tb){ if(!timeGroups[tb]) timeGroups[tb]=[]; timeGroups[tb].push(c); } });
  let bestTimeBucket=null, bestTimeAvg=null;
  Object.entries(timeGroups).forEach(([tb,list])=>{
    const weights = list.map(c=>parseFloat(c.weight)).filter(w=>!isNaN(w)&&w>0);
    if(weights.length>=3){
      const avg = weights.reduce((a,x)=>a+x,0)/weights.length;
      if(bestTimeAvg===null || avg>bestTimeAvg){ bestTimeAvg=avg; bestTimeBucket=tb; }
    }
  });
  let bestTimeBucketByCount=null, bestTimeBucketCount=0;
  Object.entries(timeGroups).forEach(([tb,list])=>{
    if(list.length>bestTimeBucketCount){ bestTimeBucketCount=list.length; bestTimeBucketByCount=tb; }
  });

  // meteo più favorevole: tra le condizioni registrate (min 2 catture), quella col peso medio più alto
  const weatherGroups = {};
  catches.forEach(c=>{
    if(c.weatherCode!=null){
      const label = weatherLabel(c.weatherCode);
      if(!weatherGroups[label]) weatherGroups[label]=[];
      weatherGroups[label].push(c);
    }
  });
  let bestWeatherLabel=null, bestWeatherAvg=null, bestWeatherCount=0;
  Object.entries(weatherGroups).forEach(([label,list])=>{
    if(list.length<2) return;
    const weights = list.map(c=>parseFloat(c.weight)).filter(w=>!isNaN(w)&&w>0);
    if(weights.length===0) return;
    const avg = weights.reduce((a,x)=>a+x,0)/weights.length;
    if(bestWeatherAvg===null || avg>bestWeatherAvg){ bestWeatherAvg=avg; bestWeatherLabel=label; bestWeatherCount=list.length; }
  });

  // stato del mare più favorevole in assoluto, e per la specie più catturata
  const seaStateGroups = {};
  catches.forEach(c=>{ if(c.seaState){ if(!seaStateGroups[c.seaState]) seaStateGroups[c.seaState]=[]; seaStateGroups[c.seaState].push(c); } });
  let bestSeaState=null, bestSeaStateAvg=null;
  Object.entries(seaStateGroups).forEach(([ss,list])=>{
    if(list.length<2) return;
    const weights = list.map(c=>parseFloat(c.weight)).filter(w=>!isNaN(w)&&w>0);
    if(weights.length===0) return;
    const avg = weights.reduce((a,x)=>a+x,0)/weights.length;
    if(bestSeaStateAvg===null || avg>bestSeaStateAvg){ bestSeaStateAvg=avg; bestSeaState=ss; }
  });
  let topSpeciesSeaState = null;
  if(topSpecies){
    const tsc = catches.filter(c=>c.speciesId===topSpeciesId && c.seaState);
    const ssc = {};
    tsc.forEach(c=>{ ssc[c.seaState]=(ssc[c.seaState]||0)+1; });
    let best=null, bestN=0;
    Object.entries(ssc).forEach(([ss,n])=>{ if(n>bestN){ bestN=n; best=ss; } });
    if(best && tsc.length>=2){ topSpeciesSeaState = {seaState:best, pct: Math.round(bestN/tsc.length*100)}; }
  }

  let topSpeciesBaitPct = null;
  if(topSpecies){
    const topSpeciesCatches = catches.filter(c=>c.speciesId===topSpeciesId);
    const bc = {};
    topSpeciesCatches.forEach(c=>{ if(c.bait && c.bait.trim()){ const b=c.bait.trim(); bc[b]=(bc[b]||0)+1; } });
    let tb=null, tbN=0;
    Object.entries(bc).forEach(([b,n])=>{ if(n>tbN){ tbN=n; tb=b; } });
    if(tb){ topSpeciesBaitPct = {bait:tb, pct: Math.round(tbN/topSpeciesCatches.length*100)}; }
  }

  const bestPressure = bestGroupByAvgWeight(catches, pressureKeyOf, 2);
  const bestWind = bestGroupByAvgWeight(catches, windKeyOf, 2);
  const bestTide = bestGroupByAvgWeight(catches, tideKeyOf, 2);

  return {bestPressure, bestWind, bestTide, topSpecies, topCount, bestMonthName, bestMonthCount, bestMonths, bestWeekdayName, bestWeekdayCount,
    bestBaitName, bestBaitAvg, bestBaitCount, avgWeightPerSpecies, heaviestSpecies, bestSpot, bestSpotStat, bestSpotPlace,
    yearCounts, years, weekdayCounts, bestTimeBucket, bestTimeBucketByCount, bestWeatherLabel, bestWeatherAvg, bestWeatherCount,
    bestSeaState, bestSeaStateAvg, topSpeciesSeaState, topSpeciesBaitPct};
}

function renderAnalysis(){
  const highlights = document.getElementById('analysisHighlights');
  const avgTable = document.getElementById('avgWeightTable');
  const insightsBox = document.getElementById('analysisInsights');
  const a = computeAnalysis();

  if(!a){
    highlights.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12s4-6 10-6c4 0 7 3 10 6-3 3-6 6-10 6-6 0-10-6-10-6Z"/></svg>
        <p>Registra qualche cattura per vedere qui la tua analisi automatica.</p>
      </div>`;
    avgTable.innerHTML = '';
    insightsBox.innerHTML = '';
    if(chartByYear){ chartByYear.destroy(); chartByYear=null; }
    return;
  }

  const favCard = (icon, label, best, fmt) => `
    <div class="dash-card"><div class="dash-icon">${icon}</div><div class="dash-info"><div class="dash-label">${label}</div><div class="dash-value">${best ? fmt(best.key) : '—'}</div><div class="dash-sub">${best ? best.avg.toFixed(2)+' kg medi · '+best.count+' catture' : 'servono più catture con posizione GPS'}</div></div></div>`;

  highlights.innerHTML = `
    <div class="dash-card"><div class="dash-icon">${a.topSpecies?a.topSpecies.glyph:'🐟'}</div><div class="dash-info"><div class="dash-label">Specie più catturata</div><div class="dash-value">${a.topSpecies?a.topSpecies.name:'—'}</div><div class="dash-sub">${a.topCount} catture</div></div></div>
    <div class="dash-card"><div class="dash-icon">🏋️</div><div class="dash-info"><div class="dash-label">Specie più pesante (media)</div><div class="dash-value">${a.heaviestSpecies? a.heaviestSpecies.s.name : '—'}</div><div class="dash-sub">${a.heaviestSpecies? a.heaviestSpecies.avg.toFixed(2)+' kg medi' : '—'}</div></div></div>
    <div class="dash-card"><div class="dash-icon">📅</div><div class="dash-info"><div class="dash-label">Mese migliore</div><div class="dash-value">${a.bestMonths.length? a.bestMonths.join(' – ') : '—'}</div><div class="dash-sub">${a.bestMonthCount||0} catture</div></div></div>
    <div class="dash-card"><div class="dash-icon">⏰</div><div class="dash-info"><div class="dash-label">Orario migliore</div><div class="dash-value">${a.bestTimeBucketByCount||'—'}</div><div class="dash-sub">${a.bestTimeBucketByCount? 'la fascia con più catture':'servono orari registrati'}</div></div></div>
    <div class="dash-card"><div class="dash-icon">🪱</div><div class="dash-info"><div class="dash-label">Esca più efficace</div><div class="dash-value">${a.bestBaitName||'—'}</div><div class="dash-sub">${a.bestBaitAvg? a.bestBaitAvg.toFixed(2)+' kg medi · '+a.bestBaitCount+' catture' : (a.bestBaitCount? a.bestBaitCount+' catture' : '—')}</div></div></div>
    <div class="dash-card"><div class="dash-icon">${a.bestWeatherLabel? weatherEmojiByLabel(a.bestWeatherLabel) : '🌤️'}</div><div class="dash-info"><div class="dash-label">Meteo più favorevole</div><div class="dash-value">${a.bestWeatherLabel||'—'}</div><div class="dash-sub">${a.bestWeatherAvg? a.bestWeatherAvg.toFixed(2)+' kg medi · '+a.bestWeatherCount+' catture' : 'servono più dati meteo'}</div></div></div>
    <div class="dash-card"><div class="dash-icon">🌊</div><div class="dash-info"><div class="dash-label">Stato del mare più favorevole</div><div class="dash-value">${a.bestSeaState||'—'}</div><div class="dash-sub">${a.bestSeaStateAvg? a.bestSeaStateAvg.toFixed(2)+' kg medi':'servono più dati'}</div></div></div>
    ${favCard('🧭', 'Pressione più favorevole', a.bestPressure, k=>'Pressione '+k)}
    ${favCard('💨', 'Vento più favorevole', a.bestWind, k=>capitalize(WIND_BUCKET_LABELS[k]||k))}
    ${favCard('〰️', 'Marea più favorevole', a.bestTide, k=>'Marea '+escapeHtml(k))}
    <div class="dash-card" onclick="switchTab('map')"><div class="dash-icon">📍</div><div class="dash-info"><div class="dash-label">Spot più produttivo</div><div class="dash-value">${a.bestSpotPlace || (a.bestSpot? fmtCoords(a.bestSpot.lat,a.bestSpot.lng):'—')}</div><div class="dash-sub">${a.bestSpotStat? a.bestSpotStat.count+' catture qui':'—'}</div></div></div>
  `;

  if(a.avgWeightPerSpecies.length===0){
    avgTable.innerHTML = `<tr><td style="color:var(--ink-soft); padding:10px 0;">Ancora nessun peso o lunghezza registrati.</td></tr>`;
  } else {
    avgTable.innerHTML = `
      <tr><th>Specie</th><th>Peso medio</th><th>Lung. media</th><th>Catture</th></tr>
      ${a.avgWeightPerSpecies.map(x=>`<tr><td>${x.s.glyph} ${x.s.name}</td><td>${x.avg? x.avg.toFixed(2)+' kg':'—'}</td><td>${x.avgLength? x.avgLength.toFixed(1)+' cm':'—'}</td><td>${x.count}</td></tr>`).join('')}
    `;
  }

  const ctxY = document.getElementById('chartByYear').getContext('2d');
  if(chartByYear) chartByYear.destroy();
  chartByYear = new Chart(ctxY, {
    type:'line',
    data:{ labels: a.years, datasets:[{ data: a.years.map(y=>a.yearCounts[y]), borderColor:'#1C6E8C', backgroundColor:'rgba(28,110,140,0.15)', fill:true, tension:0.3, pointBackgroundColor:'#1C6E8C' }]},
    options:{ plugins:{legend:{display:false}}, scales:{ y:{beginAtZero:true, ticks:{precision:0,color:'#5B6660'}, grid:{color:'#E3D6BC'}}, x:{ticks:{color:'#5B6660'}, grid:{display:false}} } }
  });

  const insights = [];
  if(a.topSpeciesBaitPct && a.topSpecies){
    insights.push(`Hai catturato il <b>${a.topSpeciesBaitPct.pct}%</b> delle ${a.topSpecies.name.toLowerCase()} con <b>${a.topSpeciesBaitPct.bait}</b>.`);
  }
  if(a.topSpeciesSeaState && a.topSpecies){
    insights.push(`Le ${a.topSpecies.name.toLowerCase()} sono state catturate principalmente con mare <b>${a.topSpeciesSeaState.seaState.toLowerCase()}</b> (${a.topSpeciesSeaState.pct}% delle volte).`);
  }
  if(a.bestMonths.length){
    insights.push(`Le tue uscite migliori sono state ${a.bestMonths.length>1 ? 'tra <b>'+a.bestMonths[0]+'</b> e <b>'+a.bestMonths[1]+'</b>' : 'in <b>'+a.bestMonths[0]+'</b>'}.`);
  }
  if(a.bestWeatherLabel){
    insights.push(`Con il meteo <b>${a.bestWeatherLabel.toLowerCase()}</b> ottieni le catture più pesanti in media.`);
  }
  if(a.bestPressure){
    insights.push(`Con pressione <b>${a.bestPressure.key}</b> ottieni le catture più pesanti in media (${a.bestPressure.count} catture).`);
  }
  if(a.bestWind){
    insights.push(`Il peso medio è più alto con <b>${WIND_BUCKET_LABELS[a.bestWind.key]||a.bestWind.key}</b> (${a.bestWind.count} catture).`);
  }
  if(a.bestTide){
    insights.push(`Le catture più pesanti arrivano con marea <b>${escapeHtml(a.bestTide.key)}</b> (${a.bestTide.count} catture).`);
  }
  if(a.bestSpotPlace || a.bestSpot){
    insights.push(`Lo spot più produttivo è <b>${a.bestSpotPlace || fmtCoords(a.bestSpot.lat,a.bestSpot.lng)}</b>.`);
  }
  if(a.bestTimeBucket){
    const label = a.bestTimeBucket==='Mattina' ? 'di mattina' : a.bestTimeBucket==='Pomeriggio' ? 'nel pomeriggio' : a.bestTimeBucket==='Sera' ? 'di sera' : 'di notte';
    insights.push(`Tendi a pescare pesci più grandi <b>${label}</b>.`);
  }

  insightsBox.innerHTML = insights.length ? `
    <div class="chart-card">
      <h3>Consigli automatici</h3>
      ${insights.map(t=>`<div class="insight-card"><div class="insight-icon">💡</div><div class="insight-text">${t}</div></div>`).join('')}
    </div>` : '';
}

/* ===================== PREVISIONE: GIORNI SIMILI AI MIGLIORI ===================== */

const WEATHER_BUCKETS = {
  sereno: [0,1], nuvoloso: [2,3], nebbia: [45,48],
  pioggia: [51,53,55,61,63,65,80,81,82], neve: [71,73,75], temporale: [95,96,99]
};
function weatherBucketFor(code){
  for(const [k,codes] of Object.entries(WEATHER_BUCKETS)){ if(codes.includes(code)) return k; }
  return 'altro';
}

function computeGoodDaysProfile(){
  const catches = data.catches;
  const byDate = {};
  catches.forEach(c=>{ if(!byDate[c.date]) byDate[c.date]=[]; byDate[c.date].push(c); });
  const dates = Object.keys(byDate);
  if(dates.length < 5) return null; // dati insufficienti per un confronto affidabile

  const avgPerDay = catches.length / dates.length;
  const threshold = Math.max(2, Math.ceil(avgPerDay));
  const goodDates = dates.filter(d=>byDate[d].length >= threshold);
  if(goodDates.length === 0) return null;

  const goodCatches = goodDates.flatMap(d=>byDate[d]);

  const weatherBuckets = {};
  goodCatches.forEach(c=>{ if(c.weatherCode!=null){ const b=weatherBucketFor(c.weatherCode); weatherBuckets[b]=(weatherBuckets[b]||0)+1; } });
  let topWeatherBucket=null, topWeatherN=0;
  Object.entries(weatherBuckets).forEach(([b,n])=>{ if(n>topWeatherN){ topWeatherN=n; topWeatherBucket=b; } });

  const seaBuckets = {};
  goodCatches.forEach(c=>{ if(c.seaState){ seaBuckets[c.seaState]=(seaBuckets[c.seaState]||0)+1; } });
  let topSea=null, topSeaN=0;
  Object.entries(seaBuckets).forEach(([s,n])=>{ if(n>topSeaN){ topSeaN=n; topSea=s; } });

  const moonBuckets = {};
  goodDates.forEach(d=>{ const m = moonPhaseForDate(d).name; moonBuckets[m]=(moonBuckets[m]||0)+1; });
  let topMoon=null, topMoonN=0;
  Object.entries(moonBuckets).forEach(([m,n])=>{ if(n>topMoonN){ topMoonN=n; topMoon=m; } });

  const speciesCounts = {};
  goodCatches.forEach(c=>{ speciesCounts[c.speciesId]=(speciesCounts[c.speciesId]||0)+1; });
  const topSpeciesIds = Object.entries(speciesCounts).sort((a,b)=>b[1]-a[1]).slice(0,2).map(x=>x[0]);

  const baitCounts = {};
  goodCatches.forEach(c=>{ if(c.bait && c.bait.trim()){ const b=c.bait.trim(); baitCounts[b]=(baitCounts[b]||0)+1; } });
  const topBaitEntry = Object.entries(baitCounts).sort((a,b)=>b[1]-a[1])[0];

  /* pressione, vento e marea nei giorni buoni: servono almeno 3 catture con il dato, altrimenti il profilo non lo usa */
  const countKey = (keyFn)=>{
    const counts = {};
    goodCatches.forEach(c=>{ const k = keyFn(c); if(k) counts[k] = (counts[k]||0)+1; });
    const entries = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
    const total = entries.reduce((s,e)=>s+e[1],0);
    return (entries.length && total >= 3) ? entries[0][0] : null;
  };

  return {
    pressureBucket: countKey(pressureKeyOf),
    windBucket: countKey(windKeyOf),
    tideState: countKey(tideKeyOf),
    goodDatesCount: goodDates.length,
    weatherBucket: topWeatherBucket, weatherConfidence: topWeatherN,
    seaState: topSea, seaConfidence: topSeaN,
    moonPhase: topMoon,
    topSpecies: topSpeciesIds.map(id=>speciesById(id)).filter(Boolean),
    topBait: topBaitEntry ? topBaitEntry[0] : null,
  };
}

function favoriteSpotCoords(){
  const geo = data.catches.filter(c=>c.lat && c.lng);
  if(geo.length===0) return null;
  const spots = buildSpots(geo);
  const best = spots.reduce((a,b)=> (b.catches.length > (a?a.catches.length:0)) ? b : a, null);
  return best ? {lat:best.lat, lng:best.lng} : null;
}

/* Aggregati giornalieri dalle serie orarie: vento medio di giorno (06–20) e variazione di pressione
   su 3 ore (differenza tra le 18 e le 06, divisa per 4), confrontabili con le fasce registrate nelle catture. */
function forecastDayAggregates(wJson, date){
  if(!wJson || !wJson.hourly || !wJson.hourly.time) return {windAvg:null, pressureTrend:null};
  const h = wJson.hourly;
  const idx = hr => h.time.indexOf(`${date}T${pad2(hr)}:00`);
  let sum = 0, n = 0;
  for(let hr=6; hr<=20; hr++){
    const i = idx(hr);
    if(i>=0 && h.wind_speed_10m && h.wind_speed_10m[i]!=null){ sum += h.wind_speed_10m[i]; n++; }
  }
  const i6 = idx(6), i18 = idx(18);
  const p = h.pressure_msl;
  const trend = (p && i6>=0 && i18>=0 && p[i6]!=null && p[i18]!=null) ? Math.round((p[i18]-p[i6])/4*10)/10 : null;
  return {windAvg: n>=8 ? sum/n : null, pressureTrend: trend};
}

/* quanti fattori del profilo "giorni migliori" coincidono con un giorno previsto */
function scoreDayAgainstProfile(day, profile){
  let score = 0, available = 0;
  if(profile.weatherBucket && day.weatherCode!=null){ available++; if(weatherBucketFor(day.weatherCode)===profile.weatherBucket) score++; }
  if(profile.seaState && day.waveHeight!=null){ available++; if(seaStateFromWaveHeight(day.waveHeight)===profile.seaState) score++; }
  const moon = moonPhaseForDate(day.date).name;
  if(profile.moonPhase){ available++; if(moon===profile.moonPhase) score++; }
  if(profile.windBucket && day.windAvg!=null){ available++; if(windBucketFor(day.windAvg)===profile.windBucket) score++; }
  if(profile.pressureBucket && day.pressureTrend!=null){
    available++;
    const info = pressureTrendInfo(day.pressureTrend);
    if(info && info.text===profile.pressureBucket) score++;
  }
  return {score, available, moon};
}

async function fetchForecastDays(lat, lng, days){
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weathercode&hourly=wind_speed_10m,pressure_msl&timezone=auto&forecast_days=${days}`;
  const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&daily=wave_height_max&timezone=auto&forecast_days=${days}`;
  const [wRes, mRes] = await Promise.allSettled([fetch(weatherUrl), fetch(marineUrl)]);
  const result = [];
  let wJson=null, mJson=null;
  if(wRes.status==='fulfilled' && wRes.value.ok) wJson = await wRes.value.json();
  if(mRes.status==='fulfilled' && mRes.value.ok) mJson = await mRes.value.json();
  const dateList = (wJson && wJson.daily && wJson.daily.time) || (mJson && mJson.daily && mJson.daily.time) || [];
  dateList.forEach((date,i)=>{
    result.push({
      date,
      weatherCode: wJson ? wJson.daily.weathercode[i] : null,
      waveHeight: mJson ? mJson.daily.wave_height_max[i] : null,
      ...forecastDayAggregates(wJson, date),
    });
  });
  return result;
}

function setPredictionHTML(html){
  ['predictionCard','predictionCardHome'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.innerHTML = html;
  });
}

async function renderPrediction(){
  if(!document.getElementById('predictionCard') && !document.getElementById('predictionCardHome')) return;
  const profile = computeGoodDaysProfile();
  if(!profile){
    setPredictionHTML(`
      <div class="prediction-card neutral">
        <div class="pred-eyebrow">Previsione</div>
        <div class="pred-body">Servono almeno una decina di uscite registrate, con meteo e stato del mare, per confrontare i prossimi giorni con i tuoi giorni migliori.</div>
      </div>`);
    return;
  }
  const spot = favoriteSpotCoords();
  if(!spot){
    setPredictionHTML(`
      <div class="prediction-card neutral">
        <div class="pred-eyebrow">Previsione</div>
        <div class="pred-body">Registra almeno una cattura con posizione GPS per confrontare le previsioni sul tuo spot preferito.</div>
      </div>`);
    return;
  }
  setPredictionHTML(`<div class="prediction-card neutral"><div class="pred-eyebrow">Previsione</div><div class="pred-body">Confronto i prossimi giorni con i tuoi ${profile.goodDatesCount} giorni migliori...</div></div>`);

  let forecast;
  try{
    forecast = await fetchForecastDays(spot.lat, spot.lng, 3);
  }catch(e){
    setPredictionHTML(`<div class="prediction-card neutral"><div class="pred-eyebrow">Previsione</div><div class="pred-body">Previsioni non disponibili al momento.</div></div>`);
    return;
  }

  const todayStr = localDateStr();
  const nextDays = forecast.filter(f=>f.date > todayStr).slice(0,2);
  if(nextDays.length===0){
    setPredictionHTML(`<div class="prediction-card neutral"><div class="pred-eyebrow">Previsione</div><div class="pred-body">Previsioni non disponibili al momento.</div></div>`);
    return;
  }

  let bestMatch = null, bestScore = -1;
  nextDays.forEach(day=>{
    const {score, available, moon:dayMoon} = scoreDayAgainstProfile(day, profile);
    const ratio = available>0 ? score/available : 0;
    if(ratio > bestScore){ bestScore = ratio; bestMatch = {...day, score, available, moon:dayMoon}; }
  });

  const dayLabel = bestMatch.date === forecast.find(f=>f.date>todayStr)?.date ? 'Domani' : 'Dopodomani';
  const dateFmt = fmtDate(bestMatch.date);

  if(bestMatch.available>0 && bestScore >= 0.5){
    const speciesTags = profile.topSpecies.map(s=>`<span class="pred-tag">${s.glyph} ${s.name}</span>`).join('');
    const profileBits = [];
    if(profile.pressureBucket) profileBits.push('pressione ' + profile.pressureBucket);
    if(profile.windBucket) profileBits.push(WIND_BUCKET_LABELS[profile.windBucket]);
    if(profile.tideState) profileBits.push('marea ' + escapeHtml(profile.tideState));
    setPredictionHTML(`
      <div class="prediction-card">
        <div class="pred-eyebrow">Previsione · ${dayLabel}, ${dateFmt}</div>
        <div class="pred-title">Condizioni simili ai tuoi giorni migliori</div>
        <div class="pred-body">
          ${bestMatch.weatherCode!=null ? weatherEmoji(bestMatch.weatherCode)+' '+weatherLabel(bestMatch.weatherCode)+' · ' : ''}
          ${bestMatch.waveHeight!=null ? '🌊 '+seaStateFromWaveHeight(bestMatch.waveHeight)+' · ' : ''}
          ${MOON_PHASES.find(m=>m.name===bestMatch.moon)?.emoji||'🌙'} ${bestMatch.moon}
          ${bestMatch.windAvg!=null ? '<br>💨 vento medio previsto ~'+Math.round(bestMatch.windAvg)+' km/h' : ''}${bestMatch.pressureTrend!=null ? ' · 🧭 pressione '+pressureTrendInfo(bestMatch.pressureTrend).text : ''}
          ${profileBits.length ? '<br>Nei tuoi giorni migliori: '+profileBits.join(', ')+'.' : ''}
          <br>Potresti avere buone possibilità con:
        </div>
        <div class="pred-tags">${speciesTags}${profile.topBait? `<span class="pred-tag">🪱 ${profile.topBait}</span>` : ''}</div>
      </div>`);
  } else {
    setPredictionHTML(`
      <div class="prediction-card neutral">
        <div class="pred-eyebrow">Previsione · ${dayLabel}, ${dateFmt}</div>
        <div class="pred-body">Le condizioni previste non assomigliano particolarmente ai tuoi giorni migliori. Nessun consiglio speciale per ora.</div>
      </div>`);
  }
}

/* ===================== CALENDARIO GIORNI MIGLIORI ===================== */
let calMonthOffset = 0;

async function renderCalendar(){
  const container = document.getElementById('bestDaysCalendar');
  if(!container) return;
  const now = new Date();
  const viewDate = new Date(now.getFullYear(), now.getMonth()+calMonthOffset, 1);
  const year = viewDate.getFullYear(), month = viewDate.getMonth();
  const monthLabel = viewDate.toLocaleDateString('it-IT', {month:'long', year:'numeric'});
  const firstDow = (viewDate.getDay()+6) % 7; // lun=0 ... dom=6
  const daysInMonth = new Date(year, month+1, 0).getDate();

  const byDate = {};
  data.catches.forEach(c=>{ byDate[c.date] = (byDate[c.date]||0)+1; });
  const maxCount = Math.max(1, ...Object.values(byDate).length?Object.values(byDate):[0]);

  const todayStr = localDateStr(now);

  let personalGoodDates = new Set();
  let genericGoodDates = new Set();
  const profile = computeGoodDaysProfile();
  const spot = favoriteSpotCoords() || SPOTORNO_COORDS;
  const lastVisibleDate = new Date(year, month, daysInMonth);
  const daysAhead = Math.ceil((lastVisibleDate - now) / 86400000);

  if(daysAhead > 0 && daysAhead <= 16){
    try{
      const forecast = await fetchForecastDays(spot.lat, spot.lng, Math.min(16, daysAhead+1));
      forecast.forEach(day=>{
        if(day.date <= todayStr) return;
        const dayMoon = moonPhaseForDate(day.date).name;

        /* confronto con i TUOI giorni migliori passati (serve storico sufficiente) */
        if(profile){
          const {score, available} = scoreDayAgainstProfile(day, profile);
          if(available>0 && score/available >= 0.5) personalGoodDates.add(day.date);
        }

        /* stima generica indipendente dallo storico: luna nuova/piena (periodi solunari forti)
           + meteo stabile + mare non troppo mosso */
        const moonStrong = (dayMoon==='Luna nuova' || dayMoon==='Luna piena');
        const weatherOk = day.weatherCode!=null && ['sereno','nuvoloso'].includes(weatherBucketFor(day.weatherCode));
        const seaOk = day.waveHeight!=null && ['Calmo','Poco mosso','Mosso'].includes(seaStateFromWaveHeight(day.waveHeight));
        if(moonStrong || (weatherOk && seaOk)) genericGoodDates.add(day.date);
      });
    }catch(e){ /* previsione non disponibile, il calendario mostra comunque lo storico */ }
  }
  renderCalendarGrid(container, year, month, daysInMonth, firstDow, byDate, maxCount, todayStr, personalGoodDates, genericGoodDates, monthLabel);
}

function renderCalendarGrid(container, year, month, daysInMonth, firstDow, byDate, maxCount, todayStr, personalGoodDates, genericGoodDates, monthLabel){
  const dowLabels = ['LUN','MAR','MER','GIO','VEN','SAB','DOM'];
  let html = `
    <div class="cal-nav">
      <button onclick="changeCalMonth(-1)">‹</button>
      <div class="cal-month-label">${monthLabel}</div>
      <button onclick="changeCalMonth(1)">›</button>
    </div>
    <div class="cal-grid">
      ${dowLabels.map(d=>`<div class="cal-dow">${d}</div>`).join('')}`;
  for(let i=0;i<firstDow;i++) html += `<div class="cal-day empty"></div>`;
  for(let d=1; d<=daysInMonth; d++){
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = dateStr === todayStr;
    const count = byDate[dateStr] || 0;
    let bg = 'var(--bg-alt)', color = 'var(--ink-soft)';
    if(dateStr <= todayStr && count>0){
      const intensity = count/maxCount;
      bg = `rgba(28,110,140,${(0.25+intensity*0.6).toFixed(2)})`;
      color = intensity>0.5 ? '#fff' : 'var(--ink)';
    }
    const isPersonalGood = personalGoodDates.has(dateStr);
    const isGenericGood = genericGoodDates.has(dateStr);
    const dots = [];
    if(isPersonalGood) dots.push('<div class="cal-dot" style="background:var(--copper);"></div>');
    if(isGenericGood) dots.push('<div class="cal-dot" style="background:var(--teal);"></div>');
    const hasForecast = dateStr >= todayStr && dateStr <= addDaysStr(todayStr, FORECAST_DAYS - 1);
    html += `<div class="cal-day ${isToday?'today':''} ${hasForecast?'clickable':''}" ${hasForecast?`onclick="openDayForecast('${dateStr}')"`:''} style="background:${bg}; color:${color};" title="${hasForecast?'Tocca per le previsioni di pesca ora per ora':(count? count+' catture':'')}">
      ${d}
      <div style="display:flex; gap:2px;">${dots.join('')}</div>
    </div>`;
  }
  html += `</div>
    <div class="cal-legend">
      <span><span class="lg-swatch" style="background:rgba(28,110,140,0.6);"></span>giorni con catture</span>
      <span><span class="lg-swatch" style="background:var(--copper);"></span>simile ai tuoi giorni migliori</span>
      <span><span class="lg-swatch" style="background:var(--teal);"></span>condizioni generalmente favorevoli</span>
      <span>👆 tocca uno dei prossimi 7 giorni per le previsioni di pesca ora per ora</span>
    </div>`;
  container.innerHTML = html;
}
function changeCalMonth(delta){ calMonthOffset += delta; renderCalendar(); }

/* ===================== CONSIGLI LOCALI (contenuto statico, da ricerca generale) ===================== */
function renderLocalTips(){
  const box = document.getElementById('localTipsCard');
  if(!box) return;
  box.innerHTML = `
    <div class="chart-card">
      <h3>Consigli generali per il Ponente ligure</h3>
      <div class="insight-card"><div class="insight-icon">🌅</div><div class="insight-text">In generale l'attività dei pesci è più alta nelle prime ore del mattino e verso il tramonto, con luce bassa.</div></div>
      <div class="insight-card"><div class="insight-icon">🌸</div><div class="insight-text">Primavera (aprile–giugno): tra i periodi più prolifici dell'anno, spigole, saraghi e orate molto attivi vicino a riva.</div></div>
      <div class="insight-card"><div class="insight-icon">🍂</div><div class="insight-text">Autunno (ottobre–novembre): altro momento forte, soprattutto per orate e grandi predatori in cerca di cibo prima dell'inverno.</div></div>
      <div class="insight-card"><div class="insight-icon">🌊</div><div class="insight-text">La spigola predilige spesso il mare mosso o in scaduta, e viene frequentemente associata a un calo della pressione atmosferica.</div></div>
      <div class="insight-card"><div class="insight-icon">🌕</div><div class="insight-text">I grandi predatori notturni (pesce serra, leccia) tendono a essere più attivi con luna crescente o piena.</div></div>
      <div class="insight-card"><div class="insight-icon">📚</div><div class="insight-text">Indicazioni generali raccolte da fonti di pesca sportiva e dalla teoria dei periodi solunari — tendenze, non garanzie.</div></div>
    </div>`;
}

function renderStats(){
  renderPrediction();
  renderCalendar();
  renderLocalTips();
  const summary = document.getElementById('statsSummary');
  const catches = data.catches;
  const totalCatches = catches.length;
  const bestCatch = catches.reduce((a,c)=> (parseFloat(c.weight)||0) > (parseFloat(a?.weight)||0) ? c : a, null);
  const lastDate = catches.length ? catches.map(c=>c.date).sort().at(-1) : null;

  summary.innerHTML = `
    <div class="summary-card"><div class="num">${totalCatches}</div><div class="lbl">Totale</div></div>
    <div class="summary-card"><div class="num">${bestCatch ? (bestCatch.weight||'—') : '—'}</div><div class="lbl">Record kg</div></div>
    <div class="summary-card"><div class="num" ${lastDate?'style="font-size:14px;"':''}>${lastDate ? fmtDate(lastDate) : '—'}</div><div class="lbl">Ultima uscita</div></div>
  `;

  // grafico per specie (top 6)
  const bySpecies = {};
  catches.forEach(c=>{
    const sp = speciesById(c.speciesId);
    const name = sp ? sp.name : (c.speciesName || 'Altro');
    bySpecies[name] = (bySpecies[name]||0)+1;
  });
  const sortedSp = Object.entries(bySpecies).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const ctx2 = document.getElementById('chartBySpecies').getContext('2d');
  if(chartSpecies) chartSpecies.destroy();
  chartSpecies = new Chart(ctx2, {
    type:'bar',
    data:{
      labels: sortedSp.map(s=>s[0]),
      datasets:[{ data: sortedSp.map(s=>s[1]), backgroundColor:'#C97C3D', borderRadius:6 }]
    },
    options:{
      indexAxis:'y',
      plugins:{legend:{display:false}},
      scales:{ x:{beginAtZero:true, ticks:{precision:0, color:'#5B6660'}, grid:{color:'#E3D6BC'}}, y:{ticks:{color:'#1B2420', font:{size:11}}, grid:{display:false}} }
    }
  });

  // record personali
  const table = document.getElementById('recordsTable');
  const unlocked = allSpecies().map(s=>({s, stat:speciesStats(s.id)})).filter(x=>x.stat.unlocked);
  unlocked.sort((a,b)=> (b.stat.bestWeight||0) - (a.stat.bestWeight||0));
  const top = unlocked.slice(0,6);
  if(top.length===0){
    table.innerHTML = `<tr><td style="color:var(--ink-soft); padding:10px 0;">Ancora nessun record: registra la tua prima cattura.</td></tr>`;
  } else {
    table.innerHTML = `
      <tr><th>Specie</th><th>Peso max</th><th>Lung. max</th></tr>
      ${top.map(x=>`<tr><td>${x.s.glyph} ${x.s.name}</td><td>${x.stat.bestWeight? x.stat.bestWeight+' kg':'—'}</td><td>${x.stat.bestLength? x.stat.bestLength+' cm':'—'}</td></tr>`).join('')}
    `;
  }

  renderAnalysis();
}
