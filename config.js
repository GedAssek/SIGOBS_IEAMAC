'use strict';
/* ═══════════════════════════════════════════════════════════
   SIGOBS — SÉCURITÉ : Neutralisation des logs navigateur
   Empêche la divulgation d'informations sensibles dans les
   outils de développement du navigateur.
   → Pour activer les logs en dev : window.SIGOBS_DEBUG = true
     avant le chargement de ce fichier.
   ═══════════════════════════════════════════════════════════ */
;(function _suppressConsoleLogs() {
  /* Autoriser les logs si le mode debug est explicitement activé */
  if (typeof window !== 'undefined' && window.SIGOBS_DEBUG === true) return;

  const _noop = function() {};
  const _methods = ['log', 'info', 'debug', 'dir', 'table', 'trace', 'group', 'groupCollapsed', 'groupEnd', 'time', 'timeEnd', 'count', 'assert'];
  _methods.forEach(function(method) {
    try { console[method] = _noop; } catch(e) { /* Lecture seule dans certains environnements */ }
  });

  /* Réduire console.warn à un simple no-op */
  try { console.warn = _noop; } catch(e) {}

  /* console.error : message générique sans détails techniques */
  try {
    console.error = function() {
      /* Silencieux en production — les erreurs sont gérées par l'UI */
    };
  } catch(e) {}
})();

/* ═══════════════════════════════════════════════════════════
   SIGOBS — config.js
   Configuration globale, état partagé, constantes
   ═══════════════════════════════════════════════════════════ */

/* ── API Backend URL ──────────────────────────────────────── */
const API_BASE = 'https://pans-ops.skovichvps.cloud-ip.cc/api/v1';

/* ── Aérodrome par défaut (mode mono-aérodrome historique) ──
   Conservé comme repli si aucun aérodrome n'est encore sélectionné
   et qu'aucun aérodrome n'est associé à l'utilisateur connecté. */
const STUDY_AERODROME_ICAO = 'DXXX';

/* ── État global de l'application ────────────────────────── */
const App = {
  token: null, user: null, aerodrome: null, aerodromeMongoId: null,
  // Liste des aérodromes accessibles à l'utilisateur connecté + sélection courante
  aerodromesList: [], currentAerodromeId: null,
  runways: [], activeRunway: null,
  obstacles: [], allObstacles: [], coordMode: 'dms', modalAction: null,
  map3dLabels: true,
  // Cache des événements d'audit (GET /evenements) — chargé une fois à l'init
  // et réutilisé par l'onglet Archive et l'historique par obstacle.
  cachedEvents: null,
  showAllObstacles: false,
};

/* ── Carte (MapLibre GL JS) ───────────────────────────────── */
const GeoMap = { map: null, initialized: false };

/* ── Style satellite ESRI (gratuit, sans token) ──────────── */
const SATELLITE_STYLE = {
  version: 8,
  sources: {
    esri_satellite: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
    }
  },
  layers: [{
    id: 'esri_satellite',
    type: 'raster',
    source: 'esri_satellite',
    minzoom: 0,
    maxzoom: 22,
  }]
};

/* ══════════════════════════════════════════════════════════
   INIT — Point d'entrée principal
══════════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {
  startClock();
  checkSavedToken();
  bindTemporalToggle();
});

/* ── Horloge UTC ──────────────────────────────────────────── */
function startClock() {
  const tick = () => {
    const now = new Date();
    const el = document.getElementById('utc-time');
    if (el) el.textContent =
      `${String(now.getHours()).padStart(2, '0')}:` +
      `${String(now.getMinutes()).padStart(2, '0')}:` +
      `${String(now.getSeconds()).padStart(2, '0')} UTC`;
  };
  tick(); setInterval(tick, 1000);
}

/* ── Toggle temporel obstacle ─────────────────────────────── */
function bindTemporalToggle() {
  const sel = document.getElementById('obs-temporal');
  if (sel) sel.addEventListener('change', () =>
    document.getElementById('expiry-group').classList.toggle('hidden', sel.value === 'permanent'));
}

/* ── Touche Entrée sur le formulaire de login ─────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const login = document.getElementById('screen-login');
    if (login && login.classList.contains('active')) handleLogin();
  }
});
