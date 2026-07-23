'use strict';
/* ═══════════════════════════════════════════════════════════
   SIGOBS — aerodrome.js
   Chargement de l'aérodrome d'étude, normalisation, pistes
   Routes : GET /aerodromes?code_oaci=  (doc §5.3)
            GET /aerodromes/:id/pistes  (doc §6.3)
   Dépend de : config.js, api.js (apiFetch, normalizeAerodromeFromAPI,
               setApiStatus, showToast)
   ═══════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════
   STATUT AÉRODROME D'ÉTUDE
══════════════════════════════════════════════════════════ */
function setAerodromeStatus(state, msg) {
  const dot = document.getElementById('study-status-dot');
  const nameEl = document.getElementById('study-name');
  if (dot) dot.className = `study-status-dot ${state}`;
  if (state === 'loading' && nameEl && !App.aerodrome) nameEl.textContent = msg || 'Chargement…';
}

/* ══════════════════════════════════════════════════════════
   CHARGEMENT DE L'AÉRODROME D'ÉTUDE (sélection courante)
   Séquence :
     1. GET /aerodromes?code_oaci=ICAO  → récupère le _id MongoDB
        (ou utilisation directe du _id si fourni)
     2. GET /aerodromes/:id/pistes      → liste des pistes (doc §6.3)
     3. normalisation + mise à jour UI
     4. chargement des obstacles
══════════════════════════════════════════════════════════ */
async function loadStudyAerodrome() {
  // Détermine quel aérodrome charger, par ordre de priorité :
  //  1. Sélection mémorisée pour cette session (switch précédent)
  //  2. Aérodrome associé au compte utilisateur (App.user.aerodrome_id)
  //  3. Aérodrome OACI par défaut historique (mono-aérodrome)
  const savedId = sessionStorage.getItem('sigobs_aerodrome_id');

  let userAerodromeId = (App.user?.aerodrome_id && typeof App.user.aerodrome_id === 'object')
    ? App.user.aerodrome_id._id
    : App.user?.aerodrome_id;

  const aeroArray = App.aerodromesList && App.aerodromesList.length > 0 ? App.aerodromesList : (App.user?.aerodromes || App.user?.aerodromes_autorises || []);
  if (!userAerodromeId && aeroArray.length > 0) {
    userAerodromeId = typeof aeroArray[0] === 'object' ? aeroArray[0]._id : aeroArray[0];
  }

  const roleRaw = App.user?.role;
  const roleName = typeof roleRaw === 'object' ? roleRaw.nomRole || roleRaw.name : roleRaw;
  const isAdmin = roleName && roleName.toLowerCase().includes('admin');

  let finalId = null;

  if (isAdmin) {
    // Les admins peuvent utiliser le savedId de la session précédente
    finalId = savedId || userAerodromeId;
  } else {
    // Pour les non-admins, l'aérodrome de l'utilisateur a TOUJOURS la priorité sur le cache
    // Sauf si le savedId fait explicitement partie de ses aérodromes autorisés (cas multi-aérodromes non-admin)
    finalId = userAerodromeId;
    if (savedId) {
      const allowedIds = aeroArray.map(a => typeof a === 'object' ? a._id : a);
      if (userAerodromeId && !allowedIds.includes(userAerodromeId)) allowedIds.push(userAerodromeId);
      if (allowedIds.includes(savedId)) {
        finalId = savedId;
      }
    }
  }

  if (finalId) {
    await loadAerodromeById(finalId);
  } else if (savedId && isAdmin) { // Sécurité supplémentaire
    await loadAerodromeById(savedId);
  } else {
    await loadAerodromeByIcao(STUDY_AERODROME_ICAO);
  }
}

/** Charge un aérodrome par son code OACI (recherche du _id MongoDB d'abord) */
async function loadAerodromeByIcao(icao) {
  setAerodromeStatus('loading', 'Chargement ' + icao + '…');
  try {
    const listRes = await apiFetch('/aerodromes?code_oaci=' + icao);
    const rawList = listRes.data || [];
    if (!rawList.length) throw new Error('Aérodrome ' + icao + ' introuvable dans la base');
    await loadAerodromeById(rawList[0]._id, rawList[0]);
  } catch (err) {
    setAerodromeStatus('error', icao + ' — erreur de chargement');
    setApiStatus('disconnected', 'API inaccessible');
    console.error('[loadAerodromeByIcao]', err);
    showToast("Impossible de charger l'aérodrome : " + err.message, 'error');
  }
}

/**
 * Charge un aérodrome par son _id MongoDB et l'applique comme aérodrome
 * d'étude courant. Utilisé au démarrage ET lors d'un changement
 * d'aérodrome via le sélecteur de la barre supérieure.
 * @param {string} id     - _id MongoDB de l'aérodrome
 * @param {Object} [raw]  - document aérodrome déjà récupéré (évite un appel réseau)
 */
async function loadAerodromeById(id, raw) {
  setAerodromeStatus('loading', 'Chargement…');
  try {
    if (!raw) {
      // Repli 1 : chercher dans la liste déjà chargée (admin) pour éviter un appel inutile
      raw = (App.aerodromesList || []).find(a => a._id === id);
    }
    if (!raw) {
      try {
        const res = await apiFetch('/aerodromes/' + id);
        raw = res.data || res; // certains backends renvoient le document directement
      } catch (e) {
        console.warn('[loadAerodromeById] GET /aerodromes/:id indisponible', e.message);
        sessionStorage.removeItem('sigobs_aerodrome_id');

        const roleRaw = App.user?.role;
        const roleName = typeof roleRaw === 'object' ? roleRaw.nomRole || roleRaw.name : roleRaw;
        const isAdmin = roleName && roleName.toLowerCase().includes('admin');

        if (isAdmin) {
          console.warn('[loadAerodromeById] Repli sur l\'aérodrome par défaut pour admin');
          return loadAerodromeByIcao(STUDY_AERODROME_ICAO);
        } else {
          throw new Error('Vous n\'avez pas accès à cet aérodrome ou il a été supprimé.');
        }
      }
    }

    App.aerodromeMongoId = raw._id || id;
    App.currentAerodromeId = App.aerodromeMongoId;
    sessionStorage.setItem('sigobs_aerodrome_id', App.aerodromeMongoId);

    // Charger les pistes séparément — doc §6.3 : GET /aerodromes/:id/pistes
    let pistesRaw = [];
    try {
      const pistesRes = await apiFetch('/aerodromes/' + App.aerodromeMongoId + '/pistes');
      pistesRaw = pistesRes.data || [];
    } catch (e) {
      console.warn('[loadAerodromeById] Impossible de charger les pistes:', e.message);
    }

    const schema = normalizeAerodromeFromAPI(raw, pistesRaw);
    applyAerodromeToUI(schema);
    // Réinitialiser les obstacles affichés avant de charger ceux du nouvel aérodrome
    App.obstaclesPage = 1;
    App.obstacles = []; App.allObstacles = [];
    await loadObstaclesList();

    const qfuCount = schema.runways.length;
    const pisteCount = pistesRaw.filter(p => !p.fermee).length;
    showToast(`${schema.icao} chargé — ${pisteCount} piste(s) · ${qfuCount} QFU`, 'success');

    if (typeof renderAerodromeSwitcher === 'function') renderAerodromeSwitcher();
  } catch (err) {
    setAerodromeStatus('error', 'Erreur de chargement');
    setApiStatus('disconnected', 'API inaccessible');
    console.error('[loadAerodromeById]', err);
    showToast("Impossible de charger l'aérodrome : " + err.message, 'error');
  }
}

/** Bascule l'aérodrome d'étude courant (appelé depuis le sélecteur de la topbar ou la liste) */
async function switchAerodrome(id) {
  if (!id || id === App.currentAerodromeId) return;
  await loadAerodromeById(id);
  // Mettre à jour la liste dans l'onglet AÉRODROMES pour refléter le nouvel aérodrome courant
  if (typeof renderAerodromesAdminList === 'function') {
    const btnAerodromes = document.getElementById('tab-btn-aerodromes');
    if (btnAerodromes && btnAerodromes.style.display !== 'none') {
      renderAerodromesAdminList();
    }
  }
}

/* ══════════════════════════════════════════════════════════
   APPLICATION DU SCHÉMA AÉRODROME À L'INTERFACE
══════════════════════════════════════════════════════════ */
function applyAerodromeToUI(schema) {
  App.aerodrome = schema;
  App.runways = schema.runways || [];

  const icaoEl = document.getElementById('study-icao');
  const nameEl = document.getElementById('study-name');
  const elevEl = document.getElementById('study-elev');
  const dotEl = document.getElementById('study-status-dot');

  if (icaoEl) icaoEl.textContent = schema.icao || '—';
  if (nameEl) nameEl.textContent = `${schema.name}${schema.iata ? '  (' + schema.iata + ')' : ''}`;
  if (elevEl) elevEl.textContent = `ELEV ${schema.elevation != null ? (schema.elevation * 0.3048).toFixed(0) : '—'} m  ·  ${schema.city || schema.country || ''}`;
  if (dotEl) dotEl.className = 'study-status-dot ready';

  const aeroInfoDiv = document.getElementById('aerodrome-info');
  if (aeroInfoDiv) aeroInfoDiv.classList.remove('hidden');

  buildRunwayTabs();

  // Sélectionner la première piste ouverte par défaut
  const firstOpen = App.runways.find(r => !r.closed) || App.runways[0];
  if (firstOpen) selectRunway(firstOpen);

  // Centrer la carte sur l'aérodrome
  if (GeoMap.map)
    GeoMap.map.flyTo({ center: [schema.longitude, schema.latitude], zoom: 13, pitch: 50, bearing: 0, duration: 2000 });
}

/* ══════════════════════════════════════════════════════════
   PISTES — Onglets et sélection
══════════════════════════════════════════════════════════ */

/** Construit les onglets de sélection de piste dans la barre runway */
function buildRunwayTabs() {
  const container = document.getElementById('runway-tabs');
  const meta = document.getElementById('runway-meta');
  container.innerHTML = '';
  meta.innerHTML = '';

  if (!App.runways.length) {
    container.innerHTML = '<span class="no-runway-msg">— Aucune piste disponible —</span>';
    return;
  }

  App.runways.forEach((rwy, idx) => {
    const btn = document.createElement('button');
    btn.className = 'runway-tab-btn' + (idx === 0 ? ' active' : '');
    btn.textContent = rwy.designation || `RWY ${idx + 1}`;
    btn.onclick = () => {
      document.querySelectorAll('.runway-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectRunway(rwy);
    };
    container.appendChild(btn);
  });
}

/** Sélectionne une piste, met à jour le panneau de droite et rafraîchit la carte */
function selectRunway(rwy) {
  App.activeRunway = rwy;

  const label = document.getElementById('active-runway-label');
  if (label) label.textContent = `RWY ${rwy.designation || '—'}  |  ${rwy.length || '—'} m  ×  ${rwy.width || '—'} m`;

  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  setText('rwy-desig', rwy.designation || '—');
  setText('rwy-length', rwy.length ? `${rwy.length} m` : '—');
  setText('rwy-width', rwy.width ? `${rwy.width} m` : '—');
  setText('rwy-bearing', rwy.trueHeading != null ? `${rwy.trueHeading}°` : '—');
  setText('rwy-elev', rwy.elevation != null ? `${(rwy.elevation * 0.3048).toFixed(1)} m` : '—');
  setText('rwy-code', rwy.icaoCode || '—');

  const meta = document.getElementById('runway-meta');
  meta.innerHTML =
    `<span class="runway-meta-item">L <span>${rwy.length ?? '—'} m</span></span>` +
    `<span class="runway-meta-item">l <span>${rwy.width ?? '—'} m</span></span>` +
    `<span class="runway-meta-item">ÉLÉV <span>${rwy.elevation != null ? (rwy.elevation * 0.3048).toFixed(1) : '—'} m</span></span>`;

  // Rafraîchir la carte (surfaces OLS + obstacles)
  geoMapRender();
}
