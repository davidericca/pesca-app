/* =====================================================================
   FORECAST.JS — Previsioni di pesca ora per ora (7 giorni): dati orari di
   meteo, vento, pressione, mare e marea (Open-Meteo), luna e periodi solunari
   calcolati in locale, indice di pesca 0–100 per ogni ora e, se hai abbastanza
   storico, il confronto con le condizioni dei tuoi giorni migliori.
   ===================================================================== */

const FORECAST_DAYS = 7;

let hourlyForecastOpen = false;
let hourlyForecastData = null;      // cache: {key, fetchedAt, dates[], byDate{}}; azzerata al cambio di località
let forecastActiveDate = null;

/* ===================== INDICE DI PESCA ORARIO =====================
   Indice ORIENTATIVO costruito su regole generali della pesca da riva (luce, luna, pressione, vento, mare,
   meteo, marea), non su una misura scientifica: è una tendenza, non una garanzia. Somma di fattori pesati (100). */

const FC_WEIGHTS = {luce:24, solunare:18, pressione:14, vento:16, mare:14, meteo:8, marea:6};
const FC_LABELS = {luce:'Luce', solunare:'Luna/solunare', pressione:'Pressione', vento:'Vento', mare:'Mare', meteo:'Meteo', marea:'Marea'};
const FC_NEUTRAL = 0.6; // fattore usato se il dato manca

function hhmmToHours(s){
  if(!s) return null;
  const [h, m] = s.split(':').map(Number);
  return h + m/60;
}

/* alba/tramonto: massima attività vicino alla luce bassa; di notte discreta; a mezzogiorno più bassa */
function lightFactor(t, sr, ss, cloud){
  if(sr == null || ss == null) return FC_NEUTRAL;
  const d = Math.min(Math.abs(t - sr), Math.abs(t - ss));
  if(d <= 0.75) return 1;
  if(d <= 1.5) return 0.85;
  if(t < sr - 1.5 || t > ss + 1.5) return 0.5;
  if(d <= 2.5) return 0.6;
  return (cloud != null && cloud >= 70) ? 0.45 : 0.3;
}

/* pressione in lieve calo = alimentazione attiva; stabile = buona; salita netta = scarsa */
function pressureFactor(trend){
  if(trend == null) return FC_NEUTRAL;
  if(trend <= -3) return 0.55;
  if(trend <= -1) return 1;
  if(trend < 1) return 0.8;
  if(trend < 3) return 0.45;
  return 0.25;
}

function windFactor(kmh){
  if(kmh == null) return FC_NEUTRAL;
  if(kmh < 8) return 1;
  if(kmh < 15) return 0.9;
  if(kmh < 22) return 0.7;
  if(kmh < 30) return 0.45;
  if(kmh < 40) return 0.2;
  return 0.05;
}

function waveFactor(m){
  if(m == null) return FC_NEUTRAL;
  if(m < 0.15) return 0.85;
  if(m < 0.5) return 1;
  if(m < 1.0) return 0.8;
  if(m < 1.5) return 0.45;
  if(m < 2.5) return 0.15;
  return 0;
}

function weatherFactor(code){
  if(code == null) return FC_NEUTRAL;
  const b = weatherBucketFor(code);
  if(b === 'sereno') return 0.85;
  if(b === 'nuvoloso') return 1;
  if(b === 'nebbia') return 0.8;
  if(b === 'pioggia') return [63,65,81,82].includes(code) ? 0.3 : 0.6;
  if(b === 'temporale') return 0;
  if(b === 'neve') return 0.2;
  return 0.7;
}

/* acqua in movimento (cm/h) meglio che acqua ferma */
function tideFactor(rate){
  if(rate == null) return FC_NEUTRAL;
  const r = Math.abs(rate);
  if(r >= 3) return 1;
  if(r >= 1.5) return 0.75;
  return 0.45;
}

function fishingIndexForHour(rec, ctx){
  const solunarW = solunarWeightForHour(ctx.solunar, rec.hour);
  const f = {
    luce: lightFactor(rec.hour + 0.5, ctx.sunriseH, ctx.sunsetH, rec.cloud),
    solunare: solunarW === 2 ? (ctx.moonStrong ? 1 : 0.85) : solunarW === 1 ? 0.55 : 0.2,
    pressione: pressureFactor(rec.pTrend),
    vento: windFactor(rec.wind),
    mare: waveFactor(rec.wave),
    meteo: weatherFactor(rec.code),
    marea: tideFactor(rec.tideRate),
  };
  const parts = {};
  let sum = 0;
  Object.keys(FC_WEIGHTS).forEach(k=>{ parts[k] = Math.round(FC_WEIGHTS[k] * f[k] * 10) / 10; sum += FC_WEIGHTS[k] * f[k]; });
  let score = Math.round(sum);
  const warn = [];
  if(rec.gust != null && rec.gust >= 50) warn.push('raffiche forti');
  if(rec.wave != null && rec.wave >= 2.5) warn.push('mare agitato');
  if(rec.code != null && [95,96,99].includes(rec.code)) warn.push('temporale');
  if(warn.length) score = Math.min(score, 20);
  else if(rec.wind != null && rec.wind >= 40){ warn.push('vento forte'); score = Math.min(score, 35); }
  return {score, parts, warn};
}

function fishingRating(score){
  if(score >= 75) return 'Ottimo';
  if(score >= 60) return 'Buono';
  if(score >= 40) return 'Discreto';
  return 'Scarso';
}

function scoreColor(score){ return `hsl(${Math.round(Math.max(0, Math.min(100, score)) * 1.15)}, 55%, 42%)`; }

/* ===================== DATI ===================== */

/* corrispondenza di un'ora con le condizioni dei tuoi giorni migliori (0–1), null se il profilo non c'è o ha pochi fattori */
function personalHourMatch(rec, profile, moonName){
  if(!profile) return null;
  let s = 0, a = 0;
  if(profile.weatherBucket && rec.code != null){ a++; if(weatherBucketFor(rec.code) === profile.weatherBucket) s++; }
  if(profile.seaState && rec.wave != null){ a++; if(seaStateFromWaveHeight(rec.wave) === profile.seaState) s++; }
  if(profile.moonPhase){ a++; if(moonName === profile.moonPhase) s++; }
  if(profile.windBucket && rec.wind != null){ a++; if(windBucketFor(rec.wind) === profile.windBucket) s++; }
  if(profile.pressureBucket && rec.pTrend != null){
    a++;
    const i = pressureTrendInfo(rec.pTrend);
    if(i && i.text === profile.pressureBucket) s++;
  }
  if(profile.tideState && rec.tideState){ a++; if(rec.tideState === profile.tideState) s++; }
  return a >= 3 ? s / a : null;
}

async function buildFishingForecast(loc){
  const la = loc.lat.toFixed(4), lo = loc.lng.toFixed(4);
  const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&hourly=temperature_2m,weather_code,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl,cloud_cover&daily=sunrise,sunset&past_days=1&forecast_days=${FORECAST_DAYS}&timezone=auto`;
  const mUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${la}&longitude=${lo}&hourly=wave_height,wave_period,wave_direction,sea_surface_temperature,sea_level_height_msl&past_days=1&forecast_days=${FORECAST_DAYS}&timezone=auto`;
  const [wRes, mRes] = await Promise.allSettled([cachedJson(wUrl, 900000), cachedJson(mUrl, 900000)]);
  const wJ = wRes.status === 'fulfilled' ? wRes.value : null;
  const mJ = mRes.status === 'fulfilled' ? mRes.value : null;
  if(!wJ && !mJ) throw new Error('previsioni non disponibili');

  const wh = wJ && wJ.hourly, mh = mJ && mJ.hourly;
  const times = (wh && wh.time) || (mh && mh.time) || [];
  const mIdx = new Map(mh ? mh.time.map((t,i)=>[t,i]) : []);
  const today = localDateStr();
  const sunByDate = {};
  if(wJ && wJ.daily && wJ.daily.time){
    wJ.daily.time.forEach((d,i)=>{
      sunByDate[d] = {
        sunrise: wJ.daily.sunrise && wJ.daily.sunrise[i] ? wJ.daily.sunrise[i].slice(11,16) : null,
        sunset: wJ.daily.sunset && wJ.daily.sunset[i] ? wJ.daily.sunset[i].slice(11,16) : null,
      };
    });
  }

  const byDate = {};
  times.forEach((t, i)=>{
    const date = t.slice(0,10);
    if(date < today) return; // ieri serve solo per la tendenza della pressione
    const hour = parseInt(t.slice(11,13), 10);
    const wv = k => (wh && wh[k]) ? wh[k][i] : null;
    const mi = mIdx.get(t);
    const mv = k => (mh && mi != null && mh[k]) ? mh[k][mi] : null;
    const p = wh ? wh.pressure_msl : null;
    const pTrend = (p && i >= 3 && p[i] != null && p[i-3] != null) ? Math.round((p[i] - p[i-3]) * 10) / 10 : null;
    const lvl = mh ? mh.sea_level_height_msl : null;
    const tideRate = (lvl && mi != null && mi >= 1 && lvl[mi+1] != null && lvl[mi-1] != null)
      ? Math.round((lvl[mi+1] - lvl[mi-1]) / 2 * 1000) / 10 : null; // cm/h
    const tide = mh ? analyzeTide(mh, date, hour + 0.5) : null;
    if(!byDate[date]) byDate[date] = {date, hours:[]};
    byDate[date].hours.push({
      date, hour, temp: wv('temperature_2m'), code: wv('weather_code'), pop: wv('precipitation_probability'), precip: wv('precipitation'),
      wind: wv('wind_speed_10m'), gust: wv('wind_gusts_10m'), windDir: wv('wind_direction_10m'), pressure: wv('pressure_msl'),
      pTrend, cloud: wv('cloud_cover'),
      wave: mv('wave_height'), period: mv('wave_period'), seaTemp: mv('sea_surface_temperature'),
      tideState: tide ? tide.tideState : null, tideRate,
    });
  });

  const dates = Object.keys(byDate).sort();
  dates.forEach(date=>{
    const day = byDate[date];
    const sun = sunByDate[date] || {};
    day.sunrise = sun.sunrise; day.sunset = sun.sunset;
    day.solunar = solunarPeriods(date, loc.lat, loc.lng);
    const moon = moonPhaseForDate(date, 12);
    day.moon = moon;
    day.moonIllum = moonIllumination(date, 12);
    const ctx = {solunar: day.solunar, sunriseH: hhmmToHours(day.sunrise), sunsetH: hhmmToHours(day.sunset),
      moonStrong: moon.name === 'Luna nuova' || moon.name === 'Luna piena'};
    day.hours.forEach(h=>{ Object.assign(h, fishingIndexForHour(h, ctx)); });
    summarizeFishingDay(day);
  });

  return {key: la + ',' + lo, fetchedAt: Date.now(), dates, byDate};
}

/* indice della giornata = media delle 6 ore migliori; finestre = serie di ore vicine al massimo */
function summarizeFishingDay(day){
  const sorted = [...day.hours].sort((a,b)=>b.score - a.score);
  const top = sorted.slice(0, 6);
  day.index = Math.round(top.reduce((s,h)=>s + h.score, 0) / top.length);
  const max = sorted[0].score;
  const thr = Math.max(55, Math.round(max * 0.9));
  const windows = [];
  let start = null;
  day.hours.forEach((h, i)=>{
    const ok = h.score >= thr;
    if(ok && start === null) start = h.hour;
    const last = i === day.hours.length - 1;
    if(start !== null && (!ok || last)){
      const end = ok ? h.hour : day.hours[i-1].hour;
      windows.push(`${pad2(start)}:00–${pad2(end + 1)}:00`);
      start = null;
    }
  });
  day.windows = windows;
  const noon = day.hours.find(h=>h.hour === 12);
  day.icon = noon && noon.code != null ? weatherEmoji(noon.code) : '—';
}

async function getForecastData(){
  const loc = resolveWeatherLocation();
  const key = loc.lat.toFixed(4) + ',' + loc.lng.toFixed(4);
  if(hourlyForecastData && hourlyForecastData.key === key && Date.now() - hourlyForecastData.fetchedAt < 1800000) return hourlyForecastData;
  hourlyForecastData = null;
  hourlyForecastData = await buildFishingForecast(loc);
  return hourlyForecastData;
}

/* ===================== VISUALIZZAZIONE ===================== */

const FC_WEEKDAYS = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];

function forecastDayHTML(fc, date){
  const day = fc.byDate[date];
  if(!day) return `<div class="pred-body" style="color:var(--ink-soft); font-size:12px;">Previsioni orarie non disponibili per questo giorno.</div>`;
  const profile = computeGoodDaysProfile();
  const todayStr = localDateStr();
  const nowHour = new Date().getHours();

  const solunarTags = day.solunar.map(s=>`<span class="sol-tag ${s.kind}" title="${s.label}">🎣 ${s.kind==='major'?'solunare':'minore'} ${s.range}</span>`).join('');
  const head = `
    <div class="fc-head">
      <div class="fc-sun">🌅 ${day.sunrise||'—'} · 🌇 ${day.sunset||'—'} · ${day.moon.emoji} ${day.moon.name} ${day.moonIllum}%</div>
      <div class="solunar-row" style="margin-top:8px;">${solunarTags}</div>
      <div class="fc-best"><b style="color:${scoreColor(day.index)};">Indice ${day.index} · ${fishingRating(day.index)}</b>${day.windows.length ? ' — finestre migliori: ' + day.windows.join(', ') : ' — nessuna finestra davvero buona'}</div>
      ${profile ? '' : `<div class="fc-note">Registra qualche uscita in più con GPS per vedere anche le ore simili ai tuoi giorni migliori (⭐).</div>`}
    </div>`;

  const rows = day.hours.map(h=>{
    const past = date === todayStr && h.hour < nowHour;
    const isTop = day.windows.some(w=>{ const [a,b] = w.split('–'); return h.hour >= parseInt(a,10) && h.hour < parseInt(b,10); });
    const match = personalHourMatch(h, profile, day.moon.name);
    const star = match != null && match >= 0.67;
    const trend = pressureTrendInfo(h.pTrend);
    const details = [];
    if(h.wind != null) details.push(`💨 ${Math.round(h.wind)} km/h ${windCompass(h.windDir)}${h.gust!=null ? ' (raff. '+Math.round(h.gust)+')' : ''}`);
    if(h.wave != null) details.push(`🌊 ${h.wave.toFixed(1)} m${h.period!=null ? ' · '+Math.round(h.period)+' s' : ''}`);
    if(h.pressure != null) details.push(`${Math.round(h.pressure)} hPa${trend ? ' '+trend.arrow : ''}`);
    if(h.tideState) details.push(`〰️ ${escapeHtml(h.tideState)}${h.tideRate!=null ? ' ('+(h.tideRate>0?'+':'')+h.tideRate.toFixed(1)+' cm/h)' : ''}`);
    if(h.pop != null && h.pop >= 30) details.push(`🌧 ${Math.round(h.pop)}%`);
    if(h.seaTemp != null) details.push(`acqua ${h.seaTemp.toFixed(1)}°`);
    const why = Object.keys(FC_WEIGHTS).map(k=>`${FC_LABELS[k]} ${h.parts[k]}/${FC_WEIGHTS[k]}`).join(' · ');
    return `
      <div class="fc-row ${isTop?'top':''} ${past?'past':''}" onclick="this.classList.toggle('open')">
        <div class="fc-main">
          <div class="fc-time">${pad2(h.hour)}:00</div>
          <div class="fc-bar"><div class="fc-bar-in" style="width:${h.score}%; background:${scoreColor(h.score)};"></div></div>
          <div class="fc-score" style="color:${scoreColor(h.score)};">${h.score}</div>
          <div class="fc-wx">${h.code!=null ? weatherEmoji(h.code) : '—'} ${h.temp!=null ? Math.round(h.temp)+'°' : ''}</div>
          <div class="fc-badges">${star ? '<span title="Condizioni simili ai tuoi giorni migliori">⭐</span>' : ''}${h.warn.length ? `<span title="${h.warn.join(', ')}">⚠️</span>` : ''}</div>
        </div>
        <div class="fc-detail">${details.join(' · ')}${h.warn.length ? '<br><b class="fc-warn">⚠️ ' + h.warn.join(', ') + '</b>' : ''}</div>
        <div class="fc-why"><b>Perché ${h.score}:</b> ${why}</div>
      </div>`;
  }).join('');

  return head + `<div class="fc-list">${rows}</div>
    <div class="fc-note">Indice orientativo 0–100 da regole generali di pesca da riva (luce, luna, pressione, vento, mare, meteo, marea): una tendenza, non una garanzia. Tocca un'ora per vedere come è calcolata.${profile ? ' ⭐ = condizioni simili ai tuoi giorni migliori.' : ''}</div>`;
}

function toggleHourlyForecast(){
  hourlyForecastOpen = !hourlyForecastOpen;
  const panel = document.getElementById('hourlyForecastPanel');
  const label = document.getElementById('hourlyToggleLabel');
  if(!hourlyForecastOpen){
    panel.style.display = 'none';
    label.textContent = '🎣 Previsioni di pesca ora per ora (7 giorni)';
    return;
  }
  label.textContent = '🎣 Nascondi previsioni di pesca';
  panel.style.display = 'block';
  renderHourlyForecastPanel();
}

async function renderHourlyForecastPanel(){
  const panel = document.getElementById('hourlyForecastPanel');
  if(!panel) return;
  panel.innerHTML = `<div class="hourly-panel"><div class="pred-body" style="color:var(--ink-soft); font-size:12px;">Carico le previsioni di pesca...</div></div>`;
  let fc;
  try{
    fc = await getForecastData();
  }catch(e){
    panel.innerHTML = `<div class="hourly-panel"><div class="pred-body" style="color:var(--ink-soft); font-size:12px;">Previsioni orarie non disponibili al momento.</div></div>`;
    return;
  }
  if(!forecastActiveDate || !fc.byDate[forecastActiveDate]) forecastActiveDate = fc.dates[0];
  const todayStr = localDateStr();
  const chips = fc.dates.map(d=>{
    const day = fc.byDate[d];
    const wd = FC_WEEKDAYS[new Date(d + 'T12:00:00').getDay()];
    return `<button class="fc-day ${d===forecastActiveDate?'active':''}" onclick="setForecastDay('${d}')">
      <span class="w">${d===todayStr ? 'Oggi' : wd}</span><span class="n">${parseInt(d.slice(8,10),10)}</span>
      <span class="i">${day.icon}</span><span class="x" style="color:${scoreColor(day.index)};">${day.index}</span>
    </button>`;
  }).join('');
  panel.innerHTML = `
    <div class="hourly-panel">
      <div class="fc-days">${chips}</div>
      ${forecastDayHTML(fc, forecastActiveDate)}
    </div>`;
}

function setForecastDay(date){
  forecastActiveDate = date;
  renderHourlyForecastPanel();
}

/* stessa vista per un singolo giorno, aperta toccando un giorno del calendario */
async function openDayForecast(date){
  const box = document.getElementById('dayForecastContent');
  document.getElementById('dayForecastTitle').textContent = 'Pesca · ' + fmtDate(date);
  box.innerHTML = `<div class="pred-body" style="color:var(--ink-soft); font-size:12px;">Carico le previsioni di pesca...</div>`;
  openModal('modalDayForecast');
  try{
    const fc = await getForecastData();
    box.innerHTML = forecastDayHTML(fc, date);
  }catch(e){
    box.innerHTML = `<div class="pred-body" style="color:var(--ink-soft); font-size:12px;">Previsioni orarie non disponibili al momento.</div>`;
  }
}
