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

/* peso dei fattori sull'attività dei pesci: luce, luna, pressione e correnti di marea decidono, vento/mare/meteo
   aggiustano soltanto (non sono "sicurezza": un po' di onda o vento non abbassa il voto) */
const FC_WEIGHTS = {luce:28, solunare:26, pressione:20, marea:10, vento:6, mare:6, meteo:4};
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

/* Vento, mare e meteo sono valutati per l'ATTIVITÀ DEI PESCI, non per la comodità o la sicurezza di chi pesca:
   un po' di vento e di moto ondoso tendono a stimolare l'alimentazione, mare piatto e aria ferma meno. */
function windFactor(kmh){
  if(kmh == null) return FC_NEUTRAL;
  if(kmh < 5) return 0.8;
  if(kmh < 25) return 1;
  if(kmh < 35) return 0.85;
  if(kmh < 45) return 0.7;
  return 0.55;
}

function waveFactor(m){
  if(m == null) return FC_NEUTRAL;
  if(m < 0.15) return 0.7;
  if(m < 0.5) return 0.9;
  if(m < 1.5) return 1;
  if(m < 2.5) return 0.85;
  return 0.7;
}

function weatherFactor(code){
  if(code == null) return FC_NEUTRAL;
  const b = weatherBucketFor(code);
  if(b === 'sereno') return 0.85;
  if(b === 'nuvoloso') return 1;
  if(b === 'nebbia') return 0.8;
  if(b === 'pioggia') return [63,65,81,82].includes(code) ? 0.6 : 0.9;
  if(b === 'temporale') return 0.5;
  if(b === 'neve') return 0.4;
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
  const solunarLv = solunarLevelForHour(ctx.solunar, rec.hour);
  const f = {
    luce: lightFactor(rec.hour + 0.5, ctx.sunriseH, ctx.sunsetH, rec.cloud),
    /* attività solunare come MeteoPesca: livello del periodo in corso (1–4), altrimenti base del giorno */
    solunare: solunarLv ? 0.3 + 0.175 * solunarLv : 0.15 + 0.05 * (ctx.solunarDay || 2),
    pressione: pressureFactor(rec.pTrend),
    vento: windFactor(rec.wind),
    mare: waveFactor(rec.wave),
    meteo: weatherFactor(rec.code),
    marea: tideFactor(rec.tideRate),
  };
  const parts = {};
  let sum = 0;
  Object.keys(FC_WEIGHTS).forEach(k=>{ parts[k] = Math.round(FC_WEIGHTS[k] * f[k] * 10) / 10; sum += FC_WEIGHTS[k] * f[k]; });
  /* nessun tetto "per sicurezza": l'indice misura l'attività dei pesci, non se conviene uscire */
  return {score: Math.round(sum), parts, warn: []};
}

function fishingRating(score){
  if(score >= 75) return 'Ottimo';
  if(score >= 60) return 'Buono';
  if(score >= 40) return 'Discreto';
  return 'Scarso';
}

/* livello di attività 0–4 di un indice orario (scala fissa, non rapportata al resto della giornata) */
function appActivityLevel(score){ return score >= 90 ? 4 : score >= 82 ? 3 : score >= 74 ? 2 : score >= 60 ? 1 : 0; }

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

  const wh = wJ && wJ.hourly;
  let mh = mJ && mJ.hourly;
  const times = (wh && wh.time) || (mh && mh.time) || [];
  /* marea calcolata (come le tavole di MeteoPesca) quando il punto è in Riviera; anche se il servizio marino non risponde */
  if(tideHarmonicApplies(loc.lat, loc.lng)){
    if(!mh) mh = {time: times.slice(), sea_level_height_msl: []};
    applyHarmonicTide(mh, loc.lat, loc.lng);
  }
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

  const allExtrema = tideExtrema(mh);
  const dates = Object.keys(byDate).sort();
  dates.forEach(date=>{
    const day = byDate[date];
    const sun = sunByDate[date] || {};
    day.sunrise = sun.sunrise; day.sunset = sun.sunset;
    day.tide = tideDayData(mh, allExtrema, date);
    day.solunar = solunarPeriods(date, loc.lat, loc.lng);
    const moon = moonPhaseForDate(date, 12);
    day.moon = moon;
    day.moonIllum = moonIllumination(date, 12);
    const ctx = {solunar: day.solunar, solunarDay: solunarDayLevel(date), sunriseH: hhmmToHours(day.sunrise), sunsetH: hhmmToHours(day.sunset)};
    day.hours.forEach(h=>{ Object.assign(h, fishingIndexForHour(h, ctx)); });
    summarizeFishingDay(day);
  });

  return {key: la + ',' + lo, fetchedAt: Date.now(), dates, byDate};
}

/* livello del mare di un giorno per il grafico: un punto all'ora (0–24) e i massimi/minimi che cadono in quel giorno */
function tideDayData(mh, allExtrema, date){
  if(!mh || !mh.sea_level_height_msl) return null;
  if(mh._harmonic) return harmonicDaySeries(date);
  const pts = [];
  for(let h = 0; h <= 24; h++){
    const v = sampleHourly(mh, 'sea_level_height_msl', date, h);
    if(v != null) pts.push([h, v]);
  }
  if(pts.length < 12) return null;
  const extrema = allExtrema.filter(e=>_naiveStr(e.ms).slice(0,10) === date).map(e=>{
    const s = _naiveStr(e.ms);
    return {type: e.type, level: e.level, hour: parseInt(s.slice(11,13), 10) + parseInt(s.slice(14,16), 10) / 60};
  });
  return {pts, extrema};
}

/* Nomi dei periodi solunari come nelle tavole di MeteoPesca */
const SOLUNAR_PERIOD_NAMES = {
  'Luna al meridiano': 'Transito lunare',
  'Luna opposta': 'Transito lunare opposto',
  'Sorgere della Luna': 'Alba lunare',
  'Tramonto della Luna': 'Tramonto lunare',
};
const fishIcons = n => '🐟'.repeat(Math.max(0, Math.min(4, n)));
function activityColor(level){ return {1:'#7C8DA3', 2:'#4F86C6', 3:'#2E9D6B', 4:'#D9801A'}[level] || '#7C8DA3'; }

/* indice orario della giornata = media delle 6 ore migliori (include meteo, vento, mare, pressione, luce);
   attività solunare del giorno e fasce = come MeteoPesca: dipendono dalla luna, non dal meteo */
function summarizeFishingDay(day){
  const sorted = [...day.hours].sort((a,b)=>b.score - a.score);
  const top = sorted.slice(0, 6);
  day.index = Math.round(top.reduce((s,h)=>s + h.score, 0) / top.length);
  day.maxScore = sorted[0].score;
  day.activity = solunarDayLevel(day.date);
  day.windows = day.solunar.map(p=>{
    const start = Math.max(0, p.startH), end = Math.min(24, p.endH);
    return {start, end, level: p.level, fish: p.level, kind: p.kind, name: SOLUNAR_PERIOD_NAMES[p.label] || p.label,
      label: `${fmtHourMin(Math.max(0, p.startH))}–${fmtHourMin(p.endH >= 24 ? p.endH - 24 : p.endH)}`};
  }).filter(w=>w.end > w.start).sort((a,b)=>a.start - b.start);

  /* analisi dell'app: attività dei pesci ora per ora (luna + luce + pressione + vento + mare + meteo + marea).
     Fasce = serie di ore vicine al massimo del giorno (e non sotto 60); il livello di ogni fascia è però assoluto. */
  day.activityApp = Math.max(1, appActivityLevel(day.index));
  const thr = day.maxScore < 60 ? Infinity : Math.max(60, day.maxScore - 12);
  const apps = [];
  let run = [];
  const flush = ()=>{
    if(!run.length) return;
    const avg = Math.round(run.reduce((s,h)=>s + h.score, 0) / run.length);
    const level = appActivityLevel(avg);
    if(level > 0){
      const start = run[0].hour, end = run[run.length - 1].hour + 1;
      /* i due fattori che più la sostengono, per spiegare perché è una buona fascia */
      const ratio = k => run.reduce((s,h)=>s + h.parts[k] / FC_WEIGHTS[k], 0) / run.length;
      const why = ['luce','solunare','pressione','marea'].sort((a,b)=>ratio(b) - ratio(a)).slice(0, 2).map(k=>k === 'solunare' ? 'luna' : FC_LABELS[k].toLowerCase()).join(' · ');
      apps.push({start, end, avg, level, fish: level, kind:'app', name: why, label: `${pad2(start)}:00–${pad2(end % 24)}:00`});
    }
    run = [];
  };
  day.hours.forEach(h=>{ if(h.score >= thr) run.push(h); else flush(); });
  flush();
  day.windowsApp = apps.sort((a,b)=>b.avg - a.avg).slice(0, 3).sort((a,b)=>a.start - b.start);

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

/* Grafico della marea della giornata (SVG): curva con area sfumata, alti e bassi con ora e altezza, alba e tramonto,
   ora attuale (solo oggi) e fasce di pesca evidenziate (più scure = attività più alta; i pesci sono nell'elenco sotto).
   Altezze in metri sul livello di riferimento delle tavole di MeteoPesca. */
let _tcSeq = 0;
function tideChartHTML(day, isToday, wins, bandLabel){
  wins = wins || day.windows;
  const t = day.tide;
  if(!t) return '';
  const uid = 'tc' + (++_tcSeq);
  const W = 360, H = 200, L = 34, R = 12, T = 38, B = 26;
  const pw = W - L - R, pb = H - B;
  const dataTop = T + 22, dataBot = pb - 8;
  const xOf = h => L + h / 24 * pw;

  /* con la marea calcolata le altezze sono metri sul livello di riferimento; col modello Open-Meteo (fuori zona)
     il livello assoluto non è affidabile e si parte dal minimo del giorno */
  const levels = t.pts.map(p=>p[1]).concat(t.extrema.map(e=>e.level));
  const rel = t.harmonic ? 0 : Math.min(...levels);
  const mn = Math.min(...levels) - rel, mx = Math.max(...levels) - rel;
  const step = (mx - mn) > 0.7 ? 0.2 : 0.1;
  const lo = Math.floor((mn - 0.03) / step) * step;
  let hi = Math.ceil((mx + 0.03) / step) * step;
  if(hi - lo < 0.3) hi = lo + 0.3;
  const yOf = v => dataBot - (v - rel - lo) / (hi - lo) * (dataBot - dataTop);
  const fmtM = v => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(1).replace('.', ',');
  const levelAt = h => {
    const i = Math.max(0, Math.min(t.pts.length - 2, Math.floor(h / 24 * (t.pts.length - 1))));
    const p0 = t.pts[i], p1 = t.pts[i + 1], f = p1[0] === p0[0] ? 0 : (h - p0[0]) / (p1[0] - p0[0]);
    return p0[1] + (p1[1] - p0[1]) * Math.max(0, Math.min(1, f));
  };

  const sr = hhmmToHours(day.sunrise), ss = hhmmToHours(day.sunset);
  let svg = `<svg class="tide-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafico della marea della giornata">`;
  svg += `<defs>
    <linearGradient id="${uid}-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2F6DB5" stop-opacity="0.34"/><stop offset="1" stop-color="#2F6DB5" stop-opacity="0.03"/></linearGradient>
    <clipPath id="${uid}-clip"><rect x="${L}" y="${T}" width="${pw}" height="${pb - T}" rx="12"/></clipPath>
  </defs>`;

  svg += `<g clip-path="url(#${uid}-clip)">`;
  svg += `<rect x="${L}" y="${T}" width="${pw}" height="${pb - T}" class="tc-night"/>`;
  if(sr != null && ss != null) svg += `<rect x="${xOf(sr).toFixed(1)}" y="${T}" width="${(xOf(ss) - xOf(sr)).toFixed(1)}" height="${pb - T}" class="tc-day"/>`;
  /* fasce di pesca: banda evidenziata, più scura se l'attività è più alta */
  wins.forEach(w=>{
    svg += `<rect x="${xOf(w.start).toFixed(1)}" y="${T}" width="${(xOf(w.end) - xOf(w.start)).toFixed(1)}" height="${pb - T}" class="tc-band l${w.level}"/>`;
  });
  for(let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step){
    const y = yOf(v + rel).toFixed(1);
    svg += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="${Math.abs(v) < 1e-9 && t.harmonic ? 'tc-zero' : 'tc-grid'}"/>`;
  }
  /* curva con area sfumata sotto */
  const P = t.pts.map(p=>[xOf(p[0]), yOf(p[1])]);
  let d = `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
  for(let i = 0; i < P.length - 1; i++){
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)},`
       + `${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)},${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  svg += `<path d="${d} L${P[P.length - 1][0].toFixed(1)} ${pb} L${P[0][0].toFixed(1)} ${pb} Z" fill="url(#${uid}-fill)"/>`;
  svg += `<path d="${d}" class="tc-curve"/>`;
  svg += `</g>`;

  /* asse a sinistra (metri) e cornice */
  for(let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step){
    svg += `<text x="${L - 6}" y="${(yOf(v + rel) + 3.5).toFixed(1)}" class="tc-axis" text-anchor="end">${fmtM(v)}</text>`;
  }
  svg += `<text x="${L - 6}" y="${T - 6}" class="tc-axis" text-anchor="end">m</text>`;

  /* ore: una tacchetta ogni ora, il numero ogni 3 */
  for(let h = 0; h <= 24; h++){
    const x = xOf(h).toFixed(1), big = h % 3 === 0;
    svg += `<line x1="${x}" x2="${x}" y1="${pb}" y2="${pb + (big ? 5 : 3)}" class="tc-tick"/>`;
    if(big) svg += `<text x="${x}" y="${H - 6}" class="tc-axis" text-anchor="middle">${h}</text>`;
  }

  /* alba e tramonto sopra il grafico */
  const sun = (h, label, up) => {
    const x = xOf(h).toFixed(1);
    return `<line x1="${x}" x2="${x}" y1="${T}" y2="${pb}" class="tc-sunline"/>
      <path d="${up ? `M${x - 4.5} ${T - 14} l4.5 -6 l4.5 6Z` : `M${x - 4.5} ${T - 20} l4.5 6 l4.5 -6Z`}" class="tc-sun"/>
      <text x="${x}" y="${T - 4}" class="tc-sunlabel" text-anchor="middle">${label}</text>`;
  };
  if(sr != null) svg += sun(sr, day.sunrise, true);
  if(ss != null) svg += sun(ss, day.sunset, false);

  /* alte e basse: punto, ora e altezza */
  t.extrema.forEach(e=>{
    const x = xOf(e.hour), y = yOf(e.level);
    const lx = Math.min(Math.max(x, L + 30), W - R - 30);
    svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" class="tc-dot ${e.type}"/>`;
    const ty = e.type === 'high' ? y - 11 : y + 20;
    svg += `<text x="${lx.toFixed(1)}" y="${ty.toFixed(1)}" class="tc-time ${e.type}" text-anchor="middle">${fmtHourMin(e.hour)}<tspan class="tc-h" dx="4">${fmtM(e.level - rel)} m</tspan></text>`;
  });

  if(isToday){
    const now = new Date(), nh = now.getHours() + now.getMinutes() / 60, x = xOf(nh).toFixed(1);
    svg += `<line x1="${x}" x2="${x}" y1="${T}" y2="${pb}" class="tc-now"/><circle cx="${x}" cy="${yOf(levelAt(nh)).toFixed(1)}" r="4.5" class="tc-nowdot"/>`;
  }
  svg += `<line x1="${L}" x2="${W - R}" y1="${pb}" y2="${pb}" class="tc-base"/></svg>`;

  const note = t.harmonic
    ? `Altezze in metri sul livello di riferimento delle tavole di MeteoPesca. Marea calcolata dalle loro tavole di Spotorno: orari entro pochi minuti, altezze ±7 cm. Non valida per la navigazione.`
    : `Altezza misurata dal livello più basso della giornata. Marea da modello marino (Open-Meteo): in Mediterraneo l'escursione è di pochi decimetri e gli orari sono una stima, non quelli ufficiali.`;
  return `<div class="tide-wrap">${svg}
    <div class="tide-legend"><span><i class="tc-dot high"></i> alta</span><span><i class="tc-dot low"></i> bassa</span><span><i class="tc-swatch"></i> ${bandLabel || 'periodo solunare'}</span></div>
    <div class="fc-note" style="margin-top:6px;">${note}</div>
  </div>`;
}

/* Due analisi dell'attività dei pesci, affiancate in una scheda scorrevole:
   - "mp" = MeteoPesca: solo Luna (attività solunare del giorno e dei quattro periodi)
   - "app" = analisi dell'app: Luna + luce + pressione + vento + mare + meteo + marea, ora per ora
   Livelli 1–4: 🐟 bassa, 🐟🐟 media, 🐟🐟🐟 elevata, 🐟🐟🐟🐟 molto elevata. */
let activityMode = 'mp';
try{ if(localStorage.getItem('pescaActivityMode') === 'app') activityMode = 'app'; }catch(e){}

const ACT_DAY_NAMES = {1:'Bassa', 2:'Media', 3:'Alta', 4:'Molto alta'};
const ACT_LEVEL_NAMES = {1:'Bassa', 2:'Media', 3:'Elevata', 4:'Molto elevata'};
function dayActivityFor(day, mode){ return mode === 'app' ? day.activityApp : day.activity; }

function windowListHTML(day, todayStr, mode){
  const nowH = new Date().getHours();
  const isToday = day.date === todayStr;
  const wins = mode === 'app' ? day.windowsApp : day.windows;
  if(!wins.length){
    return `<div class="win-list"><div class="win-empty">Nessuna fascia davvero buona: l'indice più alto della giornata è ${day.maxScore}.</div></div>`;
  }
  const rows = wins.map(w=>`
    <div class="win-row l${w.level} ${isToday && w.end <= nowH ? 'past' : ''}">
      <span class="win-fish">${fishIcons(w.level)}</span>
      <span class="win-main"><b class="win-time">${w.label}</b><span class="win-name">${w.name}</span></span>
      <span class="win-rate">${ACT_LEVEL_NAMES[w.level]}</span>
    </div>`).join('');
  const note = mode === 'app'
    ? `Analisi dell'app: unisce la Luna (come MeteoPesca) con luce, pressione, vento, mare, meteo e marea, ora per ora. Valuta l'attività dei pesci, non la comodità di pescare: un po' di onda e vento non abbassano il voto. Pesci su scala fissa, non rapportati al resto della giornata.`
    : `Come nelle tavole di MeteoPesca: l'attività dipende solo dalla fase lunare. I periodi maggiori (transiti) valgono un livello in più dei minori (alba e tramonto lunari).`;
  return `<div class="win-list">${rows}<div class="fc-note" style="margin-top:2px;">${note} 🐟 bassa · 🐟🐟 media · 🐟🐟🐟 elevata · 🐟🐟🐟🐟 molto elevata.</div></div>`;
}

function activityHeadHTML(day, mode){
  const lv = dayActivityFor(day, mode);
  return `<div class="fc-best" style="margin-top:0;"><b style="color:${activityColor(lv)};">Attività del giorno: ${ACT_DAY_NAMES[lv]}</b> <span class="act-fish">${fishIcons(lv)}</span></div>`;
}

/* scheda scorrevole a due pagine: curva della marea + fasce + elenco, per MeteoPesca e per l'analisi dell'app */
function activityCarouselHTML(day, isToday, todayStr){
  const slide = mode => `
    <div class="act-slide" data-m="${mode}">
      ${activityHeadHTML(day, mode)}
      ${tideChartHTML(day, isToday, mode === 'app' ? day.windowsApp : day.windows, mode === 'app' ? 'fascia migliore' : 'periodo solunare')}
      ${windowListHTML(day, todayStr, mode)}
    </div>`;
  return `<div class="act-wrap">
    <div class="act-switch" role="tablist">
      <button class="act-tab ${activityMode==='mp'?'active':''}" data-m="mp" onclick="actGo(this,'mp')">MeteoPesca</button>
      <button class="act-tab ${activityMode==='app'?'active':''}" data-m="app" onclick="actGo(this,'app')">Analisi dell'app</button>
    </div>
    <div class="act-slider" onscroll="onActScroll(this)">${slide('mp')}${slide('app')}</div>
    <div class="act-dots"><i class="${activityMode==='mp'?'on':''}"></i><i class="${activityMode==='app'?'on':''}"></i></div>
  </div>`;
}

function actSnap(root){
  (root || document).querySelectorAll('.act-wrap').forEach(w=>{
    const sl = w.querySelector('.act-slider');
    if(sl && sl.clientWidth) sl.scrollLeft = activityMode === 'app' ? sl.clientWidth : 0;
  });
}
function actGo(btn, mode){
  const sl = btn.closest('.act-wrap').querySelector('.act-slider');
  sl.scrollTo({left: mode === 'app' ? sl.clientWidth : 0, behavior: 'smooth'});
}
function onActScroll(sl){
  if(!sl.clientWidth) return;
  const i = sl.scrollLeft / sl.clientWidth > 0.5 ? 1 : 0, mode = i ? 'app' : 'mp';
  const wrap = sl.closest('.act-wrap');
  wrap.querySelectorAll('.act-tab').forEach(b=>b.classList.toggle('active', b.dataset.m === mode));
  wrap.querySelectorAll('.act-dots i').forEach((d, k)=>d.classList.toggle('on', k === i));
  clearTimeout(sl._t);
  sl._t = setTimeout(()=>{ if(mode !== activityMode) setActivityMode(mode); }, 120);
}
function setActivityMode(mode){
  activityMode = mode;
  try{ localStorage.setItem('pescaActivityMode', mode); }catch(e){}
  if(typeof paintDailyForecastStrip === 'function') paintDailyForecastStrip();
  /* gli altri riquadri a pagine restano sulla stessa vista */
  document.querySelectorAll('.act-wrap').forEach(w=>{
    const sl = w.querySelector('.act-slider');
    if(sl && Math.round(sl.scrollLeft / (sl.clientWidth || 1)) !== (mode === 'app' ? 1 : 0)) sl.scrollLeft = mode === 'app' ? sl.clientWidth : 0;
  });
  document.querySelectorAll('.fc-day .x').forEach(x=>{
    const d = x.closest('.fc-day').dataset.date;
    if(d && hourlyForecastData && hourlyForecastData.byDate[d]) x.textContent = fishIcons(dayActivityFor(hourlyForecastData.byDate[d], mode));
  });
}

/* scheda della home: marea di oggi con le fasce di pesca migliori */
async function renderTodayTideCard(){
  const box = document.getElementById('todayTideCard');
  if(!box) return;
  box.innerHTML = `<div class="conditions-card"><h3>Marea e fasce di pesca <span class="cond-note">oggi</span></h3><div class="pred-body" style="color:var(--ink-soft); font-size:15px;">Carico...</div></div>`;
  let fc;
  try{ fc = await getForecastData(); }
  catch(e){
    box.innerHTML = `<div class="conditions-card"><h3>Marea e fasce di pesca <span class="cond-note">oggi</span></h3><div class="pred-body" style="color:var(--ink-soft); font-size:15px;">Previsioni non disponibili al momento.</div></div>`;
    return;
  }
  const todayStr = localDateStr();
  const day = fc.byDate[todayStr] || fc.byDate[fc.dates[0]];
  if(!day){ box.innerHTML = ''; return; }
  box.innerHTML = `
    <div class="conditions-card">
      <h3>Marea e fasce di pesca <span class="cond-note">${day.date === todayStr ? 'oggi' : fmtDate(day.date)}</span></h3>
      ${activityCarouselHTML(day, day.date === todayStr, todayStr)}
    </div>`;
  actSnap(box);
}

function forecastDayHTML(fc, date){
  const day = fc.byDate[date];
  if(!day) return `<div class="pred-body" style="color:var(--ink-soft); font-size:12px;">Previsioni orarie non disponibili per questo giorno.</div>`;
  const profile = computeGoodDaysProfile();
  const todayStr = localDateStr();
  const nowHour = new Date().getHours();

  const head = `
    <div class="fc-head">
      <div class="fc-sun">🌅 ${day.sunrise||'—'} · 🌇 ${day.sunset||'—'} · ${day.moon.emoji} ${day.moon.name} ${day.moonIllum}%</div>
      ${activityCarouselHTML(day, date === todayStr, todayStr)}
      ${profile ? '' : `<div class="fc-note">Registra qualche uscita in più con GPS per vedere anche le ore simili ai tuoi giorni migliori (⭐).</div>`}
    </div>`;

  const rows = day.hours.map(h=>{
    const past = date === todayStr && h.hour < nowHour;
    const isTop = day.windowsApp.some(w=>h.hour >= w.start && h.hour < w.end);
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
    <div class="fc-note">Le barre ora per ora sono un indice orientativo 0–100 delle condizioni di pesca da riva: unisce l'attività solunare (la stessa di MeteoPesca) con luce, pressione, vento, mare, meteo e marea. È una tendenza, non una garanzia. Tocca un'ora per vedere come è calcolata.${profile ? ' ⭐ = condizioni simili ai tuoi giorni migliori.' : ''}</div>`;
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
    return `<button class="fc-day ${d===forecastActiveDate?'active':''}" data-date="${d}" onclick="setForecastDay('${d}')">
      <span class="w">${d===todayStr ? 'Oggi' : wd}</span><span class="n">${parseInt(d.slice(8,10),10)}</span>
      <span class="i">${day.icon}</span><span class="x">${fishIcons(dayActivityFor(day, activityMode))}</span>
    </button>`;
  }).join('');
  panel.innerHTML = `
    <div class="hourly-panel">
      <div class="fc-days">${chips}</div>
      ${forecastDayHTML(fc, forecastActiveDate)}
    </div>`;
  actSnap(panel);
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
    actSnap(box);
  }catch(e){
    box.innerHTML = `<div class="pred-body" style="color:var(--ink-soft); font-size:12px;">Previsioni orarie non disponibili al momento.</div>`;
  }
}
