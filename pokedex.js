/* =====================================================================
   POKEDEX.JS — Database specie, statistiche per specie, gamification
   (XP, livelli, medaglie), rendering del Pokedex e scheda specie
   (con approfondimento Wikipedia).
   ===================================================================== */

const SPECIES_DB = [
  {id:'orata', name:'Orata', latin:'Sparus aurata', rarity:'non comune', glyph:'🐠', desc:'Riconoscibile dalla banda dorata tra gli occhi. Presente lungo tutta la costa ligure, ambitissima da riva e in barca.'},
  {id:'spigola', name:'Spigola (Branzino)', latin:'Dicentrarchus labrax', rarity:'non comune', glyph:'🐟', desc:'Predatore elegante e combattivo, molto insidiato con esche artificiali lungo le foci e le scogliere del Ponente ligure.'},
  {id:'sarago', name:'Sarago maggiore', latin:'Diplodus sargus', rarity:'comune', glyph:'🐟', desc:'Bande verticali scure sul corpo argentato, tipico delle scogliere di Spotorno e del savonese, molto diffidente.'},
  {id:'sarago_pizzuto', name:'Sarago pizzuto', latin:'Diplodus puntazzo', rarity:'comune', glyph:'🐟', desc:'Muso più appuntito del sarago maggiore, bande scure più marcate. Ama i fondali misti roccia-sabbia.'},
  {id:'occhiata', name:'Occhiata', latin:'Oblada melanura', rarity:'comune', glyph:'🐟', desc:'Piccola macchia scura vicino alla coda. Nuota in banchi numerosi vicino agli scogli, presenza fissa lungo la costa ligure.'},
  {id:'boga', name:'Boga', latin:'Boops boops', rarity:'comune', glyph:'🐟', desc:'Corpo affusolato e argentato, si muove in grandi banchi. Tra le catture più frequenti a canna fissa dagli scogli.'},
  {id:'salpa', name:'Salpa', latin:'Sarpa salpa', rarity:'comune', glyph:'🐟', desc:'Righe orizzontali dorate sul corpo. Si nutre di alghe sugli scogli, tipica delle acque basse e limpide del Ponente.'},
  {id:'tordo', name:'Tordo (Donzella)', latin:'Coris julis', rarity:'comune', glyph:'🐟', desc:'Corpo sinuoso e colorato, vive tra le rocce e le praterie di posidonia. Cattura classica della pesca a fondo sotto costa.'},
  {id:'menola', name:'Menola', latin:'Spicara maena', rarity:'comune', glyph:'🐟', desc:'Piccolo pesce argenteo simile alla boga, comune nei fondali sabbiosi vicino alla costa.'},
  {id:'muggine', name:'Muggine (Cefalo)', latin:'Mugil cephalus', rarity:'comune', glyph:'🐟', desc:'Diffusissimo nei porti e alle foci dei torrenti, come quelli tra Spotorno e Savona. Molto diffidente e difficile da ingannare.'},
  {id:'scorfano', name:'Scorfano', latin:'Scorpaena sp.', rarity:'comune', glyph:'🐡', desc:'Aspetto spinoso e mimetico, vive tra le rocce. Frequente nella pesca a fondo sotto costa: attenzione alle spine venefiche.'},
  {id:'aguglia', name:'Aguglia', latin:'Belone belone', rarity:'non comune', glyph:'🐟', desc:'Corpo lunghissimo e sottile, mascella a becco. Caccia in superficie vicino alla riva, soprattutto in primavera.'},
  {id:'ombrina', name:'Ombrina', latin:'Umbrina cirrosa', rarity:'raro', glyph:'🐟', desc:'Corpo argenteo con striature dorate, barbiglio corto sul mento. Preda ambita nella pesca a fondo su spiagge e foci.'},
  {id:'leccia', name:'Leccia', latin:'Lichia amia', rarity:'raro', glyph:'🐟', desc:'Grande predatore veloce e combattivo, caccia branchi di pesce foraggio vicino alla costa rocciosa.'},
  {id:'grongo', name:'Grongo', latin:'Conger conger', rarity:'non comune', glyph:'🐍', desc:'Corpo serpentiforme privo di scaglie, attivo di notte tra gli anfratti rocciosi. Classica cattura notturna dagli scogli.'},
  {id:'murena', name:'Murena', latin:'Muraena helena', rarity:'raro', glyph:'🐍', desc:'Livrea marmorizzata, si nasconde nelle tane tra gli scogli. Denti aguzzi: va maneggiata con molta attenzione.'},
  {id:'dentice', name:'Dentice', latin:'Dentex dentex', rarity:'raro', glyph:'🦈', desc:'Predatore pregiato e diffidente, un vero trofeo per chi pesca a spinning o traina lungo la costa ligure.'},
  {id:'ricciola', name:'Ricciola', latin:'Seriola dumerili', rarity:'raro', glyph:'🐟', desc:'Combattente instancabile, insidiata al largo di Spotorno e Savona con traina e jigging.'},
  {id:'palamita', name:'Palamita', latin:'Sarda sarda', rarity:'non comune', glyph:'🐟', desc:'Simile a un piccolo tonno, veloce e in branchi che cacciano in superficie, frequente in autunno nel Mar Ligure.'},
  {id:'sgombro', name:'Sgombro', latin:'Scomber scombrus', rarity:'comune', glyph:'🐟', desc:'Dorso a righe blu-verdi ondulate, nuota in banchi numerosi vicino alla superficie, comune tutto l\'anno.'},
  {id:'tonno', name:'Tonno', latin:'Thunnus thynnus', rarity:'raro', glyph:'🐋', desc:'Gigante pelagico velocissimo, avvistato al largo del Mar Ligure: cattura riservata a uscite in barca di grande impegno.'},
];

let pokedexFilter = 'tutte';

function allSpecies(){
  const custom = data.customSpecies.map(c => ({id:c.id, name:c.name, latin:'', habitat:'altro', rarity:'—', glyph:'🐟', desc:'Specie aggiunta manualmente.'}));
  return [...SPECIES_DB, ...custom];
}

function speciesById(id){ return allSpecies().find(s=>s.id===id); }

/* ===================== GAMIFICATION: XP, LIVELLI, MEDAGLIE ===================== */

const XP_BY_RARITY = {'comune':50, 'non comune':100, 'raro':200};

const LEVELS = [
  {name:'Principiante', xp:0},
  {name:'Pescatore', xp:300},
  {name:'Pescatore Esperto', xp:700},
  {name:'Maestro di Pesca', xp:1200},
  {name:'Cacciatore di Trofei', xp:1700},
  {name:'Leggenda del Mare', xp:2200},
];

function unlockedSpeciesCount(){
  return allSpecies().filter(s=>speciesStats(s.id).unlocked).length;
}

function xpForSpecies(s){
  return XP_BY_RARITY[s.rarity] || 50;
}

function totalXP(){
  return allSpecies().filter(s=>speciesStats(s.id).unlocked).reduce((sum,s)=>sum+xpForSpecies(s), 0);
}

function currentLevelInfo(){
  const xp = totalXP();
  let levelIdx = 0;
  for(let i=0;i<LEVELS.length;i++){ if(xp>=LEVELS[i].xp) levelIdx = i; }
  const current = LEVELS[levelIdx];
  const next = LEVELS[levelIdx+1] || null;
  const progressPct = next ? Math.min(100, Math.round((xp-current.xp)/(next.xp-current.xp)*100)) : 100;
  return {xp, levelIdx, levelName:current.name, levelNum:levelIdx+1, totalLevels:LEVELS.length, next, progressPct};
}

/* ===================== POKEDEX ===================== */

function speciesStats(id){
  const caught = data.catches.filter(c=>c.speciesId===id);
  if(caught.length===0) return {unlocked:false, count:0};
  const bestWeight = Math.max(...caught.map(c=>parseFloat(c.weight)||0));
  const bestLength = Math.max(...caught.map(c=>parseFloat(c.length)||0));
  const first = caught.reduce((a,b)=> a.date < b.date ? a : b);
  const last = caught.reduce((a,b)=> a.date > b.date ? a : b);
  const withPhoto = [...caught].sort((a,b)=> b.date.localeCompare(a.date)).find(c=>c.photo);
  return {unlocked:true, count:caught.length, bestWeight, bestLength, firstDate:first.date, firstPlace:first.place, lastDate:last.date, photo: withPhoto ? withPhoto.photo : null};
}

let pokedexViewMode = 'griglia'; // 'griglia' | 'cronologia'

function renderPokedex(){
  const grid = document.getElementById('pokedexGrid');
  const timeline = document.getElementById('pokedexTimeline');
  const gallery = document.getElementById('pokedexGallery');
  const filters = document.getElementById('pokedexFilters');
  const summary = document.getElementById('pokedexSummary');
  const species = allSpecies();

  const unlockedCount = unlockedSpeciesCount();
  const pct = Math.round(unlockedCount/species.length*100);
  const lvl = currentLevelInfo();

  /* Livello pescatore */
  document.getElementById('levelCard').innerHTML = `
    <div class="lvl-top">
      <div class="lvl-name">${lvl.levelName}</div>
      <div class="lvl-num">Livello ${lvl.levelNum}/${lvl.totalLevels}</div>
    </div>
    <div class="xp-bar-outer"><div class="xp-bar-inner" style="width:${lvl.progressPct}%;"></div></div>
    <div class="xp-label">${lvl.xp} XP${lvl.next ? ' · ' + (lvl.next.xp - lvl.xp) + ' XP al livello successivo' : ' · livello massimo raggiunto'}</div>
  `;

  /* Barra completamento pokedex */
  document.getElementById('pokedexProgressBar').style.width = pct + '%';
  document.getElementById('pokedexProgressLabel').textContent = `${unlockedCount}/${species.length} specie sbloccate (${pct}%)`;

  summary.innerHTML = `
    <div class="summary-card"><div class="num">${unlockedCount}/${species.length}</div><div class="lbl">Specie sbloccate</div></div>
    <div class="summary-card"><div class="num">${pct}%</div><div class="lbl">Completamento</div></div>
  `;

  /* Toggle vista griglia / cronologia / galleria */
  const viewToggle = document.getElementById('pokedexViewToggle');
  viewToggle.innerHTML = [['griglia','📋 Griglia'],['cronologia','🕓 Cronologia'],['galleria','🖼️ Galleria']].map(([k,l])=>
    `<button class="filter-chip ${pokedexViewMode===k?'active':''}" onclick="setPokedexViewMode('${k}')">${l}</button>`).join('');

  grid.style.display = 'none';
  timeline.style.display = 'none';
  gallery.style.display = 'none';
  filters.style.display = 'none';

  if(pokedexViewMode==='cronologia'){
    timeline.style.display = 'block';
    renderPokedexTimeline(timeline);
    return;
  }
  if(pokedexViewMode==='galleria'){
    gallery.style.display = 'block';
    renderGalleryFilters();
    renderGalleryGrid();
    return;
  }

  grid.style.display = '';
  filters.style.display = '';

  const cats = [['tutte','Tutte'],['unlocked','Sbloccate'],['comune','Comuni'],['non comune','Non comuni'],['raro','Rare']];
  filters.innerHTML = cats.map(([k,l])=>`<button class="filter-chip ${pokedexFilter===k?'active':''}" onclick="setPokedexFilter('${k}')">${l}</button>`).join('');

  let list = species;
  if(pokedexFilter==='unlocked') list = list.filter(s=>speciesStats(s.id).unlocked);
  else if(pokedexFilter!=='tutte') list = list.filter(s=>s.rarity===pokedexFilter);

  grid.innerHTML = list.map(s=>{
    const stat = speciesStats(s.id);
    const visual = stat.unlocked
      ? (stat.photo ? `<img src="${stat.photo}" alt="${s.name}">` : `<div class="glyph">${s.glyph}</div>`)
      : `<div class="glyph">❔</div>`;
    return `
      <div class="species-card ${stat.unlocked?'':'locked'}" onclick="openSpeciesModal('${s.id}')">
        ${stat.unlocked ? `<div class="stamp"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></div>` : ''}
        ${visual}
        <div class="name">${s.name}</div>
        <div class="tag">${stat.unlocked ? (stat.count+' catt.') : s.rarity}</div>
      </div>`;
  }).join('');
}

function setPokedexFilter(k){ pokedexFilter = k; renderPokedex(); }

function setPokedexViewMode(k){ pokedexViewMode = k; renderPokedex(); }

function renderPokedexTimeline(container){
  const species = allSpecies().filter(s=>speciesStats(s.id).unlocked);
  const events = species.map(s=>({s, stat:speciesStats(s.id)})).sort((a,b)=> b.stat.firstDate.localeCompare(a.stat.firstDate));
  if(events.length===0){
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12s4-6 10-6c4 0 7 3 10 6-3 3-6 6-10 6-6 0-10-6-10-6Z"/></svg>
        <p>Ancora nessuna specie sbloccata.<br>La cronologia si riempirà con le tue catture.</p>
      </div>`;
    return;
  }
  container.innerHTML = events.map(({s,stat})=>{
    const thumb = stat.photo ? `<img class="tl-thumb" src="${stat.photo}" alt="">` : `<div class="tl-thumb">${s.glyph}</div>`;
    return `
      <div class="timeline-item" onclick="openSpeciesModal('${s.id}')">
        ${thumb}
        <div class="tl-info">
          <div class="tl-name">${s.name}</div>
          <div class="tl-date">sbloccata il ${fmtDate(stat.firstDate)} · +${xpForSpecies(s)} XP</div>
        </div>
      </div>`;
  }).join('');
}

function showUnlockAnimation(speciesId){
  const s = speciesById(speciesId);
  if(!s) return;
  const stat = speciesStats(speciesId);
  const xp = xpForSpecies(s);
  const visual = stat.photo
    ? `<img src="${stat.photo}" alt="">`
    : `<div class="unlock-glyph">${s.glyph}</div>`;
  document.getElementById('unlockContent').innerHTML = `
    <div class="unlock-burst">Nuova specie sbloccata!</div>
    ${stat.photo ? `<div class="unlock-glyph">${visual}</div>` : visual}
    <div class="unlock-name">${s.name}</div>
    <div class="unlock-xp">+${xp} XP</div>
  `;
  const confettiLayer = document.getElementById('confettiLayer');
  const colors = ['#C97C3D','#1C6E8C','#4C7A5E','#EFE6D5','#A85A28'];
  confettiLayer.innerHTML = Array.from({length:26}).map(()=>{
    const left = Math.random()*100;
    const delay = Math.random()*0.4;
    const dur = 1.2 + Math.random()*0.8;
    const color = colors[Math.floor(Math.random()*colors.length)];
    const rotate = Math.random()>0.5 ? '50%' : '2px';
    return `<div class="confetti-piece" style="left:${left}%; background:${color}; border-radius:${rotate}; animation-delay:${delay}s; animation-duration:${dur}s;"></div>`;
  }).join('');
  openModal('modalUnlock');
}

function openSpeciesModal(id){
  const s = speciesById(id);
  const stat = speciesStats(id);
  const content = document.getElementById('speciesDetailContent');
  if(!stat.unlocked){
    content.innerHTML = `
      <div class="species-detail-head" style="opacity:0.6;">
        <div class="glyph">❔</div>
        <h2>${s.name}</h2>
        <div class="latin">Non ancora pescata — registra una cattura per sbloccarla</div>
      </div>
      <div class="desc-box">Rarità stimata: ${s.rarity}.</div>`;
  } else {
    const headVisual = stat.photo
      ? `<img src="${stat.photo}" style="width:96px;height:96px;object-fit:cover;border-radius:18px;border:2px solid var(--line);">`
      : `<div class="glyph">${s.glyph}</div>`;
    content.innerHTML = `
      <div class="species-detail-head">
        ${headVisual}
        <h2>${s.name}</h2>
        <div class="latin">${s.latin || ''}</div>
      </div>
      <div class="detail-stats">
        <div class="st"><div class="v">${stat.count}</div><div class="k">Catture</div></div>
        <div class="st"><div class="v">${stat.bestWeight? stat.bestWeight+' kg' : '—'}</div><div class="k">Record peso</div></div>
        <div class="st"><div class="v">${stat.bestLength? stat.bestLength+' cm' : '—'}</div><div class="k">Record lung.</div></div>
      </div>
      <div class="desc-box">${s.desc || ''}<br><br><b>Prima cattura:</b> ${fmtDate(stat.firstDate)}${stat.firstPlace? ' — '+stat.firstPlace: ''}<br><b>Ultima cattura:</b> ${fmtDate(stat.lastDate)}</div>
      <div id="wikiBox" style="margin-top:12px;"></div>`;
    loadWikiInfo(s);
  }
  openModal('modalSpecies');
}

/* Wikipedia REST API: gratuita, senza chiave, contenuto CC BY-SA con link alla fonte */

async function fetchWikiSummary(candidates){
  for(const title of candidates){
    try{
      const res = await fetch('https://it.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title));
      if(!res.ok) continue;
      const j = await res.json();
      if(j.extract) return j;
    }catch(e){ /* prova il prossimo candidato */ }
  }
  return null;
}

async function loadWikiInfo(s){
  const box = document.getElementById('wikiBox');
  if(!box) return;
  box.innerHTML = `<div class="desc-box" style="color:var(--ink-soft); font-size:12px;">Cerco la scheda su Wikipedia...</div>`;
  const candidates = [s.name, s.latin].filter(Boolean);
  const wiki = await fetchWikiSummary(candidates);
  if(!document.getElementById('wikiBox')) return; // modale chiuso nel frattempo
  if(!wiki){
    box.innerHTML = '';
    return;
  }
  const img = wiki.thumbnail ? `<img src="${wiki.thumbnail.source}" style="width:100%; border-radius:12px; margin-bottom:10px; display:block;">` : '';
  box.innerHTML = `
    <div class="desc-box">
      ${img}
      <b>Da Wikipedia</b><br>${wiki.extract}
      <br><br><a href="${wiki.content_urls?.desktop?.page || ('https://it.wikipedia.org/wiki/'+encodeURIComponent(wiki.title))}" target="_blank" rel="noopener" style="color:var(--teal); font-family:var(--font-mono); font-size:11px;">Leggi su Wikipedia →</a>
    </div>`;
}
