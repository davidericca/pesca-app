/* =====================================================================
   STORAGE.JS — Livello di persistenza dati (IndexedDB, con fallback
   automatico a localStorage se IndexedDB non è disponibile) più le
   funzioni di export/import/reset del backup.

   Tutto il resto dell'app continua a leggere/scrivere l'oggetto globale
   `data` in memoria esattamente come prima: cambia solo COME viene
   salvato su disco, non la forma dei dati né il resto della logica.
   ===================================================================== */

const STORAGE_KEY = 'pescaAppData_v1';   // vecchia chiave localStorage (usata per la migrazione una tantum)
const IDB_NAME = 'pescaAppDB';
const IDB_VERSION = 1;
const IDB_STORE = 'appData';
const IDB_KEY = 'main';

let data = { catches: [], customSpecies: [], poi: [] };

let _idbInstance = null;
let _idbBroken = false; // se true, usiamo il fallback localStorage per tutta la sessione

function _openIDB(){
  return new Promise((resolve, reject)=>{
    if(_idbInstance){ resolve(_idbInstance); return; }
    if(!('indexedDB' in window)){ reject(new Error('IndexedDB non supportato')); return; }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains(IDB_STORE)){
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = (e)=>{ _idbInstance = e.target.result; resolve(_idbInstance); };
    req.onerror = (e)=> reject(e.target.error);
  });
}

async function _idbGet(key){
  const db = await _openIDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const req = store.get(key);
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}

async function _idbSet(key, value){
  const db = await _openIDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req = store.put(value, key);
    req.onsuccess = ()=> resolve(true);
    req.onerror = ()=> reject(req.error);
  });
}

/* Migra automaticamente i dati dal vecchio localStorage (versioni precedenti
   dell'app) a IndexedDB, una sola volta, se IndexedDB risulta ancora vuoto. */
function _migrateFromLocalStorageIfNeeded(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed;
  }catch(e){ return null; }
}

/* Chiede al browser di non cancellare i dati in automatico (poco spazio, pulizia
   dei siti inattivi). Il browser può rifiutare: in quel caso non cambia nulla. */
function _requestPersistentStorage(){
  try{
    if(navigator.storage && navigator.storage.persist){
      navigator.storage.persist().catch(()=>{});
    }
  }catch(e){ /* non supportato: si va avanti normalmente */ }
}

async function loadData(){
  _requestPersistentStorage();
  try{
    let stored = await _idbGet(IDB_KEY);
    if(!stored){
      // primo avvio su IndexedDB: prova a recuperare eventuali dati salvati in precedenza
      const legacy = _migrateFromLocalStorageIfNeeded();
      if(legacy){
        stored = legacy;
        await _idbSet(IDB_KEY, stored);
      }
    }
    if(stored) data = stored;
  }catch(e){
    console.warn('IndexedDB non disponibile, uso localStorage come fallback:', e);
    _idbBroken = true;
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(raw) data = JSON.parse(raw);
    }catch(e2){ /* dati non recuperabili, si riparte da vuoto */ }
  }
  if(!data.catches) data.catches = [];
  if(!data.customSpecies) data.customSpecies = [];
  if(!data.poi) data.poi = [];
}

async function saveData(){
  if(_idbBroken){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch(e){ console.error('Salvataggio fallito (localStorage pieno?)', e); toast && toast('Errore nel salvataggio: spazio esaurito'); }
    return;
  }
  try{
    await _idbSet(IDB_KEY, data);
  }catch(e){
    console.error('Salvataggio IndexedDB fallito:', e);
    toast && toast('Errore nel salvataggio dei dati');
  }
}

function uid(){ return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

/* Data locale YYYY-MM-DD (toISOString darebbe la data UTC: vicino a mezzanotte sarebbe il giorno sbagliato) */
function localDateStr(d){
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

/* ===================== EXPORT / IMPORT ===================== */

function exportData(){
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'diario-pesca-backup-' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('Backup esportato');
}

function importData(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = function(ev){
    try{
      const imported = JSON.parse(ev.target.result);
      if(!imported.catches) throw new Error('formato non valido');
      data = { catches: imported.catches||[], customSpecies: imported.customSpecies||[], poi: imported.poi||[] };
      saveData();
      closeModal('modalSettings');
      toast('Backup importato');
      refreshCurrentView();
    }catch(err){
      toast('File non valido');
    }
  };
  reader.readAsText(file);
}

function wipeData(){
  if(!confirm('Cancellare TUTTI i dati salvati su questo dispositivo? Operazione irreversibile.')) return;
  data = {catches:[], customSpecies:[], poi:[]};
  saveData();
  closeModal('modalSettings');
  toast('Dati cancellati');
  refreshCurrentView();
}
