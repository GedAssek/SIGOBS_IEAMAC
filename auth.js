'use strict';
/* ═══════════════════════════════════════════════════════════
   SIGOBS — auth.js
   Authentification : login, logout, restauration de session
   Conforme à la documentation §2 (POST /auth/login)
   Dépend de : config.js (App, GeoMap), api.js (apiFetch, setApiStatus, showToast)
   ═══════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════
   LOGIN
   POST /auth/login — route publique, pas de JWT requis (doc §2.1)
══════════════════════════════════════════════════════════ */
async function handleLogin() {
  const email    = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const btn      = document.getElementById('btn-login');
  const lbl      = btn.querySelector('.btn-label');
  const loader   = btn.querySelector('.btn-loader');

  if (!email || !password) { showLoginError('Email et mot de passe requis.'); return; }

  document.getElementById('login-error').classList.add('hidden');
  lbl.classList.add('hidden');
  loader.classList.remove('hidden');
  btn.disabled = true;

  try {
    // Réponse : { success: true, data: { _id, email, role, token } }
    const res = await apiFetch('/auth/login', 'POST', { email, password }, false);
    const userData = res.data;

    if (userData?.token) {
      App.token = userData.token;
      App.user  = userData;
      // Persistance de session (sessionStorage, pas localStorage pour plus de sécurité)
      sessionStorage.setItem('sigobs_token', App.token);
      sessionStorage.setItem('sigobs_user',  JSON.stringify(App.user));
      showApp();
    } else {
      showLoginError(res.message || 'Authentification refusée.');
    }
  } catch (e) {
    showLoginError(e.message || 'Impossible de contacter le serveur.');
  } finally {
    lbl.classList.remove('hidden');
    loader.classList.add('hidden');
    btn.disabled = false;
  }
}

/** Affiche un message d'erreur sous le formulaire de connexion */
function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

/* ══════════════════════════════════════════════════════════
   LOGOUT — Nettoyage complet de la session
══════════════════════════════════════════════════════════ */
function handleLogout() {
  // Réinitialiser l'état global
  App.token             = null;
  App.user              = null;
  App.aerodrome         = null;
  App.aerodromeMongoId  = null;
  App.aerodromesList    = [];
  App.currentAerodromeId = null;
  App.runways           = [];
  App.activeRunway      = null;
  App.obstacles         = [];
  App.allObstacles      = [];
  App.showAllObstacles  = false;   // ⇦ réinitialiser le toggle admin

  // Nettoyer le stockage session
  sessionStorage.clear();

  // ── Réinitialiser l'UI ──────────────────────────────────
  // 1. Masquer les onglets admin (Pistes / Aérodromes / Utilisateurs)
  const btnRunways = document.getElementById('tab-btn-runways');
  const btnAerodromes = document.getElementById('tab-btn-aerodromes');
  const btnUsers   = document.getElementById('tab-btn-users');
  if (btnRunways) btnRunways.style.display = 'none';
  if (btnAerodromes) btnAerodromes.style.display = 'none';
  if (btnUsers)   btnUsers.style.display   = 'none';

  // Supprimer le sélecteur d'aérodrome de la topbar s'il existe
  const switcher = document.getElementById('aerodrome-switcher-select');
  if (switcher) switcher.remove();

  // 2. Masquer le bouton "Tous les obstacles"
  const btnToggle = document.getElementById('btn-toggle-all-obs');
  if (btnToggle) btnToggle.style.display = 'none';

  // 3. Revenir sur l'onglet Analyse OLS
  const allTabs    = document.querySelectorAll('.tab-content');
  const allTabBtns = document.querySelectorAll('.tab-btn');
  allTabs.forEach(t    => t.classList.remove('active'));
  allTabBtns.forEach(b => b.classList.remove('active'));
  const analyseTab    = document.getElementById('tab-analyse');
  const analyseBtn    = document.getElementById('tab-btn-analyse');
  if (analyseTab) analyseTab.classList.add('active');
  if (analyseBtn) analyseBtn.classList.add('active');

  // 4. Fermer le panneau de légende surfaces s'il est ouvert
  const legendPanel = document.getElementById('surfaces-legend-panel');
  if (legendPanel) legendPanel.classList.remove('open');

  // Retourner à l'écran de connexion
  document.getElementById('screen-app').classList.remove('active');
  document.getElementById('screen-login').classList.add('active');
  document.getElementById('login-password').value = '';

  // Détruire la carte MapLibre
  if (GeoMap.map) {
    GeoMap.map.remove();
    GeoMap.map         = null;
    GeoMap.initialized = false;
  }
}

/* ══════════════════════════════════════════════════════════
   RESTAURATION DE SESSION
   Vérifie si un token valide est déjà en sessionStorage
══════════════════════════════════════════════════════════ */
function checkSavedToken() {
  const saved = sessionStorage.getItem('sigobs_token');
  const user  = sessionStorage.getItem('sigobs_user');
  if (saved && user) {
    App.token = saved;
    App.user  = JSON.parse(user);
    showApp();
  }
}

/* ══════════════════════════════════════════════════════════
   TRANSITION VERS L'ÉCRAN PRINCIPAL
   Appelé après login réussi ou restauration de session
══════════════════════════════════════════════════════════ */
function showApp() {
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');

  const nameEl = document.getElementById('user-name');
  const roleEl = document.getElementById('user-role');
  // App.user.role peut être un objet { _id, nomRole } ou une string selon le backend
  const roleRaw  = App.user.role;
  const roleName = (typeof roleRaw === 'object' && roleRaw !== null)
    ? (roleRaw.nomRole || roleRaw.name || 'USER')
    : (String(roleRaw || 'USER'));
  // Stocker la string normalisée pour les vérifications isAdmin
  App.user._roleName = roleName;
  const isAdmin = roleName.toLowerCase() === 'admin';
  if (nameEl) nameEl.textContent = App.user.email || App.user.nom || '—';
  if (roleEl) roleEl.textContent = roleName;

  const btnRunways = document.getElementById('tab-btn-runways');
  const btnAerodromes = document.getElementById('tab-btn-aerodromes');
  const btnUsers = document.getElementById('tab-btn-users');
  const btnToggleAllObs = document.getElementById('btn-toggle-all-obs');
  if (btnRunways) btnRunways.style.display = isAdmin ? 'block' : 'none';
  if (btnAerodromes) btnAerodromes.style.display = isAdmin ? 'block' : 'none';
  if (btnUsers) btnUsers.style.display = isAdmin ? 'block' : 'none';
  if (btnToggleAllObs) btnToggleAllObs.style.display = isAdmin ? 'flex' : 'none';

  setApiStatus('connected');

  // Délai court pour laisser le DOM se stabiliser avant d'initialiser la carte
  setTimeout(() => {
    geoMapInit();
    bindCoordInputListeners();
    loadStudyAerodrome().then(() => loadAllAerodromes());
  }, 300);
}
