'use strict';

/* ═══════════════════════════════════════════════════════════
   SIGOBS — Application JavaScript v3.0
   Mapbox GL JS · Surfaces OLS géoréférencées · MongoDB Backend
   ═══════════════════════════════════════════════════════════ */

/* ── API Backend URL ──────────────────────────────────────── */
const API_BASE = 'https://pans-ops.skovichvps.cloud-ip.cc/api/v1/';

/* ── OurAirports (Redirection si backend hors ligne) ─────────── */
const OURAIRPORTS = {
  airports: 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv',
  runways: 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/runways.csv',
};
const _csvCache = { airports: null, runways: null };

/* ── Ètat ────────────────────────────────────────────────── */
const App = {
  token: null, user: null, aerodrome: null, runways: [], activeRunway: null,
  obstacles: [], aixmFile: null, coordMode: 'dms', modalAction: null,
  allObstacles: [], map3dLabels: true,
};

/* ──  PARAMETRES OLS─────────────── */
const OLS = {
  approach: { stripEnd: 60, sec1Length: 3000, sec2Length: 3600, innerWidth: 300, slope: 1 / 50, divergence: 0.15 },
  takeoff: { stripEnd: 60, length: 15000, innerWidth: 180, slope: 1 / 50, divergence: 0.125 },
  ihs: { height: 45, radius: 4000 },
  conical: { slope: 1 / 20, height: 100, ihsRadius: 4000 },
  transition: { slope: 1 / 7 },
};

/* ══════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {
  startClock();
  checkSavedToken();
  bindTemporalToggle();
});

function startClock() {
  const tick = () => {
    const now = new Date();
    const el = document.getElementById('utc-time');
    if (el) el.textContent =
      `${String(now.getUTCHours()).padStart(2, '0')}:` +
      `${String(now.getUTCMinutes()).padStart(2, '0')}:` +
      `${String(now.getUTCSeconds()).padStart(2, '0')}Z`;
  };
  tick(); setInterval(tick, 1000);
}
function bindTemporalToggle() {
  const sel = document.getElementById('obs-temporal');
  if (sel) sel.addEventListener('change', () =>
    document.getElementById('expiry-group').classList.toggle('hidden', sel.value !== 'temporary'));
}
function checkSavedToken() {
  const saved = sessionStorage.getItem('sigobs_token');
  const user = sessionStorage.getItem('sigobs_user');
  if (saved && user) { App.token = saved; App.user = JSON.parse(user); showApp(); }
}

/* ══════════════════════════════════════════════════════════
   AUTHENTIFICATION
══════════════════════════════════════════════════════════ */
async function handleLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('btn-login');
  const lbl = btn.querySelector('.btn-label'), loader = btn.querySelector('.btn-loader');
  if (!username || !password) { showLoginError('Identifiant et mot de passe requis.'); return; }
  document.getElementById('login-error').classList.add('hidden');
  lbl.classList.add('hidden'); loader.classList.remove('hidden'); btn.disabled = true;
  try {
    const res = await apiFetch('/auth/login', 'POST', { username, password }, false);
    if (res.token) {
      App.token = res.token; App.user = res.user || { username, role: 'user' };
      sessionStorage.setItem('sigobs_token', App.token);
      sessionStorage.setItem('sigobs_user', JSON.stringify(App.user));
      showApp();
    } else { showLoginError(res.message || 'Authentification refusée.'); }
  } catch (e) {
    /* Mode démo si API hors ligne */
    App.token = 'demo_token'; App.user = { username, role: 'admin', name: username };
    sessionStorage.setItem('sigobs_token', App.token);
    sessionStorage.setItem('sigobs_user', JSON.stringify(App.user));
    showApp(); showToast('Mode démonstration — API non disponible', 'warn');
  } finally { lbl.classList.remove('hidden'); loader.classList.add('hidden'); btn.disabled = false; }
}
function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg; el.classList.remove('hidden');
}
function handleLogout() {
  App.token = null; App.user = null; App.aerodrome = null; App.runways = [];
  App.activeRunway = null; App.obstacles = []; App.allObstacles = [];
  sessionStorage.clear();
  document.getElementById('screen-app').classList.remove('active');
  document.getElementById('screen-login').classList.add('active');
  document.getElementById('login-password').value = '';
  if (GeoMap.map) { GeoMap.map.remove(); GeoMap.map = null; GeoMap.initialized = false; }
}
function showApp() {
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');
  const nameEl = document.getElementById('user-name');
  const roleEl = document.getElementById('user-role');
  if (nameEl) nameEl.textContent = App.user.name || App.user.username || 'Utilisateur';
  if (roleEl) roleEl.textContent = App.user.role || 'USER';
  setApiStatus('connected');
  checkExpirations();
  setTimeout(() => { geoMapInit(); bindCoordInputListeners(); }, 300);
}

/* ══════════════════════════════════════════════════════════
   API HELPER
══════════════════════════════════════════════════════════ */
async function apiFetch(path, method = 'GET', body = null, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && App.token) headers['Authorization'] = `Bearer ${App.token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (res.status === 401) { handleLogout(); throw new Error('Session expirée'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}
function setApiStatus(state, msg) {
  const dot = document.getElementById('api-dot');
  const text = document.getElementById('api-status-text');
  if (!dot) return;
  dot.className = 'status-dot ' + state;
  if (text) text.textContent = msg || (state === 'connected' ? 'Connecté' : state === 'disconnected' ? 'Hors ligne' : '…');
}

/* ══════════════════════════════════════════════════════════
   CHARGEMENT D'AERODROME — DB locale → OurAirports
══════════════════════════════════════════════════════════ */
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
function icaoRunwayCode(l) { return l < 800 ? 1 : l < 1200 ? 2 : l < 1800 ? 3 : 4; }

/* ─── Geo helpers ─────────────────────────────────────── */
function calcBearing(lat1, lon1, lat2, lon2) {
  const toR = Math.PI / 180, φ1 = lat1 * toR, φ2 = lat2 * toR, Δλ = (lon2 - lon1) * toR;
  const y = Math.sin(Δλ) * Math.cos(φ2), x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000, toR = Math.PI / 180, Δφ = (lat2 - lat1) * toR, Δλ = (lon2 - lon1) * toR;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function normalizeSurface(s) {
  if (!s) return 'UNKN';
  const m = { asphalt: 'ASP', concrete: 'CON', paved: 'ASP', grass: 'GRS', gravel: 'GVL', dirt: 'DIRT', sand: 'SAND', water: 'WATER', compacted: 'GVL', unpaved: 'GVL' };
  return m[s.toLowerCase()] || s.toUpperCase().slice(0, 4);
}

/* ─── OurAirports CSV (fallback offline) ────────────── */
async function getOurAirportsCsv(type) {
  if (_csvCache[type]) return _csvCache[type];
  const labels = { airports: 'aéroports', runways: 'pistes' };
  setAerodromeStatus('loading', `Fallback — téléchargement base ${labels[type]}…`);
  const res = await fetch(OURAIRPORTS[type]);
  if (!res.ok) throw new Error(`OurAirports ${type}: HTTP ${res.status}`);
  const total = parseInt(res.headers.get('Content-Length') || 0);
  const reader = res.body.getReader(); const dec = new TextDecoder(); let received = 0, text = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break; received += value.length; text += dec.decode(value, { stream: true });
    if (total) setAerodromeStatus('loading', `OurAirports ${type}: ${Math.round(received / total * 100)}%`);
  }
  _csvCache[type] = text; return text;
}
function parseCSVLine(line) {
  const res = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; } else if (c === ',' && !inQ) { res.push(cur.trim()); cur = ''; } else cur += c; }
  res.push(cur.trim()); return res;
}
async function ourairportsSearchAirport(icao) {
  const text = await getOurAirportsCsv('airports'); const lines = text.split('\n'); const headers = parseCSVLine(lines[0]);
  for (let i = 1; i < lines.length; i++) { if (!lines[i].trim() || !lines[i].includes(icao)) continue; const vals = parseCSVLine(lines[i]); const row = {}; headers.forEach((h, j) => row[h] = vals[j] || ''); if (row.ident === icao || row.gps_code === icao) return row; }
  return null;
}
async function ourairportsSearchRunways(icao) {
  const text = await getOurAirportsCsv('runways'); const lines = text.split('\n'); const headers = parseCSVLine(lines[0]); const found = [];
  for (let i = 1; i < lines.length; i++) { if (!lines[i].trim() || !lines[i].includes(icao)) continue; const vals = parseCSVLine(lines[i]); const row = {}; headers.forEach((h, j) => row[h] = vals[j] || ''); if (row.airport_ident === icao) found.push(row); }
  return found;
}
function mapOurAirportsToSchema(airport, runwayRows) {
  const runways = [];
  runwayRows.forEach(rwy => {
    const lenM = Math.round((parseFloat(rwy.length_ft) || 0) * 0.3048), widM = Math.round((parseFloat(rwy.width_ft) || 0) * 0.3048);
    const base = { length: lenM, width: widM, surface: normalizeSurface(rwy.surface), lighted: rwy.lighted === '1', closed: rwy.closed === '1', icaoCode: icaoRunwayCode(lenM) };
    if (rwy.le_ident) runways.push({ ...base, designation: rwy.le_ident, reciprocal: rwy.he_ident || '', trueHeading: parseFloat(rwy.le_heading_degT) || 0, elevation: parseFloat(rwy.le_elevation_ft) || parseFloat(airport.elevation_ft) || 0, thresholdLat: parseFloat(rwy.le_latitude_deg) || null, thresholdLon: parseFloat(rwy.le_longitude_deg) || null });
    if (rwy.he_ident) runways.push({ ...base, designation: rwy.he_ident, reciprocal: rwy.le_ident || '', trueHeading: parseFloat(rwy.he_heading_degT) || 0, elevation: parseFloat(rwy.he_elevation_ft) || parseFloat(airport.elevation_ft) || 0, thresholdLat: parseFloat(rwy.he_latitude_deg) || null, thresholdLon: parseFloat(rwy.he_longitude_deg) || null });
  });
  return { icao: airport.ident || airport.gps_code, name: airport.name, type: airport.type || 'aerodrome', latitude: parseFloat(airport.latitude_deg) || 0, longitude: parseFloat(airport.longitude_deg) || 0, elevation: parseFloat(airport.elevation_ft) || 0, country: airport.iso_country || '', city: airport.municipality || '', iata: airport.iata_code || '', source: 'ourairports', importedAt: new Date().toISOString(), runways };
}

function setAerodromeStatus(state, msg) {
  const infoDiv = document.getElementById('aerodrome-info'), nameEl = document.getElementById('aerodrome-name');
  if (!infoDiv || !nameEl) return;
  infoDiv.classList.remove('hidden');
  if (state === 'loading') { nameEl.className = 'aerodrome-loading'; nameEl.textContent = msg || 'Chargement…'; }
  else { nameEl.className = 'aero-name'; }
}

/* ─── loadAerodrome — DB locale d'abord, OurAirports ensuite ─ */
async function loadAerodrome() {
  const icao = document.getElementById('icao-search').value.trim().toUpperCase();
  if (!icao || icao.length < 2) { showToast('Saisissez un code OACI valide', 'warn'); return; }
  const btn = document.querySelector('.btn-icon[onclick="loadAerodrome()"]');
  if (btn) btn.disabled = true;
  setAerodromeStatus('loading', `Recherche ${icao}…`);

  try {
    let schema = null;
    let fromSource = '—';

    /* ── Étape 1 : Backend MongoDB ─────────────────────── */
    try {
      setAerodromeStatus('loading', `Recherche locale — ${icao}…`);
      const apiRes = await apiFetch(`/aerodromes/${icao}`);
      const raw = apiRes.data || apiRes.aerodrome;
      if (raw) {
        schema = normalizeAerodromeFromAPI(raw);
        fromSource = apiRes.source === 'local' ? 'Base locale' : 'OurAirports (auto-sauvegardé)';
        const srcLabel = apiRes.source === 'local' ? '💾 Base locale' : '🌐 OurAirports';
        showToast(`${srcLabel} — ${schema.name}`, 'success');
      }
    } catch (apiErr) {
      /* Backend hors ligne → fallback local */
      console.warn('[loadAerodrome] Backend non disponible, fallback OurAirports direct:', apiErr.message);
      setApiStatus('disconnected', 'Hors ligne');
    }

    /* ── Étape 2 : Fallback OurAirports direct (si backend hors ligne) ── */
    if (!schema) {
      setAerodromeStatus('loading', `OurAirports — recherche ${icao}…`);
      const apRow = await ourairportsSearchAirport(icao);
      if (!apRow) throw new Error(`Code OACI "${icao}" introuvable`);
      const rwRows = await ourairportsSearchRunways(icao);
      schema = mapOurAirportsToSchema(apRow, rwRows);
      fromSource = 'OurAirports (direct)';
    }

    /* ── Piste fictive si aucune piste disponible ─────── */
    /*
    if (!schema.runways?.length) {
      schema.runways = [{
        designation: '00', reciprocal: '18', trueHeading: 0,
        length: 3000, width: 45, elevation: schema.elevation || 0,
        thresholdLat: schema.latitude, thresholdLon: schema.longitude,
        surface: 'UNKN', lighted: false, closed: false, icaoCode: 4,
      }];
      showToast('Aucune piste disponible ', 'warn');
    }
*/
    applyAerodromeToUI(schema);
    /* Charger les obstacles existants pour cet aérodrome */
    await loadObstaclesList();
    showToast(`${schema.name} — ${schema.runways.length} piste(s)  [${fromSource}]`, 'success');

  } catch (err) {
    setAerodromeStatus('error', `${icao} — introuvable`);
    document.getElementById('aerodrome-info').classList.add('hidden');
    showToast(`Erreur chargement ${icao} : ${err.message}`, 'error');
    console.error('loadAerodrome:', err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * Normalise un aérodrome venant du backend (champs français)
 * vers le schéma interne du frontend (champs anglais).
 */
/**
 * Normalise un obstacle venant du backend (champs français)
 * vers le schéma interne du frontend.
 */
function normalizeObstacleFromAPI(raw) {
  const coords = raw.geometrie?.coordinates;
  return {
    _id: raw._id,
    name: raw.nom || raw.name || '—',
    type: normalizeObsTypeBack(raw.type_obstacle || raw.type || ''),
    latitude: coords ? coords[1] : (raw.latitude ?? null),
    longitude: coords ? coords[0] : (raw.longitude ?? null),
    altitude: raw.altitude_max ?? raw.altitude ?? 0,
    height: raw.hauteur ?? raw.height ?? 0,
    temporal: (raw.permanence === 'Temporaire' || raw.temporal === 'temporary') ? 'temporary' : 'permanent',
    expiryDate: raw.date_expiration || raw.expiryDate || null,
    status: normalizeStatusBack(raw.statut_validation || raw.status || 'Draft'),
    aerodromeIcao: raw.aerodrome_id?.code_oaci || raw.aerodromeIcao || '',
    importedFromAixm: raw.importe_depuis_aixm || false,
    createdAt: raw.createdAt,
  };
}
function normalizeObsTypeBack(t) {
  const m = {
    'Bâtiment': 'building', 'Tour': 'tower', 'Pylône': 'tower', 'Végétation': 'vegetation',
    'Grue': 'crane', 'Antenne': 'antenna', 'Ligne électrique': 'powerline',
    "Château d'eau": 'water_tower', 'Immeuble': 'building', 'Autre': 'other'
  };
  return m[t] || t.toLowerCase() || 'other';
}
function normalizeStatusBack(s) {
  const m = { 'Draft': 'draft', 'Pending': 'pending', 'Validated': 'validated' };
  return m[s] || s.toLowerCase() || 'draft';
}

function normalizeAerodromeFromAPI(raw) {
  const coords = raw.point_reference?.coordinates;
  const lon = coords ? coords[0] : (raw.longitude ?? 0);
  const lat = coords ? coords[1] : (raw.latitude ?? 0);

  // Convertir les pistes (format backend français → format frontend)
  const runways = (raw.pistes || []).map(p => {
    // Seuils
    const seuil1 = p.seuils?.[0];
    const seuil2 = p.seuils?.[1];
    return {
      designation: p.qfu_1 || p.designation || '',
      reciprocal: p.qfu_2 || p.reciprocal || '',
      trueHeading: p.cap_vrai || p.trueHeading || 0,
      length: p.longueur || p.length || 0,
      width: p.largeur || p.width || 45,
      surface: p.surface || 'UNKN',
      lighted: p.eclairee ?? p.lighted ?? false,
      closed: p.fermee ?? p.closed ?? false,
      icaoCode: p.code_reference ? parseInt(p.code_reference[0]) || 4 : 4,
      elevation: seuil1?.altitude ?? raw.altitude ?? 0,
      thresholdLat: seuil1?.coordinates?.[1] ?? lat,
      thresholdLon: seuil1?.coordinates?.[0] ?? lon,
    };
  });

  // Ajouter aussi la piste réciproque si elle existe
  const runwaysFull = [];
  (raw.pistes || []).forEach(p => {
    const seuil1 = p.seuils?.[0];
    const seuil2 = p.seuils?.[1];
    const base = {
      length: p.longueur || 0,
      width: p.largeur || 45,
      surface: p.surface || 'UNKN',
      lighted: p.eclairee ?? false,
      closed: p.fermee ?? false,
      icaoCode: p.code_reference ? parseInt(p.code_reference[0]) || 4 : 4,
    };
    if (p.qfu_1 && seuil1) {
      runwaysFull.push({
        ...base,
        designation: p.qfu_1, reciprocal: p.qfu_2 || '',
        trueHeading: p.cap_vrai || 0,
        elevation: seuil1.altitude ?? raw.altitude ?? 0,
        thresholdLat: seuil1.coordinates?.[1] ?? lat,
        thresholdLon: seuil1.coordinates?.[0] ?? lon,
      });
    }
    if (p.qfu_2 && seuil2) {
      const hdg2 = ((p.cap_vrai || 0) + 180) % 360;
      runwaysFull.push({
        ...base,
        designation: p.qfu_2, reciprocal: p.qfu_1 || '',
        trueHeading: hdg2,
        elevation: seuil2.altitude ?? raw.altitude ?? 0,
        thresholdLat: seuil2.coordinates?.[1] ?? lat,
        thresholdLon: seuil2.coordinates?.[0] ?? lon,
      });
    }
  });

  return {
    _id: raw._id,
    icao: raw.code_oaci || raw.icao || '',
    name: raw.nom || raw.name || '',
    type: raw.type || 'aerodrome',
    latitude: lat,
    longitude: lon,
    elevation: raw.altitude || raw.elevation || 0,
    country: raw.pays || raw.country || '',
    city: raw.ville || raw.city || '',
    iata: raw.iata || '',
    source: raw.source || 'ourairports',
    runways: runwaysFull.length ? runwaysFull : runways,
  };
}

function applyAerodromeToUI(schema) {
  App.aerodrome = schema; App.runways = schema.runways || [];
  document.getElementById('aerodrome-info').classList.remove('hidden');
  document.getElementById('aerodrome-name').textContent = `${schema.name}${schema.iata ? '  (' + schema.iata + ')' : ''}`;
  document.getElementById('aerodrome-elev').textContent = `ELEV ${schema.elevation ?? '—'} ft  ·  ${schema.city || schema.country || ''}`;
  buildRunwayTabs();
  const firstOpen = App.runways.find(r => !r.closed) || App.runways[0];
  if (firstOpen) selectRunway(firstOpen);
  if (GeoMap.map)
    GeoMap.map.flyTo({ center: [schema.longitude, schema.latitude], zoom: 13, pitch: 50, bearing: 0, duration: 2000 });
}

function buildRunwayTabs() {
  const container = document.getElementById('runway-tabs'), meta = document.getElementById('runway-meta');
  container.innerHTML = ''; meta.innerHTML = '';
  if (!App.runways.length) { container.innerHTML = '<span class="no-runway-msg">— Aucune piste disponible —</span>'; return; }
  App.runways.forEach((rwy, idx) => {
    const btn = document.createElement('button');
    btn.className = 'runway-tab-btn' + (idx === 0 ? ' active' : '');
    btn.textContent = rwy.designation || rwy.name || `RWY ${idx + 1}`;
    btn.onclick = () => {
      document.querySelectorAll('.runway-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); selectRunway(rwy);
    };
    container.appendChild(btn);
  });
}

function selectRunway(rwy) {
  App.activeRunway = rwy;
  const label = document.getElementById('active-runway-label');
  if (label) label.textContent = `RWY ${rwy.designation || '—'}  |  ${rwy.length || '—'} m  ×  ${rwy.width || '—'} m`;
  document.getElementById('rwy-desig').textContent = rwy.designation || '—';
  document.getElementById('rwy-length').textContent = rwy.length ? `${rwy.length} m` : '—';
  document.getElementById('rwy-width').textContent = rwy.width ? `${rwy.width} m` : '—';
  document.getElementById('rwy-bearing').textContent = rwy.trueHeading != null ? `${rwy.trueHeading}°` : '—';
  document.getElementById('rwy-elev').textContent = rwy.elevation != null ? `${rwy.elevation} ft` : '—';
  document.getElementById('rwy-code').textContent = rwy.icaoCode || '—';
  const meta = document.getElementById('runway-meta');
  meta.innerHTML = `<span class="runway-meta-item">CAP <span>${rwy.trueHeading ?? '—'}°</span></span>` +
    `<span class="runway-meta-item">L <span>${rwy.length ?? '—'} m</span></span>` +
    `<span class="runway-meta-item">l <span>${rwy.width ?? '—'} m</span></span>` +
    `<span class="runway-meta-item">ÉLÉV <span>${rwy.elevation ?? '—'} ft</span></span>`;
  const codeEl = document.getElementById('conf-ref-code');
  if (codeEl) codeEl.textContent = `CODE : ${rwy.icaoCode || '—'}`;
  refreshAnalysis();
  geoMapRenderOLS();
}

/* ══════════════════════════════════════════════════════════
   CALCULS OLS
══════════════════════════════════════════════════════════ */
function ftToM(ft) { return ft * 0.3048; }
function mToFt(m) { return m / 0.3048; }

function geoToLocal(obsLat, obsLon, rwyLat, rwyLon, heading) {
  const R = 6371000, dLat = (obsLat - rwyLat) * Math.PI / 180, dLon = (obsLon - rwyLon) * Math.PI / 180;
  const dx = dLon * R * Math.cos((rwyLat + obsLat) / 2 * Math.PI / 180), dy = dLat * R;
  const hdgRad = heading * Math.PI / 180;
  return { x: dx * Math.cos(hdgRad) - dy * Math.sin(hdgRad), y: dx * Math.sin(hdgRad) + dy * Math.cos(hdgRad) };
}

function getOLSLimit(obsLat, obsLon, rwy) {
  if (!rwy || obsLat == null || obsLon == null) return null;
  const rwyLat = rwy.thresholdLat || rwy.latitude || 0, rwyLon = rwy.thresholdLon || rwy.longitude || 0;
  const rwyElevM = ftToM(rwy.elevation || 0), heading = rwy.trueHeading || 0, L = rwy.length || 3000, W = rwy.width || 45;
  const { x, y } = geoToLocal(obsLat, obsLon, rwyLat, rwyLon, heading);
  let limits = [];
  if (y < 0) { const dist = Math.abs(y) - (W / 2); if (dist > 0 && dist <= OLS.approach.sec1Length + OLS.approach.sec2Length) { const halfW = (OLS.approach.innerWidth / 2) + dist * OLS.approach.divergence; if (Math.abs(x) <= halfW) limits.push({ surface: 'Approche', limit: mToFt(rwyElevM + dist * OLS.approach.slope) }); } }
  if (y > L) { const dist = y - L; if (dist <= OLS.takeoff.length) { const halfW = (OLS.takeoff.innerWidth / 2) + dist * OLS.takeoff.divergence; if (Math.abs(x) <= halfW) limits.push({ surface: 'TOCS Décollage', limit: mToFt(rwyElevM + dist * OLS.takeoff.slope) }); } }
  const distCenter = Math.sqrt(x * x + y * y);
  if (distCenter <= OLS.ihs.radius) limits.push({ surface: 'IHS', limit: mToFt(rwyElevM + OLS.ihs.height) });
  if (distCenter > OLS.ihs.radius && distCenter <= OLS.ihs.radius + OLS.conical.height / OLS.conical.slope) { const distBeyond = distCenter - OLS.ihs.radius; limits.push({ surface: 'Conique', limit: mToFt(rwyElevM + OLS.ihs.height + distBeyond * OLS.conical.slope) }); }
  const stripHalfW = W / 2 + 60;
  if (y >= -(W / 2) && y <= L + W / 2) { const distFromStrip = Math.abs(x) - stripHalfW; if (distFromStrip > 0) { const ols_h = rwyElevM + distFromStrip * OLS.transition.slope; if (ols_h <= rwyElevM + OLS.ihs.height) limits.push({ surface: 'Transition', limit: mToFt(ols_h) }); } }
  if (!limits.length) return null;
  limits.sort((a, b) => a.limit - b.limit);
  return limits[0];
}

/* ══════════════════════════════════════════════════════════
   ANALYSIS REFRESH +  PANEL DE CONFORMITÈ
══════════════════════════════════════════════════════════ */
function refreshAnalysis() {
  if (!App.activeRunway) return;
  const rwy = App.activeRunway;
  let total = 0, breaches = 0, ok = 0, maxObsAlt = null, maxClearance = null;
  App.obstacles.forEach(obs => {
    total++;
    const result = getOLSLimit(obs.latitude, obs.longitude, rwy);
    const olsLimit = result ? result.limit : null, breach = olsLimit !== null && obs.altitude > olsLimit;
    const clearance = olsLimit != null ? (olsLimit - obs.altitude) : null;
    if (breach) breaches++; else ok++;
    if (obs.altitude != null && (maxObsAlt === null || obs.altitude > maxObsAlt)) maxObsAlt = obs.altitude;
    if (clearance !== null && (maxClearance === null || clearance < maxClearance)) maxClearance = clearance;
  });
  updateConformityPanel(total, breaches, ok, maxObsAlt, maxClearance, rwy);
  updateObstaclesLayer();
}

function updateConformityPanel(total, breaches, ok, maxObsAlt, maxClearance, rwy) {
  const statusEl = document.getElementById('conf-main-status'), subEl = document.getElementById('conf-sub');
  const altEl = document.getElementById('conf-alt-max'), clearEl = document.getElementById('conf-clearance');
  const obsEl = document.getElementById('conf-obs-count'), penEl = document.getElementById('conf-penetrations');
  if (total === 0) { statusEl.textContent = '—'; statusEl.className = 'conf-main-status'; subEl.textContent = 'AUCUN OBSTACLE'; }
  else if (breaches > 0) { statusEl.textContent = 'NON CONFORME'; statusEl.className = 'conf-main-status violation'; subEl.textContent = `${breaches} PÉNÉTRATION${breaches > 1 ? 'S' : ''} DÉTECTÉE${breaches > 1 ? 'S' : ''}`; }
  else { statusEl.textContent = 'CONFORME'; statusEl.className = 'conf-main-status conforme'; subEl.textContent = 'AUCUNE PÉNÉTRATION OLS'; }
  if (altEl) altEl.textContent = maxObsAlt != null ? `${ftToM(maxObsAlt).toFixed(1)} m` : '— m';
  if (clearEl) clearEl.textContent = maxClearance != null ? `${ftToM(maxClearance).toFixed(1)} m` : '— m';
  if (obsEl) obsEl.textContent = total;
  if (penEl) { penEl.textContent = breaches; penEl.className = 'conf-metric-val big' + (breaches > 0 ? ' danger' : ''); }
  buildConfSurfacesTable(rwy);
}

function buildConfSurfacesTable(rwy) {
  const list = document.getElementById('conf-surfaces-list');
  if (!list || !rwy) return;
  const elv = rwy.elevation || 0;
  const surfaces = [
    { name: 'Approche S1', slope: '1:50', limitZ: `${(elv + mToFt(OLS.approach.sec1Length * OLS.approach.slope)).toFixed(0)} ft`, label: 'Approche' },
    { name: 'Transition', slope: '1:7', limitZ: `${(elv + mToFt(OLS.ihs.height)).toFixed(0)} ft`, label: 'Transition' },
    { name: 'IHS', slope: 'Fixe', limitZ: `${(elv + mToFt(OLS.ihs.height)).toFixed(0)} ft`, label: 'IHS' },
    { name: 'Conique', slope: '1:20', limitZ: `${(elv + mToFt(OLS.ihs.height + OLS.conical.height)).toFixed(0)} ft`, label: 'Conique' },
    { name: 'TOCS', slope: '1:50', limitZ: `${(elv + mToFt(OLS.takeoff.length * OLS.takeoff.slope)).toFixed(0)} ft`, label: 'TOCS Décollage' },
  ];
  const breachedSurfaces = new Set(), obsZBySurface = {};
  App.obstacles.forEach(obs => {
    const result = getOLSLimit(obs.latitude, obs.longitude, rwy);
    if (!result) return;
    if (obs.altitude > result.limit) breachedSurfaces.add(result.surface);
    if (!obsZBySurface[result.surface] || obs.altitude > obsZBySurface[result.surface]) obsZBySurface[result.surface] = obs.altitude;
  });
  list.innerHTML = surfaces.map(s => {
    const breached = breachedSurfaces.has(s.label), obsZ = obsZBySurface[s.label];
    const obsZStr = obsZ != null ? `${obsZ} ft` : '—';
    const stateHTML = !App.obstacles.length ? `<span class="conf-surf-state-na">N/A</span>` :
      breached ? `<span class="conf-surf-state-fail">✗</span>` : `<span class="conf-surf-state-ok">✓</span>`;
    return `<div class="conf-surface-row"><span class="conf-surf-name">${s.name}</span><span class="conf-surf-slope">${s.slope}</span><span class="conf-surf-lim">${s.limitZ}</span><span class="conf-surf-obs">${obsZStr}</span><span>${stateHTML}</span></div>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════
  CHAMPS OBSTACLE 
══════════════════════════════════════════════════════════ */
function setCoordMode(mode) {
  App.coordMode = mode;
  document.getElementById('coord-dms').classList.toggle('active', mode === 'dms');
  document.getElementById('coord-dd').classList.toggle('active', mode === 'dd');
  document.getElementById('btn-dms').classList.toggle('active', mode === 'dms');
  document.getElementById('btn-dd').classList.toggle('active', mode === 'dd');
  updatePreviewMarker();
}
function dmsToDecimal(deg, min, sec, hem) {
  const d = parseFloat(deg) || 0, m = parseFloat(min) || 0, s = parseFloat(sec) || 0;
  return ((hem === 'S' || hem === 'W') ? -1 : 1) * (d + m / 60 + s / 3600);
}
function getCoordinates() {
  if (App.coordMode === 'dms') {
    const latDeg = document.getElementById('lat-deg').value;
    const lonDeg = document.getElementById('lon-deg').value;
    if (!latDeg || !lonDeg) return { lat: NaN, lon: NaN };
    return {
      lat: dmsToDecimal(latDeg, document.getElementById('lat-min').value, document.getElementById('lat-sec').value, document.getElementById('lat-hem').value),
      lon: dmsToDecimal(lonDeg, document.getElementById('lon-min').value, document.getElementById('lon-sec').value, document.getElementById('lon-hem').value),
    };
  }
  const latDd = document.getElementById('lat-dd').value;
  const lonDd = document.getElementById('lon-dd').value;
  if (!latDd || !lonDd) return { lat: NaN, lon: NaN };
  return { lat: parseFloat(latDd), lon: parseFloat(lonDd) };
}

/* ── Preview marker live sur la carte ───────────────────
   Affiché dès que les coordonnées du formulaire sont valides,
   avant même la soumission de l'obstacle.
──────────────────────────────────────────────────────── */
function updatePreviewMarker() {
  const map = GeoMap.map;
  if (!map || !map.loaded()) return;

  const { lat, lon } = getCoordinates();
  const valid = !isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;

  if (!map.getSource('src-preview')) {
    map.addSource('src-preview', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    // Extrusion (barre 3D)
    map.addLayer({
      id: 'preview-extrude',
      type: 'fill-extrusion',
      source: 'src-preview',
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-opacity': 0.88,
        'fill-extrusion-height': ['get', 'heightM'],
        'fill-extrusion-base': ['get', 'baseH']
      }
    });
    // Point central
    map.addLayer({
      id: 'preview-dot',
      type: 'circle',
      source: 'src-preview',
      paint: {
        'circle-radius': 7,
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.95,
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': 2,
      },
    });
    // Label
    map.addLayer({
      id: 'preview-label',
      type: 'symbol',
      source: 'src-preview',
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Regular'],
        'text-size': 11,
        'text-offset': [0, -2],
        'text-anchor': 'bottom',
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': 'rgba(5,8,20,0.9)',
        'text-halo-width': 2,
      },
    });

    // Ajout événements de survol pour l'infobulle
    map.on('mouseenter', 'preview-dot', showPreviewTooltip);
    map.on('mouseleave', 'preview-dot', hideTooltip);
    map.on('mouseenter', 'preview-extrude', showPreviewTooltip);
    map.on('mouseleave', 'preview-extrude', hideTooltip);
  }

  if (!valid) {
    map.getSource('src-preview').setData({ type: 'FeatureCollection', features: [] });
    return;
  }

  const name = document.getElementById('obs-name')?.value.trim() || '⊕ Prévisualisation';
  const type = typeToLabel(document.getElementById('obs-type')?.value);
  const alt = parseFloat(document.getElementById('obs-alt')?.value) || 0;
  const height = parseFloat(document.getElementById('obs-height')?.value) || 10;
  const label = name + `\n${alt} ft`;

  const rwy = App.activeRunway;
  const elevM = rwy ? ftToM(rwy.elevation || 0) : 0;
  const result = rwy ? getOLSLimit(lat, lon, rwy) : null;
  const olsLimit = result ? result.limit : null;
  const breach = olsLimit !== null && alt > olsLimit;
  const clearance = olsLimit != null ? (olsLimit - alt).toFixed(1) : null;

  const heightM = Math.max(ftToM(height), 5);
  const color = olsLimit == null ? '#6AB4FF' : breach ? '#FF1744' : '#00E676';
  const verdict = olsLimit == null ? 'HORS ZONE' : breach ? '▲ PÉNÉTRATION' : '✓ CONFORME';

  map.getSource('src-preview').setData({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        label, name, type, altitude: alt, height,
        breach, clearance, surface: result ? result.surface : 'hors zone',
        olsLimit, heightM: elevM + heightM, baseH: elevM, color, verdict
      },
      geometry: makePointBufferPolygon(lat, lon, 15),
    }],
  });

  // Ne centrer que si c'est loin ou qu'on tape les coordonnées manuellement (évite l'effet rebond intempestif)
  const currentCenter = map.getCenter();
  if (Math.abs(currentCenter.lat - lat) > 0.01 || Math.abs(currentCenter.lng - lon) > 0.01) {
    map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 14), duration: 600 });
  }
}

// Variables pour les infobulles partagées
let mapTooltip = null;

function hideTooltip() {
  const map = GeoMap.map;
  if (map) map.getCanvas().style.cursor = '';
  if (mapTooltip) { mapTooltip.remove(); mapTooltip = null; }
}

function showPreviewTooltip(e) {
  const map = GeoMap.map;
  if (!map) return;
  map.getCanvas().style.cursor = 'pointer';
  const p = e.features[0].properties;

  const html = `<div style="font-family:monospace;font-size:11px;color:#d0e8f5;background:#0b1220;border:1px solid #00E5FF33;padding:10px 13px;border-radius:5px;min-width:170px;line-height:1.7;">
    <b style="color:#00E5FF;font-size:12px;">${p.name}</b><br>
    <span style="color:#6A8AA8">${p.type}</span><br>
    <span style="color:#6A8AA8">Alt :</span> <b>${p.altitude} ft AMSL</b><br>
    <span style="color:#6A8AA8">Haut :</span> <b>${p.height} ft AGL</b><br>
    <span style="color:#6A8AA8">Surface :</span> ${p.surface}<br>
    ${p.olsLimit != null
      ? `<span style="color:#6A8AA8">Limite OLS :</span> ${parseFloat(p.olsLimit).toFixed(0)} ft<br>
         <span style="color:#6A8AA8">Dégagement :</span> <b style="color:${p.color}">${p.clearance} ft</b><br>`
      : ''}
    <b style="color:${p.color};font-size:12px;">${p.verdict}</b>
  </div>`;

  if (mapTooltip) mapTooltip.remove();
  mapTooltip = new mapboxgl.Popup({ closeButton: false, offset: 15, maxWidth: '260px' })
    .setLngLat(e.lngLat).setHTML(html).addTo(map);
}

/* Bind les événements de saisie coordonnées → preview live */
function bindCoordInputListeners() {
  const coordIds = [
    'lat-deg', 'lat-min', 'lat-sec', 'lat-hem',
    'lon-deg', 'lon-min', 'lon-sec', 'lon-hem',
    'lat-dd', 'lon-dd',
  ];
  coordIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updatePreviewMarker);
    if (el) el.addEventListener('change', updatePreviewMarker);
  });
  // Le nom, altitude et hauteur mettent à jour le label du marker
  ['obs-name', 'obs-alt', 'obs-height'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updatePreviewMarker);
  });
}

/* Effacer le marker de prévisualisation */
function clearPreviewMarker() {
  const map = GeoMap.map;
  if (!map || !map.getSource('src-preview')) return;
  map.getSource('src-preview').setData({ type: 'FeatureCollection', features: [] });
}
async function submitObstacle() {
  const name = document.getElementById('obs-name').value.trim(), type = document.getElementById('obs-type').value;
  const alt = parseFloat(document.getElementById('obs-alt').value), height = parseFloat(document.getElementById('obs-height').value);
  const temporal = document.getElementById('obs-temporal').value, expiry = document.getElementById('obs-expiry').value;
  if (!name) { showToast('Désignation requise', 'warn'); return; }
  if (isNaN(alt)) { showToast('Altitude requise (ft AMSL)', 'warn'); return; }
  if (isNaN(height)) { showToast('Hauteur requise (ft AGL)', 'warn'); return; }
  const { lat, lon } = getCoordinates();
  if (isNaN(lat) || isNaN(lon)) { showToast('Coordonnées invalides', 'warn'); return; }
  if (lat < -90 || lat > 90) { showToast('Latitude hors limites', 'warn'); return; }
  if (lon < -180 || lon > 180) { showToast('Longitude hors limites', 'warn'); return; }
  if (temporal === 'temporary' && !expiry) { showToast("Date d'expiration requise", 'warn'); return; }
  if (!App.aerodrome) { showToast('Aucun aérodrome actif', 'warn'); return; }

  const icao = App.aerodrome.icao || document.getElementById('icao-search').value.trim().toUpperCase();
  const payload = {
    name, type, latitude: lat, longitude: lon, altitude: alt, height, temporal,
    aerodromeIcao: icao,
    ...(temporal === 'temporary' ? { expiryDate: expiry } : {}),
  };

  try {
    const res = await apiFetch('/obstacles', 'POST', payload);
    const apiObs = normalizeObstacleFromAPI(res.data || res.obstacle || res);
    const newObs = {
      ...apiObs,
      latitude: (apiObs.latitude !== null && !isNaN(apiObs.latitude)) ? apiObs.latitude : payload.latitude,
      longitude: (apiObs.longitude !== null && !isNaN(apiObs.longitude)) ? apiObs.longitude : payload.longitude,
      altitude: apiObs.altitude || payload.altitude,
      height: apiObs.height || payload.height,
      _id: apiObs._id || Date.now().toString(),
      status: apiObs.status || 'draft',
      createdAt: apiObs.createdAt || new Date().toISOString(),
    };
    App.obstacles.push(newObs); App.allObstacles.push(newObs);
    showToast(`Obstacle "${name}" sauvegardé en base`, 'success');
  } catch (e) {
    const newObs = { ...payload, _id: Date.now().toString(), status: 'draft', createdAt: new Date().toISOString() };
    App.obstacles.push(newObs); App.allObstacles.push(newObs);
    showToast(`Obstacle "${name}" ajouté localement (API hors ligne)`, 'warn');
  }

  clearObstacleForm();
  /*clearPreviewMarker();
  updateObstaclesLayer(); */
  refreshAnalysis();
  checkExpirations();
}

function clearObstacleForm() {
  ['obs-name', 'obs-alt', 'obs-height', 'lat-deg', 'lat-min', 'lat-sec', 'lon-deg', 'lon-min', 'lon-sec', 'lat-dd', 'lon-dd']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('obs-temporal').value = 'permanent';
  document.getElementById('expiry-group').classList.add('hidden');
}

/* ══════════════════════════════════════════════════════════
   OBSTACLES LIST (Tab 2)
══════════════════════════════════════════════════════════ */
async function loadObstaclesList() {
  const icao = App.aerodrome?.icao || document.getElementById('icao-search').value.trim().toUpperCase();
  if (!icao) return;
  try {
    const res = await apiFetch(`/obstacles?icao=${icao}`);
    const raw = res.data || res.obstacles || res || [];
    App.allObstacles = raw.map(normalizeObstacleFromAPI);
    App.obstacles = [...App.allObstacles];
    renderObstaclesList(App.allObstacles);
    refreshAnalysis();
  } catch (e) {
    renderObstaclesList(App.obstacles);
  }
}
function filterObstacles() {
  const search = (document.getElementById('obs-search').value || '').toLowerCase();
  const status = document.getElementById('obs-filter-status').value, type = document.getElementById('obs-filter-type').value;
  const breach = document.getElementById('obs-filter-breach').checked;
  renderObstaclesList(App.allObstacles.filter(obs => {
    if (search && !obs.name.toLowerCase().includes(search)) return false;
    if (status && obs.status !== status) return false;
    if (type && obs.type !== type) return false;
    if (breach) { const r = App.activeRunway ? getOLSLimit(obs.latitude, obs.longitude, App.activeRunway) : null; if (!r || obs.altitude <= r.limit) return false; }
    return true;
  }));
}
function renderObstaclesList(list) {
  const tbody = document.getElementById('obs-list-tbody');
  if (!tbody) return;
  if (!list.length) { tbody.innerHTML = '<tr class="table-placeholder"><td colspan="10">Aucun obstacle trouvé</td></tr>'; return; }
  tbody.innerHTML = list.map(obs => {
    const result = App.activeRunway ? getOLSLimit(obs.latitude, obs.longitude, App.activeRunway) : null;
    const breach = result && obs.altitude > result.limit;
    const verdict = result == null ? '<span class="tag tag-info">HORS ZONE</span>' : breach ? '<span class="tag tag-fail">PÉNÉTRATION</span>' : '<span class="tag tag-pass">CONFORME</span>';
    const statusTag = `<span class="tag tag-${obs.status || 'draft'}">${statusLabel(obs.status)}</span>`;
    const temporal = obs.temporal === 'temporary' ? `<span class="tag tag-warn">TEMP</span>` : `<span class="tag tag-info">PERM</span>`;
    return `<tr><td style="font-weight:600;">${obs.name}</td><td>${typeToLabel(obs.type)}</td><td class="mono">${obs.latitude != null ? obs.latitude.toFixed(6) : '—'}</td><td class="mono">${obs.longitude != null ? obs.longitude.toFixed(6) : '—'}</td><td class="mono">${obs.altitude ?? '—'}</td><td class="mono">${obs.height ?? '—'}</td><td>${temporal}</td><td>${statusTag}</td><td>${verdict}</td><td>${buildWorkflowActions(obs)}</td></tr>`;
  }).join('');
  const pending = list.filter(o => o.status === 'pending').length;
  const pendingEl = document.getElementById('pending-count');
  if (pendingEl) pendingEl.textContent = pending;
  renderPendingList(list.filter(o => o.status === 'pending'));
}
function buildWorkflowActions(obs) {
  const actions = [];
  if (obs.status === 'draft') actions.push(`<button class="action-btn pending" onclick="setObstacleStatus('${obs._id}','pending')">SOUMETTRE</button>`);
  if (obs.status === 'pending') {
    actions.push(`<button class="action-btn validate" onclick="setObstacleStatus('${obs._id}','validated')">VALIDER</button>`);
    actions.push(`<button class="action-btn reject" onclick="setObstacleStatus('${obs._id}','draft')">REJETER</button>`);
  }
  actions.push(`<button class="action-btn delete" onclick="confirmDelete('${obs._id}','${obs.name.replace(/'/g, "\\'")}')">✕</button>`);
  return `<div class="action-group">${actions.join('')}</div>`;
}
async function setObstacleStatus(id, newStatus) {
  try { await apiFetch(`/obstacles/${id}/status`, 'PUT', { status: newStatus }); } catch (e) { }
  [App.allObstacles, App.obstacles].forEach(arr => { const o = arr.find(o => o._id === id); if (o) o.status = newStatus; });
  showToast(`Statut mis à jour : ${statusLabel(newStatus)}`, 'success');
  renderObstaclesList(App.allObstacles);
  renderPendingList(App.allObstacles.filter(o => o.status === 'pending'));
}
function confirmDelete(id, name) {
  showModal("Supprimer l'obstacle", `Confirmer la suppression de <strong>${name}</strong> ?<br>Cette action est irréversible.`, async () => {
    try { await apiFetch(`/obstacles/${id}`, 'DELETE'); } catch (e) { }
    App.obstacles = App.obstacles.filter(o => o._id !== id);
    App.allObstacles = App.allObstacles.filter(o => o._id !== id);
    showToast('Obstacle supprimé', 'success'); renderObstaclesList(App.allObstacles); refreshAnalysis();
  });
}
function renderPendingList(list) {
  const el = document.getElementById('pending-list'); if (!el) return;
  if (!list.length) { el.innerHTML = '<span class="empty-msg">Aucun élément en attente</span>'; return; }
  el.innerHTML = list.map(obs => `<div class="expiry-item warning"><span class="expiry-name">${obs.name}</span><span class="expiry-date">${typeToLabel(obs.type)} — En attente validation</span></div>`).join('');
}

/* ══════════════════════════════════════════════════════════
   EXPIRATION ALERTS
══════════════════════════════════════════════════════════ */
function checkExpirations() {
  const now = new Date(), warn30 = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  const expiring = App.obstacles.filter(obs => obs.temporal === 'temporary' && obs.expiryDate)
    .map(obs => { const exp = new Date(obs.expiryDate); const daysLeft = Math.ceil((exp - now) / (24 * 3600 * 1000)); return { obs, exp, daysLeft }; })
    .filter(({ exp }) => exp <= warn30).sort((a, b) => a.exp - b.exp);
  const list = document.getElementById('expiry-list'), count = document.getElementById('expiry-count');
  if (!list) return;
  if (count) count.textContent = expiring.length;
  if (!expiring.length) { list.innerHTML = '<span class="empty-msg">Aucune alerte</span>'; return; }
  list.innerHTML = expiring.map(({ obs, exp, daysLeft }) => {
    const cls = daysLeft <= 7 ? 'critical' : 'warning';
    const label = daysLeft <= 0 ? '⚠ EXPIRÉ' : daysLeft === 1 ? 'Expire demain' : `Expire dans ${daysLeft} j`;
    return `<div class="expiry-item ${cls}"><span class="expiry-name">${obs.name}</span><span class="expiry-date">${label} — ${exp.toLocaleDateString('fr-FR')}</span></div>`;
  }).join('');
  expiring.filter(({ daysLeft }) => daysLeft <= 0).forEach(({ obs }) => showToast(`⚠ Obstacle "${obs.name}" a expiré !`, 'error'));
}

/* ══════════════════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════════════════ */
function switchTab(btn, tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');
  if (tab === 'obstacles') renderObstaclesList(App.allObstacles);
  if (tab === 'analyse' && GeoMap.map) setTimeout(() => GeoMap.map.resize(), 100);
}

/* ══════════════════════════════════════════════════════════
   MODAL
══════════════════════════════════════════════════════════ */
function showModal(title, body, onConfirm) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  App.modalAction = onConfirm;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); App.modalAction = null; }
function confirmModalAction() { if (App.modalAction) App.modalAction(); closeModal(); }

/* ══════════════════════════════════════════════════════════
   TOASTS
══════════════════════════════════════════════════════════ */
function showToast(msg, type = 'info') {
  const icons = { success: '✓', error: '✗', warn: '⚠', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

/* ══════════════════════════════════════════════════════════
   IMPORT LOG
══════════════════════════════════════════════════════════ */
function addLog(level, msg) {
  const log = document.getElementById('import-log'); if (!log) return;
  const line = document.createElement('div'); line.className = `log-line log-${level}`;
  line.textContent = `[${new Date().toLocaleTimeString('fr-FR', { hour12: false })}] ${msg}`;
  log.appendChild(line); log.scrollTop = log.scrollHeight;
}
function clearLog() { const log = document.getElementById('import-log'); if (log) log.innerHTML = '<span class="log-line log-info">Journal effacé.</span>'; }

/* ══════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════ */
function typeToLabel(t) { const m = { building: 'Bâtiment', tower: 'Tour/Pylône', vegetation: 'Végétation', crane: 'Grue', antenna: 'Antenne', powerline: 'Ligne HT', water_tower: 'Château eau', other: 'Autre' }; return m[t] || t || '—'; }
function statusLabel(s) { const m = { draft: 'BROUILLON', pending: 'EN ATTENTE', validated: 'VALIDÉ' }; return m[s] || (s || '—').toUpperCase(); }
function formatBytes(b) { if (b < 1024) return `${b} B`; if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`; return `${(b / 1048576).toFixed(2)} MB`; }
document.addEventListener('keydown', e => { if (e.key === 'Enter') { const login = document.getElementById('screen-login'); if (login.classList.contains('active')) handleLogin(); } });

/* ══════════════════════════════════════════════════════════
   AIXM 5.1 IMPORT
══════════════════════════════════════════════════════════ */
function handleFileDrop(e) { e.preventDefault(); document.getElementById('drop-zone').classList.remove('drag-over'); const file = e.dataTransfer.files[0]; if (file) processAixmFile(file); }
function handleFileSelect(e) { const file = e.target.files[0]; if (file) processAixmFile(file); }
function processAixmFile(file) {
  App.aixmFile = file;
  document.getElementById('file-name').textContent = file.name;
  document.getElementById('file-size').textContent = formatBytes(file.size);
  document.getElementById('file-preview').classList.remove('hidden');
  document.getElementById('btn-import').disabled = false;
  const reader = new FileReader();
  reader.onload = e => { document.getElementById('xml-preview').textContent = e.target.result.split('\n').slice(0, 80).join('\n'); };
  reader.readAsText(file);
  addLog('info', `Fichier chargé : ${file.name} (${formatBytes(file.size)})`);
}
function clearFile() {
  App.aixmFile = null;
  document.getElementById('file-preview').classList.add('hidden');
  document.getElementById('xml-preview').textContent = 'Chargez un fichier pour prévisualiser';
  document.getElementById('aixm-file').value = '';
  document.getElementById('btn-import').disabled = true;
}
async function runAixmImport() {
  if (!App.aixmFile) { showToast('Aucun fichier sélectionné', 'warn'); return; }
  if (!App.aerodrome) { showToast("Sélectionnez un aérodrome avant d'importer", 'warn'); return; }
  const mode = document.querySelector('input[name="import-mode"]:checked').value;
  addLog('info', `=== Début import AIXM 5.1 — mode: ${mode} ===`);
  addLog('info', `Aérodrome cible : ${App.aerodrome.icao}`);
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const doc = new DOMParser().parseFromString(e.target.result, 'application/xml');
      if (doc.querySelector('parsererror')) { addLog('error', 'Erreur de parsing XML'); return; }
      if (mode === 'surfaces' || mode === 'all') parseAixmSurfaces(doc);
      if (mode === 'obstacles' || mode === 'all') await parseAixmObstacles(doc);
      addLog('success', '=== Import terminé ===');
    } catch (err) { addLog('error', `Erreur inattendue : ${err.message}`); }
  };
  reader.readAsText(App.aixmFile);
}
function parseAixmSurfaces(doc) {
  addLog('info', 'Analyse des surfaces OLS depuis XML…');
  const ns = { aixm: 'http://www.aixm.aero/schema/5.1' };
  ['ObstacleLimitationSurface', 'Surface', 'airportHeliport', 'RunwayProtectArea', 'Obstacle'].forEach(tag => {
    const nodes = doc.getElementsByTagNameNS(ns.aixm, tag);
    if (nodes.length) addLog('success', `  → ${nodes.length} élément(s) <aixm:${tag}> trouvé(s)`);
  });
  const tagCounts = {};
  for (const el of doc.getElementsByTagName('*')) tagCounts[el.localName] = (tagCounts[el.localName] || 0) + 1;
  addLog('info', 'Éléments XML :');
  Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([name, count]) => addLog('info', `  <${name}> × ${count}`));
  addLog('warn', 'Paramètres ICAO Annex 14 par défaut actifs — surfaces tracées sur la carte');
  updateObstaclesLayer();
}
async function parseAixmObstacles(doc) {
  addLog('info', 'Extraction des obstacles…');
  const obsNodes = [...doc.getElementsByTagNameNS('http://www.aixm.aero/schema/5.1', 'Obstacle'), ...doc.getElementsByTagName('Obstacle'), ...doc.getElementsByTagName('obstacle')];
  if (!obsNodes.length) { addLog('warn', 'Aucun obstacle trouvé dans ce fichier AIXM'); return; }
  addLog('info', `${obsNodes.length} obstacle(s) trouvé(s) — import en cours…`);
  let imported = 0, errors = 0;
  for (const node of obsNodes) {
    try {
      const name = getXmlText(node, ['name', 'designator', 'Name']) || `Obstacle AIXM ${imported + 1}`;
      const type = getXmlText(node, ['type', 'obstacleType', 'Type']) || 'other';
      const pos = (getXmlText(node, ['pos', 'coordinates', 'Pos']) || '').trim().split(/\s+/).map(Number).filter(n => !isNaN(n));
      let lat = NaN, lon = NaN;
      if (pos.length >= 2) { lat = pos[0]; lon = pos[1]; }
      const alt = parseFloat(getXmlText(node, ['elevation', 'altitude', 'height', 'Elevation']) || '') || 0;
      if (isNaN(lat) || isNaN(lon)) { addLog('warn', `  ✗ ${name} — coordonnées manquantes, ignoré`); errors++; continue; }
      const payload = { name, type: normalizeObsType(type), latitude: lat, longitude: lon, altitude: alt, height: alt, temporal: 'permanent', aerodromeIcao: App.aerodrome.icao, importedFromAixm: true };
      try {
        const res = await apiFetch('/obstacles', 'POST', payload);
        const obs = res.obstacle || { ...payload, _id: Date.now().toString() + imported, status: 'draft', createdAt: new Date().toISOString() };
        App.obstacles.push(obs); App.allObstacles.push(obs);
      } catch (e) {
        const obs = { ...payload, _id: Date.now().toString() + imported, status: 'draft', createdAt: new Date().toISOString() };
        App.obstacles.push(obs); App.allObstacles.push(obs);
      }
      addLog('success', `  ✓ ${name} (${lat.toFixed(4)}, ${lon.toFixed(4)}) — ${alt} ft`); imported++;
    } catch (e) { addLog('error', `  ✗ Erreur : ${e.message}`); errors++; }
  }
  addLog(imported > 0 ? 'success' : 'warn', `Import obstacles : ${imported} importé(s), ${errors} erreur(s)`);
  if (imported > 0) { refreshAnalysis(); renderObstaclesList(App.allObstacles); showToast(`${imported} obstacle(s) importé(s) depuis AIXM`, 'success'); checkExpirations(); }
}
function getXmlText(node, names) { for (const name of names) { const child = node.querySelector(name) || node.getElementsByTagName(name)[0]; if (child) return child.textContent.trim(); } return null; }
function normalizeObsType(t) { t = (t || '').toLowerCase(); if (t.includes('tower') || t.includes('pylon')) return 'tower'; if (t.includes('tree') || t.includes('veget')) return 'vegetation'; if (t.includes('crane')) return 'crane'; if (t.includes('antenna')) return 'antenna'; if (t.includes('power') || t.includes('wire')) return 'powerline'; if (t.includes('water')) return 'water_tower'; if (t.includes('building')) return 'building'; return 'other'; }

/* ══════════════════════════════════════════════════════════
   GEO MAP ENGINE — Mapbox GL JS
   Surfaces OLS géoréférencées sur satellite HD
══════════════════════════════════════════════════════════ */

/* ── VOTRE TOKEN MAPBOX ─────────────────────────────────────
   Obtenez le vôtre sur https://account.mapbox.com
   Remplacez la valeur ci-dessous par votre token pk.eyJ1…   */
const MAPBOX_TOKEN = 'pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw';

const GeoMap = {
  map: null,
  initialized: false,
};

/* ─── Geo helpers ─────────────────────────────────────── */
function destPoint(lat, lon, bearing, dist) {
  const R = 6378137, toR = Math.PI / 180;
  const φ1 = lat * toR, λ1 = lon * toR, θ = bearing * toR, δ = dist / R;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [λ2 * 180 / Math.PI, φ2 * 180 / Math.PI];
}
function makePolygon(coords, id) {
  return { type: 'Feature', id, properties: { id }, geometry: { type: 'Polygon', coordinates: [coords] } };
}
function makePointBufferPolygon(lat, lon, radius = 15) {
  const points = [];
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];
  angles.forEach(angle => {
    points.push(destPoint(lat, lon, angle, radius));
  });
  points.push(points[0]); // close polygon
  return {
    type: 'Polygon',
    coordinates: [points]
  };
}

/* ─── OLS surface builders ───────────────────────────── */
function buildApproachCoords(rwy) {
  const lat = rwy.thresholdLat, lon = rwy.thresholdLon, hdg = rwy.trueHeading || 0;
  const W = rwy.width || 45, P = OLS.approach;
  const d1 = P.sec1Length, d2 = P.sec2Length;
  const w0 = P.innerWidth / 2, w1 = w0 + d1 * P.divergence, w2 = w0 + (d1 + d2) * P.divergence;
  const back = (hdg + 180) % 360, perp = (hdg + 270) % 360, perp2 = (hdg + 90) % 360;
  const tL = destPoint(lat, lon, perp, W / 2), tR = destPoint(lat, lon, perp2, W / 2);
  const m1 = destPoint(lat, lon, back, d1);
  const midL1 = destPoint(m1[1], m1[0], perp, w1), midR1 = destPoint(m1[1], m1[0], perp2, w1);
  const m2 = destPoint(lat, lon, back, d1 + d2);
  const midL2 = destPoint(m2[1], m2[0], perp, w2), midR2 = destPoint(m2[1], m2[0], perp2, w2);
  return [[tL[0], tL[1]], [midL1[0], midL1[1]], [midL2[0], midL2[1]], [midR2[0], midR2[1]], [midR1[0], midR1[1]], [tR[0], tR[1]], [tL[0], tL[1]]];
}

function buildTocsCoords(rwy) {
  const lat = rwy.thresholdLat, lon = rwy.thresholdLon;
  const hdg = rwy.trueHeading || 0, L = rwy.length || 3000, W = rwy.width || 45;
  const far = destPoint(lat, lon, hdg, L);
  const P = OLS.takeoff;
  const w0 = P.innerWidth / 2, wFar = w0 + P.length * P.divergence;
  const perp = (hdg + 270) % 360, perp2 = (hdg + 90) % 360;
  const n1L = destPoint(far[1], far[0], perp, W / 2), n1R = destPoint(far[1], far[0], perp2, W / 2);
  const farPt = destPoint(far[1], far[0], hdg, P.length);
  const n2L = destPoint(farPt[1], farPt[0], perp, wFar), n2R = destPoint(farPt[1], farPt[0], perp2, wFar);
  return [[n1L[0], n1L[1]], [n2L[0], n2L[1]], [n2R[0], n2R[1]], [n1R[0], n1R[1]], [n1L[0], n1L[1]]];
}

function buildIHSCoords(rwy, segments = 72) {
  const cLat = rwy.thresholdLat, cLon = rwy.thresholdLon;
  const L = rwy.length || 3000, hdg = rwy.trueHeading || 0;
  const center = destPoint(cLat, cLon, hdg, L / 2);
  const R = OLS.ihs.radius, ring = [];
  for (let i = 0; i <= segments; i++) { const angle = (i / segments) * 360; ring.push(destPoint(center[1], center[0], angle, R)); }
  return ring;
}

function buildConicalCoords(rwy, segments = 72) {
  const cLat = rwy.thresholdLat, cLon = rwy.thresholdLon;
  const L = rwy.length || 3000, hdg = rwy.trueHeading || 0;
  const center = destPoint(cLat, cLon, hdg, L / 2);
  const rInner = OLS.ihs.radius, rOuter = rInner + OLS.conical.height / OLS.conical.slope;
  const outer = [], inner = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 360;
    outer.push(destPoint(center[1], center[0], angle, rOuter));
    inner.push(destPoint(center[1], center[0], angle, rInner));
  }
  return { outer, inner };
}

function buildTransitionCoords(rwy) {
  const lat = rwy.thresholdLat, lon = rwy.thresholdLon;
  const hdg = rwy.trueHeading || 0, L = rwy.length || 3000, W = rwy.width || 45;
  const stripHW = W / 2 + 60, transW = OLS.ihs.height / OLS.transition.slope;
  const perp = (hdg + 270) % 360, perp2 = (hdg + 90) % 360;
  const far = destPoint(lat, lon, hdg, L);
  const sides = [];
  [[perp, stripHW, stripHW + transW], [perp2, stripHW, stripHW + transW]].forEach(([bearing, innerD, outerD]) => {
    const p1 = destPoint(lat, lon, bearing, innerD);
    const p2 = destPoint(far[1], far[0], bearing, innerD);
    const p3 = destPoint(far[1], far[0], bearing, outerD);
    const p4 = destPoint(lat, lon, bearing, outerD);
    sides.push([p1, p2, p3, p4, p1].map(p => [p[0], p[1]]));
  });
  return sides;
}

/* ─── Mapbox Init ─────────────────────────────────────── */
function geoMapInit() {
  if (GeoMap.initialized) return;
  const container = document.getElementById('map3d-container');
  if (!container) return;

  if (!document.getElementById('mapbox-container')) {
    const mapDiv = document.createElement('div');
    mapDiv.id = 'mapbox-container';
    mapDiv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    container.appendChild(mapDiv);
  }
  const emptyEl = document.getElementById('map3d-empty');

  try {
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const isRealToken = MAPBOX_TOKEN && !MAPBOX_TOKEN.endsWith('gifQ.rJcFIG214AriISLbB6B5aw');
    const mapStyle = isRealToken
      ? 'mapbox://styles/mapbox/satellite-streets-v12'
      : { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] };

    GeoMap.map = new mapboxgl.Map({
      container: 'mapbox-container', style: mapStyle,
      center: [2.55, 49.01], zoom: 11, pitch: 50, bearing: 0, antialias: true,
    });
    GeoMap.map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');
    GeoMap.map.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    GeoMap.map.on('load', () => {
      if (emptyEl) emptyEl.style.display = 'none';
      GeoMap.initialized = true;
      if (App.activeRunway) geoMapRender();
    });
    GeoMap.map.on('error', e => console.warn('Mapbox error:', e.error?.message || e));
  } catch (err) {
    console.warn('Mapbox GL non disponible:', err.message);
    if (emptyEl) { emptyEl.style.display = 'flex'; const p = emptyEl.querySelector('p'); if (p) p.innerHTML = 'Carte satellite non disponible<br><small>Vérifiez votre connexion Internet</small>'; }
  }
}

/* ─── geoMapRender — point d'entrée principal ─────────
   Appelle geoMapRenderOLS() pour les surfaces statiques,
   puis updateObstaclesLayer() pour les obstacles.
──────────────────────────────────────────────────────── */
function geoMapRender() {
  const map = GeoMap.map;
  if (!map || !App.activeRunway) return;
  if (!map.loaded() || !map.isStyleLoaded()) { map.once('idle', () => geoMapRender()); return; }
  geoMapRenderOLS();
  updateObstaclesLayer();
}

/* ─── geoMapRenderOLS — surfaces ICAO Annexe 14 ──────
   Nettoie et redessine uniquement les polygones OLS.
   NE touche PAS aux couches obstacles/preview.
──────────────────────────────────────────────────────── */
function geoMapRenderOLS() {
  const map = GeoMap.map;
  if (!map || !App.activeRunway) return;
  const rwy = App.activeRunway;
  if (!rwy.thresholdLat || !rwy.thresholdLon) return;

  /* Nettoyage couches OLS uniquement */
  const olsLayers = [
    'ols-runway', 'ols-runway-line',
    'ols-approach', 'ols-approach-line', 'ols-approach-ext',
    'ols-tocs', 'ols-tocs-line', 'ols-tocs-ext',
    'ols-ihs', 'ols-ihs-line', 'ols-ihs-ext',
    'ols-conical', 'ols-conical-line', 'ols-conical-ext',
    'ols-trans-fill', 'ols-trans-line', 'ols-trans-ext',
  ];
  olsLayers.forEach(id => { try { if (map.getLayer(id)) map.removeLayer(id); } catch (e) { } });
  const olsSrc = ['src-runway', 'src-approach', 'src-tocs', 'src-ihs', 'src-conical', 'src-transition'];
  olsSrc.forEach(id => { try { if (map.getSource(id)) map.removeSource(id); } catch (e) { } });

  const lat = rwy.thresholdLat, lon = rwy.thresholdLon;
  const hdg = rwy.trueHeading || 0, L = rwy.length || 3000, W = rwy.width || 45;
  const elevM = ftToM(rwy.elevation || 0);

  /* ── RUNWAY STRIP ─────────────────────────────────── */
  {
    const perp = (hdg + 270) % 360, perp2 = (hdg + 90) % 360;
    const far = destPoint(lat, lon, hdg, L);
    const c1 = destPoint(lat, lon, perp, W / 2), c2 = destPoint(lat, lon, perp2, W / 2);
    const c3 = destPoint(far[1], far[0], perp2, W / 2), c4 = destPoint(far[1], far[0], perp, W / 2);
    map.addSource('src-runway', { type: 'geojson', data: makePolygon([[c1[0], c1[1]], [c2[0], c2[1]], [c3[0], c3[1]], [c4[0], c4[1]], [c1[0], c1[1]]], 'runway') });
    map.addLayer({ id: 'ols-runway', type: 'fill', source: 'src-runway', paint: { 'fill-color': '#1a2a3a', 'fill-opacity': 0.9 } });
    map.addLayer({ id: 'ols-runway-line', type: 'line', source: 'src-runway', paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-opacity': 0.8 } });
  }

  /* ── APPROACH SURFACE (cyan) ──────────────────────── */
  {
    const coords = buildApproachCoords(rwy);
    const approachH = elevM + OLS.approach.sec1Length * OLS.approach.slope;
    map.addSource('src-approach', { type: 'geojson', data: makePolygon(coords, 'approach') });
    map.addLayer({ id: 'ols-approach', type: 'fill', source: 'src-approach', paint: { 'fill-color': '#00E5FF', 'fill-opacity': 0.25 } });
    map.addLayer({ id: 'ols-approach-line', type: 'line', source: 'src-approach', paint: { 'line-color': '#00E5FF', 'line-width': 2.5, 'line-opacity': 0.9 } });
    map.addLayer({ id: 'ols-approach-ext', type: 'fill-extrusion', source: 'src-approach', paint: { 'fill-extrusion-color': '#00E5FF', 'fill-extrusion-opacity': 0.18, 'fill-extrusion-height': approachH, 'fill-extrusion-base': elevM } });
  }

  /* ── TOCS / TAKE-OFF SURFACE (orange) ─────────────── */
  {
    const coords = buildTocsCoords(rwy);
    const tocsH = elevM + OLS.takeoff.length * OLS.takeoff.slope;
    map.addSource('src-tocs', { type: 'geojson', data: makePolygon(coords, 'tocs') });
    map.addLayer({ id: 'ols-tocs', type: 'fill', source: 'src-tocs', paint: { 'fill-color': '#FF9100', 'fill-opacity': 0.25 } });
    map.addLayer({ id: 'ols-tocs-line', type: 'line', source: 'src-tocs', paint: { 'line-color': '#FF9100', 'line-width': 2.5, 'line-opacity': 0.9 } });
    map.addLayer({ id: 'ols-tocs-ext', type: 'fill-extrusion', source: 'src-tocs', paint: { 'fill-extrusion-color': '#FF9100', 'fill-extrusion-opacity': 0.18, 'fill-extrusion-height': tocsH, 'fill-extrusion-base': elevM } });
  }

  /* ── IHS — Inner Horizontal Surface (vert) ─────────── */
  {
    const coords = buildIHSCoords(rwy);
    const ihsH = elevM + OLS.ihs.height;
    map.addSource('src-ihs', { type: 'geojson', data: makePolygon(coords, 'ihs') });
    map.addLayer({ id: 'ols-ihs', type: 'fill', source: 'src-ihs', paint: { 'fill-color': '#69F0AE', 'fill-opacity': 0.15 } });
    map.addLayer({ id: 'ols-ihs-line', type: 'line', source: 'src-ihs', paint: { 'line-color': '#69F0AE', 'line-width': 2, 'line-dasharray': [5, 3], 'line-opacity': 0.85 } });
    map.addLayer({ id: 'ols-ihs-ext', type: 'fill-extrusion', source: 'src-ihs', paint: { 'fill-extrusion-color': '#69F0AE', 'fill-extrusion-opacity': 0.10, 'fill-extrusion-height': ihsH, 'fill-extrusion-base': ihsH - 1 } });
  }

  /* ── CONICAL SURFACE (jaune) — anneau ─────────────── */
  {
    const { outer, inner } = buildConicalCoords(rwy);
    const ihsH = elevM + OLS.ihs.height;
    const conicalTopH = ihsH + OLS.conical.height;
    const conicalGeoJSON = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [outer, [...inner].reverse()] } };
    map.addSource('src-conical', { type: 'geojson', data: conicalGeoJSON });
    map.addLayer({ id: 'ols-conical', type: 'fill', source: 'src-conical', paint: { 'fill-color': '#FFD54F', 'fill-opacity': 0.20 } });
    map.addLayer({ id: 'ols-conical-line', type: 'line', source: 'src-conical', paint: { 'line-color': '#FFD54F', 'line-width': 2, 'line-dasharray': [6, 3], 'line-opacity': 0.85 } });
    map.addLayer({ id: 'ols-conical-ext', type: 'fill-extrusion', source: 'src-conical', paint: { 'fill-extrusion-color': '#FFD54F', 'fill-extrusion-opacity': 0.13, 'fill-extrusion-height': conicalTopH, 'fill-extrusion-base': ihsH } });
  }

  /* ── TRANSITION SURFACES (violet) — 2 bandes lat. ──── */
  {
    const sides = buildTransitionCoords(rwy);
    const ihsH = elevM + OLS.ihs.height;
    const transitionGeoJSON = { type: 'FeatureCollection', features: sides.map(coords => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } })) };
    map.addSource('src-transition', { type: 'geojson', data: transitionGeoJSON });
    map.addLayer({ id: 'ols-trans-fill', type: 'fill', source: 'src-transition', paint: { 'fill-color': '#CE93D8', 'fill-opacity': 0.20 } });
    map.addLayer({ id: 'ols-trans-line', type: 'line', source: 'src-transition', paint: { 'line-color': '#CE93D8', 'line-width': 2, 'line-opacity': 0.85 } });
    map.addLayer({ id: 'ols-trans-ext', type: 'fill-extrusion', source: 'src-transition', paint: { 'fill-extrusion-color': '#CE93D8', 'fill-extrusion-opacity': 0.12, 'fill-extrusion-height': ihsH, 'fill-extrusion-base': elevM } });
  }

  /* S'assurer que la source obstacles existe (créée vide si premier rendu) */
  if (!map.getSource('src-obstacles')) {
    map.addSource('src-obstacles', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    const elevM_ = ftToM(rwy.elevation || 0);
    map.addLayer({
      id: 'ols-obstacles-extrude', type: 'fill-extrusion', source: 'src-obstacles',
      paint: {
        'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-opacity': 0.88,
        'fill-extrusion-height': ['get', 'heightM'], 'fill-extrusion-base': ['get', 'baseH']
      },
    });
    map.addLayer({
      id: 'ols-obstacles-circles', type: 'circle', source: 'src-obstacles',
      paint: {
        'circle-radius': 9, 'circle-color': ['get', 'color'], 'circle-opacity': 0.95,
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2
      },
    });
    map.addLayer({
      id: 'ols-obstacles-labels', type: 'symbol', source: 'src-obstacles',
      layout: {
        'text-field': ['concat', ['get', 'name'], '\n', ['to-string', ['get', 'altitude']], ' ft'],
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Regular'],
        'text-size': 11, 'text-offset': [0, -2], 'text-anchor': 'bottom', 'text-allow-overlap': false,
      },
      paint: {
        'text-color': ['case', ['get', 'breach'], '#FF1744', '#00E676'],
        'text-halo-color': 'rgba(5,8,20,0.88)', 'text-halo-width': 2,
      },
    });

    /* Popup au survol (infobulle) */
    function showObsTooltip(e) {
      map.getCanvas().style.cursor = 'pointer';
      const p = e.features[0].properties;
      const verdict = p.olsLimit == null ? 'HORS ZONE' : p.breach ? '▲ PÉNÉTRATION' : '✓ CONFORME';
      const col = p.color;
      const html = `<div style="font-family:monospace;font-size:11px;color:#d0e8f5;background:#0b1220;border:1px solid #00E5FF33;padding:10px 13px;border-radius:5px;min-width:170px;line-height:1.7;">
        <b style="color:#00E5FF;font-size:12px;">${p.name}</b><br>
        <span style="color:#6A8AA8">${p.type}</span><br>
        <span style="color:#6A8AA8">Alt :</span> <b>${p.altitude} ft AMSL</b><br>
        <span style="color:#6A8AA8">Haut :</span> <b>${p.height} ft AGL</b><br>
        <span style="color:#6A8AA8">Surface :</span> ${p.surface}<br>
        ${p.olsLimit != null
          ? `<span style="color:#6A8AA8">Limite OLS :</span> ${parseFloat(p.olsLimit).toFixed(0)} ft<br>
             <span style="color:#6A8AA8">Dégagement :</span> <b style="color:${col}">${p.clearance} ft</b><br>`
          : ''}
        <b style="color:${col};font-size:12px;">${verdict}</b>
      </div>`;
      if (mapTooltip) mapTooltip.remove();
      mapTooltip = new mapboxgl.Popup({ closeButton: false, offset: 15, maxWidth: '260px' })
        .setLngLat(e.lngLat).setHTML(html).addTo(map);
    }

    map.on('mouseenter', 'ols-obstacles-circles', showObsTooltip);
    map.on('mouseleave', 'ols-obstacles-circles', hideTooltip);
    map.on('mouseenter', 'ols-obstacles-extrude', showObsTooltip);
    map.on('mouseleave', 'ols-obstacles-extrude', hideTooltip);
  }

  /* Repositionnement vue */
  map.flyTo({
    center: [lon, lat],
    zoom: Math.max(11, 15 - Math.log2(L / 500)),
    pitch: 55, bearing: hdg, duration: 1500,
  });
}

/* ─── updateObstaclesLayer — mise à jour dynamique ───
   Appelle setData() sur src-obstacles : instantané,
   sans retoucher les surfaces OLS.
──────────────────────────────────────────────────────── */
function updateObstaclesLayer() {
  const map = GeoMap.map;
  if (!map || !map.loaded()) return;
  if (!map.getSource('src-obstacles')) return; // pas encore initialisé

  const rwy = App.activeRunway;
  const elevM = rwy ? ftToM(rwy.elevation || 0) : 0;

  const features = App.obstacles
    .filter(obs => obs.latitude != null && obs.longitude != null)
    .map(obs => {
      const result = rwy ? getOLSLimit(obs.latitude, obs.longitude, rwy) : null;
      const olsLimit = result ? result.limit : null;
      const breach = olsLimit !== null && obs.altitude > olsLimit;
      const clearance = olsLimit != null ? (olsLimit - obs.altitude).toFixed(1) : null;
      const heightM = Math.max(ftToM(obs.height || obs.altitude || 10), 5);
      const color = olsLimit == null ? '#6AB4FF' : breach ? '#FF1744' : '#00E676';
      return {
        type: 'Feature',
        properties: {
          name: obs.name, type: typeToLabel(obs.type),
          altitude: obs.altitude, height: obs.height,
          breach, clearance,
          surface: result ? result.surface : 'hors zone',
          olsLimit,
          heightM: elevM + heightM, baseH: elevM,
          color,
        },
        geometry: makePointBufferPolygon(obs.latitude, obs.longitude, 15),
      };
    });

  map.getSource('src-obstacles').setData({
    type: 'FeatureCollection',
    features,
  });
}

/* ─── Map controls ────────────────────────────────────── */
function map3dResetCamera() {
  const map = GeoMap.map; if (!map) return;
  if (App.activeRunway)
    map.flyTo({ center: [App.activeRunway.thresholdLon, App.activeRunway.thresholdLat], zoom: 12, pitch: 55, bearing: App.activeRunway.trueHeading || 0, duration: 800 });
  else if (App.aerodrome)
    map.flyTo({ center: [App.aerodrome.longitude, App.aerodrome.latitude], zoom: 11, pitch: 45, bearing: 0, duration: 800 });
}
function map3dToggleLabels() {
  App.map3dLabels = !App.map3dLabels;
  const map = GeoMap.map; if (!map) return;
  if (map.getLayer('ols-obstacles-labels'))
    map.setLayoutProperty('ols-obstacles-labels', 'visibility', App.map3dLabels ? 'visible' : 'none');
  showToast(`Labels ${App.map3dLabels ? 'activés' : 'désactivés'}`, 'info');
}
function map3dResize() { if (GeoMap.map) GeoMap.map.resize(); }

/* ══════════════════════════════════════════════════════════
   PDF REPORT GENERATOR (avec sauvegarde en base)
══════════════════════════════════════════════════════════ */
async function generatePdfReport() {
  if (!window.jspdf) { showToast('Génération PDF indisponible', 'error'); return; }
  if (!App.activeRunway) { showToast('Aucune piste active pour le rapport', 'warn'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const rwy = App.activeRunway, now = new Date();

  const CYAN = [0, 229, 255], GREEN = [0, 230, 118], RED = [255, 23, 68], AMBER = [255, 179, 0];
  const BG = [5, 10, 18], DARK = [8, 14, 26], PANEL = [11, 18, 32], TEXT = [208, 232, 245], DIM = [51, 77, 99];

  doc.setFillColor(...BG); doc.rect(0, 0, 210, 297, 'F');
  doc.setFillColor(...DARK); doc.rect(0, 0, 210, 28, 'F');
  doc.setDrawColor(...CYAN); doc.setLineWidth(0.5); doc.line(0, 28, 210, 28);
  doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(...CYAN);
  doc.text("RAPPORT D'ANALYSE OLS", 32, 12);
  doc.setFontSize(9); doc.setFont('courier', 'normal'); doc.setTextColor(...DIM);
  doc.text("ICAO ANNEXE 14 — SURFACES DE LIMITATION D'OBSTACLES", 32, 19);
  doc.setFontSize(8); doc.setTextColor(...TEXT);
  doc.text(`Généré le : ${now.toLocaleDateString('fr-FR')} ${now.toLocaleTimeString('fr-FR')}Z`, 210, 10, { align: 'right' });
  doc.text(`Opérateur : ${App.user?.name || App.user?.username || 'N/A'}`, 210, 16, { align: 'right' });
  doc.text('Moteur : V5.0_MAP2026', 210, 22, { align: 'right' });

  let y = 36;
  const section = (n, title) => { doc.setFillColor(...PANEL); doc.rect(10, y, 190, 6, 'F'); doc.setTextColor(...CYAN); doc.setFont('courier', 'bold'); doc.setFontSize(8); doc.text(`${n}. ${title}`, 14, y + 4.2); y += 8; };
  const kv = (k, v, k2, v2) => { doc.setFontSize(7.5); doc.setFont('courier', 'bold'); doc.setTextColor(...DIM); doc.text(k, 14, y + 4); doc.setTextColor(...TEXT); doc.setFont('courier', 'normal'); doc.text(String(v), 50, y + 4); if (k2) { doc.setFont('courier', 'bold'); doc.setTextColor(...DIM); doc.text(k2, 110, y + 4); doc.setTextColor(...TEXT); doc.setFont('courier', 'normal'); doc.text(String(v2), 146, y + 4); } y += 7; };

  section('1', 'INFORMATIONS AÉRODROME');
  kv('OACI', App.aerodrome?.icao || '—', 'NOM', App.aerodrome?.name || '—');
  kv('ÉLÉVATION', `${App.aerodrome?.elevation || '—'} ft`, 'PAYS', App.aerodrome?.country || '—');
  kv('VILLE', App.aerodrome?.city || '—', 'SOURCE', App.aerodrome?.source || '—');

  y += 2; section('2', 'PISTE ACTIVE');
  kv('DÉSIGNATION', rwy.designation || '—', 'CAP VRAI', `${rwy.trueHeading ?? '—'}°`);
  kv('LONGUEUR', `${rwy.length || '—'} m`, 'LARGEUR', `${rwy.width || '—'} m`);
  kv('ÉLÉVATION SEUIL', `${rwy.elevation || '—'} ft`, 'CODE OACI', String(rwy.icaoCode || '—'));

  y += 2; section('3', 'PARAMÈTRES OLS (ICAO ANNEXE 14 — CODE 4)');
  const rwyElev = rwy.elevation || 0;
  const olsRows = [
    ['Approche S1', '1:50 (2%)', `${(rwyElev + mToFt(OLS.approach.sec1Length * OLS.approach.slope)).toFixed(0)} ft`, `${OLS.approach.innerWidth}–${(OLS.approach.innerWidth + 2 * OLS.approach.sec1Length * OLS.approach.divergence).toFixed(0)} m`],
    ['Transition', '1:7 (14.3%)', `${(rwyElev + mToFt(OLS.ihs.height)).toFixed(0)} ft`, 'Variable'],
    ['IHS 45m', 'Horizontale', `${(rwyElev + mToFt(OLS.ihs.height)).toFixed(0)} ft`, `R=${OLS.ihs.radius} m`],
    ['Conique', '1:20 (5%)', `${(rwyElev + mToFt(OLS.ihs.height + OLS.conical.height)).toFixed(0)} ft`, `${OLS.ihs.radius}–${(OLS.ihs.radius + OLS.conical.height / OLS.conical.slope).toFixed(0)} m`],
    ['TOCS', '1:50 (2%)', `${(rwyElev + mToFt(OLS.takeoff.length * OLS.takeoff.slope)).toFixed(0)} ft`, `${OLS.takeoff.innerWidth}–${(OLS.takeoff.innerWidth + 2 * OLS.takeoff.length * OLS.takeoff.divergence).toFixed(0)} m`],
  ];
  doc.setFillColor(15, 25, 40); doc.rect(10, y, 190, 7, 'F');
  doc.setFontSize(7); doc.setFont('courier', 'bold'); doc.setTextColor(...DIM);
  ['SURFACE', 'PENTE', 'LIM. ALTITUDE', 'EMPRISE LATÉRALE'].forEach((h, i) => doc.text(h, 14 + [0, 50, 95, 145][i], y + 4.5)); y += 7;
  const surfColors = [[0, 229, 255], [206, 147, 216], [105, 240, 174], [255, 213, 79], [255, 145, 0]];
  olsRows.forEach((row, ri) => {
    doc.setFillColor(ri % 2 === 0 ? 11 : 8, ri % 2 === 0 ? 18 : 14, ri % 2 === 0 ? 32 : 26); doc.rect(10, y, 190, 6.5, 'F');
    const sc = surfColors[ri] || TEXT; doc.setTextColor(...sc); doc.setFont('courier', 'bold'); doc.setFontSize(7.5); doc.text(row[0], 14, y + 4.2);
    doc.setTextColor(...TEXT); doc.setFont('courier', 'normal'); doc.text(row[1], 64, y + 4.2); doc.text(row[2], 109, y + 4.2); doc.text(row[3], 159, y + 4.2); y += 6.5;
  });

  y += 4; section('4', `ANALYSE DES OBSTACLES  (${App.obstacles.length} obstacle(s))`);
  let totalBreaches = 0;
  if (!App.obstacles.length) {
    doc.setTextColor(...DIM); doc.setFont('courier', 'normal'); doc.setFontSize(8);
    doc.text('Aucun obstacle enregistré pour cet aérodrome.', 14, y + 4); y += 10;
  } else {
    doc.setFillColor(15, 25, 40); doc.rect(10, y, 190, 7, 'F');
    doc.setFontSize(6.5); doc.setFont('courier', 'bold'); doc.setTextColor(...DIM);
    ['DÉSIGNATION', 'TYPE', 'ALT (ft)', 'LIM. OLS (ft)', 'ÉCART (ft)', 'SURFACE', 'VERDICT'].forEach((h, i) => doc.text(h, 14 + [0, 50, 80, 100, 122, 145, 168][i], y + 4.5)); y += 7;
    App.obstacles.forEach((obs, ri) => {
      const result = getOLSLimit(obs.latitude, obs.longitude, rwy);
      const olsLimit = result ? result.limit : null, breach = olsLimit !== null && obs.altitude > olsLimit;
      const clearance = olsLimit != null ? (olsLimit - obs.altitude) : null;
      if (breach) totalBreaches++;
      doc.setFillColor(breach ? 30 : (ri % 2 === 0 ? 11 : 8), breach ? 5 : (ri % 2 === 0 ? 18 : 14), breach ? 8 : (ri % 2 === 0 ? 32 : 26)); doc.rect(10, y, 190, 6.5, 'F');
      if (breach) { doc.setDrawColor(...RED); doc.setLineWidth(0.5); doc.line(10, y, 10, y + 6.5); }
      doc.setFontSize(7); doc.setFont('courier', 'bold'); doc.setTextColor(...TEXT); doc.text((obs.name || '—').slice(0, 18), 14, y + 4.2);
      doc.setFont('courier', 'normal'); doc.setTextColor(...DIM); doc.text(typeToLabel(obs.type).slice(0, 12), 64, y + 4.2);
      doc.setTextColor(...TEXT); doc.text(String(obs.altitude ?? '—'), 94, y + 4.2); doc.text(olsLimit != null ? olsLimit.toFixed(0) : '—', 114, y + 4.2);
      const cl = clearance != null ? clearance.toFixed(0) : '—';
      const clColor = clearance == null ? DIM : clearance < 0 ? RED : clearance < 30 ? AMBER : GREEN;
      doc.setTextColor(...clColor); doc.text((clearance != null && clearance < 0 ? '+' : '') + cl, 136, y + 4.2);
      doc.setTextColor(...DIM); doc.text(result ? result.surface.slice(0, 12) : '—', 159, y + 4.2);
      doc.setTextColor(...(breach ? RED : GREEN)); doc.setFont('courier', 'bold');
      doc.text(olsLimit == null ? 'HORS ZONE' : breach ? 'PENETRATION' : 'CONFORME', 182, y + 4.2);
      y += 6.5; if (y > 270) { doc.addPage(); doc.setFillColor(...BG); doc.rect(0, 0, 210, 297, 'F'); y = 15; }
    });
    y += 4;
    const conformes = App.obstacles.length - totalBreaches;
    doc.setFillColor(...PANEL); doc.rect(10, y, 190, 22, 'F');
    doc.setDrawColor(...(totalBreaches > 0 ? RED : GREEN)); doc.setLineWidth(1); doc.rect(10, y, 190, 22, 'S'); doc.setLineWidth(0.1);
    doc.setFontSize(14); doc.setFont('courier', 'bold'); doc.setTextColor(...(totalBreaches > 0 ? RED : GREEN));
    doc.text(`STATUT GLOBAL : ${totalBreaches > 0 ? 'NON CONFORME' : 'CONFORME'}`, 105, y + 10, { align: 'center' });
    doc.setFontSize(8); doc.setTextColor(...TEXT);
    doc.text(`${App.obstacles.length} obstacle(s)  |  ${conformes} conforme(s)  |  ${totalBreaches} pénétration(s)`, 105, y + 17, { align: 'center' }); y += 28;
  }

  y += 2; doc.setFontSize(7); doc.setFont('courier', 'normal'); doc.setTextColor(...DIM);
  doc.text('Références : ICAO DOC 9157 Partie 6  |  ICAO ANNEXE 14 VOL I  |  PANS-OLS', 14, y);
  doc.setFillColor(...DARK); doc.rect(0, 289, 210, 8, 'F');
  doc.setDrawColor(...CYAN); doc.line(0, 289, 210, 289);
  doc.setFontSize(7); doc.setTextColor(...DIM);
  doc.text(`SIGOBS V5.0_MAP2026  ·  Edited by A2G  ·  ${now.toLocaleDateString('fr-FR')}`, 105, 294, { align: 'center' });

  const icao = App.aerodrome?.icao || 'XXXX', dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `SIGOBS_OLS_${icao}_RWY${rwy.designation}_${dateStr}.pdf`;
  doc.save(filename);
  showToast('Rapport PDF généré', 'success');

  /* ── Sauvegarde du rapport en base ─────────────────── */
  try {
    await apiFetch('/reports', 'POST', {
      aerodromeIcao: icao,
      runwayDesig: rwy.designation,
      summary: {
        totalObstacles: App.obstacles.length,
        breaches: totalBreaches,
        conformes: App.obstacles.length - totalBreaches,
        globalStatus: App.obstacles.length === 0 ? 'AUCUN OBSTACLE' : totalBreaches > 0 ? 'NON CONFORME' : 'CONFORME',
      },
      obstaclesSnapshot: App.obstacles.map(o => ({
        name: o.name, type: o.type, latitude: o.latitude, longitude: o.longitude,
        altitude: o.altitude, height: o.height, status: o.status,
      })),
      olsParams: OLS,
      filename,
    });
    showToast('Rapport sauvegardé en base', 'success');
  } catch (e) {
    console.warn('[Report] Sauvegarde base échouée (API hors ligne)', e.message);
  }
}
