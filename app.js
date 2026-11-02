// IL MIO ORTO – fase 1
'use strict';

/* ============ utilità ============ */
const $ = (s, el = document) => el.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MESI = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
const STATI = ['Da seminare','Seminata','Germinata','In crescita','Da trapiantare','In fioritura','In produzione','Pronta per la raccolta','Raccolta completata','Terminata'];
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtData = s => s ? new Date(s + 'T12:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtOra = t => new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
const giorniDa = s => s ? Math.round((new Date(s + 'T12:00') - new Date(ymd(new Date()) + 'T12:00')) / 864e5) : null;
const newId = () => 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ============ database locale (IndexedDB) ============ */
let dbp;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('ilmioorto', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      ['plants', 'photos', 'waterings', 'diagnoses'].forEach(n => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: 'id' }); });
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
const dbAll = s => tx(s, 'readonly', st => st.getAll()).then(r => r || []);
const dbGet = (s, k) => tx(s, 'readonly', st => st.get(k));
const dbPut = (s, obj) => tx(s, 'readwrite', st => st.put(obj));
const dbDel = (s, k) => tx(s, 'readwrite', st => st.delete(k));
const dbClear = s => tx(s, 'readwrite', st => st.clear());

/* ============ impostazioni ============ */
// Le coordinate iniziali sono approssimative: si possono correggere in Impostazioni con la ricerca della località.
const DEF = { nome: 'Il mio orto', luogo: 'Gallicano nel Lazio (RM)', lat: 41.8667, lon: 12.8833 };
async function getSettings() { const v = await tx('settings', 'readonly', st => st.get('main')); return { ...DEF, ...(v || {}) }; }
async function saveSettings(patch) { const cur = await getSettings(); await tx('settings', 'readwrite', st => st.put({ ...cur, ...patch }, 'main')); }

/* ============ meteo (Open-Meteo, senza chiave) ============ */
async function getWeather(force = false) {
  const s = await getSettings();
  const key = `meteo:${Number(s.lat).toFixed(3)},${Number(s.lon).toFixed(3)}`;
  const cache = JSON.parse(localStorage.getItem(key) || 'null');
  if (!force && cache && Date.now() - cache.t < 30 * 60e3) return { ...cache, fresh: true };
  try {
    const q = new URLSearchParams({
      latitude: s.lat, longitude: s.lon, timezone: 'Europe/Rome', forecast_days: 10, wind_speed_unit: 'kmh',
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m',
      hourly: 'temperature_2m,precipitation_probability,precipitation,wind_speed_10m,relative_humidity_2m,uv_index,visibility,weather_code',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,uv_index_max'
    });
    const r = await fetch('https://api.open-meteo.com/v1/forecast?' + q);
    if (!r.ok) throw new Error('servizio meteo non disponibile (' + r.status + ')');
    const j = await r.json();
    const data = { t: Date.now(), j, luogo: s.luogo };
    localStorage.setItem(key, JSON.stringify(data));
    return { ...data, fresh: true };
  } catch (e) {
    return cache ? { ...cache, fresh: false, err: e.message } : { err: e.message || 'connessione assente' };
  }
}
// indice nelle previsioni orarie corrispondente all'ora attuale
function hIdx(j) {
  const i = j.hourly.time.indexOf(j.current.time.slice(0, 13) + ':00');
  return i < 0 ? 0 : i;
}
const WMO = {
  0: ['Sereno', '☀️', 'sole'], 1: ['Prevalentemente sereno', '🌤️', 'sole'], 2: ['Parzialmente nuvoloso', '⛅', 'nuvole'], 3: ['Coperto', '☁️', 'nuvole_scure'],
  45: ['Nebbia', '🌫️', 'nebbia'], 48: ['Nebbia con brina', '🌫️', 'nebbia'],
  51: ['Pioviggine', '🌦️', 'pioggia'], 53: ['Pioviggine', '🌦️', 'pioggia'], 55: ['Pioviggine intensa', '🌧️', 'pioggia'],
  61: ['Pioggia debole', '🌦️', 'pioggia'], 63: ['Pioggia', '🌧️', 'pioggia'], 65: ['Pioggia forte', '🌧️', 'pioggia'],
  66: ['Pioggia gelata', '🌧️', 'neve'], 67: ['Pioggia gelata forte', '🌧️', 'neve'],
  71: ['Neve debole', '🌨️', 'neve'], 73: ['Neve', '🌨️', 'neve'], 75: ['Neve forte', '❄️', 'neve'], 77: ['Nevischio', '🌨️', 'neve'],
  80: ['Rovesci', '🌦️', 'pioggia'], 81: ['Rovesci', '🌧️', 'pioggia'], 82: ['Rovesci forti', '⛈️', 'temporale'],
  85: ['Nevicate a rovesci', '🌨️', 'neve'], 86: ['Nevicate forti a rovesci', '❄️', 'neve'],
  95: ['Temporale', '⛈️', 'temporale'], 96: ['Temporale con grandine', '⛈️', 'temporale'], 99: ['Temporale forte con grandine', '⛈️', 'temporale']
};
const condizione = code => WMO[code] || ['Non disponibile', '🌡️', 'nuvole'];
function sceneKind(code, isDay, hour) {
  let k = condizione(code)[2];
  if (!isDay && (k === 'sole' || k === 'nuvole')) return 'notte';
  if (isDay && k === 'sole' && hour >= 18 && hour <= 20) return 'tramonto';
  return k;
}
const DIR = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const dirVento = deg => DIR[Math.round(deg / 45) % 8];
const rnd = (a, b) => a + Math.random() * (b - a);

// Animazione meteo: elementi decorativi generati in modo casuale ma stabile per ogni render
function sceneHTML(kind, isDay, content) {
  let fx = '';
  const cloud = (scura) => `<b class="cloud ${scura ? 'scura' : ''}" style="top:${rnd(4, 60)}%;animation-duration:${rnd(25, 45)}s;animation-delay:-${rnd(0, 40)}s"></b>`;
  const drops = n => Array.from({ length: n }, () => `<i class="drop" style="left:${rnd(0, 100)}%;animation-duration:${rnd(.6, 1.2)}s;animation-delay:-${rnd(0, 1.5)}s"></i>`).join('');
  const ripples = n => Array.from({ length: n }, () => `<i class="ripple" style="left:${rnd(5, 85)}%;top:${rnd(62, 92)}%;animation-delay:-${rnd(0, 3)}s"></i>`).join('');
  const flakes = n => Array.from({ length: n }, () => `<i class="flake" style="left:${rnd(0, 100)}%;animation-duration:${rnd(5, 9)}s;animation-delay:-${rnd(0, 9)}s">❄</i>`).join('');
  const stars = n => Array.from({ length: n }, () => `<i class="star" style="left:${rnd(0, 100)}%;top:${rnd(0, 100)}%;animation-delay:-${rnd(0, 3)}s"></i>`).join('');
  const fog = `<i class="fog" style="top:20%"></i><i class="fog" style="top:55%;animation-duration:16s"></i>`;
  switch (kind) {
    case 'sole': fx = `<div class="sun"><div class="rays"></div></div>${cloud(false)}`; break;
    case 'tramonto': fx = `<div class="sun" style="top:auto;bottom:-40px;right:30%"><div class="rays"></div></div>`; break;
    case 'nuvole': fx = cloud(false) + cloud(false); break;
    case 'nuvole_scure': fx = cloud(true) + cloud(true) + cloud(true); break;
    case 'pioggia': fx = cloud(true) + drops(60) + ripples(10); break;
    case 'temporale': fx = cloud(true) + cloud(true) + drops(70) + ripples(10) + `<div class="flash"></div>`; break;
    case 'neve': fx = flakes(50); break;
    case 'nebbia': fx = fog; break;
    case 'notte': fx = stars(60) + `<div class="moon"></div>`; break;
  }
  if (!isDay && kind !== 'notte' && kind !== 'tramonto') fx = stars(30) + fx;
  return `<section class="scene scene-${kind}">${fx}<div class="content">${content}</div></section>`;
}

/* ============ luna (calcolo locale) ============ */
const SINODICO = 29.530588853;
function etaLuna(d) {
  const ref = Date.UTC(2000, 0, 6, 18, 14) / 864e5;
  let e = (d.getTime() / 864e5 - ref) % SINODICO;
  return e < 0 ? e + SINODICO : e;
}
function fasiLuna(d) {
  const e = etaLuna(d);
  if (e < 1.85) return { nome: 'Luna nuova', ico: '🌑' };
  if (e < 7.38) return { nome: 'Luna crescente', ico: '🌒' };
  if (e < 9.22) return { nome: 'Primo quarto', ico: '🌓' };
  if (e < 14.77) return { nome: 'Luna crescente', ico: '🌔' };
  if (e < 16.61) return { nome: 'Luna piena', ico: '🌕' };
  if (e < 22.15) return { nome: 'Luna calante', ico: '🌖' };
  if (e < 23.99) return { nome: 'Ultimo quarto', ico: '🌗' };
  return { nome: 'Luna calante', ico: '🌘' };
}
function prossimaLuna(target) {
  let t = new Date(), prev = etaLuna(t);
  for (let i = 0; i < 24 * 40; i++) {
    t = new Date(t.getTime() + 36e5);
    const e = etaLuna(t);
    if (target === 'nuova' ? e < prev : (prev < 14.765 && e >= 14.765)) return t;
    prev = e;
  }
  return null;
}

/* ============ calendario agricolo (indicativo, centro Italia) ============ */
const MESE_DATI = [
  { semina: ['Nessuna semina all\'aperto'], semenzaio: [], trapianto: [], raccolta: ['Cavoli', 'Spinaci', 'Bietole', 'Porri'], lavori: ['Pianifica la rotazione delle aiuole', 'Distribuisci letame maturo sul terreno libero'] },
  { semina: ['Fave (metà-fine mese, se il clima lo consente)', 'Spinaci'], semenzaio: ['Pomodoro', 'Peperone', 'Melanzana'], trapianto: [], raccolta: ['Cavoli', 'Bietole'], lavori: ['Prepara il terreno, senza lavorarlo se è bagnato'] },
  { semina: ['Carota', 'Ravanello', 'Lattuga', 'Spinaci', 'Piselli', 'Fave'], semenzaio: ['Zucchina', 'Cetriolo', 'Basilico'], trapianto: ['Cavolo', 'Cipolla (piantine)'], raccolta: ['Spinaci', 'Ravanelli'], lavori: ['Pacciamatura dove il terreno è scoperto'] },
  { semina: ['Fagiolo (fine mese)', 'Zucca', 'Bietola'], semenzaio: ['Pomodoro', 'Melanzana', 'Peperone'], trapianto: ['Lattuga', 'Cavolo'], raccolta: ['Ravanelli', 'Spinaci'], lavori: ['Controlla tutori e legature'] },
  { semina: ['Fagiolo', 'Zucchina', 'Cetriolo', 'Carota tardiva'], semenzaio: [], trapianto: ['Pomodoro (dopo le gelate)', 'Peperone', 'Melanzana', 'Zucchina'], raccolta: ['Lattuga', 'Piselli'], lavori: ['Inizia le annaffiature regolari'] },
  { semina: ['Fagiolo', 'Zucchina'], semenzaio: [], trapianto: ['Trapianti tardivi'], raccolta: ['Fave', 'Piselli', 'Lattuga', 'Ravanelli'], lavori: ['Pacciamatura per trattenere l\'umidità'] },
  { semina: ['Insalate per l\'autunno (fine mese)'], semenzaio: [], trapianto: [], raccolta: ['Pomodoro', 'Zucchina', 'Fagiolo', 'Cetriolo'], lavori: ['Controlla le irrigazioni nelle ore fresche'] },
  { semina: ['Cicoria', 'Spinaci (per l\'autunno)', 'Ravanelli'], semenzaio: ['Cavoli per l\'autunno'], trapianto: [], raccolta: ['Pomodoro', 'Peperone', 'Melanzana'], lavori: ['Rimuovi le piante a fine ciclo'] },
  { semina: ['Spinaci', 'Ravanelli', 'Carote', 'Fave (fine mese)'], semenzaio: [], trapianto: ['Cavoli e broccoli'], raccolta: ['Zucchina', 'Fagiolo', 'Pomodoro'], lavori: ['Concima con compost'] },
  { semina: ['Aglio (inizio-metà mese, in zone temperate)'], semenzaio: [], trapianto: ['Cipolla', 'Aglio'], raccolta: ['Zucca', 'Carota', 'Cavolo'], lavori: ['Prepara compost e cumuli di sfalci'] },
  { semina: ['Fave', 'Aglio'], semenzaio: [], trapianto: ['Cipolla'], raccolta: ['Zucca', 'Cavolo'], lavori: ['Pacciama le aiuole scoperte'] },
  { semina: [], semenzaio: [], trapianto: [], raccolta: ['Cavoli', 'Porri'], lavori: ['Pulizia dell\'orto e programmazione dell\'anno'] }
];

/* ============ scheda ortaggi (indicativa) ============ */
const ORTAGGI = [
  { id: 'pomodoro', nome: 'Pomodoro', famiglia: 'Solanacee', descrizione: 'Ortaggio da frutto a ciclo estivo, molto esigente di sole e calore.', semina: 'Febbraio-marzo, in semenzaio protetto', trapianto: 'Maggio, a gelate finite', germinazione: '7-14 giorni', maturazione: '70-100 giorni dal trapianto, secondo la varietà', profondita: '0,5-1 cm', distPiante: '50-60 cm', distFile: '80-100 cm', esposizione: 'Pieno sole', terreno: 'Profondo, ben drenato, ricco di sostanza organica', acqua: 'Regolare: evita sbalzi, che favoriscono i marciumi', concimazione: 'Compost prima del trapianto, poi concime ricco di potassio in fioritura', potatura: 'Tutori e, secondo la varietà, cimatura e speronatura', malattie: 'Peronospora, alternaria, marciume apicale', parassiti: 'Afidi, nottue, ragnetto rosso', raccolta: 'Quando i frutti sono ben colorati', conservazione: 'Pochi giorni a temperatura ambiente; per più tempo conserve o essiccazione' },
  { id: 'zucchina', nome: 'Zucchina', famiglia: 'Cucurbitacee', descrizione: 'Pianta vigorosa e produttiva, molto esposta a oidio e attacchi di insetti.', semina: 'Marzo in semenzaio, o aprile-maggio direttamente in terra', trapianto: 'Maggio, a clima stabile', germinazione: '5-10 giorni', maturazione: '50-60 giorni', profondita: '2-3 cm', distPiante: '80-100 cm', distFile: '100-120 cm', esposizione: 'Pieno sole', terreno: 'Fertile e profondo, con buona sostanza organica', acqua: 'Abbondante durante la fruttificazione, alla base della pianta', concimazione: 'Compost e letame maturo prima dell\'impianto', potatura: 'Eliminare le foglie secche o ammalate', malattie: 'Oidio, marciumi del colletto', parassiti: 'Afidi, mosca bianca, lumache', raccolta: 'Frutti di 15-20 cm, raccolti spesso', conservazione: 'Qualche giorno in frigorifero' },
  { id: 'melanzana', nome: 'Melanzana', famiglia: 'Solanacee', descrizione: 'Ortaggio estivo che ama il caldo, simile al pomodoro nelle esigenze.', semina: 'Febbraio-marzo, in ambiente protetto', trapianto: 'Maggio-giugno', germinazione: '10-15 giorni', maturazione: '90-120 giorni dalla semina', profondita: '0,5-1 cm', distPiante: '50-70 cm', distFile: '80-100 cm', esposizione: 'Pieno sole', terreno: 'Profondo e ben drenato', acqua: 'Regolare, senza ristagni', concimazione: 'Compost prima del trapianto, poi concime equilibrato', potatura: 'Tutore; eliminare i rami troppo fitti', malattie: 'Oidio, marciume del colletto', parassiti: 'Ragnetto rosso, afidi, altica', raccolta: 'Quando la buccia è lucida e tesa', conservazione: 'Breve periodo in frigorifero' },
  { id: 'peperone', nome: 'Peperone', famiglia: 'Solanacee', descrizione: 'Ortaggio da fine estate, con frutti da raccogliere più volte.', semina: 'Febbraio-marzo, in semenzaio protetto', trapianto: 'Maggio, a temperature stabili', germinazione: '10-20 giorni', maturazione: '70-90 giorni dal trapianto', profondita: '0,5 cm', distPiante: '40-50 cm', distFile: '70-80 cm', esposizione: 'Pieno sole', terreno: 'Fertile e ben drenato', acqua: 'Regolare, con attenzione ai periodi di caldo', concimazione: 'Compost prima del trapianto, poi concime per frutti', potatura: 'Tutore leggero', malattie: 'Marciumi, virosi', parassiti: 'Afidi, ragnetto rosso', raccolta: 'Frutti sodi e di colore pieno', conservazione: 'Qualche giorno in frigorifero' },
  { id: 'lattuga', nome: 'Lattuga', famiglia: 'Asteraceae', descrizione: 'Insalata a ciclo rapido, adatta a semine scalari per raccolte continue.', semina: 'Marzo-settembre, a intervalli di 2-3 settimane', trapianto: 'Da piantine, dopo 3-4 settimane di semenzaio', germinazione: '5-10 giorni', maturazione: '45-60 giorni', profondita: '0,5 cm', distPiante: '25-30 cm', distFile: '30 cm', esposizione: 'Sole o mezz\'ombra in estate', terreno: 'Leggero, fresco, ben drenato', acqua: 'Frequente e leggera, soprattutto in estate', concimazione: 'Compost prima della semina', potatura: 'Nessuna', malattie: 'Marciume basale, peronospora', parassiti: 'Lumache, afidi', raccolta: 'Quando le foglie sono sviluppate', conservazione: 'Pochi giorni in frigorifero' },
  { id: 'carota', nome: 'Carota', famiglia: 'Apiaceae', descrizione: 'Radice da semina diretta, con terreno sciolto e privo di sassi.', semina: 'Marzo-luglio, direttamente in terra', trapianto: 'Non si trapianta', germinazione: '14-21 giorni', maturazione: '70-100 giorni', profondita: '0,5-1 cm', distPiante: '5 cm (diradare)', distFile: '25-30 cm', esposizione: 'Pieno sole o mezz\'ombra', terreno: 'Sciolto, profondo, senza sassi', acqua: 'Regolare durante la germinazione', concimazione: 'Compost ben maturo, nessun letame fresco', potatura: 'Diradamento delle piantine', malattie: 'Alternaria, marciume', parassiti: 'Mosca della carota', raccolta: 'Quando il colletto supera i 1-2 cm di diametro', conservazione: 'In frigorifero o in sabbia umida' },
  { id: 'fagiolo', nome: 'Fagiolo', famiglia: 'Leguminose', descrizione: 'Leguminosa che migliora la fertilità del terreno; sensibile al freddo.', semina: 'Aprile-giugno, in terra calda', trapianto: 'Non si trapianta', germinazione: '7-10 giorni', maturazione: '60-90 giorni', profondita: '3-4 cm', distPiante: '10 cm', distFile: '40-50 cm', esposizione: 'Pieno sole', terreno: 'Medio impasto, ben drenato', acqua: 'Moderata; evitare ristagni', concimazione: 'Poca concimazione azotata', potatura: 'Tutori per le varietà rampicanti', malattie: 'Antracnosi, ruggine', parassiti: 'Afidi, ragnetto rosso', raccolta: 'Baccelli ben formati e non fibrosi', conservazione: 'In frigorifero o essiccati' },
  { id: 'cipolla', nome: 'Cipolla', famiglia: 'Liliacee e Amaryllidaceae', descrizione: 'Bulbo da coltivare in inverno o in primavera, con poca acqua in maturazione.', semina: 'Febbraio-marzo in semenzaio, o trapianto di bulbilli in autunno', trapianto: 'Marzo-aprile', germinazione: '10-15 giorni', maturazione: '120-150 giorni', profondita: '1 cm', distPiante: '10 cm', distFile: '30 cm', esposizione: 'Pieno sole', terreno: 'Leggero, ben drenato', acqua: 'Regolare in crescita, ridotta a maturazione', concimazione: 'Compost prima dell\'impianto', potatura: 'Nessuna', malattie: 'Peronospora, marciume del bulbo', parassiti: 'Mosca della cipolla, tripidi', raccolta: 'Quando le foglie si piegano e ingialliscono', conservazione: 'Bulbi asciutti in luogo ventilato' }
];

/* ============ diagnosi guidata (senza AI) ============ */
const SINTOMI = {
  macchie:      { label: 'Macchie sulle foglie', gravita: 'media', esperto: false, cause: ['Malattie fungine (es. peronospora, alternaria, oidio)', 'Batteriosi', 'Carenze di magnesio o potassio'], rimedi: ['Rimuovi e smaltisci le foglie colpite, non nel compost', 'Annaffia alla base, evitando di bagnare il fogliame', 'Migliora la circolazione d\'aria tra le piante'], prevenzione: 'Rotazione delle colture, distanze adeguate, irrigazione al mattino' },
  ingiallimento:{ label: 'Ingiallimento', gravita: 'media', esperto: false, cause: ['Carenza di azoto', 'Eccesso o difetto di acqua', 'Radici danneggiate o ristagno'], rimedi: ['Controlla l\'umidità del terreno a 3-4 cm prima di annaffiare', 'Verifica che il terreno sia drenante', 'Se persiste, considera un\'analisi del terreno'], prevenzione: 'Concimazione equilibrata e irrigazione regolare' },
  muffa:        { label: 'Muffe', gravita: 'alta', esperto: true, cause: ['Umidità elevata e poca ventilazione', 'Ristagno d\'acqua', 'Muffe grigie (botrite) o oidio'], rimedi: ['Riduci le annaffiature e non bagnare le foglie', 'Rimuovi le parti colpite', 'Migliora la ventilazione tra le piante'], prevenzione: 'Distanze adeguate, potature di sfoltimento, terreno drenante' },
  arricciate:   { label: 'Foglie arricciate', gravita: 'media', esperto: false, cause: ['Afidi o altri insetti succhiatori', 'Virosi trasmesse dagli insetti', 'Stress idrico o sbalzi termici'], rimedi: ['Controlla la pagina inferiore delle foglie', 'Elimina le piante molto colpite se sospetti virosi', 'Ripristina un\'irrigazione regolare'], prevenzione: 'Controllo periodico degli insetti e uso di varietà sane' },
  buchi:        { label: 'Buchi nelle foglie', gravita: 'bassa', esperto: false, cause: ['Lumache e limacce', 'Bruchi o coleotteri', 'Grandine o danni meccanici'], rimedi: ['Controlla di sera o di notte lumache e larve', 'Usa barriere fisiche o trappole', 'Ispeziona la pagina inferiore delle foglie'], prevenzione: 'Pulizia delle erbe infestanti e del terreno intorno' },
  marciume:     { label: 'Marciume su frutti o colletto', gravita: 'alta', esperto: true, cause: ['Marciume fungino o batterico', 'Irrigazione irregolare (es. marciume apicale)', 'Frutti a contatto con il terreno umido'], rimedi: ['Rimuovi i frutti colpiti', 'Mantieni un\'irrigazione regolare', 'Solleva i frutti con pacciamatura o tutori'], prevenzione: 'Irrigazione costante, pacciamatura, rotazione' },
  crescita:     { label: 'Crescita rallentata', gravita: 'media', esperto: false, cause: ['Carenze nutritive', 'Problemi alle radici (compattamento, ristagno)', 'Temperature troppo basse o troppo alte'], rimedi: ['Verifica terreno e drenaggio', 'Concima con prodotti organici, seguendo l\'etichetta', 'Controlla le radici se la pianta si può estrarre senza danni'], prevenzione: 'Terreno ricco di sostanza organica e rotazione' },
  insetti:      { label: 'Insetti visibili', gravita: 'media', esperto: false, cause: ['Afidi, cocciniglie, ragnetto rosso, mosca bianca', 'Larve o bruchi sulla pianta'], rimedi: ['Rimozione manuale o getto d\'acqua per gli afidi', 'Osserva la pagina inferiore delle foglie ogni pochi giorni'], prevenzione: 'Ispezioni regolari e presenza di insetti utili' }
};
const LIVELLO = { bassa: 1, media: 2, alta: 3 };

/* ============ consigli basati sul meteo ============ */
function consiglioMeteo(j) {
  const i = hIdx(j), out = [];
  const d = j.daily;
  const pioggia2g = (d.precipitation_sum[0] || 0) + (d.precipitation_sum[1] || 0);
  const tmin = d.temperature_2m_min[0], tmax = d.temperature_2m_max[0];
  const ventoMax = Math.max(...j.hourly.wind_speed_10m.slice(i, i + 24));
  const umidMedia = j.hourly.relative_humidity_2m.slice(i, i + 24).reduce((a, b) => a + b, 0) / 24;
  if (pioggia2g >= 5) out.push({ ico: '🌧️', tipo: 'acqua', testo: `Previste circa ${pioggia2g.toFixed(0)} mm di pioggia nei prossimi due giorni: evita irrigazioni inutili.` });
  if (tmin <= 2) out.push({ ico: '🥶', tipo: 'allerta', testo: `Minima prevista di ${tmin.toFixed(0)}°C: proteggi le piante sensibili con tessuto non tessuto o coperture.` });
  if (tmax >= 32) out.push({ ico: '🔥', tipo: 'allerta', testo: `Massima prevista di ${tmax.toFixed(0)}°C: annaffia al mattino presto e pacciama per trattenere l'umidità.` });
  if (ventoMax >= 40) out.push({ ico: '💨', tipo: 'allerta', testo: `Vento fino a ${ventoMax.toFixed(0)} km/h: controlla tutori, legature e coperture.` });
  if (umidMedia >= 85) out.push({ ico: '💧', tipo: 'avviso', testo: 'Umidità elevata nelle prossime ore: condizioni favorevoli alle malattie fungine, evita di bagnare le foglie.' });
  return out;
}
function consigliOrto(j, piante) {
  const out = j ? consiglioMeteo(j) : [];
  const m = MESE_DATI[new Date().getMonth()];
  if (!piante.length) out.push({ ico: '🌱', tipo: 'info', testo: 'Non hai ancora registrato colture: aggiungile per ricevere consigli personalizzati.' });
  piante.filter(p => p.stato === 'Da trapiantare').forEach(p => out.push({ ico: '🪴', tipo: 'info', testo: `${esc(p.nome)}: è pronta per il trapianto.` }));
  piante.filter(p => p.stato === 'Pronta per la raccolta').forEach(p => out.push({ ico: '🧺', tipo: 'info', testo: `${esc(p.nome)}: pronta per la raccolta.` }));
  m.lavori.forEach(t => out.push({ ico: '🛠️', tipo: 'info', testo: t }));
  return out;
}
function consigloIrrigazione(j) {
  const d = j.daily, pioggia2g = (d.precipitation_sum[0] || 0) + (d.precipitation_sum[1] || 0);
  if (pioggia2g >= 5) return 'Sono previste piogge consistenti: evita le irrigazioni e controlla il terreno dopo la pioggia.';
  if (d.temperature_2m_max[0] >= 30) return 'Caldo intenso: controlla il terreno ogni giorno, annaffia al mattino presto, in profondità e alla base.';
  const m = new Date().getMonth();
  if (m >= 5 && m <= 8) return 'Stagione calda: indicativamente 2-3 volte a settimana, ma verifica prima il terreno a 3-4 cm di profondità.';
  return 'Stagione più fresca: annaffia solo quando il terreno è asciutto in profondità.';
}

/* ============ moduli dei form (dichiarati prima dell'uso) ============ */
const forms = {};

/* ============ rendering: meteo ============ */
function cardMeteoCompatta(w) {
  const c = w.j.current, d = w.j.daily, cond = condizione(c.weather_code);
  const kind = sceneKind(c.weather_code, c.is_day, new Date().getHours());
  const badge = w.fresh ? `<span class="tag-fresh">Aggiornato alle ${fmtOra(w.t)}</span>` : `<span class="tag-stale">Dati memorizzati del ${fmtOra(w.t)} (non aggiornati)</span>`;
  return sceneHTML(kind, c.is_day, `
    <div class="top"><div><div>${esc(w.luogo || '')}</div><div class="big-temp">${Math.round(c.temperature_2m)}°</div>
    <div>${cond[1]} ${cond[0]}</div></div>
    <div style="text-align:right">Max ${Math.round(d.temperature_2m_max[0])}° · Min ${Math.round(d.temperature_2m_min[0])}°<br>${badge}</div></div>`);
}

async function pageMeteo() {
  const w = await getWeather(), s = await getSettings();
  if (!w.j) {
    $('#app').innerHTML = `<h1>Meteo</h1><div class="card err">Meteo non disponibile: ${esc(w.err)}.</div>${linkImpostazioni()}`;
    return;
  }
  const j = w.j, c = j.current, i = hIdx(j), d = j.daily, h = j.hourly;
  const cond = condizione(c.weather_code);
  const kind = sceneKind(c.weather_code, c.is_day, new Date().getHours());
  const uv = d.uv_index_max[0];
  const uvTxt = uv == null ? '—' : uv < 3 ? 'Più debole' : uv < 6 ? 'Moderato' : uv < 8 ? 'Forte' : 'Molto forte';
  const badge = w.fresh ? `Aggiornato alle ${fmtOra(w.t)}` : `Dati memorizzati del ${fmtOra(w.t)}${w.err ? ' · non aggiornati' : ''}`;
  const luogo = esc((s.luogo || '').split(' (')[0]);

  // prossime 6 ore: una colonna per ora, la curva è centrata su ciascuna colonna
  const ore = Array.from({ length: 6 }, (_, k) => i + k).filter(k => k < h.time.length);
  const T = ore.map(k => h.temperature_2m[k]);
  const tMin = Math.min(...T), tMax = Math.max(...T);
  const W = 600, H = 120;
  const cx = k => (k + 0.5) * (W / T.length);
  const cy = v => H - 34 - ((v - tMin) / ((tMax - tMin) || 1)) * (H - 70);
  const pts = T.map((v, k) => `${cx(k).toFixed(1)},${cy(v).toFixed(1)}`).join(' ');
  const curva = `<svg class="wx-curve" viewBox="0 0 ${W} ${H}" aria-label="Andamento temperature prossime ore">
    <defs><linearGradient id="tg" x1="0" x2="1"><stop offset="0" stop-color="#ffb84d"/><stop offset="1" stop-color="#b8e27a"/></linearGradient></defs>
    <polyline fill="none" stroke="url(#tg)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" points="${pts}"/>
    ${T.map((v, k) => `<text x="${cx(k)}" y="${cy(v) - 12}" text-anchor="middle" font-size="16" fill="currentColor">${Math.round(v)}°</text>`).join('')}
    <circle cx="${cx(0)}" cy="${cy(T[0])}" r="6" fill="#fff" stroke="#f5a623" stroke-width="3"/></svg>`;
  const oreHTML = ore.map((k, n) => {
    const pr = h.precipitation_probability[k];
    return `<div><div>${n === 0 ? 'Ora' : h.time[k].slice(11, 16)}</div>
      <div style="font-size:1.5rem;margin:4px 0">${condizione(h.weather_code[k])[1]}</div>
      <div class="wx-p">${pr >= 20 ? pr + '%' : ''}</div></div>`;
  }).join('');

  // prossimi giorni con barra di escursione termica
  const dmin = Math.min(...d.temperature_2m_min), dmax = Math.max(...d.temperature_2m_max);
  const pos = v => ((v - dmin) / ((dmax - dmin) || 1)) * 100;
  const giorni = d.time.map((t, k) => {
    const lab = k === 0 ? 'Oggi' : k === 1 ? 'Domani' : new Date(t + 'T12:00').toLocaleDateString('it-IT', { weekday: 'short' });
    const a = pos(d.temperature_2m_min[k]), b = pos(d.temperature_2m_max[k]);
    const pr = d.precipitation_probability_max?.[k];
    return `<div>
      <span class="wx-data">${new Date(t + 'T12:00').toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })}</span>
      <span>${lab} ${condizione(d.weather_code[k])[1]}${pr != null && pr >= 20 ? ` <small class="wx-p">${pr}%</small>` : ''}</span>
      <span style="text-align:right;opacity:.8">${Math.round(d.temperature_2m_min[k])}°</span>
      <span class="wx-track"><i style="left:${a}%;width:${Math.max(b - a, 5)}%"></i></span>
      <span style="text-align:right">${Math.round(d.temperature_2m_max[k])}°</span></div>`;
  }).join('');

  const dettagli = [
    ['Umidità', c.relative_humidity_2m + '%'],
    ['Vento', Math.round(c.wind_speed_10m) + ' km/h ' + dirVento(c.wind_direction_10m)],
    ['Pressione', Math.round(c.pressure_msl) + ' hPa'],
    ['Visibilità', ((h.visibility[i] || 0) / 1000).toFixed(1) + ' km'],
    ['Pioggia 24 ore', Array.from({ length: 24 }, (_, k) => h.precipitation[i + k] || 0).reduce((a, b) => a + b, 0).toFixed(1) + ' mm'],
    ['Nuvolosità', c.cloud_cover + '%']
  ];

  const sfondo = sceneHTML(kind, c.is_day, `
    <div class="wx-top">
      <span class="wx-ico">☰</span>
      <div class="wx-title"><b>${luogo}</b><small>${badge}</small></div>
      <span class="wx-ico">⋮</span>
    </div>
    <div style="text-align:center"><span class="wx-pill">UV ${uvTxt}</span></div>
    <div class="wx-cond">${cond[0]} ${Math.round(d.temperature_2m_min[0])}~${Math.round(d.temperature_2m_max[0])}°C</div>
    <div class="wx-temp">${Math.round(c.temperature_2m)}<sup>°C</sup></div>
    <div class="wx-feel">Percepita ${Math.round(c.apparent_temperature)}°C</div>
    <div class="wx-glass">${curva}<div class="wx-hours">${oreHTML}</div></div>
    <div class="wx-glass wx-daily">${giorni}</div>
    <div class="wx-glass"><div class="wx-grid">${dettagli.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div></div>
    <div class="row" style="margin-top:12px"><button class="btn sec" data-a="aggiornaMeteo">Aggiorna dati</button></div>
    <p style="text-align:center;opacity:.8"><a href="#impostazioni" style="color:inherit">Cambia la località nelle Impostazioni</a></p>`
  ).replace('class="scene ', 'class="scene wx-full ');
  $('#app').innerHTML = sfondo;
}
function grafico(valori, unita, colore, barre = false) {
  const W = 600, H = 150, pad = 18;
  const min = Math.min(...valori, barre ? 0 : Infinity), max = Math.max(...valori, barre ? 0.5 : -Infinity);
  const span = (max - min) || 1;
  const x = k => pad + (k * (W - 2 * pad)) / Math.max(valori.length - 1, 1);
  const y = v => H - pad - ((v - min) / span) * (H - 2 * pad);
  let body;
  if (barre) {
    const bw = (W - 2 * pad) / valori.length * .7;
    body = valori.map((v, k) => `<rect x="${x(k) - bw / 2}" y="${y(v)}" width="${bw}" height="${H - pad - y(v)}" rx="3" fill="${colore}" opacity=".8"/>`).join('');
  } else {
    body = `<polyline fill="none" stroke="${colore}" stroke-width="3" stroke-linejoin="round" points="${valori.map((v, k) => `${x(k)},${y(v)}`).join(' ')}"/>` +
      valori.map((v, k) => k % 4 === 0 ? `<text x="${x(k)}" y="${y(v) - 8}" font-size="18" text-anchor="middle" fill="currentColor">${Math.round(v)}</text>` : '').join('');
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafico ${unita}">${body}<line x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}" stroke="currentColor" opacity=".25"/></svg><div class="muted">Unità: ${unita}</div>`;
}
const linkImpostazioni = () => `<p class="muted"><a href="#impostazioni">Cambia la località dell'orto nelle Impostazioni</a></p>`;

/* ============ rendering: home ============ */
async function pageHome() {
  const s = await getSettings(), piante = await dbAll('plants');
  const now = new Date(), luna = fasiLuna(now), mese = MESE_DATI[now.getMonth()];
  const saluto = now.getHours() < 12 ? 'Buongiorno' : now.getHours() < 18 ? 'Buon pomeriggio' : 'Buonasera';
  const w = await getWeather();
  const attive = piante.filter(p => !['Terminata', 'Raccolta completata'].includes(p.stato));
  const prossimi = attive.filter(p => p.raccolta && giorniDa(p.raccolta) >= 0 && giorniDa(p.raccolta) <= 30).sort((a, b) => a.raccolta.localeCompare(b.raccolta));
  const conteggi = STATI.map(st => [st, piante.filter(p => p.stato === st).length]).filter(([, n]) => n);
  const meteoHTML = w.j ? cardMeteoCompatta(w) : `<div class="card err">Meteo non disponibile: ${esc(w.err)}. Verifica la connessione.</div>`;
  const consigli = consigliOrto(w.j || null, piante);
  $('#app').innerHTML = `
    <div class="top"><div>
      <div class="muted">${now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <h1>${saluto}</h1><div class="muted">${esc(s.nome)} · ${esc(s.luogo)}</div>
    </div></div>
    <a href="#meteo" style="text-decoration:none;color:inherit">${meteoHTML}</a>
    <div class="grid2">
      <div class="kpi"><span>Fase lunare</span><b>${luna.ico} ${luna.nome}</b></div>
      <div class="kpi"><span>Colture attive</span><b>${attive.length}</b></div>
    </div>
    <h2>I consigli di oggi</h2>
    ${consigli.length ? consigli.map(x => `<div class="card ${x.tipo === 'allerta' ? 'err' : x.tipo === 'avviso' ? 'warn' : ''}">${x.ico} ${x.testo}</div>`).join('') : '<div class="card muted">Nessun consiglio per oggi.</div>'}
    <h2>Cosa seminare questo mese</h2>
    <div class="card">${mese.semina.length ? '<ul class="list">' + mese.semina.map(x => `<li>${x}</li>`).join('') + '</ul>' : '<span class="muted">Nessuna semina all\'aperto consigliata questo mese.</span>'}
      ${mese.semenzaio.length ? `<p class="muted">In semenzaio: ${mese.semenzaio.join(', ')}</p>` : ''}</div>
    <h2>Cosa trapiantare</h2>
    <div class="card">${mese.trapianto.length ? mese.trapianto.join(', ') : '<span class="muted">Nessun trapianto consigliato questo mese.</span>'}</div>
    <h2>Prossimi raccolti (30 giorni)</h2>
    <div class="card">${prossimi.length ? '<ul class="list">' + prossimi.map(p => `<li>${esc(p.nome)} · ${fmtData(p.raccolta)} (${giorniDa(p.raccolta)} giorni)</li>`).join('') + '</ul>' : '<span class="muted">Nessun raccolto previsto nei prossimi 30 giorni.</span>'}</div>
    <h2>Stato delle coltivazioni</h2>
    <div class="card">${conteggi.length ? '<div class="chips">' + conteggi.map(([st, n]) => `<span class="chip">${st}: ${n}</span>`).join('') + '</div>' : '<span class="muted">Nessuna coltivazione registrata. <a href="#colture">Aggiungi la prima</a>.</span>'}</div>
    <h2>Strumenti</h2>
    <div class="row">
      <a class="btn sec" href="#irrigazione">💧 Irrigazione</a>
      <a class="btn sec" href="#diagnosi">🔍 Diagnosi</a>
      <a class="btn sec" href="#ortaggi">📖 Scheda ortaggi</a>
    </div>`;
}

/* ============ rendering: coltivazioni ============ */
async function pageColture() {
  const piante = (await dbAll('plants')).sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  const acque = await dbAll('waterings');
  const ultimaAcqua = id => acque.filter(a => a.plantId === id).map(a => a.data).sort().pop();
  $('#app').innerHTML = `
    <div class="top"><h1>Le mie coltivazioni</h1><button class="btn" data-a="nuovaPianta">+ Nuova</button></div>
    <p class="muted">Archivio delle colture presenti nell'orto. Le modifiche restano sul dispositivo.</p>
    ${piante.length ? piante.map(p => `
      <div class="card">
        <div class="top"><div><b>${esc(p.nome)}</b>${p.varieta ? ` · ${esc(p.varieta)}` : ''}<div class="muted">${esc(p.posizione) || 'Posizione non indicata'}${p.quantita ? ' · ' + esc(p.quantita) : ''}</div></div>
        <span class="chip">${esc(p.stato)}</span></div>
        <div class="muted" style="margin:6px 0">Semina: ${fmtData(p.semina)} · Trapianto: ${fmtData(p.trapianto)} · Raccolta prevista: ${fmtData(p.raccolta)}</div>
        <div class="muted">Ultima irrigazione: ${fmtData(ultimaAcqua(p.id))}</div>
        ${p.problemi ? `<div style="margin-top:6px">⚠️ ${esc(p.problemi)}</div>` : ''}
        <div class="row" style="margin-top:10px">
          <button class="btn small" data-a="annaffia" data-id="${p.id}">💧 Annaffiata ora</button>
          <button class="btn small sec" data-a="modificaPianta" data-id="${p.id}">Modifica</button>
          <button class="btn small danger" data-a="eliminaPianta" data-id="${p.id}">Elimina</button>
        </div>
      </div>`).join('') : `<div class="card muted">Nessuna coltivazione. Premi “+ Nuova” per aggiungere la prima.</div>`}
    <p><a href="#ortaggi">📖 Apri la scheda degli ortaggi</a></p>`;
}
async function formPianta(id) {
  const p = id ? await dbGet('plants', id) || {} : {};
  openModal(`<h3>${id ? 'Modifica coltivazione' : 'Nuova coltivazione'}</h3>
  <form class="stack" data-f="pianta" data-id="${esc(id || '')}">
    <label>Ortaggio<input name="nome" list="elenco-ortaggi" required value="${esc(p.nome)}">
      <datalist id="elenco-ortaggi">${ORTAGGI.map(o => `<option value="${o.nome}">`).join('')}</datalist></label>
    <label>Varietà<input name="varieta" value="${esc(p.varieta)}"></label>
    <label>Posizione nell'orto<input name="posizione" value="${esc(p.posizione)}" placeholder="es. aiuola 1, fila sud"></label>
    <div class="row"><label>Data di semina<input type="date" name="semina" value="${esc(p.semina)}"></label>
    <label>Data di trapianto<input type="date" name="trapianto" value="${esc(p.trapianto)}"></label></div>
    <div class="row"><label>Quantità<input name="quantita" value="${esc(p.quantita)}" placeholder="es. 6 piante"></label>
    <label>Stato<select name="stato">${STATI.map(x => `<option ${p.stato === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>
    <label>Data prevista di raccolta<input type="date" name="raccolta" value="${esc(p.raccolta)}"></label>
    <label>Problemi osservati<textarea name="problemi">${esc(p.problemi)}</textarea></label>
    <button class="btn">Salva</button>
  </form>`);
}
forms.pianta = async f => {
  const d = Object.fromEntries(new FormData(f));
  const id = f.dataset.id || newId();
  const old = f.dataset.id ? (await dbGet('plants', id)) || {} : {};
  await dbPut('plants', { ...old, ...d, id, aggiornato: Date.now() });
  closeModal(); route();
};

/* ============ rendering: ortaggi ============ */
async function pageOrtaggi(id) {
  if (id) {
    const o = ORTAGGI.find(x => x.id === id);
    if (!o) return $('#app').innerHTML = '<div class="card err">Ortaggio non trovato.</div>';
    const campi = [['Famiglia botanica', o.famiglia], ['Semina', o.semina], ['Trapianto', o.trapianto], ['Germinazione', o.germinazione], ['Maturazione', o.maturazione], ['Profondità di semina', o.profondita], ['Distanza tra le piante', o.distPiante], ['Distanza tra le file', o.distFile], ['Esposizione', o.esposizione], ['Terreno', o.terreno], ['Irrigazione', o.acqua], ['Concimazione', o.concimazione], ['Potatura e manutenzione', o.potatura], ['Malattie frequenti', o.malattie], ['Parassiti', o.parassiti], ['Raccolta', o.raccolta], ['Conservazione', o.conservazione]];
    $('#app').innerHTML = `<p><a href="#ortaggi">← Tutti gli ortaggi</a></p><h1>${o.nome}</h1><p class="muted">${o.descrizione}</p>
      <div class="card"><ul class="list">${campi.map(([k, v]) => `<li><b>${k}:</b> ${v}</li>`).join('')}</ul></div>
      <p class="muted">Dati indicativi: adatta semine e trapianti al meteo e al clima della tua zona.</p>`;
    return;
  }
  $('#app').innerHTML = `<h1>Scheda ortaggi</h1><p class="muted">Schede indicative per l'orto. Le date vanno sempre adattate al meteo.</p>
    ${ORTAGGI.map(o => `<div class="card"><b><a href="#ortaggi/${o.id}" style="color:inherit">${o.nome}</a></b> <span class="muted">· ${o.famiglia}</span><div class="muted">${o.descrizione}</div></div>`).join('')}`;
}

/* ============ rendering: calendario ============ */
async function pageCalendario(param) {
  const oggi = new Date();
  let [anno, mese] = param ? param.split('-').map(Number) : [oggi.getFullYear(), oggi.getMonth() + 1];
  const dati = MESE_DATI[mese - 1];
  const prev = mese === 1 ? [anno - 1, 12] : [anno, mese - 1];
  const next = mese === 12 ? [anno + 1, 1] : [anno, mese + 1];
  const lista = (titolo, arr) => `<div class="card"><b>${titolo}</b>${arr.length ? '<ul class="list">' + arr.map(x => `<li>${x}</li>`).join('') + '</ul>' : '<div class="muted">Nessuna indicazione</div>'}</div>`;
  // calendario lunare del mese
  let celle = '';
  const primo = new Date(anno, mese - 1, 1), giorni = new Date(anno, mese, 0).getDate();
  const vuoti = (primo.getDay() + 6) % 7;
  for (let k = 0; k < vuoti; k++) celle += '<div></div>';
  for (let g = 1; g <= giorni; g++) {
    const e = etaLuna(new Date(anno, mese - 1, g, 12));
    const ico = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'][Math.round(e / SINODICO * 8) % 8];
    const isOggi = oggi.getFullYear() === anno && oggi.getMonth() + 1 === mese && oggi.getDate() === g;
    celle += `<div style="text-align:center;padding:4px;border-radius:10px;${isOggi ? 'background:var(--beige);font-weight:700' : ''}"><div class="muted" style="font-size:.7rem">${g}</div><div>${ico}</div></div>`;
  }
  const luna = fasiLuna(new Date());
  const prossimaPiena = prossimaLuna('piena'), prossimaNuova = prossimaLuna('nuova');
  $('#app').innerHTML = `
    <h1>Calendario agricolo</h1>
    <div class="top"><a class="btn sec small" href="#calendario/${prev[0]}-${prev[1]}">← ${MESI[prev[1] - 1]}</a><b>${MESI[mese - 1]} ${anno}</b><a class="btn sec small" href="#calendario/${next[0]}-${next[1]}">${MESI[next[1] - 1]} →</a></div>
    <p class="muted">Indicazioni generali per il centro Italia. Usale come finestre temporali, non come date rigide.</p>
    ${lista('Da seminare direttamente in terra', dati.semina)}
    ${lista('Da seminare in semenzaio', dati.semenzaio)}
    ${lista('Da trapiantare', dati.trapianto)}
    ${lista('Da raccogliere', dati.raccolta)}
    ${lista('Lavori e manutenzione', dati.lavori)}
    <h2>Calendario lunare</h2>
    <div class="card"><div class="grid2"><div class="kpi"><span>Fase attuale</span><b>${luna.ico} ${luna.nome}</b></div>
      <div class="kpi"><span>Prossima luna piena</span><b>${prossimaPiena ? fmtData(ymd(prossimaPiena)) : '—'}</b></div>
      <div class="kpi"><span>Prossima luna nuova</span><b>${prossimaNuova ? fmtData(ymd(prossimaNuova)) : '—'}</b></div></div></div>
    <div class="card"><div class="grid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;font-size:.9rem">${['L','M','M','G','V','S','D'].map(x => `<div class="muted" style="text-align:center">${x}</div>`).join('')}${celle}</div></div>
    <div class="card muted">Le tradizioni legano la semina alle fasi lunari, ma non esistono prove scientifiche solide di un vantaggio generale sulle coltivazioni.</div>`;
}

/* ============ rendering: irrigazione (accessibile dalla home) ============ */
async function pageIrrigazione() {
  const w = await getWeather(), piante = (await dbAll('plants')).filter(p => !['Terminata', 'Raccolta completata'].includes(p.stato));
  const acque = await dbAll('waterings');
  const ultima = id => acque.filter(a => a.plantId === id).map(a => a.data).sort().pop();
  $('#app').innerHTML = `
    <h1>Irrigazione</h1>
    <div class="card">${w.j ? consigloIrrigazione(w.j) : 'Consigli meteo non disponibili: ' + esc(w.err)}
      <div class="muted" style="margin-top:6px">L'app non conosce l'umidità reale del terreno: verifica con il dito a 3-4 cm di profondità.</div></div>
    <h2>Ultime irrigazioni</h2>
    ${piante.length ? piante.map(p => `<div class="card"><div class="top"><div><b>${esc(p.nome)}</b><div class="muted">Ultima: ${fmtData(ultima(p.id))}</div></div><button class="btn small" data-a="annaffia" data-id="${p.id}">💧 Annaffiata ora</button></div></div>`).join('') : '<div class="card muted">Aggiungi prima una coltivazione.</div>'}
    <h2>Registra un'irrigazione</h2>
    <form class="card stack" data-f="irrigazione">
      <label>Coltivazione<select name="plantId">${piante.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></label>
      <div class="row"><label>Data<input type="date" name="data" value="${ymd(new Date())}" required></label>
      <label>Litri (facoltativo)<input name="litri" inputmode="decimal"></label></div>
      <label>Note<input name="note"></label>
      <button class="btn">Registra</button>
    </form>`;
}
forms.irrigazione = async f => {
  const d = Object.fromEntries(new FormData(f));
  await dbPut('waterings', { id: newId(), plantId: d.plantId, data: d.data, litri: d.litri, note: d.note, creato: Date.now() });
  route();
};

/* ============ rendering: diario fotografico ============ */
async function pageDiario() {
  const foto = (await dbAll('photos')).sort((a, b) => a.data.localeCompare(b.data));
  const piante = await dbAll('plants');
  const nomePianta = id => (piante.find(p => p.id === id) || {}).nome || 'Orto generale';
  const opzioni = foto.map(f => `<option value="${f.id}">${fmtData(f.data)} · ${esc(nomePianta(f.plantId))}</option>`).join('');
  $('#app').innerHTML = `
    <h1>Diario fotografico</h1>
    <form class="card stack" data-f="foto">
      <label>Foto (fotocamera o galleria)<input type="file" name="file" accept="image/*" capture="environment" required></label>
      <div class="row"><label>Data<input type="date" name="data" value="${ymd(new Date())}" required></label>
      <label>Coltivazione<select name="plantId"><option value="">Orto generale</option>${piante.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></label></div>
      <label>Note<textarea name="note"></textarea></label>
      <button class="btn">Salva foto</button>
    </form>
    <h2>Confronta nel tempo</h2>
    ${foto.length >= 2 ? `<div class="card"><div class="compare">
      <select data-c="confronta" data-lato="a">${opzioni}</select><select data-c="confronta" data-lato="b">${opzioni}</select></div>
      <div id="confronto" class="compare" style="margin-top:10px"></div></div>` : '<div class="card muted">Servono almeno due foto per confrontarle.</div>'}
    <h2>Cronologia</h2>
    ${foto.length ? foto.slice().reverse().map(f => `<div class="card">
      <div class="top"><div><b>${fmtData(f.data)}</b> · ${esc(nomePianta(f.plantId))}</div><button class="btn small danger" data-a="eliminaFoto" data-id="${f.id}">Elimina</button></div>
      <img class="photo" style="margin:8px 0" src="${URL.createObjectURL(f.blob)}" alt="Foto di ${esc(nomePianta(f.plantId))} del ${fmtData(f.data)}">
      ${f.note ? `<div>${esc(f.note)}</div>` : ''}</div>`).join('') : '<div class="card muted">Nessuna foto salvata.</div>'}`;
}
forms.foto = async f => {
  const d = Object.fromEntries(new FormData(f));
  if (!d.file || !d.file.size) return alert('Scegli una foto.');
  await dbPut('photos', { id: newId(), plantId: d.plantId || '', data: d.data, note: d.note, blob: d.file, creato: Date.now() });
  route();
};

/* ============ rendering: diagnosi guidata ============ */
async function pageDiagnosi() {
  const piante = await dbAll('plants'), storico = (await dbAll('diagnoses')).sort((a, b) => b.creato - a.creato).slice(0, 15);
  $('#app').innerHTML = `
    <h1>Diagnosi guidata</h1>
    <p class="muted">Scegli i sintomi che vedi. La diagnosi è indicativa e non sostituisce il parere di un tecnico.</p>
    <form class="card stack" data-f="diagnosi">
      <label>Coltivazione<select name="plantId"><option value="">Non specificata</option>${piante.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></label>
      <label>Parte della pianta<select name="parte"><option>Foglia</option><option>Frutto</option><option>Pianta intera</option><option>Colletto o radici</option></select></label>
      <fieldset style="border:0;padding:0;display:flex;flex-direction:column;gap:6px"><legend class="muted">Sintomi osservati</legend>
        ${Object.entries(SINTOMI).map(([k, s]) => `<label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="sintomi" value="${k}" style="width:auto">${s.label}</label>`).join('')}
      </fieldset>
      <label>Note<textarea name="note" placeholder="Es. comparsi dopo la pioggia"></textarea></label>
      <button class="btn">Mostra possibili cause</button>
    </form>
    <div id="esito"></div>
    <h2>Storico diagnosi</h2>
    ${storico.length ? storico.map(d => `<div class="card"><b>${fmtData(d.data)}</b> · ${esc(piante.find(p => p.id === d.plantId)?.nome || 'Non specificata')} · ${esc(d.parte)}<div class="muted">${d.sintomi.map(k => SINTOMI[k].label).join(', ')}</div></div>`).join('') : '<div class="card muted">Nessuna diagnosi salvata.</div>'}`;
}
forms.diagnosi = async f => {
  const d = new FormData(f);
  const sintomi = d.getAll('sintomi');
  if (!sintomi.length) return alert('Seleziona almeno un sintomo.');
  const gravita = sintomi.map(k => SINTOMI[k].gravita).reduce((a, b) => LIVELLO[b] > LIVELLO[a] ? b : a, 'bassa');
  const esperto = sintomi.some(k => SINTOMI[k].esperto) || gravita === 'alta';
  const cause = [...new Set(sintomi.flatMap(k => SINTOMI[k].cause))];
  const rimedi = [...new Set(sintomi.flatMap(k => SINTOMI[k].rimedi))];
  const prevenzione = [...new Set(sintomi.map(k => SINTOMI[k].prevenzione))];
  const plantId = d.get('plantId') || '';
  await dbPut('diagnoses', { id: newId(), plantId, parte: d.get('parte'), sintomi, note: d.get('note'), gravita, data: ymd(new Date()), creato: Date.now() });
  $('#esito').innerHTML = `
    <div class="card ${gravita === 'alta' ? 'err' : gravita === 'media' ? 'warn' : ''}">
      <h3>Possibili cause (indicative)</h3><ul class="list">${cause.map(x => `<li>${x}</li>`).join('')}</ul>
      <p><b>Gravità stimata:</b> ${gravita}</p>
      <h3>Rimedi consigliati</h3><ul class="list">${rimedi.map(x => `<li>${x}</li>`).join('')}</ul>
      <h3>Prevenzione</h3><ul class="list">${prevenzione.map(x => `<li>${x}</li>`).join('')}</ul>
      ${esperto ? '<p><b>Consigliato un parere esperto</b> (tecnico agricolo o servizio fitosanitario regionale).</p>' : ''}
      <p class="muted">Diagnosi salvata nello storico.</p>
    </div>`;
};

/* ============ rendering: impostazioni ============ */
async function pageImpostazioni() {
  const s = await getSettings();
  $('#app').innerHTML = `
    <h1>Impostazioni</h1>
    <form class="card stack" data-f="impostazioni">
      <label>Nome dell'orto<input name="nome" value="${esc(s.nome)}"></label>
      <label>Località (testo)<input name="luogo" value="${esc(s.luogo)}"></label>
      <div class="row"><label>Latitudine<input name="lat" value="${s.lat}" inputmode="decimal"></label>
      <label>Longitudine<input name="lon" value="${s.lon}" inputmode="decimal"></label></div>
      <button class="btn">Salva</button>
    </form>
    <h2>Cerca la località</h2>
    <form class="card stack" data-f="cerca">
      <div class="row"><input name="q" placeholder="Es. Gallicano nel Lazio" required><button class="btn sec" style="flex:0">Cerca</button></div>
    </form>
    <div id="risultati"></div>
    <h2>Dati</h2>
    <div class="card stack">
      <button class="btn" data-a="esporta">Esporta backup (JSON)</button>
      <label>Ripristina da backup<input type="file" accept="application/json" data-c="ripristina"></label>
      <button class="btn danger" data-a="svuota">Cancella tutti i dati</button>
      <p class="muted">Il backup include coltivazioni, irrigazioni, diagnosi, impostazioni e foto.</p>
    </div>
    <p class="muted">Versione 1 (fase iniziale). Notifiche e diagnosi fotografica con AI sono previste nelle prossime fasi.</p>`;
}
forms.impostazioni = async f => {
  const d = Object.fromEntries(new FormData(f));
  const lat = parseFloat(String(d.lat).replace(',', '.')), lon = parseFloat(String(d.lon).replace(',', '.'));
  if (isNaN(lat) || isNaN(lon)) return alert('Coordinate non valide.');
  await saveSettings({ nome: d.nome, luogo: d.luogo, lat, lon });
  localStorage.removeItem('meteo:' + lat.toFixed(3) + ',' + lon.toFixed(3));
  alert('Impostazioni salvate.');
  route();
};
forms.cerca = async f => {
  const q = new FormData(f).get('q');
  const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name: q, count: 5, language: 'it', country: 'IT' }));
  const j = await r.json().catch(() => ({}));
  const out = (j.results || []).map(x => `<div class="card"><b>${esc(x.name)}</b> · ${esc(x.admin2 || x.admin1 || '')}<div class="muted">${x.latitude.toFixed(4)}, ${x.longitude.toFixed(4)}</div>
    <button class="btn small" style="margin-top:6px" data-a="scegliLuogo" data-lat="${x.latitude}" data-lon="${x.longitude}" data-nome="${esc(x.name + (x.admin2 ? ', ' + x.admin2 : ''))}">Usa questa</button></div>`).join('');
  $('#risultati').innerHTML = out || '<div class="card muted">Nessun risultato. Prova con un altro nome.</div>';
};

/* ============ backup ============ */
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
async function esporta() {
  const s = await getSettings();
  const foto = await dbAll('photos');
  const fotoOut = [];
  for (const f of foto) fotoOut.push({ ...f, blob: undefined, dataUrl: await blobToDataURL(f.blob) });
  const backup = { versione: 1, esportato: new Date().toISOString(), settings: s, plants: await dbAll('plants'), waterings: await dbAll('waterings'), diagnoses: await dbAll('diagnoses'), photos: fotoOut };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
  a.download = `il-mio-orto-${ymd(new Date())}.json`;
  a.click();
}
async function ripristina(file) {
  if (!file) return;
  if (!confirm('Il ripristino aggiunge o sostituisce i dati con quelli del backup. Continuare?')) return;
  const b = JSON.parse(await file.text());
  if (b.settings) await tx('settings', 'readwrite', st => st.put({ ...DEF, ...b.settings }, 'main'));
  for (const p of b.plants || []) await dbPut('plants', p);
  for (const w of b.waterings || []) await dbPut('waterings', w);
  for (const d of b.diagnoses || []) await dbPut('diagnoses', d);
  for (const f of b.photos || []) { const blob = await (await fetch(f.dataUrl)).blob(); await dbPut('photos', { id: f.id, plantId: f.plantId, data: f.data, note: f.note, creato: f.creato, blob }); }
  alert('Ripristino completato.');
  route();
}

/* ============ finestre ============ */
function openModal(html) { const m = $('#modal'); m.innerHTML = `<div class="modal-box">${html}<p><button class="btn sec" data-a="chiudi">Chiudi</button></p></div>`; m.hidden = false; }
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }

/* ============ azioni e moduli ============ */
const actions = {
  chiudi: closeModal,
  aggiornaMeteo: async () => { const s = await getSettings(); localStorage.removeItem('meteo:' + Number(s.lat).toFixed(3) + ',' + Number(s.lon).toFixed(3)); route(); },
  nuovaPianta: () => formPianta(),
  modificaPianta: el => formPianta(el.dataset.id),
  eliminaPianta: async el => { if (confirm('Eliminare questa coltivazione?')) { await dbDel('plants', el.dataset.id); route(); } },
  annaffia: async el => { await dbPut('waterings', { id: newId(), plantId: el.dataset.id, data: ymd(new Date()), creato: Date.now() }); route(); },
  eliminaFoto: async el => { if (confirm('Eliminare questa foto?')) { await dbDel('photos', el.dataset.id); route(); } },
  scegliLuogo: async el => { await saveSettings({ lat: parseFloat(el.dataset.lat), lon: parseFloat(el.dataset.lon), luogo: el.dataset.nome }); alert('Località aggiornata.'); route(); },
  esporta: () => esporta(),
  svuota: async () => { if (confirm('Cancellare tutti i dati dell\'orto? Operazione non reversibile.')) { for (const s of ['plants', 'photos', 'waterings', 'diagnoses', 'settings']) await dbClear(s); localStorage.clear(); route(); } }
};
const changes = {
  confronta: () => {
    const [a, b] = ['a', 'b'].map(l => document.querySelector(`select[data-c="confronta"][data-lato="${l}"]`).value);
    const imgs = [a, b].map(id => id ? dbGet('photos', id) : null);
    Promise.all(imgs).then(([fa, fb]) => {
      const box = (f) => f ? `<div><img class="photo" src="${URL.createObjectURL(f.blob)}" alt=""><div class="muted">${fmtData(f.data)}</div></div>` : '<div></div>';
      $('#confronto').innerHTML = box(fa) + box(fb);
    });
  },
  ripristina: el => ripristina(el.files[0])
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (el && actions[el.dataset.a]) { e.preventDefault(); actions[el.dataset.a](el); }
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-c]');
  if (el && changes[el.dataset.c]) changes[el.dataset.c](el);
});
document.addEventListener('submit', async e => {
  const f = e.target;
  if (!f.dataset.f || !forms[f.dataset.f]) return;
  e.preventDefault();
  try { await forms[f.dataset.f](f); } catch (err) { alert('Errore: ' + err.message); }
});
// apertura delle form di coltivazione dal pulsante “Modifica” o “Nuova”
// (le form sono generate in modale; il tasto di salvataggio chiama forms.pianta)

/* ============ router ============ */
const pagine = { home: pageHome, meteo: pageMeteo, colture: pageColture, ortaggi: pageOrtaggi, calendario: pageCalendario, diario: pageDiario, irrigazione: pageIrrigazione, diagnosi: pageDiagnosi, impostazioni: pageImpostazioni };
async function route() {
  const [nome, ...resto] = (location.hash || '#home').slice(1).split('/');
  const fn = pagine[nome] || pageHome;
  document.querySelectorAll('.bottom-nav a').forEach(a => a.classList.toggle('on', a.dataset.r === nome || (nome === 'meteo' && a.dataset.r === 'home')));
  $('#app').innerHTML = '<div class="loading">Caricamento…</div>';
  try { await fn(resto.join('/') || undefined); }
  catch (err) { $('#app').innerHTML = `<div class="card err">Si è verificato un errore: ${esc(err.message)}</div>`; }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
window.addEventListener('load', () => {
  route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
});
