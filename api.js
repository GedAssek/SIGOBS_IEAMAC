'use strict';
/* ═══════════════════════════════════════════════════════════
   SIGOBS — api.js
   Wrapper fetch, statut API, normalisation des données backend
   Dépend de : config.js (API_BASE, App)
   ═══════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════
   API HELPER — Wrapper fetch avec injection automatique du token
   Conforme à la doc §2.3
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

/* ── Indicateur de statut connexion API ───────────────────── */
function setApiStatus(state, msg) {
  const dot = document.getElementById('api-dot');
  const text = document.getElementById('api-status-text');
  if (!dot) return;
  dot.className = 'status-dot ' + state;
  if (text) text.textContent = msg || (state === 'connected' ? 'Connecté' : state === 'disconnected' ? 'Hors ligne' : '…');
}

/* ══════════════════════════════════════════════════════════
   NORMALISATION DES DONNÉES BACKEND
══════════════════════════════════════════════════════════ */

/**
 * Normalise un document aérodrome + ses pistes en schéma interne.
 * @param {Object} raw       - réponse brute aérodrome (GET /aerodromes?code_oaci=…)
 * @param {Array}  pistesRaw - tableau brut des pistes (GET /aerodromes/:id/pistes)
 */
function normalizeAerodromeFromAPI(raw, pistesRaw) {
  pistesRaw = pistesRaw || [];
  const coords = raw.point_reference && raw.point_reference.coordinates;
  const lon = coords ? coords[0] : (raw.longitude !== undefined ? raw.longitude : 0);
  const lat = coords ? coords[1] : (raw.latitude !== undefined ? raw.latitude : 0);

  // Pistes : priorité à pistesRaw (appel /pistes séparé), sinon pistes embarquées
  const allPistes = pistesRaw.length ? pistesRaw : (raw.pistes || []);

  const runwaysFull = [];
  allPistes.forEach(function (p) {
    const seuil1 = p.seuils && p.seuils[0];
    const seuil2 = p.seuils && p.seuils[1];
    const base = {
      _id: p._id,
      length: p.longueur || 0,
      width: p.largeur || 45,
      closed: p.fermee || false,
      icaoCode: p.code_reference ? parseInt(p.code_reference[0]) || 4 : 4,
      typesApproche: p.types_approche || [],
    };
    if (p.qfu_1 && seuil1 && !runwaysFull.find(r => r.designation === p.qfu_1)) {
      runwaysFull.push(Object.assign({}, base, {
        designation: p.qfu_1,
        reciprocal: p.qfu_2 || '',
        trueHeading: p.cap_vrai || 0,
        elevation: seuil1.altitude !== undefined ? seuil1.altitude : (raw.altitude || 0),
        thresholdLat: seuil1.coordinates ? seuil1.coordinates[1] : lat,
        thresholdLon: seuil1.coordinates ? seuil1.coordinates[0] : lon,
      }));
    }
    if (p.qfu_2 && seuil2 && !runwaysFull.find(r => r.designation === p.qfu_2)) {
      const hdg2 = ((p.cap_vrai || 0) + 180) % 360;
      runwaysFull.push(Object.assign({}, base, {
        designation: p.qfu_2,
        reciprocal: p.qfu_1 || '',
        trueHeading: hdg2,
        elevation: seuil2.altitude !== undefined ? seuil2.altitude : (raw.altitude || 0),
        thresholdLat: seuil2.coordinates ? seuil2.coordinates[1] : lat,
        thresholdLon: seuil2.coordinates ? seuil2.coordinates[0] : lon,
      }));
    }
  });

  return {
    _id: raw._id,
    icao: raw.code_oaci || raw.icao || '',
    name: raw.nom || raw.name || '',
    latitude: lat, longitude: lon,
    elevation: raw.altitude || raw.elevation || 0,
    country: raw.pays || raw.country || '',
    city: raw.ville || raw.city || '',
    iata: raw.iata || '',
    runways: runwaysFull,
  };
}

/**
 * Normalise un document obstacle brut (backend) en schéma interne.
 * @param {Object} raw - obstacle tel que retourné par GET /obstacles
 */
function normalizeObstacleFromAPI(raw) {
  const coords = raw.geometrie?.coordinates;
  return {
    _id: raw._id,
    name: raw.nom || raw.name || '—',
    proprietaire: raw.proprietaire || raw.owner || '',
    type: normalizeObsTypeBack(raw.type_obstacle || raw.type || ''),
    latitude: coords ? coords[1] : (raw.latitude ?? null),
    longitude: coords ? coords[0] : (raw.longitude ?? null),
    altitude: raw.altitude_max ?? raw.altitude ?? 0,
    height: raw.hauteur ?? raw.height ?? 0,
    perce: raw.perce !== undefined ? raw.perce : (raw.penetration !== undefined ? raw.penetration : null),
    temporal: (raw.permanence === 'Temporaire' || raw.temporal === 'temporary') ? 'temporary' : 'permanent',
    status: normalizeStatusBack(raw.statut_validation || raw.status || 'Draft'),
    aerodromeIcao: raw.aerodrome_id?.code_oaci || raw.aerodromeIcao || '',
    creatorId: (raw.createur_id && typeof raw.createur_id === 'object')
      ? (raw.createur_id._id || raw.createur_id.id || raw.createur_id)
      : (raw.createur_id || raw.user_id || raw.createur || raw.user || null),
    // Email de l'utilisateur soumettant (pour la colonne admin)
    creatorEmail: raw.createur_id?.email || raw.user?.email || raw.creatorEmail || '',
    soumisParEmail: raw.soumis_par?.email || raw.createur_id?.email || raw.user?.email || raw.soumisParEmail || '',
    createdAt: raw.createdAt,
  };
}

/** Convertit le type_obstacle backend → clé interne */
function normalizeObsTypeBack(t) {
  const m = {
    'Bâtiment': 'building', 'Tour': 'tower', 'Pylône': 'tower', 'Végétation': 'vegetation',
    'Grue': 'crane', 'Antenne': 'antenna', 'Ligne électrique': 'powerline',
    "Château d'eau": 'water_tower', 'Immeuble': 'building', 'Autre': 'other'
  };
  return m[t] || t.toLowerCase() || 'other';
}

/** Convertit statut_validation backend → clé interne */
function normalizeStatusBack(s) {
  const m = { 'Draft': 'draft', 'Pending': 'pending', 'Validated': 'validated' };
  return m[s] || (s || 'draft').toLowerCase();
}

/* ── Helpers d'affichage partagés ────────────────────────── */

/** Convertit la clé interne → valeur type_obstacle acceptée par le backend (doc §7.4) */
function labelToTypeObstacle(t) {
  const m = {
    building: 'Immeuble', tower: 'Tour', vegetation: 'Végétation',
    crane: 'Grue', antenna: 'Antenne', powerline: 'Ligne électrique',
    water_tower: "Château d'eau", other: 'Autre'
  };
  return m[t] || t;
}

/** Convertit la clé interne → label d'affichage lisible */
function typeToLabel(t) {
  const m = {
    building: 'Bâtiment', tower: 'Tour/Pylône', vegetation: 'Végétation',
    crane: 'Grue', antenna: 'Antenne', powerline: 'Ligne HT',
    water_tower: 'Château eau', other: 'Autre',
    // Valeurs backend directes (si déjà sous forme string backend)
    'Immeuble': 'Bâtiment', 'Tour': 'Tour/Pylône', 'Végétation': 'Végétation',
    'Grue': 'Grue', 'Antenne': 'Antenne', 'Ligne électrique': 'Ligne HT',
    "Château d'eau": 'Château eau', 'Autre': 'Autre',
  };
  return m[t] || t || '—';
}

/** Convertit la clé statut interne → label d'affichage */
function statusLabel(s) {
  const m = { draft: 'BROUILLON', pending: 'EN ATTENTE', validated: 'VALIDÉ' };
  return m[s] || (s || '—').toUpperCase();
}

/* ══════════════════════════════════════════════════════════
   MODAL — Boîte de confirmation générique
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
   TOASTS — Notifications éphémères
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
   NAVIGATION PAR ONGLETS
══════════════════════════════════════════════════════════ */
function switchTab(btn, tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');
  if (tab === 'obstacles') renderObstaclesList(App.allObstacles);
  if (tab === 'analyse' && GeoMap.map) setTimeout(() => GeoMap.map.resize(), 100);
  if (tab === 'users') {
    if (typeof loadUsers === 'function') loadUsers();
    if (typeof populateRoleSelect === 'function') populateRoleSelect();
  }
  if (tab === 'runways') {
    if (typeof renderRunwaysManagementList === 'function') renderRunwaysManagementList();
  }
}
