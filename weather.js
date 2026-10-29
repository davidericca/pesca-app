/* =====================================================================
   WEATHER.JS — Meteo, mare e marea (Open-Meteo, gratuito, senza chiave),
   astronomia calcolata in locale (luna, periodi solunari) e rilevamento
   GPS usato nel form di registrazione cattura.
   ===================================================================== */

/* Spotorno (SV), Liguria — riferimento fisso sempre disponibile per meteo/mare, indipendente dallo storico catture */
const SPOTORNO_COORDS = {lat:44.2313, lng:8.4109};

const WEATHER_CODES = {
  0:['Sereno','☀️'],1:['Poco nuvoloso','🌤️'],2:['Parz. nuvoloso','⛅'],3:['Coperto','☁️'],
  45:['Nebbia','🌫️'],48:['Nebbia gelata','🌫️'],
  51:['Pioviggine leggera','🌦️'],53:['Pioviggine','🌦️'],55:['Pioviggine fitta','🌦️'],
  56:['Pioviggine gelata','🌦️'],57:['Pioviggine gelata','🌦️'],
  61:['Pioggia leggera','🌧️'],63:['Pioggia','🌧️'],65:['Pioggia forte','🌧️'],
  66:['Pioggia gelata','🌧️'],67:['Pioggia gelata','🌧️'],
  71:['Neve leggera','🌨️'],73:['Neve','🌨️'],75:['Neve forte','🌨️'],77:['Granelli di neve','🌨️'],
  80:['Rovesci leggeri','🌦️'],81:['Rovesci','🌧️'],82:['Rovesci forti','⛈️'],
  85:['Rovesci di neve','🌨️'],86:['Rovesci di neve','🌨️'],
  95:['Temporale','⛈️'],96:['Temporale con grandine','⛈️'],99:['Temporale forte','⛈️'],
};

function weatherLabel(code){ return WEATHER_CODES[code] ? WEATHER_CODES[code][0] : 'N/D'; }

function weatherEmoji(code){ return WEATHER_CODES[code] ? WEATHER_CODES[code][1] : '🌡️'; }

function weatherEmojiByLabel(label){
  const entry = Object.values(WEATHER_CODES).find(v=>v[0]===label);
  return entry ? entry[1] : '🌤️';
}

/* ===================== UTIL ===================== */

function pad2(n){ return String(n).padStart(2,'0'); }

/* ore decimali -> "HH:MM" (con giro di mezzanotte) */
function fmtHourMin(h){
  let m = Math.round(h*60);
  m = ((m % 1440) + 1440) % 1440;
  return pad2(Math.floor(m/60)) + ':' + pad2(m%60);
}

function addDaysStr(dateStr, n){
  const [y,m,d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m-1, d+n));
  return dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth()+1) + '-' + pad2(dt.getUTCDate());
}

function daysBetween(fromStr, toStr){
  const [y1,m1,d1] = fromStr.split('-').map(Number);
  const [y2,m2,d2] = toStr.split('-').map(Number);
  return Math.round((Date.UTC(y2,m2-1,d2) - Date.UTC(y1,m1-1,d1)) / 86400000);
}

/* testo -> HTML sicuro (i dati di una cattura possono arrivare da un backup importato) */
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function numOrNull(v){
  if(v===null || v===undefined || v==='') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

const COMPASS_8 = ['N','NE','E','SE','S','SO','O','NO'];
function windCompass(deg){
  if(deg==null) return '';
  return COMPASS_8[Math.round((((deg%360)+360)%360)/45) % 8];
}

/* tendenza barometrica su 3 ore (hPa): oltre ±1 hPa/3h è già una variazione significativa */
function pressureTrendInfo(delta){
  if(delta==null) return null;
  if(delta >= 1) return {arrow:'↗', text:'in salita'};
  if(delta <= -1) return {arrow:'↘', text:'in calo'};
  return {arrow:'→', text:'stabile'};
}

/* ===================== ASTRONOMIA (calcolo locale, nessun servizio esterno) =====================
   Posizione di Sole e Luna con serie di perturbazioni troncate (precisione ~0.3° sulla Luna):
   fase entro circa 1 ora, passaggi al meridiano entro un paio di minuti.            */

const DEG = Math.PI / 180;
const SYNODIC_DAYS = 29.530588853;

const MOON_PHASES = [
  {name:'Luna nuova', emoji:'🌑'},
  {name:'Luna crescente', emoji:'🌒'},
  {name:'Primo quarto', emoji:'🌓'},
  {name:'Gibbosa crescente', emoji:'🌔'},
  {name:'Luna piena', emoji:'🌕'},
  {name:'Gibbosa calante', emoji:'🌖'},
  {name:'Ultimo quarto', emoji:'🌗'},
  {name:'Luna calante', emoji:'🌘'},
];

function _frac(x){ return x - Math.floor(x); }
function _norm360(x){ x = x % 360; return x < 0 ? x + 360 : x; }
function _jdFromMs(ms){ return ms / 86400000 + 2440587.5; }

/* scarto dall'UTC (in ore) del fuso del dispositivo in quella data */
function deviceUtcOffsetH(dateStr){
  const [y,m,d] = dateStr.split('-').map(Number);
  return -new Date(y, m-1, d, 12).getTimezoneOffset() / 60;
}

/* istante UTC (ms) di "data + ora locale" con dato scarto dall'UTC */
function _localToMs(dateStr, hour, utcOffsetH){
  const [y,m,d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m-1, d) + (hour - utcOffsetH) * 3600000;
}

function _sunLongitude(jd){
  const n = jd - 2451545.0;
  const L = 280.460 + 0.9856474 * n;
  const g = (357.528 + 0.9856003 * n) * DEG;
  return _norm360(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2*g));
}

/* longitudine e latitudine eclittiche della Luna, in gradi */
function _moonPosition(jd){
  const T = (jd - 2451545.0) / 36525;
  const L0 = _frac(0.606433 + 1336.855225 * T);
  const l  = 2*Math.PI * _frac(0.374897 + 1325.552410 * T);   // anomalia media della Luna
  const ls = 2*Math.PI * _frac(0.993133 + 99.997361 * T);     // anomalia media del Sole
  const D  = 2*Math.PI * _frac(0.827361 + 1236.853086 * T);   // elongazione media
  const F  = 2*Math.PI * _frac(0.259086 + 1342.227825 * T);   // argomento della latitudine
  const dL = 22640*Math.sin(l) - 4586*Math.sin(l-2*D) + 2370*Math.sin(2*D) + 769*Math.sin(2*l)
    - 668*Math.sin(ls) - 412*Math.sin(2*F) - 212*Math.sin(2*l-2*D) - 206*Math.sin(l+ls-2*D)
    + 192*Math.sin(l+2*D) - 165*Math.sin(ls-2*D) - 125*Math.sin(D) - 110*Math.sin(l+ls)
    + 148*Math.sin(l-ls) - 55*Math.sin(2*F-2*D);
  const lon = _norm360((L0 + dL/1296000) * 360);
  const S = F + (dL + 412*Math.sin(2*F) + 541*Math.sin(ls)) / 206264.8;
  const h = F - 2*D;
  const N = -526*Math.sin(h) + 44*Math.sin(l+h) - 31*Math.sin(-l+h) - 23*Math.sin(ls+h)
    + 11*Math.sin(-ls+h) - 25*Math.sin(-2*l+F) + 21*Math.sin(-l+F);
  const lat = (18520*Math.sin(S) + N) / 3600;
  return {lon, lat};
}

function _moonEquatorial(jd){
  const p = _moonPosition(jd);
  const eps = (23.4393 - 0.0130042 * ((jd - 2451545.0) / 36525)) * DEG;
  const lon = p.lon * DEG, lat = p.lat * DEG;
  const ra = Math.atan2(Math.sin(lon)*Math.cos(eps) - Math.tan(lat)*Math.sin(eps), Math.cos(lon));
  const dec = Math.asin(Math.sin(lat)*Math.cos(eps) + Math.cos(lat)*Math.sin(eps)*Math.sin(lon));
  return {ra: _norm360(ra / DEG), dec: dec / DEG};
}

function _gmstDeg(jd){ return _norm360(280.46061837 + 360.98564736629 * (jd - 2451545.0)); }

/* elongazione Luna-Sole in gradi: 0 = luna nuova, 180 = luna piena */
function _moonElongation(jd){ return _norm360(_moonPosition(jd).lon - _sunLongitude(jd)); }

function _jdForDateHour(dateStr, hour){
  return _jdFromMs(_localToMs(dateStr, hour == null ? 12 : hour, deviceUtcOffsetH(dateStr)));
}

function moonPhaseForDate(dateStr, hour){
  const e = _moonElongation(_jdForDateHour(dateStr, hour));
  return MOON_PHASES[Math.floor(e / 45 + 0.5) % 8];
}

/* percentuale di disco lunare illuminato */
function moonIllumination(dateStr, hour){
  const e = _moonElongation(_jdForDateHour(dateStr, hour));
  return Math.round((1 - Math.cos(e * DEG)) / 2 * 100);
}

function moonAgeDays(dateStr, hour){
  return _moonElongation(_jdForDateHour(dateStr, hour)) / 360 * SYNODIC_DAYS;
}

/* Eventi lunari della giornata locale, in ore dalla mezzanotte locale:
   passaggio superiore/inferiore al meridiano e sorgere/tramonto della Luna. */
function moonEventsForDay(dateStr, lat, lng, utcOffsetH){
  const t0 = _localToMs(dateStr, 0, utcOffsetH);
  const stepMs = 5 * 60000;
  const steps = 24 * 12;
  const sinLat = Math.sin(lat * DEG), cosLat = Math.cos(lat * DEG);
  const H0 = 0.125; // altezza del bordo alla linea d'orizzonte (rifrazione + parallasse della Luna)
  const wrap180 = x => { x = _norm360(x); return x > 180 ? x - 360 : x; };
  const ev = {upper:[], lower:[], rise:[], set:[]};
  let prev = null;
  for(let i=0; i<=steps; i++){
    const ms = t0 + i*stepMs;
    const jd = _jdFromMs(ms);
    const eq = _moonEquatorial(jd);
    const H = _norm360(_gmstDeg(jd) + lng - eq.ra);              // angolo orario
    const alt = Math.asin(sinLat*Math.sin(eq.dec*DEG) + cosLat*Math.cos(eq.dec*DEG)*Math.cos(H*DEG)) / DEG - H0;
    const cur = {ms, u: wrap180(H), v: wrap180(H - 180), alt};
    if(prev){
      const cross = (a, b) => (0 - a) / (b - a) * stepMs;        // interpolazione lineare dello zero
      if(prev.u < 0 && cur.u >= 0 && cur.u - prev.u < 90) ev.upper.push((prev.ms + cross(prev.u, cur.u) - t0) / 3600000);
      if(prev.v < 0 && cur.v >= 0 && cur.v - prev.v < 90) ev.lower.push((prev.ms + cross(prev.v, cur.v) - t0) / 3600000);
      if(prev.alt < 0 && cur.alt >= 0) ev.rise.push((prev.ms + cross(prev.alt, cur.alt) - t0) / 3600000);
      if(prev.alt >= 0 && cur.alt < 0) ev.set.push((prev.ms + cross(prev.alt, cur.alt) - t0) / 3600000);
    }
    prev = cur;
  }
  return ev;
}

/* Periodi solunari (teoria amatoriale): "maggiori" ±1 h attorno al passaggio della Luna al meridiano
   e al suo opposto, "minori" ±30 min attorno a sorgere e tramonto lunare. Calcolati alla longitudine reale. */
function solunarPeriods(dateStr, lat, lng, utcOffsetH){
  if(lat == null || lng == null){ lat = SPOTORNO_COORDS.lat; lng = SPOTORNO_COORDS.lng; }
  if(utcOffsetH == null) utcOffsetH = deviceUtcOffsetH(dateStr);
  const ev = moonEventsForDay(dateStr, lat, lng, utcOffsetH);
  const out = [];
  const mk = (label, kind, c, w) => out.push({
    label, kind, centerH:c, startH:c-w, endH:c+w,
    range: `${fmtHourMin(c-w)} – ${fmtHourMin(c+w)}`,
  });
  ev.upper.forEach(c=> mk('Luna al meridiano', 'major', c, 1));
  ev.lower.forEach(c=> mk('Luna opposta', 'major', c, 1));
  ev.rise.forEach(c=> mk('Sorgere della Luna', 'minor', c, 0.5));
  ev.set.forEach(c=> mk('Tramonto della Luna', 'minor', c, 0.5));
  return out.sort((a,b)=>a.centerH - b.centerH);
}

/* peso solunare dell'ora [hour, hour+1): 2 = periodo maggiore, 1 = minore, 0 = nessuno (gestisce la mezzanotte) */
function solunarWeightForHour(periods, hour){
  let w = 0;
  periods.forEach(p=>{
    [-24, 0, 24].forEach(shift=>{
      if(p.startH + shift < hour + 1 && p.endH + shift > hour){
        w = Math.max(w, p.kind === 'major' ? 2 : 1);
      }
    });
  });
  return w;
}

/* Stima approssimativa della marea, usata SOLO come ripiego se il servizio dati non risponde
   (NON è un dato ufficiale: modello semi-diurno semplificato basato sul transito lunare). */
function estimateTide(dateStr, hour){
  const age = moonAgeDays(dateStr, hour);
  const transitOffsetH = age * (24 / SYNODIC_DAYS);
  const transit1 = (12 + transitOffsetH) % 24;
  let deltaH = (hour - transit1) % 12.42;
  if(deltaH < 0) deltaH += 12.42;
  const phaseFraction = deltaH / 12.42; // 0 = alta marea, 0.5 = bassa marea
  const heightFactor = Math.cos(phaseFraction * 2 * Math.PI);
  let status, proximity;
  if(phaseFraction < 0.08 || phaseFraction > 0.92){ status='vicino al picco'; proximity='alta'; }
  else if(phaseFraction > 0.42 && phaseFraction < 0.58){ status='vicino al minimo'; proximity='bassa'; }
  else if(phaseFraction < 0.5){ status='in discesa'; proximity=null; }
  else { status='in salita'; proximity=null; }
  return { status, proximity, heightFactor };
}

/* ===================== OPEN-METEO ===================== */

/* Scala approssimativa altezza onde -> stato del mare (rif. scala Douglas semplificata) */
function seaStateFromWaveHeight(h){
  if(h < 0.1) return 'Calmo';
  if(h < 0.5) return 'Poco mosso';
  if(h < 1.25) return 'Mosso';
  if(h < 2.5) return 'Molto mosso';
  return 'Agitato';
}

/* piccola cache in memoria: evita richieste identiche ripetute a ogni render */
const _jsonCache = new Map();
async function cachedJson(url, ttlMs){
  const hit = _jsonCache.get(url);
  if(hit && Date.now() - hit.t < (ttlMs || 600000)) return hit.v;
  const res = await fetch(url);
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const v = await res.json();
  _jsonCache.set(url, {t: Date.now(), v});
  return v;
}

/* Valore orario interpolato a "data + ore decimali" (ore anche <0 o >=24). Gli angoli si interpolano sull'arco più corto. */
function sampleHourly(h, key, dateStr, hourFloat, circular){
  if(!h || !h.time || !h[key]) return null;
  const dayShift = Math.floor(hourFloat / 24);
  const hh = hourFloat - dayShift * 24;
  const d = addDaysStr(dateStr, dayShift);
  const base = Math.floor(hh), frac = hh - base;
  const i0 = h.time.indexOf(`${d}T${pad2(base)}:00`);
  if(i0 < 0) return null;
  const v0 = h[key][i0];
  if(v0 == null) return null;
  const v1 = h[key][i0 + 1];
  if(frac === 0 || v1 == null) return v0;
  if(circular){
    let diff = ((v1 - v0 + 540) % 360) - 180;
    return ((v0 + diff * frac) % 360 + 360) % 360;
  }
  return v0 + (v1 - v0) * frac;
}

function _naiveMs(t){ // "YYYY-MM-DDTHH:MM" locale -> ms su scala "naive" (confrontabile solo con altri naive)
  return Date.UTC(+t.slice(0,4), +t.slice(5,7)-1, +t.slice(8,10), +t.slice(11,13), +t.slice(14,16));
}
function _naiveStr(ms){ return new Date(ms).toISOString().slice(0,16); }

/* Marea dalla serie oraria del livello del mare: stato, prossimi massimo e minimo, livello sopra il minimo del giorno. */
function analyzeTide(h, dateStr, hourFloat){
  if(!h || !h.time || !h.sea_level_height_msl) return null;
  const y = h.sea_level_height_msl, ts = h.time.map(_naiveMs);
  const extrema = [];
  for(let i=1; i<y.length-1; i++){
    const a = y[i-1], b = y[i], c = y[i+1];
    if(a==null || b==null || c==null) continue;
    const isMax = b > a && b >= c, isMin = b < a && b <= c;
    if(!isMax && !isMin) continue;
    const denom = a - 2*b + c;
    const off = denom !== 0 ? 0.5 * (a - c) / denom : 0;          // vertice della parabola, in ore
    const last = extrema[extrema.length-1];
    const type = isMax ? 'high' : 'low';
    if(last && last.type === type) continue;                      // tiene solo massimi e minimi alternati
    extrema.push({ms: ts[i] + off*3600000, level: b - 0.25*(a - c)*off, type});
  }
  const target = _naiveMs(dateStr + 'T00:00') + hourFloat * 3600000;
  const next = extrema.find(e=>e.ms > target) || null;
  const prevE = [...extrema].reverse().find(e=>e.ms <= target) || null;
  if(!next && !prevE) return null;

  const nearest = extrema.reduce((best,e)=> (!best || Math.abs(e.ms-target) < Math.abs(best.ms-target)) ? e : best, null);
  let state;
  if(nearest && Math.abs(nearest.ms - target) <= 40*60000) state = nearest.type === 'high' ? 'vicino al picco' : 'vicino al minimo';
  else if(next) state = next.type === 'high' ? 'in salita' : 'in discesa';
  else state = prevE.type === 'high' ? 'in discesa' : 'in salita';

  const nextHigh = extrema.find(e=>e.ms > target && e.type === 'high');
  const nextLow = extrema.find(e=>e.ms > target && e.type === 'low');

  const dayVals = [];
  h.time.forEach((t,i)=>{ if(t.startsWith(dateStr) && y[i] != null) dayVals.push(y[i]); });
  const level = sampleHourly(h, 'sea_level_height_msl', dateStr, hourFloat);
  let seaLevel = null, tideRange = null;
  if(dayVals.length && level != null){
    const mn = Math.min(...dayVals), mx = Math.max(...dayVals);
    seaLevel = Math.round((level - mn) * 100);
    tideRange = Math.round((mx - mn) * 100);
  }
  return {
    tideState: state,
    nextHigh: nextHigh ? _naiveStr(nextHigh.ms) : null,
    nextLow: nextLow ? _naiveStr(nextLow.ms) : null,
    seaLevel, tideRange,
  };
}

const _round = (v, d) => v == null ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d);

/* Condizioni all'istante esatto (data + ora) e nel punto indicato.
   Meteo: previsione/analisi orarie per gli ultimi ~90 giorni, archivio ERA5 per le date più vecchie.
   Mare e marea: modello marino Open-Meteo (onde, temperatura acqua, livello del mare comprensivo di marea).
   I valori orari sono interpolati ai minuti. Un blocco che non risponde resta a null: nessun dato inventato. */
async function fetchConditionsAt(lat, lng, dateStr, timeStr){
  const now = new Date();
  const today = localDateStr(now);
  let hourFloat, approx = false;
  if(timeStr && /^\d{1,2}:\d{2}/.test(timeStr)){
    const [hh, mm] = timeStr.split(':').map(Number);
    hourFloat = hh + mm/60;
  } else if(dateStr === today){
    hourFloat = now.getHours() + now.getMinutes()/60;
  } else {
    hourFloat = 12; approx = true;
  }

  const start = addDaysStr(dateStr, -1);
  let end = addDaysStr(dateStr, 1);
  const maxEnd = addDaysStr(today, 14);
  if(end > maxEnd) end = maxEnd;
  const la = lat.toFixed(4), lo = lng.toFixed(4);
  const useArchive = daysBetween(start, today) > 88;
  const wBase = useArchive ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  const wUrl = `${wBase}?latitude=${la}&longitude=${lo}&hourly=temperature_2m,weather_code,pressure_msl,wind_speed_10m,wind_gusts_10m,wind_direction_10m,cloud_cover,precipitation&daily=sunrise,sunset&start_date=${start}&end_date=${end}&timezone=auto`;
  const mUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${la}&longitude=${lo}&hourly=wave_height,wave_period,wave_direction,sea_surface_temperature,sea_level_height_msl&start_date=${start}&end_date=${end}&timezone=auto`;

  const [wRes, mRes] = await Promise.allSettled([cachedJson(wUrl), cachedJson(mUrl)]);
  const wJ = wRes.status === 'fulfilled' ? wRes.value : null;
  const mJ = mRes.status === 'fulfilled' ? mRes.value : null;
  if(!wJ && !mJ) throw new Error('meteo e mare non disponibili');

  const out = {
    at: dateStr + 'T' + fmtHourMin(hourFloat), approx,
    temp:null, code:null, pressure:null, pressureTrend:null, windSpeed:null, windGust:null, windDir:null,
    cloudCover:null, precip:null, sunrise:null, sunset:null,
    waveHeight:null, wavePeriod:null, waveDir:null, seaTemp:null, seaState:null,
    seaLevel:null, tideState:null, nextHigh:null, nextLow:null, tideRange:null,
  };

  if(wJ && wJ.hourly){
    const h = wJ.hourly;
    const at = (k, circ) => sampleHourly(h, k, dateStr, hourFloat, circ);
    out.temp = _round(at('temperature_2m'), 1);
    const code = sampleHourly(h, 'weather_code', dateStr, Math.round(hourFloat)); // codice: ora più vicina, non interpolato
    out.code = code == null ? null : Math.round(code);
    out.pressure = _round(at('pressure_msl'), 1);
    const p3 = sampleHourly(h, 'pressure_msl', dateStr, hourFloat - 3);
    if(out.pressure != null && p3 != null) out.pressureTrend = _round(out.pressure - p3, 1);
    out.windSpeed = _round(at('wind_speed_10m'), 0);
    out.windGust = _round(at('wind_gusts_10m'), 0);
    out.windDir = _round(at('wind_direction_10m', true), 0);
    out.cloudCover = _round(at('cloud_cover'), 0);
    out.precip = _round(at('precipitation'), 1);
    if(wJ.daily && wJ.daily.time){
      const di = wJ.daily.time.indexOf(dateStr);
      if(di >= 0){
        if(wJ.daily.sunrise && wJ.daily.sunrise[di]) out.sunrise = wJ.daily.sunrise[di].slice(11,16);
        if(wJ.daily.sunset && wJ.daily.sunset[di]) out.sunset = wJ.daily.sunset[di].slice(11,16);
      }
    }
  }

  if(mJ && mJ.hourly){
    const h = mJ.hourly;
    out.waveHeight = _round(sampleHourly(h, 'wave_height', dateStr, hourFloat), 2);
    out.wavePeriod = _round(sampleHourly(h, 'wave_period', dateStr, hourFloat), 1);
    out.waveDir = _round(sampleHourly(h, 'wave_direction', dateStr, hourFloat, true), 0);
    out.seaTemp = _round(sampleHourly(h, 'sea_surface_temperature', dateStr, hourFloat), 1);
    if(out.waveHeight != null) out.seaState = seaStateFromWaveHeight(out.waveHeight);
    const tide = analyzeTide(h, dateStr, hourFloat);
    if(tide) Object.assign(out, tide);
  }
  return out;
}

/* Geocoding: cerca una località per nome (Open-Meteo, gratuito, no chiave) */
async function geocodePlace(query){
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=it&format=json`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('ricerca non disponibile');
  const j = await res.json();
  if(!j.results) return [];
  return j.results.map(r=>({
    name: r.name + (r.admin2 ? ', '+r.admin2 : (r.admin1 ? ', '+r.admin1 : '')),
    lat: r.latitude, lng: r.longitude,
  }));
}

/* Località da usare per meteo/mare: scelta manuale salvata > spot preferito > Spotorno di default */
function resolveWeatherLocation(){
  if(data.weatherLocation) return {lat:data.weatherLocation.lat, lng:data.weatherLocation.lng, name:data.weatherLocation.name, source:'scelta'};
  const fav = favoriteSpotCoords();
  if(fav) return {lat:fav.lat, lng:fav.lng, name:null, source:'spot'};
  return {lat:SPOTORNO_COORDS.lat, lng:SPOTORNO_COORDS.lng, name:'Spotorno', source:'default'};
}

async function fetchDailyForecastFull(lat, lng, days){
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=${days}`;
  const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&daily=wave_height_max&timezone=auto&forecast_days=${days}`;
  const [wRes, mRes] = await Promise.allSettled([fetch(weatherUrl), fetch(marineUrl)]);
  let wJson=null, mJson=null;
  if(wRes.status==='fulfilled' && wRes.value.ok) wJson = await wRes.value.json();
  if(mRes.status==='fulfilled' && mRes.value.ok) mJson = await mRes.value.json();
  const dateList = (wJson && wJson.daily && wJson.daily.time) || (mJson && mJson.daily && mJson.daily.time) || [];
  return dateList.map((date,i)=>({
    date,
    weatherCode: wJson ? wJson.daily.weathercode[i] : null,
    tempMax: wJson ? wJson.daily.temperature_2m_max[i] : null,
    tempMin: wJson ? wJson.daily.temperature_2m_min[i] : null,
    waveHeight: mJson ? mJson.daily.wave_height_max[i] : null,
  }));
}

/* ===================== VISUALIZZAZIONE CONDIZIONI ===================== */

/* "2026-10-29T14:35" -> "14:35" (con "+1"/"-1" se cade in un altro giorno rispetto a refDate) */
function fmtTideTime(s, refDate){
  if(!s) return '';
  const t = s.slice(11,16);
  if(!refDate || s.slice(0,10) === refDate) return t;
  return t + (s.slice(0,10) > refDate ? ' (+1)' : ' (-1)');
}

/* Badge con le condizioni di una cattura (o di un rilevamento): c usa i nomi dei campi salvati nella cattura. */
function conditionsBadgesHTML(c){
  const b = [];
  const add = (txt, color) => b.push(`<span class="badge" style="background:var(--${color});">${txt}</span>`);
  const temp = numOrNull(c.weatherTemp), code = numOrNull(c.weatherCode);
  if(temp != null && code != null) add(`${weatherEmoji(code)} ${temp}° — ${weatherLabel(code)}`, 'teal');
  const pr = numOrNull(c.pressure);
  if(pr != null){
    const tr = numOrNull(c.pressureTrend), info = pressureTrendInfo(tr);
    add(`${Math.round(pr)} hPa${info ? ` ${info.arrow} ${info.text} (${tr>0?'+':''}${tr.toFixed(1)}/3h)` : ''}`, 'teal');
  }
  const ws = numOrNull(c.windSpeed);
  if(ws != null){
    const wd = numOrNull(c.windDir), wg = numOrNull(c.windGust);
    add(`💨 ${Math.round(ws)} km/h${wd!=null ? ' da '+windCompass(wd) : ''}${wg!=null ? ' · raff. '+Math.round(wg) : ''}`, 'teal');
  }
  const cc = numOrNull(c.cloudCover), pc = numOrNull(c.precip);
  if(cc != null) add(`☁️ ${Math.round(cc)}%${pc ? ' · 🌧 '+pc+' mm' : ''}`, 'teal');
  const wh = numOrNull(c.waveHeight);
  if(c.seaState || wh != null){
    const wp = numOrNull(c.wavePeriod);
    add(`🌊 ${escapeHtml(c.seaState || '')}${wh!=null ? ` (${wh.toFixed(1)} m${wp!=null ? ' · '+wp.toFixed(0)+' s' : ''})` : ''}`, 'copper');
  }
  const st = numOrNull(c.seaTemp);
  if(st != null) add(`🌡 acqua ${st.toFixed(1)}°`, 'copper');
  if(c.tideState){
    const ref = c.date || (c.conditionsAt ? String(c.conditionsAt).slice(0,10) : null);
    const hi = escapeHtml(fmtTideTime(c.nextHigh, ref)), lo = escapeHtml(fmtTideTime(c.nextLow, ref));
    add(`〰️ marea ${escapeHtml(c.tideState)}${hi ? ' · alta '+hi : ''}${lo ? ' · bassa '+lo : ''}`, 'copper');
  }
  return b.length ? `<div class="cond-badges">${b.join('')}</div>` : '';
}

/* ===================== GPS PRECISO ===================== */

const GPS_ERRORS = {1:'Permesso negato dal browser', 2:'Posizione non disponibile', 3:'Timeout nel rilevamento'};

/* Raccoglie i fix GPS per qualche secondo e tiene il più preciso (il primo fix è spesso grossolano).
   Si ferma appena la precisione scende sotto targetAccuracy (m) o allo scadere di maxWaitMs. */
function getBestPosition(opts){
  opts = opts || {};
  const maxWait = opts.maxWaitMs || 12000, target = opts.targetAccuracy || 5;
  return new Promise((resolve, reject)=>{
    if(!navigator.geolocation){ reject({code:0}); return; }
    let best = null, done = false, watchId = null, timer = null;
    const finish = (err)=>{
      if(done) return;
      done = true;
      if(watchId !== null) navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      if(best) resolve(best); else reject(err || {code:3});
    };
    watchId = navigator.geolocation.watchPosition(pos=>{
      const c = pos.coords;
      if(!best || c.accuracy < best.accuracy) best = {lat:c.latitude, lng:c.longitude, accuracy:c.accuracy};
      if(opts.onProgress) opts.onProgress(best);
      if(best.accuracy <= target) finish();
    }, err=> finish(err), {enableHighAccuracy:true, maximumAge:0, timeout:maxWait});
    timer = setTimeout(()=> finish({code:3}), maxWait);
  });
}

function showGpsAccuracy(acc, progress){
  const el = document.getElementById('gpsAccuracy');
  if(!el) return;
  const a = numOrNull(acc);
  if(a == null){ el.innerHTML = ''; return; }
  const r = Math.round(a);
  if(progress) el.textContent = `Affino la posizione… ±${r} m`;
  else el.innerHTML = r > 15 ? `<span class="gps-warn">⚠️ posizione imprecisa (±${r} m): riprova all'aperto</span>` : `📍 posizione ±${r} m`;
}

/* ===================== FORM CATTURA: condizioni all'ora della cattura ===================== */

/* campi aggiuntivi salvati nella cattura (oltre a weatherTemp, weatherCode, pressure, seaState) */
const CONDITION_EXTRA_KEYS = ['pressureTrend','windSpeed','windGust','windDir','cloudCover','precip',
  'waveHeight','wavePeriod','waveDir','seaTemp','seaLevel','tideState','nextHigh','nextLow','conditionsAt'];

let _condReqToken = 0;
let _condDebounce = null;

function _formEl(id){ return document.getElementById(id); }

function refreshConditionsBtn(){
  const btn = _formEl('refreshConditionsBtn');
  if(!btn) return;
  const has = numOrNull(_formEl('fLat').value) != null && numOrNull(_formEl('fLng').value) != null;
  btn.style.display = has ? 'inline-block' : 'none';
}

function applyConditionsToForm(c){
  const v = x => x == null ? '' : x;
  _formEl('fWeatherTemp').value = v(c.temp);
  _formEl('fWeatherCode').value = v(c.code);
  _formEl('fWeatherPressure').value = v(c.pressure);
  const extras = {
    pressureTrend:c.pressureTrend, windSpeed:c.windSpeed, windGust:c.windGust, windDir:c.windDir,
    cloudCover:c.cloudCover, precip:c.precip, waveHeight:c.waveHeight, wavePeriod:c.wavePeriod,
    waveDir:c.waveDir, seaTemp:c.seaTemp, seaLevel:c.seaLevel, tideState:c.tideState,
    nextHigh:c.nextHigh, nextLow:c.nextLow, conditionsAt:c.at,
  };
  _formEl('fConditions').value = JSON.stringify(extras);
  if(c.seaState) _formEl('fSeaState').value = c.seaState;
  const flat = {
    weatherTemp:c.temp, weatherCode:c.code, pressure:c.pressure, seaState:c.seaState, date:c.at.slice(0,10), ...extras,
  };
  const note = c.approx ? `<div class="cond-note-line">ora non indicata: uso le 12:00</div>` : '';
  const html = conditionsBadgesHTML(flat);
  _formEl('weatherPreview').innerHTML = html ? html + note : '';
  if(!html) toast('Meteo e mare non disponibili per questo istante');
}

/* Scarica e applica le condizioni per data e ora del form e posizione già presente. */
async function refreshConditionsForm(manual){
  const lat = numOrNull(_formEl('fLat').value), lng = numOrNull(_formEl('fLng').value);
  if(lat == null || lng == null){ if(manual) toast('Serve prima una posizione GPS'); return; }
  const date = _formEl('fDate').value;
  if(!date){ if(manual) toast('Inserisci una data'); return; }
  const token = ++_condReqToken;
  _formEl('weatherPreview').textContent = 'Rilevo meteo e mare per quella data e ora...';
  let c;
  try{
    c = await fetchConditionsAt(lat, lng, date, _formEl('fTime').value);
  }catch(e){
    if(token !== _condReqToken) return;
    _formEl('weatherPreview').textContent = '';
    toast('Meteo e mare non disponibili ora');
    return;
  }
  if(token !== _condReqToken) return;
  applyConditionsToForm(c);
  if(manual) toast('Meteo e mare aggiornati — salva per confermare');
}

async function useCurrentLocation(){
  if(!navigator.geolocation){ toast('Geolocalizzazione non disponibile'); return; }
  toast('Rilevo posizione GPS...');
  let pos;
  try{
    pos = await getBestPosition({onProgress: p=> showGpsAccuracy(p.accuracy, true)});
  }catch(err){
    showGpsAccuracy(null);
    toast('GPS: ' + (GPS_ERRORS[err && err.code] || 'impossibile rilevare la posizione'));
    return;
  }
  _formEl('fLat').value = pos.lat;
  _formEl('fLng').value = pos.lng;
  _formEl('fAccuracy').value = Math.round(pos.accuracy);
  showGpsAccuracy(pos.accuracy);
  refreshConditionsBtn();
  toast('Posizione registrata (±' + Math.round(pos.accuracy) + ' m)');
  await refreshConditionsForm(false);
}

/* se cambia data o ora e c'è già una posizione, le condizioni vengono riscaricate per il nuovo istante */
['fDate','fTime'].forEach(id=>{
  const el = document.getElementById(id);
  if(!el) return;
  el.addEventListener('change', ()=>{
    if(numOrNull(_formEl('fLat').value) == null) return;
    clearTimeout(_condDebounce);
    _condDebounce = setTimeout(()=> refreshConditionsForm(false), 500);
  });
});
