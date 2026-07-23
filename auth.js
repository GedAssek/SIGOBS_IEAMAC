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
      
      if (userData.mustChangePassword || email === password || password === 'password123') {
        // Première connexion (le mot de passe est l'email ou le mot de passe par défaut)
        App.forcePasswordChange = true;
        document.getElementById('screen-login').classList.remove('active');
        openChangePasswordModal();
        const cpCurrent = document.getElementById('cp-current-password');
        if (cpCurrent) {
          cpCurrent.value = password;
          cpCurrent.setAttribute('readonly', 'true');
        }
      } else {
        showApp();
      }
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
  // Nettoyer le stockage de session
  sessionStorage.clear();

  // Recharger la page pour garantir une mémoire et un DOM 100% vierges
  // Cela élimine complètement l'effet de "données fantômes" au prochain login
  window.location.reload();
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
  const isAdmin = getIsAdmin();
  const isEvaluator = getIsEvaluator();
  const isDataTech = getIsDataTech();

  if (nameEl) nameEl.textContent = App.user.email || App.user.nom || '—';
  if (roleEl) roleEl.textContent = roleName;

  const btnRunways = document.getElementById('tab-btn-runways');
  const btnAerodromes = document.getElementById('tab-btn-aerodromes');
  const btnUsers = document.getElementById('tab-btn-users');
  const btnArchive = document.getElementById('tab-btn-archive');
  const btnToggleAllObs = document.getElementById('btn-toggle-all-obs');
  
  const aeroArray = App.user?.aerodromes || App.user?.aerodromes_autorises || [];
  const hasMultipleAerodromes = aeroArray.length > 0;

  // RBAC Tab access logic based on API documentation
  if (btnRunways) btnRunways.style.display = (isAdmin || isEvaluator) ? 'block' : 'none';
  if (btnAerodromes) btnAerodromes.style.display = (isAdmin || isEvaluator || hasMultipleAerodromes) ? 'block' : 'none';
  if (btnArchive) btnArchive.style.display = (isAdmin || isEvaluator) ? 'block' : 'none';
  if (btnUsers) btnUsers.style.display = isAdmin ? 'block' : 'none';

  // Cacher le panneau de création d'aérodrome pour les non-admins et corriger le layout CSS Grid
  const aeroAddPanel = document.querySelector('#tab-aerodromes .panel-left');
  const aeroAppLayout = document.querySelector('#tab-aerodromes .app-layout');
  if (aeroAddPanel && aeroAppLayout) {
    if (isAdmin || isEvaluator) {
      aeroAddPanel.style.display = 'block';
      aeroAppLayout.style.gridTemplateColumns = '320px 1fr';
    } else {
      aeroAddPanel.style.display = 'none';
      aeroAppLayout.style.gridTemplateColumns = '1fr';
    }
  }
  
  if (btnToggleAllObs) btnToggleAllObs.style.display = (isAdmin || isEvaluator) ? 'flex' : 'none';

  // Ajuster le menu déroulant de la corbeille pour les non-admins
  const corbeilleSelect = document.getElementById('corbeille-type-select');
  if (corbeilleSelect) {
    Array.from(corbeilleSelect.options).forEach(opt => {
      if (opt.value !== 'obstacles') {
        opt.style.display = (isAdmin || isEvaluator) ? 'block' : 'none';
        opt.disabled = !(isAdmin || isEvaluator);
      }
    });
    if (!isAdmin && !isEvaluator && corbeilleSelect.value !== 'obstacles') {
      corbeilleSelect.value = 'obstacles';
    }
  }

  setApiStatus('connected');

  // Délai court pour laisser le DOM se stabiliser avant d'initialiser la carte
  setTimeout(() => {
    geoMapInit();
    bindCoordInputListeners();
    // On charge d'abord TOUTE la liste des aérodromes autorisés pour savoir sur quoi atterrir
    loadAllAerodromes().then(() => loadStudyAerodrome());
  }, 300);
}

/* ══════════════════════════════════════════════════════════
   CHANGEMENT DE MOT DE PASSE
   POST /auth/change-password — requiert JWT
══════════════════════════════════════════════════════════ */

/** Ouvre la modale et réinitialise les champs */
function openChangePasswordModal() {
  const cpCurrent = document.getElementById('cp-current-password');
  if (cpCurrent) {
    if (!App.forcePasswordChange) {
      cpCurrent.value = '';
      cpCurrent.removeAttribute('readonly');
    }
  }
  document.getElementById('cp-new-password').value     = '';
  document.getElementById('cp-confirm-password').value = '';
  document.getElementById('cp-error').classList.add('hidden');
  document.getElementById('cp-success').classList.add('hidden');
  document.getElementById('cp-strength-fill').style.width      = '0%';
  document.getElementById('cp-strength-fill').style.background = '';
  document.getElementById('cp-strength-label').textContent     = '';
  const btn = document.getElementById('cp-btn-submit');
  btn.disabled = false;
  btn.querySelector('.cp-btn-label').classList.remove('hidden');
  btn.querySelector('.cp-btn-loader').classList.add('hidden');
  
  const closeBtn = document.querySelector('.cp-close-btn');
  if (closeBtn) {
    closeBtn.style.display = App.forcePasswordChange ? 'none' : 'block';
  }
  
  const title = document.getElementById('cp-modal-title');
  if (title) {
    title.textContent = App.forcePasswordChange ? 'CRÉATION DU MOT DE PASSE (Requis)' : 'CHANGEMENT DE MOT DE PASSE';
  }
  
  document.getElementById('change-password-overlay').classList.remove('hidden');
  if (!App.forcePasswordChange) {
    setTimeout(() => document.getElementById('cp-current-password').focus(), 80);
  } else {
    setTimeout(() => document.getElementById('cp-new-password').focus(), 80);
  }
}

/** Ferme la modale (clic sur fond ou bouton ✕/Annuler) */
function closeChangePasswordModal(e) {
  if (App.forcePasswordChange) return; // Empêcher la fermeture si changement forcé
  if (e && e.target !== document.getElementById('change-password-overlay')) return;
  document.getElementById('change-password-overlay').classList.add('hidden');
}

/** Bascule la visibilité d'un champ mot de passe */
function toggleCpVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  input.type = (input.type === 'password') ? 'text' : 'password';
  btn.style.color = (input.type === 'text') ? 'var(--cyan)' : '';
}

/** Calcule et affiche la force du nouveau mot de passe */
function checkCpStrength(val) {
  const fill  = document.getElementById('cp-strength-fill');
  const label = document.getElementById('cp-strength-label');
  if (!val) { fill.style.width = '0%'; label.textContent = ''; return; }

  let score = 0;
  if (val.length >= 8)  score++;
  if (val.length >= 12) score++;
  if (/[A-Z]/.test(val)) score++;
  if (/[0-9]/.test(val)) score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;

  const levels = [
    { pct: '20%', color: 'var(--red)',   text: 'TRÈS FAIBLE' },
    { pct: '40%', color: '#FF6B00',      text: 'FAIBLE'      },
    { pct: '60%', color: 'var(--amber)', text: 'MOYEN'       },
    { pct: '80%', color: '#7ED957',      text: 'FORT'        },
    { pct: '100%',color: 'var(--green)', text: 'TRÈS FORT'   },
  ];
  const lvl = levels[Math.min(score - 1, 4)] || levels[0];
  fill.style.width      = lvl.pct;
  fill.style.background = lvl.color;
  label.textContent     = lvl.text;
  label.style.color     = lvl.color;
}

/** Soumet le changement de mot de passe au backend */
async function handleChangePassword() {
  const current  = document.getElementById('cp-current-password').value;
  const newPwd   = document.getElementById('cp-new-password').value;
  const confirm  = document.getElementById('cp-confirm-password').value;
  const errEl    = document.getElementById('cp-error');
  const succEl   = document.getElementById('cp-success');
  const btn      = document.getElementById('cp-btn-submit');
  const lbl      = btn.querySelector('.cp-btn-label');
  const loader   = btn.querySelector('.cp-btn-loader');

  errEl.classList.add('hidden');
  succEl.classList.add('hidden');

  if (!current || !newPwd || !confirm) {
    errEl.textContent = 'Tous les champs sont obligatoires.';
    errEl.classList.remove('hidden');
    return;
  }
  if (newPwd !== confirm) {
    errEl.textContent = 'Les nouveaux mots de passe ne correspondent pas.';
    errEl.classList.remove('hidden');
    return;
  }
  if (newPwd.length < 6) {
    errEl.textContent = 'Le nouveau mot de passe doit comporter au moins 6 caractères.';
    errEl.classList.remove('hidden');
    return;
  }

  lbl.classList.add('hidden');
  loader.classList.remove('hidden');
  btn.disabled = true;

  try {
    const res = await apiFetch('/auth/change-password', 'PUT', {
      oldPassword: current,
      newPassword: newPwd,
    });
    if (res.data && res.data.token) {
      App.token = res.data.token;
      sessionStorage.setItem('sigobs_token', App.token);
      if (App.user) {
        App.user.mustChangePassword = false;
        sessionStorage.setItem('sigobs_user', JSON.stringify(App.user));
      }
    }
    succEl.textContent = 'Mot de passe modifié avec succès !';
    succEl.classList.remove('hidden');
    document.getElementById('cp-current-password').value    = '';
    document.getElementById('cp-new-password').value        = '';
    document.getElementById('cp-confirm-password').value    = '';
    document.getElementById('cp-strength-fill').style.width = '0%';
    document.getElementById('cp-strength-label').textContent = '';
    showToast('Mot de passe modifié avec succès', 'success');
    setTimeout(() => {
      document.getElementById('change-password-overlay').classList.add('hidden');
      if (App.forcePasswordChange) {
        App.forcePasswordChange = false;
        showApp();
      }
    }, 1800);
  } catch (e) {
    errEl.textContent = e.message || 'Erreur lors du changement de mot de passe.';
    errEl.classList.remove('hidden');
  } finally {
    lbl.classList.remove('hidden');
    loader.classList.add('hidden');
    btn.disabled = false;
  }
}

/* ══════════════════════════════════════════════════════════
   HELPERS RBAC (Role-Based Access Control)
══════════════════════════════════════════════════════════ */
function getIsAdmin() {
  return (App.user?._roleName || '').toLowerCase().includes('admin');
}

function getIsEvaluator() {
  return (App.user?._roleName || '').toLowerCase().includes('evaluator');
}

function getIsDataTech() {
  return (App.user?._roleName || '').toLowerCase().includes('data technician') || 
         (App.user?._roleName || '').toLowerCase().includes('technician');
}
