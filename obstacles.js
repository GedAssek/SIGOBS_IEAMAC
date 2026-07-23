'use strict';
/* ═══════════════════════════════════════════════════════════
   SIGOBS — obstacles.js
   Gestion complète des obstacles : CRUD, filtres, workflow,
   conformité OLS, coordonnées DMS/DD, rapport panneau
   Routes :
     POST   /obstacles              (doc §7.4)
     POST   /obstacles/:id/evaluer  (doc §7.8)
     GET    /obstacles?aerodrome_id (doc §7.3)
     PATCH  /obstacles/:id          (doc §7.6)
     DELETE /obstacles/:id          (doc §7.7)
   Dépend de : config.js, api.js (apiFetch, normalizeObstacleFromAPI,
               normalizeStatusBack, labelToTypeObstacle, typeToLabel,
               statusLabel, showToast, showModal)
   ═══════════════════════════════════════════════════════════ */


/* ══════════════════════════════════════════════════════════
   COORDONNÉES — Gestion DMS / DD
══════════════════════════════════════════════════════════ */

/** Bascule entre les modes de saisie des coordonnées DMS et DD */
function setCoordMode(mode) {
  App.coordMode = mode;
  document.getElementById('coord-dms').classList.toggle('active', mode === 'dms');
  document.getElementById('coord-dd').classList.toggle('active', mode === 'dd');
  document.getElementById('btn-dms').classList.toggle('active', mode === 'dms');
  document.getElementById('btn-dd').classList.toggle('active', mode === 'dd');
}

/** Convertit des degrés/minutes/secondes en degrés décimaux */
function dmsToDecimal(deg, min, sec, hem) {
  const d = parseFloat(deg) || 0, m = parseFloat(min) || 0, s = parseFloat(sec) || 0;
  return ((hem === 'S' || hem === 'W') ? -1 : 1) * (d + m / 60 + s / 3600);
}

/** Lit les coordonnées depuis le formulaire (mode DMS ou DD) */
function getCoordinates() {
  if (App.coordMode === 'dms') {
    const latDeg = document.getElementById('lat-deg').value;
    const lonDeg = document.getElementById('lon-deg').value;
    if (!latDeg || !lonDeg) return { lat: NaN, lon: NaN };
    return {
      lat: dmsToDecimal(latDeg, document.getElementById('lat-min').value,
        document.getElementById('lat-sec').value, document.getElementById('lat-hem').value),
      lon: dmsToDecimal(lonDeg, document.getElementById('lon-min').value,
        document.getElementById('lon-sec').value, document.getElementById('lon-hem').value),
    };
  }
  const latDd = document.getElementById('lat-dd').value;
  const lonDd = document.getElementById('lon-dd').value;
  if (!latDd || !lonDd) return { lat: NaN, lon: NaN };
  return { lat: parseFloat(latDd), lon: parseFloat(lonDd) };
}

/** Attache les listeners sur les champs de coordonnées (anciennement pour le preview) */
function bindCoordInputListeners() {
  // Le preview temps réel sur la carte a été désactivé à la demande de l'utilisateur.
  // L'obstacle n'apparaît sur la carte qu'après avoir cliqué sur "Ajouter".
}

/** Réinitialise le formulaire de saisie d'obstacle (page dédiée) */
function clearObstacleForm() {
  ['oe-name', 'oe-proprietaire', 'obs-alt-m', 'obs-height-m',
    'lat-deg', 'lat-min', 'lat-sec',
    'lon-deg', 'lon-min', 'lon-sec',
    'lat-dd', 'lon-dd',
    'oe-createur', 'oe-source', 'oe-precision-h', 'oe-resolution-h', 'oe-etendue-h',
    'oe-precision-v', 'oe-resolution-v', 'oe-operations', 'oe-applicabilite',
    'oe-balisage-type', 'oe-marque-type',
  ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const temporalSel = document.getElementById('obs-temporal');
  if (temporalSel) temporalSel.value = 'permanent';
  const expiryGroup = document.getElementById('expiry-group');
  if (expiryGroup) expiryGroup.classList.add('hidden');
  const balisageGroup = document.getElementById('oe-balisage-type-group');
  if (balisageGroup) balisageGroup.classList.add('hidden');
  const marqueGroup = document.getElementById('oe-marque-type-group');
  if (marqueGroup) marqueGroup.classList.add('hidden');
  const balisageSel = document.getElementById('oe-balisage');
  if (balisageSel) balisageSel.value = 'Non';
  const marqueSel = document.getElementById('oe-marque');
  if (marqueSel) marqueSel.value = 'Non';
  // Date/heure de relevé réinitialisée à l'instant présent
  const dtEl = document.getElementById('oe-datetime');
  if (dtEl) dtEl.value = new Date().toISOString().slice(0, 16);
}

/* ══════════════════════════════════════════════════════════
   DÉTECTION DE DOUBLON — helper partagé
   Deux niveaux de détection pour la saisie manuelle :
   1. Même identifiant (nom, insensible à la casse) → doublon
      d'identifiant, même si les coordonnées diffèrent.
   2. Mêmes champs clés (lat/lon à 0.000001° près + altitude
      à 1 ft près + type_obstacle) → doublon complet, même si
      l'identifiant diffère.
   Ce critère s'applique aussi bien à la saisie manuelle
   qu'à l'import CSV (voir obstacles-csv-import.js).
══════════════════════════════════════════════════════════ */
/**
 * Vérifie si un obstacle similaire existe déjà dans App.allObstacles.
 * @param {string} name   - Identifiant/désignation de l'obstacle
 * @param {number} lat    - Latitude en degrés décimaux
 * @param {number} lon    - Longitude en degrés décimaux
 * @param {number} [altFt]  - Altitude en pieds (optionnel)
 * @param {string} [type]   - Type d'obstacle (optionnel)
 * @returns {{ type: 'none'|'id'|'fields', duplicate: object|null }}
 *   type='id'     → même identifiant qu'un obstacle existant
 *   type='fields' → mêmes champs clés (lat/lon/alt/type)
 *   type='none'   → aucun doublon
 */
function checkObstacleDuplicate(name, lat, lon, altFt, type) {
  const nameLower = (name || '').trim().toLowerCase();
  const obstacles = App.allObstacles || [];

  // 1. Doublon par identifiant (nom identique, insensible à la casse)
  const idDup = obstacles.find(obs =>
    (obs.name || '').trim().toLowerCase() === nameLower
  );
  if (idDup) return { type: 'id', duplicate: idDup };

  // 2. Doublon par champs clés (lat/lon/altitude/type identiques)
  const fieldsDup = obstacles.find(obs => {
    const sameLat = obs.latitude != null && Math.abs(obs.latitude - lat) < 0.000001;
    const sameLon = obs.longitude != null && Math.abs(obs.longitude - lon) < 0.000001;
    const sameAlt = altFt === undefined || altFt === null || isNaN(altFt)
      || (obs.altitude_max != null && Math.abs(obs.altitude_max - altFt) < 1);
    const sameType = !type || !obs.type_obstacle
      || obs.type_obstacle === type || labelToTypeObstacle(type) === obs.type_obstacle;
    return sameLat && sameLon && sameAlt && sameType;
  });
  if (fieldsDup) return { type: 'fields', duplicate: fieldsDup };

  return { type: 'none', duplicate: null };
}

/**
 * Compatibilité ascendante — utilisée par obstacles-csv-import.js.
 * @param {string} name - Identifiant/désignation de l'obstacle
 * @param {number} lat  - Latitude en degrés décimaux
 * @param {number} lon  - Longitude en degrés décimaux
 * @returns {boolean} true si un doublon est détecté
 */
function isObstacleDuplicate(name, lat, lon) {
  const result = checkObstacleDuplicate(name, lat, lon);
  return result.type !== 'none';
}

/* ══════════════════════════════════════════════════════════
   SOUMISSION D'UN OBSTACLE
   1. POST /obstacles              → sauvegarde (statut = Draft auto)
   2. POST /obstacles/:id/evaluer  → verdict OLS backend
   Conforme au workflow complet doc §11
   Les hauteurs/altitudes sont saisies en MÈTRES sur la page de
   saisie puis converties en pieds pour le payload backend (champs
   altitude_max / hauteur — convention déjà utilisée par l'API).
══════════════════════════════════════════════════════════ */
async function submitObstacle() {
  const name = document.getElementById('oe-name').value.trim();
  const proprietaire = (document.getElementById('oe-proprietaire')?.value || '').trim();
  const type = document.getElementById('oe-type').value;
  const altM = parseFloat(document.getElementById('obs-alt-m').value);
  const heightM = parseFloat(document.getElementById('obs-height-m').value); // optionnel (Annexe 15 : attribut "Hauteur" = optionnel)
  const temporal = document.getElementById('obs-temporal').value;
  const expiry = document.getElementById('obs-expiry').value;
  const { lat, lon } = getCoordinates();

  if (!name || isNaN(altM) || isNaN(lat) || isNaN(lon)) {
    showToast('Veuillez remplir les champs obligatoires (désignation, altitude, coordonnées)', 'warn'); return;
  }
  if (temporal !== 'permanent' && !expiry) {
    showToast('La date de fin de validité est obligatoire pour un obstacle temporaire/en construction', 'warn'); return;
  }
  if (!App.aerodromeMongoId) {
    showToast('Aérodrome non chargé, impossible de soumettre', 'error'); return;
  }

  const payload = buildObstaclePayload({
    name, proprietaire, type, lat, lon, altM, heightM, temporal, expiry,
  });

  // Mode édition (retours n°10 / n°18) : si une édition est en cours
  // (voir obstacle-entry-page.js), on modifie l'obstacle existant au lieu
  // d'en créer un nouveau.
  if (typeof _editingObstacleId !== 'undefined' && _editingObstacleId) {
    const editId = _editingObstacleId;
    _editingObstacleId = null;
    await updateObstacle(editId, payload);
    closeObstacleEntryPage();
    return;
  }

  // ── Détection de doublon (saisie manuelle) ───────────────────────────────
  const M_TO_FT_CHK = 3.28084;
  const altFtChk = !isNaN(altM) ? altM * M_TO_FT_CHK : undefined;
  const dupCheck = checkObstacleDuplicate(name, lat, lon, altFtChk, type);
  if (dupCheck.type === 'id') {
    showToast(
      `⚠ Doublon détecté : l'identifiant "${name}" est déjà utilisé par un obstacle existant. Veuillez choisir un identifiant différent.`,
      'error'
    );
    return;
  }
  if (dupCheck.type === 'fields') {
    showToast(
      '⚠ Doublon détecté : un obstacle avec les mêmes coordonnées, altitude et type existe déjà. Veuillez vérifier les données saisies.',
      'error'
    );
    return;
  }
  // ─────────────────────────────────────────────────────────────────────────

  await createAndEvaluateObstacle(payload);
  clearObstacleForm();
}

/**
 * Construit le payload backend pour un obstacle à partir de valeurs déjà
 * extraites (mètres). Centralise la conversion m → ft et l'ajout des
 * attributs étendus (Annexe 15 / Tableau A6-2) afin d'être réutilisable
 * par la saisie unitaire ET par l'import CSV par lot.
 */
function buildObstaclePayload({ name, proprietaire, type, lat, lon, altM, heightM, temporal, expiry, unite_mesure, balisage_lumineux, marque }) {
  const M_TO_FT = 3.28084;
  const altFt = altM * M_TO_FT;
  const heightFt = !isNaN(heightM) ? heightM * M_TO_FT : undefined;

  const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : undefined; };

  const payload = {
    aerodrome_id: App.aerodromeMongoId,
    nom: name,
    proprietaire: proprietaire || undefined,
    type_obstacle: labelToTypeObstacle(type),
    geometrie: { type: 'Point', coordinates: [lon, lat] },
    latitude: lat,
    longitude: lon,
    altitude_max: Math.round(altFt * 100) / 100,
    ...(heightFt !== undefined ? { hauteur: Math.round(heightFt * 100) / 100 } : {}),
    zone_de_couverture: getVal('oe-zone-couverture') || '3',
    // 'construction' = obstacle temporaire de chantier à surveiller jusqu'à
    // la fin du projet (retour n°15) — traité comme "Temporaire" côté
    // backend, avec un sous-type conservé côté client pour le voyant dédié.
    permanence: temporal === 'permanent' ? 'Permanent' : 'Temporaire',
    type_temporel: temporal, // 'permanent' | 'temporary' | 'construction'
    date_echeance: (temporal !== 'permanent' && expiry) ? expiry : null,
    date_expiration: (temporal !== 'permanent' && expiry) ? expiry : null,
    date_fin_validite: (temporal !== 'permanent' && expiry) ? expiry : null,

    // ── Attributs étendus — conformes au Tableau A6-2 (Annexe 15 OACI) ──
    // Envoyés en plus du schéma de base ; ignorés sans risque par un
    // backend qui ne les connaît pas encore.
    identificateur_createur_donnees: getVal('oe-createur') || undefined,
    identificateur_source_donnees: getVal('oe-source') || undefined,
    precision_horizontale: getVal('oe-precision-h') ? parseFloat(getVal('oe-precision-h')) : undefined,
    niveau_confiance_horizontal: getVal('oe-confiance-h') || undefined,
    resolution_horizontale: getVal('oe-resolution-h') ? parseFloat(getVal('oe-resolution-h')) : undefined,
    etendue_horizontale: getVal('oe-etendue-h') ? parseFloat(getVal('oe-etendue-h')) : undefined,
    systeme_reference_horizontal: getVal('oe-ref-h') || undefined,
    precision_verticale: getVal('oe-precision-v') ? parseFloat(getVal('oe-precision-v')) : undefined,
    niveau_confiance_vertical: getVal('oe-confiance-v') || undefined,
    resolution_verticale: getVal('oe-resolution-v') ? parseFloat(getVal('oe-resolution-v')) : undefined,
    systeme_reference_vertical: getVal('oe-ref-v') || undefined,
    type_geometrie: getVal('oe-geom-type') || 'Point',
    integrite: getVal('oe-integrite') || undefined,
    date_heure_releve: getVal('oe-datetime') || undefined,
    unite_mesure: unite_mesure !== undefined ? unite_mesure : (getVal('oe-unite-mesure') || 'm'),
    operations: getVal('oe-operations') || undefined,
    applicabilite: getVal('oe-applicabilite') || undefined,
    balisage_lumineux: balisage_lumineux !== undefined ? balisage_lumineux : (getVal('oe-balisage') || 'Non'),
    balisage_lumineux_type: (balisage_lumineux !== undefined ? balisage_lumineux : getVal('oe-balisage')) === 'Oui' ? (getVal('oe-balisage-type') || undefined) : undefined,
    marque: marque !== undefined ? marque : (getVal('oe-marque') || 'Non'),
    marque_type: getVal('oe-marque') === 'Oui' ? (getVal('oe-marque-type') || undefined) : undefined,
  };
  // Nettoyer les clés undefined pour un payload propre
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
  return payload;
}

/** Envoie le payload au backend, déclenche l'évaluation OLS et met à jour l'état local + l'UI */
async function createAndEvaluateObstacle(payload) {
  try {
    // 1. Sauvegarder l'obstacle — réponse: { success, data: obstacle }
    const res = await apiFetch('/obstacles', 'POST', payload);
    const apiObs = normalizeObstacleFromAPI(res.data);

    // Fallback: si le backend ignore la date d'expiration, on la force localement
    if (payload.date_echeance && !apiObs.expiry) {
      apiObs.expiry = payload.date_echeance;
    }

    if (apiObs.latitude === null || isNaN(apiObs.latitude)) apiObs.latitude = payload.latitude || payload.geometrie?.coordinates[1];
    if (apiObs.longitude === null || isNaN(apiObs.longitude)) apiObs.longitude = payload.longitude || payload.geometrie?.coordinates[0];
    // Conserver les attributs étendus localement (le backend peut ne pas les renvoyer)
    apiObs.extended = extractExtendedAttributes(payload);

    // 2. Évaluation OLS — réservé Admin et Evaluator
    const isAdmin = typeof getIsAdmin === 'function' ? getIsAdmin() : false;
    const isEvaluator = typeof getIsEvaluator === 'function' ? getIsEvaluator() : false;

    if (isAdmin || isEvaluator) {
      try {
        const evalRes = await apiFetch('/obstacles/' + apiObs._id + '/evaluer', 'POST');
        const evalData = evalRes.data || {};
        if (evalData.statut_resultant) apiObs.status = normalizeStatusBack(evalData.statut_resultant);
        if (evalData.perce !== undefined) apiObs.perce = evalData.perce;
        if (evalData.percements) apiObs.percements = evalData.percements;
        displayEvalResult(apiObs, evalData);
      } catch (e) {
        console.warn('[createAndEvaluateObstacle] Erreur évaluation:', e.message);
        showToast('Obstacle sauvegardé — évaluation OLS non disponible', 'warn');
      }
    } else {
      // Data Technician: l'obstacle est créé en "Draft" (Défaut backend), pas d'évaluation automatique
      apiObs.status = 'draft';
    }

    if (!apiObs.creatorId) apiObs.creatorId = App.user?._id || App.user?.id;
    App.obstacles.push(apiObs);
    App.allObstacles.push(apiObs);
    if (typeof logAction === 'function') {
      // Un obstacle temporaire (chantier, etc.) est un TEMPDELTA au sens AIXM 5.2 :
      // sa présence n'est valide que jusqu'à sa date d'expiration.
      const temporality = apiObs.temporal !== 'permanent' ? 'TEMPDELTA' : 'BASELINE';
      logAction('creation', 'obstacle', apiObs.name, apiObs.perce ? 'Pénétration détectée' : 'Conforme', temporality);
    }
    showToast(`Obstacle « ${apiObs.name} » sauvegardé et évalué`, 'success');
    addToSessionList(apiObs);

    filterObstacles();
    updateObstaclesLayer();
    updateConformityPanel();
    return apiObs;
  } catch (e) {
    showToast('Erreur API : ' + e.message, 'error');
    console.error('[createAndEvaluateObstacle]', e);
    return null;
  }
}

/** Isole les attributs étendus (hors champs de base) pour affichage/CSV */
function extractExtendedAttributes(payload) {
  const baseKeys = ['aerodrome_id', 'nom', 'proprietaire', 'type_obstacle', 'geometrie',
    'altitude_max', 'hauteur', 'zone_de_couverture', 'permanence', 'date_expiration'];
  const ext = {};
  Object.keys(payload).forEach(k => { if (!baseKeys.includes(k)) ext[k] = payload[k]; });
  return ext;
}

/* ══════════════════════════════════════════════════════════
   AFFICHAGE RÉSULTAT ÉVALUATION OLS
   @param obs      — obstacle normalisé
   @param evalData — evalRes.data : { perce, statut_resultant, percements, surfaces_testees }
══════════════════════════════════════════════════════════ */
function displayEvalResult(obs, evalData) {
  const mainEl = document.getElementById('conf-main-status');
  const subEl = document.getElementById('conf-sub');
  const surfListEl = document.getElementById('conf-surfaces-list');
  if (!mainEl) return;

  // Le tableau `percements` renvoyé par POST /obstacles/:id/evaluer est
  // systématiquement vide côté backend (doc §7.8) — la liste des surfaces
  // réellement percées est donc recalculée côté client (obstacles-geometry.js).
  const breached = (typeof computeBreachedSurfaces === 'function') ? computeBreachedSurfaces(obs) : [];

  if (evalData.perce) {
    mainEl.textContent = 'NON CONFORME';
    mainEl.style.setProperty('color', '#FF1744', 'important');
    const surfNames = breached.map(b => b.label).join(', ');
    subEl.textContent = `${breached.length} SURFACE(S) PÉNÉTRÉE(S)${surfNames ? ' — ' + surfNames : ''}`;
  } else {
    mainEl.textContent = 'CONFORME';
    mainEl.style.setProperty('color', '#00E676', 'important');
    let geomLine = '';
    if (typeof computeObstacleClearance === 'function') {
      const { clearanceM, admissibleM, surfaceLabel, horsSurfaces } = computeObstacleClearance(obs);
      if (horsSurfaces) {
        geomLine = ' — HORS SURFACES OLS';
      } else if (admissibleM != null && clearanceM != null) {
        geomLine = ` — Dégagement : +${clearanceM.toFixed(1)} m (${surfaceLabel || '—'})`;
      }
    }
    subEl.textContent = `${evalData.surfaces_testees || evalData.surfaces_testées || 0} SURFACES TESTÉES${geomLine}`;
  }

  renderSurfacesBreachTable(surfListEl, obs);
}

/** Construit le tableau des surfaces percées avec dépassement en mètres, à partir de computeBreachedSurfaces(obs) */
function renderSurfacesBreachTable(surfListEl, obs) {
  if (!surfListEl) return;
  const breached = (typeof computeBreachedSurfaces === 'function' && obs) ? computeBreachedSurfaces(obs) : [];
  if (breached.length) {
    surfListEl.innerHTML = breached.map(b => {
      const obsM = (obs.altitude || 0) * 0.3048;
      return `<div class="conf-surface-row breach">
        <span class="conf-surf-name">${b.label}</span>
        <span>—</span>
        <span>${b.sommetM.toFixed(1)} m</span>
        <span>${obsM.toFixed(1)} m</span>
        <span class="conf-surf-depass">−${b.depassementM.toFixed(1)} m</span>
        <span style="color:var(--danger)">✗</span>
      </div>`;
    }).join('');
  } else {
    surfListEl.innerHTML = '<div class="conf-surface-row empty"><span style="color:var(--green)">Aucune pénétration</span></div>';
  }
}

/* ══════════════════════════════════════════════════════════
   LISTE DES OBSTACLES
   GET /obstacles?aerodrome_id=:mongoId  (doc §7.3)
══════════════════════════════════════════════════════════ */
// État de la pagination
App.obstaclesPage = App.obstaclesPage || 1;
App.obstaclesTotalPages = 1;

async function loadObstaclesList() {
  const mongoId = App.aerodromeMongoId;
  if (!mongoId) return;
  try {
    const res = await apiFetch(`/obstacles?aerodrome_id=${mongoId}&page=${App.obstaclesPage}&limit=25&submitter=true`);
    const raw = res.data || (Array.isArray(res) ? res : []);
    App.allObstacles = raw.map(normalizeObstacleFromAPI);
    App.obstacles = [...App.allObstacles];
    
    // Déduction robuste du nombre total de pages
    const isFullPage = raw.length >= 25;
    if (res.pagination && res.pagination.totalPages) App.obstaclesTotalPages = res.pagination.totalPages;
    else if (res.totalPages) App.obstaclesTotalPages = res.totalPages;
    else if (res.total_pages) App.obstaclesTotalPages = res.total_pages;
    else if (typeof res.total === 'number') App.obstaclesTotalPages = Math.ceil(res.total / 25) || 1;
    else if (isFullPage) App.obstaclesTotalPages = App.obstaclesPage + 1; // Fallback
    else App.obstaclesTotalPages = App.obstaclesPage;
    
    updatePaginationUI();

    // Vérification des échéances
    const now = new Date();
    const expiredCount = App.allObstacles.filter(obs => {
      if (obs.temporal === 'permanent' || !obs.temporal || !obs.expiry) return false;
      return Math.ceil((new Date(obs.expiry) - now) / 86400000) < 0;
    }).length;
    const soonCount = App.allObstacles.filter(obs => {
      if (obs.temporal === 'permanent' || !obs.temporal || !obs.expiry) return false;
      const d = Math.ceil((new Date(obs.expiry) - now) / 86400000);
      return d >= 0 && d <= 3;
    }).length;
    if (expiredCount > 0) showToast(`Attention : ${expiredCount} obstacle(s) temporaire(s) expiré(s) !`, 'error');
    if (soonCount > 0) showToast(`Attention : ${soonCount} obstacle(s) à échéance dans moins de 3 jours !`, 'warn');

    // fetchObstacleCreators() supprimé car le backend inclut 'createur' via submitter=true

    filterObstacles();
    updateObstaclesLayer();
    updateConformityPanel();

    await reconcileObstacleVerdicts();

    // Pré-chargement silencieux des événements pour accélérer
    // l'onglet Archive et le bouton HISTORIQUE
    if (!App.cachedEvents) {
      apiFetch('/evenements').then(r => { App.cachedEvents = r.data || []; }).catch(() => { });
    }
  } catch (e) {
    console.warn('[loadObstaclesList]', e);
    filterObstacles();
  }
}

function changeObstaclesPage(delta) {
  const newPage = App.obstaclesPage + delta;
  if (newPage < 1 || newPage > App.obstaclesTotalPages) return;
  App.obstaclesPage = newPage;
  loadObstaclesList();
}

function updatePaginationUI() {
  const paginationDiv = document.getElementById('obstacles-pagination');
  const btnPrev = document.getElementById('btn-prev-page');
  const btnNext = document.getElementById('btn-next-page');
  const info = document.getElementById('pagination-info');
  
  if (!paginationDiv) return;
  
  paginationDiv.style.display = 'flex';
  info.textContent = `Page ${App.obstaclesPage || 1} sur ${App.obstaclesTotalPages || 1}`;
  
  btnPrev.disabled = App.obstaclesPage <= 1;
  btnNext.disabled = App.obstaclesPage >= (App.obstaclesTotalPages || 1);
}


/**
 * Recharge le verdict OLS authoritatif (perce / percements) depuis le backend
 * pour tout obstacle dont le statut n'a pas été renvoyé par GET /obstacles.
 * Corrige le bug où un obstacle non conforme apparaissait conforme après
 * une déconnexion / reconnexion (le verdict n'étant pas persisté côté liste).
 */
async function reconcileObstacleVerdicts() {
  const toReconcile = App.allObstacles.filter(o => o.perce === undefined || o.perce === null);
  if (!toReconcile.length) return;

  await Promise.all(toReconcile.map(async (obs) => {
    try {
      const evalRes = await apiFetch('/obstacles/' + obs._id + '/evaluer', 'POST');
      const evalData = evalRes.data || {};
      if (evalData.perce !== undefined) obs.perce = evalData.perce;
      if (evalData.percements) obs.percements = evalData.percements;
      if (evalData.statut_resultant) {
        const newStatus = normalizeStatusBack(evalData.statut_resultant);
        // Ne pas écraser un statut de workflow déjà avancé (validé/en attente)
        // si le backend ne renvoie que le statut "brut" de l'évaluation.
        if (obs.status === 'draft' || !obs.status) obs.status = newStatus;
      }
      // Répercuter sur App.obstacles (référence différente après filterObstacles)
      const ref = App.obstacles.find(o => o._id === obs._id);
      if (ref) { ref.perce = obs.perce; ref.percements = obs.percements; }
    } catch (e) {
      console.warn('[reconcileObstacleVerdicts]', obs._id, e.message);
    }
  }));

  filterObstacles();
  updateObstaclesLayer();
  updateConformityPanel();
}

/**
 * Évalue si un obstacle pénètre une surface OLS.
 *
 * Priorité au calcul géométrique client (Turf.js, point-in-polygon) quand
 * les surfaces OLS sont chargées — ce calcul est cohérent avec le panneau
 * de détail (dégagement, tableau des surfaces percées) et plus fiable que
 * le champ `perce` du backend qui peut être obsolète ou mal calculé.
 *
 * Fallback sur obs.perce (verdict backend) uniquement si la géométrie
 * n'est pas encore disponible (surfaces non chargées, Turf.js absent,
 * coordonnées manquantes).
 */
function checkPenetration(obs) {
  // ── Calcul géométrique client (prioritaire) ──────────────────────────────
  if (typeof computeBreachedSurfaces === 'function' &&
    typeof turf !== 'undefined' &&
    typeof GeoMap !== 'undefined' && GeoMap.surfacesGeoJSON?.features?.length > 0 &&
    obs.latitude != null && obs.longitude != null) {
    return computeBreachedSurfaces(obs).length > 0;
  }
  // ── Fallback : verdict backend ────────────────────────────────────────────
  if (obs.perce !== undefined && obs.perce !== null) return obs.perce;
  // ── Aucune donnée disponible : CONFORME par défaut ───────────────────────
  return false;

}



/** Génère le HTML du tableau des obstacles et met à jour le panneau de conformité */
function renderObstaclesList(list) {
  const tbody = document.getElementById('obs-list-tbody');
  if (!tbody) return;


  // Colonne 'SOUMIS PAR' visible uniquement pour l'admin (indépendamment
  // du toggle "afficher tous" — règle métier : admin-only, pas admin+toggle)
  const isAdmin = getIsAdmin();
  const showSoumis = isAdmin;
  const soumisColHeader = document.getElementById('obs-col-soumis');
  if (soumisColHeader) soumisColHeader.style.display = showSoumis ? '' : 'none';

  if (!list.length) {
    tbody.innerHTML = `<tr class="table-placeholder"><td colspan="${showSoumis ? 16 : 15}">Aucun obstacle trouvé</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(obs => {
    // Verdict OLS ne dépend PLUS du status (qui est juste le workflow)
    const penetrates = checkPenetration(obs);
    const verdict = penetrates
      ? '<span class="tag tag-fail">PÉNÉTRATION</span>'
      : '<span class="tag tag-pass">CONFORME</span>';

    const statusTag = `<span class="tag tag-${obs.status || 'draft'}">${statusLabel(obs.status)}</span>`;
    const temporal = buildTemporalBadge(obs);
    const expiryBadge = buildExpiryBadge(obs);
    const clearance = (typeof formatClearanceBadge === 'function') ? formatClearanceBadge(obs) : '—';
    let soumisInfo = '—';
    if (obs.createur) {
      const u = obs.createur;
      const nom = [u.prenom, u.nom].filter(Boolean).join(' ').trim() || u.username || u.name || u.nomComplet || '';
      soumisInfo = nom ? `${nom}${u.email ? ' — ' + u.email : ''}` : (u.email || '—');
    }
    const soumisCell = showSoumis
      ? `<td style="font-size:10px;color:var(--text-secondary);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${soumisInfo}">${soumisInfo}</td>`
      : '';
    // Surface(s) concernée(s) — on ne garde que la surface déterminante (celle avec le pire dépassement)
    const breachedSurfs = (typeof computeBreachedSurfaces === 'function') ? computeBreachedSurfaces(obs) : [];
    const worstSurface = breachedSurfs.length
      ? [breachedSurfs.reduce((max, b) => (b.depassementM > max.depassementM ? b : max), breachedSurfs[0])]
      : [];

    // Palette couleur par famille de surface OLS
    const surfaceColor = (label = '') => {
      const l = label.toLowerCase();
      if (l.includes('approche') || l.includes('approch'))
        return { bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.30)', color: '#991B1B' };
      if (l.includes('décollage') || l.includes('decollage') || l.includes('montée') || l.includes('montee'))
        return { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.30)', color: '#B45309' };
      if (l.includes('horizontale intérieure') || l.includes('horizontale interieure'))
        return { bg: 'rgba(99,102,241,0.10)', border: 'rgba(99,102,241,0.30)', color: '#4338CA' };
      if (l.includes('horizontale'))
        return { bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.25)', color: '#4338CA' };
      if (l.includes('conique'))
        return { bg: 'rgba(14,165,233,0.10)', border: 'rgba(14,165,233,0.30)', color: '#0369A1' };
      if (l.includes('transition'))
        return { bg: 'rgba(168,85,247,0.10)', border: 'rgba(168,85,247,0.30)', color: '#7E22CE' };
      if (l.includes('bande') || l.includes('resa'))
        return { bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.30)', color: '#065F46' };
      // défaut rouge doux
      return { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.20)', color: '#991B1B' };
    };

    const surfaceCell = worstSurface.length
      ? `<div class="surface-tags-cell">${worstSurface.map(b => {
        const c = surfaceColor(b.label);
        return `<span class="surface-tag-pill" style="background:${c.bg};border-color:${c.border};color:${c.color};"
            title="Dépassement : ${b.depassementM != null ? b.depassementM.toFixed(1) + ' m' : 'N/A'}">
            <span class="surface-tag-dot" style="background:${c.color};"></span>${b.label}
          </span>`;
      }).join('')}</div>`
      : `<span class="surface-tag-none ${penetrates ? 'surface-tag-unknown' : 'surface-tag-ok'}">—</span>`;
    return `<tr>
      <td style="font-weight:600;">${obs.name}</td>
      <td>${typeToLabel(obs.type)}</td>
      <td style="font-size:11px;color:var(--cyan);">${obs.proprietaire || '—'}</td>
      <td class="mono" title="${obs.latitude != null ? ddToDms(obs.latitude, 'lat') : ''}">${obs.latitude != null ? obs.latitude.toFixed(6) : '—'}</td>
      <td class="mono" title="${obs.longitude != null ? ddToDms(obs.longitude, 'lon') : ''}">${obs.longitude != null ? obs.longitude.toFixed(6) : '—'}</td>
      <td class="mono">${obs.altitude != null ? (obs.altitude * 0.3048).toFixed(1) : '—'}</td>
      <td class="mono">${obs.height != null && obs.height !== 0 ? (obs.height * 0.3048).toFixed(1) : '—'}</td>
      <td>${temporal}</td>
      <td>${expiryBadge}</td>
      <td>${verdict}</td>
      <td>${clearance}</td>
      <td>${surfaceCell}</td>
      <td>${buildActionSelect(obs)}</td>
      <td>${statusTag}</td>
      ${soumisCell}
      <td><div class="action-group">${buildWorkflowActions(obs)}</div></td>
    </tr>`;
  }).join('');


  const pending = list.filter(o => o.status === 'pending').length;
  const pendingEl = document.getElementById('pending-count');
  if (pendingEl) pendingEl.textContent = pending;
  renderPendingList(list.filter(o => o.status === 'pending'));
}

/**
 * Construit le badge temporel : PERM, TEMP (avec jours restants), À SURVEILLER
 * (projet de construction) ou EXPIRÉ (temporaire dont la date est dépassée).
 * Répond au retour utilisateur n°9 (suivi d'un obstacle temporaire) et n°15
 * (voyant de surveillance pour un projet de construction en cours).
 */
function buildTemporalBadge(obs) {
  if (obs.temporal === 'permanent' || !obs.temporal) {
    return `<span class="tag tag-info">PERM</span>`;
  }
  return `<span class="tag tag-warn">TEMP</span>`;
}

/**
 * Construit le badge de la colonne ÉCHÉANCE — uniquement pour les temporaires.
 * Retourne une cellule vide pour les permanents.
 */
function buildExpiryBadge(obs) {
  if (obs.temporal === 'permanent' || !obs.temporal) return '<span style="color:var(--text-dim)">—</span>';
  if (!obs.expiry) return '<span style="color:var(--text-dim)">—</span>';

  const now = new Date();
  const exp = new Date(obs.expiry);
  if (isNaN(exp.getTime())) return '<span style="color:var(--text-dim)">—</span>';

  const daysLeft = Math.ceil((exp - now) / 86400000);
  const dateStr = exp.toLocaleDateString('fr-FR');

  if (daysLeft < 0) {
    return `<span class="expiry-badge expiry-critical" title="Expiré le ${dateStr}"><span class="expiry-icon">🔴</span>EXPIRÉ — ${dateStr}</span>`;
  }
  if (daysLeft <= 3) {
    return `<span class="expiry-badge expiry-warn" title="Echéance dans ${daysLeft} jour(s)"><span class="expiry-icon">⚠️</span>${dateStr} • J-${daysLeft}</span>`;
  }
  return `<span class="expiry-badge expiry-ok">${dateStr}</span>`;
}


/** Sélecteur en ligne pour l'état de balisage (conforme / satisfaisant / non conforme) — retour n°11 */
function buildBalisageSelect(obs) {
  const opts = [
    { v: '', l: '—' },
    { v: 'conforme', l: 'Conforme' },
    { v: 'satisfaisant', l: 'Satisfaisant' },
    { v: 'non_conforme', l: 'Non conforme' },
  ];
  const current = obs.balisageEtat || '';
  return `<select class="field-select inline-select" style="font-size:11px;padding:3px 5px;"
      onchange="updateObstacleBalisage('${obs._id}', this.value)">
      ${opts.map(o => `<option value="${o.v}" ${o.v === current ? 'selected' : ''}>${o.l}</option>`).join('')}
    </select>`;
}

/** Sélecteur en ligne pour l'action recommandée (supprimer / réduire / baliser / sans action) — retour n°14 */
function buildActionSelect(obs) {
  const opts = [
    { v: '', l: '—' },
    { v: 'supprimer', l: 'Supprimer' },
    { v: 'reduire', l: 'Réduire' },
    { v: 'baliser', l: 'Baliser' },
    { v: 'sans_action', l: 'Sans action' },
  ];
  const current = obs.actionRecommandee || '';
  return `<select class="field-select inline-select" style="font-size:11px;padding:3px 5px;"
      onchange="updateObstacleAction('${obs._id}', this.value)">
      ${opts.map(o => `<option value="${o.v}" ${o.v === current ? 'selected' : ''}>${o.l}</option>`).join('')}
    </select>`;
}

/** Applique les filtres de recherche sur la liste des obstacles */
function filterObstacles() {
  const search = (document.getElementById('obs-search').value || '').toLowerCase();
  const status = document.getElementById('obs-filter-status').value;
  const type = document.getElementById('obs-filter-type').value;
  const breach = document.getElementById('obs-filter-breach').checked;

  const isAdmin = getIsAdmin();
  // L'_id utilisateur peut être sous forme string ou dans user._id / user.id
  const myUserId = String(App.user?._id || App.user?.id || '');

  // Normalise un creatorId (string, ObjectId, ou objet populé) en string comparable
  const normalizeId = (id) => {
    if (!id) return '';
    if (typeof id === 'object') return String(id._id || id.id || id);
    return String(id);
  };

  // Admin avec toggle "tous" → tout voir. Sinon → ses propres obstacles seulement
  const baseList = (App.showAllObstacles && isAdmin)
    ? App.allObstacles
    : App.allObstacles.filter(o => normalizeId(o.creatorId) === myUserId);

  const filteredList = baseList.filter(obs => {
    if (search && !obs.name.toLowerCase().includes(search)) return false;
    if (status && obs.status !== status) return false;
    if (type && obs.type !== type) return false;
    if (breach && !checkPenetration(obs)) return false;
    return true;
  });

  // Met à jour la liste affichée
  renderObstaclesList(filteredList);

  // Met à jour la carte 3D avec les mêmes obstacles
  App.obstacles = filteredList;
  if (typeof updateObstaclesLayer === 'function') {
    updateObstaclesLayer();
  }
}

/** Toggle l'affichage global des obstacles (Admin) */
window.toggleAllObstacles = function () {
  App.showAllObstacles = !App.showAllObstacles;
  const btnText = document.getElementById('btn-toggle-all-obs-text');
  if (btnText) {
    btnText.textContent = App.showAllObstacles ? 'MES OBSTACLES SOUMIS' : 'AFFICHER TOUS LES OBSTACLES';
  }
  filterObstacles();
};

/** Construit les boutons d'action workflow selon le statut de l'obstacle */
function buildWorkflowActions(obs) {
  const actions = [];
  const isAdmin = typeof getIsAdmin === 'function' ? getIsAdmin() : false;
  const isEvaluator = typeof getIsEvaluator === 'function' ? getIsEvaluator() : false;
  const isDataTech = typeof getIsDataTech === 'function' ? getIsDataTech() : false;

  // Historique des événements
  actions.push(`<button class="action-btn" onclick="showObstacleHistory('${obs._id}', '${(obs.name || '').replace(/'/g, "\\'")}')" title="Historique des événements">HISTORIQUE</button>`);

  // Voir le détail de pénétration
  actions.push(`<button class="action-btn" onclick="showObstacleConformityDetail('${obs._id}')" title="Détail conformité">DÉTAIL</button>`);

  // Rapport PDF individuel
  actions.push(`<button class="action-btn pdf-btn" onclick="generatePdfReportSingle('${obs._id}')" title="Rapport PDF de cet obstacle">PDF</button>`);

  // Édition des attributs (Admin, Data Technician, Evaluator)
  if (isAdmin || isDataTech || isEvaluator) {
    actions.push(`<button class="action-btn" onclick="editObstacle('${obs._id}')" title="Modifier l'obstacle">MODIFIER</button>`);
  }

  // Soumettre
  if (obs.status === 'draft' && (isAdmin || isDataTech || isEvaluator)) {
    actions.push(`<button class="action-btn pending" onclick="setObstacleStatus('${obs._id}','pending')">SOUMETTRE</button>`);
  }

  // Évaluer (OLS) — Suppression demandée car l'évaluation est automatique à la création/modification

  // Valider ou Rejeter (Admin, Evaluator)
  if (obs.status === 'pending' && (isAdmin || isEvaluator)) {
    actions.push(`<button class="action-btn validate" onclick="setObstacleStatus('${obs._id}','validated')">VALIDER</button>`);
    actions.push(`<button class="action-btn reject"   onclick="setObstacleStatus('${obs._id}','draft')">REJETER</button>`);
  }

  // Supprimer (Tous les rôles d'édition)
  if (isAdmin || isDataTech || isEvaluator) {
    actions.push(`<button class="action-btn delete" onclick="confirmDelete('${obs._id}','${obs.name.replace(/'/g, "\\'")}')">✕</button>`);
  }
  return actions.join('');
}

async function showObstacleHistory(id, name) {
  try {
    // Toujours interroger le backend pour être sûr d'avoir l'historique complet de ce document spécifique
    const res = await apiFetch(`/evenements?document_id=${id}`);
    const events = res.data || [];

    if (!events.length) {
      showToast('Aucun historique trouvé pour cet obstacle.', 'info');
      return;
    }

    const ACTION_LABELS = { CREATE: 'Création', UPDATE: 'Modification', DELETE: 'Suppression', UNDELETE: 'Restauration' };
    const ACTION_CLASSES = { CREATE: 'tag-pass ev-create', UPDATE: 'tag-info', DELETE: 'tag-fail ev-delete', UNDELETE: 'tag-warn' };


    let html = `<div style="max-height:65vh; overflow-y:auto; padding:2px 4px;">`;
    let idx = 0;
    events.forEach(ev => {
      const date = new Date(ev.date_heure || ev.createdAt).toLocaleString('fr-FR');
      const auteur = ev.auteur || ev.utilisateur_id?.email || 'Système';
      
      let actionClass = 'tag-info';
      const actionStr = (ev.action || ev.type_action || '').toLowerCase();
      if (actionStr.includes('création') || actionStr === 'create') actionClass = 'tag-pass ev-create';
      if (actionStr.includes('suppression') || actionStr === 'delete') actionClass = 'tag-fail ev-delete';
      
      const actionLabel = ev.action || ev.type_action || 'Action';
      const propsMods = Array.isArray(ev.proprietes_modifiees) ? ev.proprietes_modifiees : [];
      
      let summary = 'Modification technique';
      if (actionStr.includes('création') || actionStr === 'create') summary = 'Obstacle créé';
      else if (actionStr.includes('suppression') || actionStr === 'delete') summary = 'Obstacle supprimé';
      else if (propsMods.length > 0) summary = `Champs modifiés : ${propsMods.join(', ')}`;
      
      const evClass = actionClass.includes('ev-create') ? 'ev-create' : (actionClass.includes('ev-delete') ? 'ev-delete' : '');
      const eventId = ev.id || ev._id;

      html += `
        <div class="history-event-card">
          <div class="history-event-header">
            <span style="font-size:12px;font-weight:600;color:var(--text-primary);">${date}</span>
            <span class="tag ${actionClass}">${actionLabel}</span>
          </div>
          <div class="history-event-meta">
            <svg viewBox="0 0 16 16" fill="none" width="11" height="11" style="vertical-align:middle;margin-right:3px;">
              <circle cx="8" cy="5" r="2.5" stroke="currentColor" stroke-width="1.3"/>
              <path d="M2 14c0-3 2.5-5 6-5s6 2 6 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
            ${auteur}
          </div>
          <div class="history-event-summary ${evClass}">${summary}</div>
          ${eventId ? `
          <button class="history-toggle-detail" onclick="showEventDetails('${eventId}')">▶ Voir le détail des modifications</button>
          ` : ''}
        </div>
      `;
    });
    html += `</div>`;

    showModal(`Historique : ${name} (${events.length} événement${events.length > 1 ? 's' : ''})`, html);
  } catch (err) {
    console.error('[showObstacleHistory]', err);
    showToast('Erreur lors du chargement de l\'historique.', 'error');
  }
}

/**
 * Fonction explicite pour déclencher l'évaluation OLS d'un obstacle
 */
async function evaluerObstacle(id) {
  try {
    const res = await apiFetch(`/obstacles/${id}/evaluer`, 'POST');
    const evalData = res.data || {};
    showToast('Évaluation OLS terminée.', 'info');
    // Rafraîchir les obstacles pour voir le statut final
    if (typeof loadObstaclesList === 'function') loadObstaclesList();
  } catch (e) {
    showToast("Erreur lors de l'évaluation : " + e.message, 'error');
  }
}

/** Affiche le détail de conformité (surfaces percées, dépassement en m) d'un obstacle dans le panneau de droite */
function showObstacleConformityDetail(id) {
  const obs = App.allObstacles.find(o => o._id === id);
  if (!obs) return;
  const tabBtn = document.getElementById('tab-btn-analyse');
  if (tabBtn) switchTab(tabBtn, 'analyse');

  const mainEl = document.getElementById('conf-main-status');
  const subEl = document.getElementById('conf-sub');
  const surfListEl = document.getElementById('conf-surfaces-list');
  const penetrates = checkPenetration(obs);

  if (mainEl) {
    mainEl.textContent = penetrates ? 'NON CONFORME' : 'CONFORME';
    mainEl.style.setProperty('color', penetrates ? '#FF1744' : '#00E676', 'important');
  }

  // Dégagement / altitude admissible / surface concernée — retours n°3, n°4, n°5
  // (calcul géométrique client, cf. obstacles-geometry.js)
  let geomLine = '';
  if (typeof computeObstacleClearance === 'function') {
    const { clearanceM, admissibleM, surfaceLabel, horsSurfaces } = computeObstacleClearance(obs);
    const breached = (typeof computeBreachedSurfaces === 'function') ? computeBreachedSurfaces(obs) : [];

    if (horsSurfaces) {
      geomLine = ' — HORS SURFACES OLS (aucune surface ne couvre cette position)';
    } else if (admissibleM != null) {
      geomLine = clearanceM >= 0
        ? ` — CONFORME · Dégagement min : +${clearanceM.toFixed(1)} m (Surface limitante : ${surfaceLabel || '—'})`
        : ` — ${breached.length} SURFACE(S) PÉNÉTRÉE(S) · Dépassement max : ${Math.abs(clearanceM).toFixed(1)} m (Surface la plus critique : ${surfaceLabel || '—'})`;
    }
  }

  let tempLine = '';
  if (obs.temporal === 'temporary' || obs.temporal === 'construction') {
    if (obs.expiry) {
      const expDate = new Date(obs.expiry).toLocaleDateString('fr-FR');
      const isExpired = new Date(obs.expiry) < new Date();
      tempLine = ` — [TEMP. Échéance : ${expDate}${isExpired ? ' ⚠️ EXPIRÉ' : ''}]`;
    } else {
      tempLine = ` — [TEMP.]`;
    }
  }

  if (subEl) subEl.textContent = `OBSTACLE : ${obs.name}${tempLine}${geomLine}`;
  renderSurfacesBreachTable(surfListEl, obs);
}

/* ══════════════════════════════════════════════════════════
   WORKFLOW STATUT
   PATCH /obstacles/:id { statut_validation: ... }  (doc §7.6)
══════════════════════════════════════════════════════════ */
async function setObstacleStatus(id, newStatus) {
  const backendStatus = { draft: 'Draft', pending: 'Pending', validated: 'Validated' }[newStatus] || newStatus;
  try {
    let patchPayload = { statut_validation: backendStatus };
    try {
      const getRes = await apiFetch(`/obstacles/${id}`);
      const obsData = getRes.data || getRes.obstacle || getRes || {};
      if (obsData.frangibilite == null) patchPayload.frangibilite = false;
      if (obsData.mobilite == null) patchPayload.mobilite = 'Fixe';
      if (obsData.balisage == null) patchPayload.balisage = { jour: [], nuit: [] };
      if (obsData.hauteur == null) patchPayload.hauteur = 0;
      if (obsData.zone_de_couverture == null) patchPayload.zone_de_couverture = '3';
    } catch(e) {}
    await apiFetch(`/obstacles/${id}`, 'PATCH', patchPayload);
  } catch (e) {
    console.warn('[setObstacleStatus]', e);
  }
  [App.allObstacles, App.obstacles].forEach(arr => {
    const o = arr.find(o => o._id === id);
    if (o) o.status = newStatus;
  });
  const obsRef = App.allObstacles.find(o => o._id === id);
  if (typeof logAction === 'function') {
    logAction('statut', 'obstacle', obsRef?.name || id, `Nouveau statut : ${statusLabel(newStatus)}`);
  }
  showToast(`Statut mis à jour : ${statusLabel(newStatus)}`, 'success');
  filterObstacles(); // Respecte le filtrage par utilisateur
  renderPendingList(App.allObstacles.filter(o => o.status === 'pending'));
  updateObstaclesLayer();
  updateConformityPanel();
}

/* ══════════════════════════════════════════════════════════
   SUPPRESSION (soft delete)
   DELETE /obstacles/:id  (doc §7.7)
   Suppression logique uniquement (is_deleted: true)
══════════════════════════════════════════════════════════ */
function confirmDelete(id, name) {
  showModal(
    "Supprimer l'obstacle",
    `Confirmer la suppression de <strong>${name}</strong> ?<br>Cette action est irréversible.`,
    async () => {
      try { await apiFetch(`/obstacles/${id}`, 'DELETE'); } catch (e) { /* soft delete, pas critique */ }
      App.obstacles = App.obstacles.filter(o => o._id !== id);
      App.allObstacles = App.allObstacles.filter(o => o._id !== id);
      if (typeof logAction === 'function') logAction('suppression', 'obstacle', name, '', 'PERMDELTA');
      showToast('Obstacle supprimé', 'success');
      renderObstaclesList(App.allObstacles);
      updateObstaclesLayer();
      updateConformityPanel();
    }
  );
}

/** Affiche la liste des obstacles en attente de validation dans le panneau de droite */
function renderPendingList(list) {
  const el = document.getElementById('pending-list');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<span class="empty-msg">Aucun élément en attente</span>';
    return;
  }
  el.innerHTML = list.map(obs =>
    `<div class="expiry-item warning">
      <span class="expiry-name">${obs.name}</span>
      <span class="expiry-date">${typeToLabel(obs.type)} — En attente validation</span>
    </div>`
  ).join('');
}

/* ══════════════════════════════════════════════════════════
   ÉTAT DE BALISAGE / ACTION RECOMMANDÉE — mise à jour en ligne
   PATCH /obstacles/:id { balisage_etat | action_recommandee }
   Retours utilisateurs n°11 et n°14. Persisté localement dans tous
   les cas (App.allObstacles) même si le backend ne connaît pas
   encore ces champs, pour ne pas perdre la saisie de l'utilisateur.
══════════════════════════════════════════════════════════ */
async function updateObstacleBalisage(id, value) {
  try {
    let patchPayload = { balisage_etat: value };
    try {
      const getRes = await apiFetch(`/obstacles/${id}`);
      const obsData = getRes.data || getRes.obstacle || getRes || {};
      if (obsData.frangibilite === undefined) patchPayload.frangibilite = false;
      if (obsData.mobilite === undefined) patchPayload.mobilite = 'Fixe';
      if (obsData.balisage === undefined) patchPayload.balisage = { jour: [], nuit: [] };
      if (obsData.hauteur === undefined) patchPayload.hauteur = 0;
    } catch(e) {}
    await apiFetch(`/obstacles/${id}`, 'PATCH', patchPayload);
  }
  catch (e) { console.warn('[updateObstacleBalisage] backend indisponible pour ce champ', e.message); }
  const obs = App.allObstacles.find(o => o._id === id);
  if (obs) obs.balisageEtat = value || null;
  const balisageLabels = { conforme: 'Conforme', satisfaisant: 'Satisfaisant', non_conforme: 'Non conforme' };
  if (typeof logAction === 'function') {
    logAction('balisage', 'obstacle', obs?.name || id, `État de balisage : ${balisageLabels[value] || '—'}`);
  }
  showToast('État de balisage mis à jour', 'success');
}

async function updateObstacleAction(id, value) {
  try {
    let patchPayload = { action_recommandee: value };
    try {
      const getRes = await apiFetch(`/obstacles/${id}`);
      const obsData = getRes.data || getRes.obstacle || getRes || {};
      if (obsData.frangibilite === undefined) patchPayload.frangibilite = false;
      if (obsData.mobilite === undefined) patchPayload.mobilite = 'Fixe';
      if (obsData.balisage === undefined) patchPayload.balisage = { jour: [], nuit: [] };
      if (obsData.hauteur === undefined) patchPayload.hauteur = 0;
    } catch(e) {}
    await apiFetch(`/obstacles/${id}`, 'PATCH', patchPayload);
  }
  catch (e) { console.warn('[updateObstacleAction] backend indisponible pour ce champ', e.message); }
  const obs = App.allObstacles.find(o => o._id === id);
  if (obs) obs.actionRecommandee = value || null;
  const actionLabels = { supprimer: 'Supprimer', reduire: 'Réduire', baliser: 'Baliser', sans_action: 'Sans action' };
  if (typeof logAction === 'function') {
    logAction('action_recommandee', 'obstacle', obs?.name || id, `Action recommandée : ${actionLabels[value] || '—'}`);
  }
  showToast('Action recommandée mise à jour', 'success');
}

/* ══════════════════════════════════════════════════════════
   ÉDITION D'UN OBSTACLE EXISTANT — retour utilisateur n°10 et n°18
   Réutilise la page de saisie complète (voir obstacle-entry-page.js)
   en mode édition : PATCH /obstacles/:id puis ré-évaluation OLS.
══════════════════════════════════════════════════════════ */
async function updateObstacle(id, payload) {
  try {
    // Pour éviter les erreurs de validation (Mongoose) sur les anciens obstacles qui n'ont pas
    // les nouveaux attributs requis, on récupère l'obstacle actuel depuis la base.
    let existingObs = {};
    try {
      const getRes = await apiFetch(`/obstacles/${id}`);
      existingObs = getRes.data || getRes.obstacle || getRes || {};
    } catch (err) {
      console.warn('[updateObstacle] Impossible de pré-charger l\'obstacle existant', err.message);
    }

    // On complète le payload avec des valeurs par défaut pour les champs requis manquants
    // (ou nuls) dans l'ancien document, pour éviter les CastError/ValidationError de Mongoose.
    const patchPayload = { ...payload };
    if (existingObs.frangibilite == null && patchPayload.frangibilite == null) patchPayload.frangibilite = false;
    if (existingObs.mobilite == null && patchPayload.mobilite == null) patchPayload.mobilite = 'Fixe';
    if (existingObs.balisage == null && patchPayload.balisage == null) patchPayload.balisage = { jour: [], nuit: [] };
    if (existingObs.hauteur == null && patchPayload.hauteur == null) patchPayload.hauteur = 0;
    // Forcer une valeur par défaut pour la zone si manquante et nulle part ailleurs
    if (existingObs.zone_de_couverture == null && patchPayload.zone_de_couverture == null) patchPayload.zone_de_couverture = '3';

    // Correction cruciale : Lors d'un PATCH de Permanent vers Temporaire, Mongoose ne génère pas 
    // automatiquement les dates de début par défaut (contrairement au POST). Si elles sont requises, 
    // la validation échoue. On les injecte donc manuellement.
    if (patchPayload.permanence === 'Temporaire' || patchPayload.type_temporel !== 'permanent') {
      const now = new Date().toISOString();
      if (!existingObs.date_debut_validite && !patchPayload.date_debut_validite) patchPayload.date_debut_validite = now;
      if (!existingObs.date_debut && !patchPayload.date_debut) patchPayload.date_debut = now;
      if (!existingObs.date_heure_releve && !patchPayload.date_heure_releve) patchPayload.date_heure_releve = now;
    }

    const res = await apiFetch(`/obstacles/${id}`, 'PATCH', patchPayload);
    const apiObs = normalizeObstacleFromAPI(res.data || { ...patchPayload, _id: id });

    if (payload.date_echeance && !apiObs.expiry) {
      apiObs.expiry = payload.date_echeance;
    }

    const updated = {
      ...apiObs,
      latitude: (apiObs.latitude !== null && !isNaN(apiObs.latitude)) ? apiObs.latitude : (payload.latitude || payload.geometrie?.coordinates[1]),
      longitude: (apiObs.longitude !== null && !isNaN(apiObs.longitude)) ? apiObs.longitude : (payload.longitude || payload.geometrie?.coordinates[0]),
    };
    updated._id = id;

    // Ré-évaluer après modification (réservé Admin et Evaluator)
    const isAdmin = typeof getIsAdmin === 'function' ? getIsAdmin() : false;
    const isEvaluator = typeof getIsEvaluator === 'function' ? getIsEvaluator() : false;

    if (isAdmin || isEvaluator) {
      try {
        const evalRes = await apiFetch(`/obstacles/${id}/evaluer`, 'POST');
        const evalData = evalRes.data || {};
        if (evalData.statut_resultant) updated.status = normalizeStatusBack(evalData.statut_resultant);
        if (evalData.perce !== undefined) updated.perce = evalData.perce;
        if (evalData.percements) updated.percements = evalData.percements;
        displayEvalResult(updated, evalData);
      } catch (e) {
        console.warn('[updateObstacle] évaluation post-édition indisponible', e.message);
      }
    } else {
      // Data Technician: l'obstacle retourne automatiquement en "Pending" (backend)
      // Mettre à jour localement pour refléter le changement
      updated.status = 'pending';
    }

    [App.allObstacles, App.obstacles].forEach(arr => {
      const idx = arr.findIndex(o => o._id === id);
      if (idx !== -1) arr[idx] = { ...arr[idx], ...updated };
    });

    if (typeof logAction === 'function') logAction('modification', 'obstacle', updated.name, 'Édition des attributs');
    showToast(`Obstacle « ${updated.name} » modifié et réévalué`, 'success');

    filterObstacles();
    updateObstaclesLayer();
    updateConformityPanel();
    return updated;
  } catch (e) {
    showToast('Erreur lors de la modification : ' + e.message, 'error');
    console.error('[updateObstacle]', e);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════
   ÉVALUATION GLOBALE — retour utilisateur n°7
   Relance l'évaluation OLS de TOUS les obstacles de l'aérodrome
   courant en une seule opération (utile après un import CSV massif
   ou une modification de piste/surface).
══════════════════════════════════════════════════════════ */
async function evaluateAllObstacles() {
  if (!App.allObstacles.length) { showToast('Aucun obstacle à évaluer', 'warn'); return; }

  showToast(`Évaluation de ${App.allObstacles.length} obstacle(s) en cours…`, 'info');
  let ok = 0, failed = 0;

  await Promise.all(App.allObstacles.map(async (obs) => {
    try {
      const evalRes = await apiFetch(`/obstacles/${obs._id}/evaluer`, 'POST');
      const evalData = evalRes.data || {};
      if (evalData.perce !== undefined) obs.perce = evalData.perce;
      if (evalData.percements) obs.percements = evalData.percements;
      if (evalData.statut_resultant) obs.status = normalizeStatusBack(evalData.statut_resultant);
      ok++;
    } catch (e) {
      failed++;
      console.warn('[evaluateAllObstacles]', obs._id, e.message);
    }
  }));

  filterObstacles();
  updateObstaclesLayer();
  updateConformityPanel();
  if (typeof logAction === 'function') {
    logAction('modification', 'obstacle', `${App.allObstacles.length} obstacle(s)`, 'Évaluation globale relancée');
  }
  showToast(`Évaluation globale terminée — ${ok} réussie(s)${failed ? `, ${failed} échec(s)` : ''}`, failed ? 'warn' : 'success');
}

/* ══════════════════════════════════════════════════════════
   EXPORT CSV DES OBSTACLES EN PÉNÉTRATION — retour utilisateur n°8
   Répertorie, après une évaluation globale, tous les obstacles qui
   pénètrent une surface OLS et génère un fichier CSV.
══════════════════════════════════════════════════════════ */
function exportPenetrationsCsv() {
  const penetrating = App.allObstacles.filter(o => checkPenetration(o));
  if (!penetrating.length) { showToast('Aucun obstacle en pénétration à exporter', 'info'); return; }

  const header = ['nom', 'type', 'proprietaire', 'latitude', 'longitude', 'altitude_m', 'hauteur_m', 'surface(s)_penetree(s)', 'depassement_m', 'statut_balisage'];
  const rows = [header.join(',')];

  penetrating.forEach(obs => {
    const breached = (typeof computeBreachedSurfaces === 'function') ? computeBreachedSurfaces(obs) : [];
    const surfaces = breached.map(b => b.label).join(' / ');
    const depassements = breached.map(b => b.depassementM.toFixed(1)).join(' / ');
    const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    rows.push([
      csvEscape(obs.name), csvEscape(typeToLabel(obs.type)), csvEscape(obs.proprietaire || ''),
      obs.latitude?.toFixed(6) ?? '', obs.longitude?.toFixed(6) ?? '',
      obs.altitude != null ? (obs.altitude * 0.3048).toFixed(1) : '',
      obs.height ? (obs.height * 0.3048).toFixed(1) : '',
      csvEscape(surfaces), csvEscape(depassements), csvEscape(obs.balisageEtat || ''),
    ].join(','));
  });

  const blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sigobs_penetrations_${App.aerodrome?.icao || 'aerodrome'}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`${penetrating.length} obstacle(s) en pénétration exporté(s)`, 'success');
}

/* ══════════════════════════════════════════════════════════
   RAPPORT PDF
   Génère un rapport PDF complet de l'analyse OLS
   Utilise jsPDF (chargé via CDN dans index.html)
══════════════════════════════════════════════════════════ */
async function generatePdfReport() {
  if (!window.jspdf) { showToast('Génération PDF indisponible', 'error'); return; }
  if (!App.aerodrome) { showToast('Aérodrome non chargé', 'warn'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const now = new Date();
  const CYAN = [14, 165, 233], GREEN = [34, 197, 94], RED = [239, 68, 68];
  const BG = [255, 255, 255], DARK = [248, 250, 252], PANEL = [241, 245, 249];
  const TEXT = [15, 23, 42], DIM = [100, 116, 139];

  doc.setFillColor(...BG); doc.rect(0, 0, 297, 210, 'F');
  doc.setFillColor(...DARK); doc.rect(0, 0, 297, 28, 'F');
  doc.setDrawColor(...CYAN); doc.setLineWidth(0.5); doc.line(0, 28, 297, 28);
  doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(...CYAN);
  doc.text("RAPPORT D'ANALYSE OLS", 32, 12);
  doc.setFontSize(9); doc.setFont('courier', 'normal'); doc.setTextColor(...DIM);
  doc.text("ICAO ANNEXE 14 — SURFACES DE LIMITATION D'OBSTACLES", 32, 19);
  doc.setFontSize(8); doc.setTextColor(...TEXT);
  doc.text(`Généré le : ${now.toLocaleDateString('fr-FR')} ${now.toLocaleTimeString('fr-FR')}Z`, 287, 10, { align: 'right' });
  doc.text(`Opérateur : ${App.user?.email || '—'}`, 287, 16, { align: 'right' });

  let y = 36;
  const W = 277;
  const section = (n, title) => {
    doc.setFillColor(...PANEL); doc.rect(10, y, W, 8, 'F');
    doc.setTextColor(...CYAN); doc.setFont('courier', 'bold'); doc.setFontSize(11);
    doc.text(`${n}. ${title}`, 14, y + 5.5); y += 10;
  };
  const kv = (k, v, k2, v2) => {
    doc.setFontSize(10); doc.setFont('courier', 'bold'); doc.setTextColor(...DIM);
    doc.text(k, 14, y + 6);
    doc.setTextColor(...TEXT); doc.setFont('courier', 'normal'); doc.text(String(v), 60, y + 6);
    if (k2) {
      doc.setFont('courier', 'bold'); doc.setTextColor(...DIM); doc.text(k2, 160, y + 6);
      doc.setTextColor(...TEXT); doc.setFont('courier', 'normal'); doc.text(String(v2), 200, y + 6);
    }
    y += 9;
  };

  section('1', 'INFORMATIONS AÉRODROME');
  kv('OACI', App.aerodrome?.icao || '—', 'NOM', App.aerodrome?.name || '—');
  kv('ÉLÉVATION', `${App.aerodrome?.elevation != null ? (App.aerodrome.elevation * 0.3048).toFixed(1) : '—'} m`, 'PAYS', App.aerodrome?.country || '—');
  kv('VILLE', App.aerodrome?.city || '—', 'IATA', App.aerodrome?.iata || '—');

  y += 2; section('2', `OBSTACLES (${App.allObstacles.length} total)`);
  const penetrations = App.allObstacles.filter(o => checkPenetration(o)).length;
  const conformes = App.allObstacles.filter(o => !checkPenetration(o)).length;

  if (!App.allObstacles.length) {
    doc.setTextColor(...DIM); doc.setFont('courier', 'normal'); doc.setFontSize(10);
    doc.text('Aucun obstacle enregistré.', 14, y + 6);
  } else {
    _drawObstaclesTable(doc, App.allObstacles, y, { BG, PANEL, TEXT, DIM, CYAN, GREEN, RED }, W);
    y = _lastObstaclesTableY + 4;

    // Si on est trop bas sur la page, on crée une nouvelle page pour le cadre final
    if (y + 24 > 200) {
      doc.addPage();
      doc.setFillColor(...BG); doc.rect(0, 0, 297, 210, 'F');
      y = 15;
    }

    // Fond foncé pour faire ressortir le cadre
    doc.setFillColor(...PANEL); doc.rect(10, y, W, 22, 'F');
    doc.setDrawColor(...(penetrations > 0 ? RED : GREEN)); doc.setLineWidth(1.2);
    doc.rect(10, y, W, 22, 'S');

    doc.setFontSize(14); doc.setFont('courier', 'bold');
    doc.setTextColor(...(penetrations > 0 ? RED : GREEN));
    doc.text(`STATUT GLOBAL : ${penetrations > 0 ? 'NON CONFORME' : 'CONFORME'}`, 10 + W / 2, y + 10, { align: 'center' });

    doc.setFontSize(10); doc.setTextColor(...TEXT);
    doc.text(`${App.allObstacles.length} obstacle(s)   |   ${conformes} conforme(s)   |   ${penetrations} pénétration(s)`, 10 + W / 2, y + 17, { align: 'center' });
  }

  doc.save(`SIGOBS_OLS_${App.aerodrome?.icao || 'AERO'}_${now.toISOString().slice(0, 10)}.pdf`);
  showToast('Rapport PDF généré', 'success');
}

window.generatePdfReportSingle = function (id) {
  if (!window.jspdf) { showToast('Génération PDF indisponible', 'error'); return; }
  const obs = App.allObstacles.find(o => o._id === id);
  if (!obs) return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const now = new Date();
  const CYAN = [14, 165, 233], GREEN = [34, 197, 94], RED = [239, 68, 68];
  const BG = [255, 255, 255], DARK = [248, 250, 252], PANEL = [241, 245, 249];
  const TEXT = [15, 23, 42], DIM = [100, 116, 139];
  const W = 277;

  // ── En-tête (identique au rapport global) ──────────────────────────
  doc.setFillColor(...BG); doc.rect(0, 0, 297, 210, 'F');
  doc.setFillColor(...DARK); doc.rect(0, 0, 297, 28, 'F');
  doc.setDrawColor(...CYAN); doc.setLineWidth(0.5); doc.line(0, 28, 297, 28);
  doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(...CYAN);
  doc.text("RAPPORT D'OBSTACLE OLS", 32, 12);
  doc.setFontSize(9); doc.setFont('courier', 'normal'); doc.setTextColor(...DIM);
  doc.text("ICAO ANNEXE 14 — SURFACES DE LIMITATION D'OBSTACLES", 32, 19);
  doc.setFontSize(8); doc.setTextColor(...TEXT);
  doc.text(`Généré le : ${now.toLocaleDateString('fr-FR')} ${now.toLocaleTimeString('fr-FR')}Z`, 287, 10, { align: 'right' });
  doc.text(`Opérateur : ${App.user?.email || '—'}`, 287, 16, { align: 'right' });

  let y = 36;

  const section = (n, title) => {
    doc.setFillColor(...PANEL); doc.rect(10, y, W, 8, 'F');
    doc.setTextColor(...CYAN); doc.setFont('courier', 'bold'); doc.setFontSize(11);
    doc.text(`${n}. ${title}`, 14, y + 5.5); y += 10;
  };
  const kv = (k, v, k2, v2) => {
    doc.setFontSize(10); doc.setFont('courier', 'bold'); doc.setTextColor(...DIM);
    doc.text(k, 14, y + 6);
    doc.setTextColor(...TEXT); doc.setFont('courier', 'normal'); doc.text(String(v), 70, y + 6);
    if (k2 !== undefined) {
      doc.setFont('courier', 'bold'); doc.setTextColor(...DIM); doc.text(k2, 160, y + 6);
      doc.setTextColor(...TEXT); doc.setFont('courier', 'normal'); doc.text(String(v2 ?? '—'), 210, y + 6);
    }
    y += 9;
  };

  // ── Section 1 : Aérodrome ─────────────────────────────────────────
  section('1', 'INFORMATIONS AÉRODROME');
  kv('OACI', App.aerodrome?.icao || '—', 'NOM', App.aerodrome?.name || '—');
  kv('ÉLÉVATION', `${App.aerodrome?.elevation != null ? (App.aerodrome.elevation * 0.3048).toFixed(1) : '—'} m`, 'PAYS', App.aerodrome?.country || '—');
  kv('VILLE', App.aerodrome?.city || '—', 'IATA', App.aerodrome?.iata || '—');

  y += 2;

  // ── Section 2 : Identification de l’obstacle ─────────────────────
  section('2', `IDENTIFICATION DE L'OBSTACLE`);
  kv('NOM', obs.name || '—', 'TYPE', typeToLabel ? typeToLabel(obs.type) : (obs.type || '—'));
  kv('LATITUDE', obs.latitude != null ? obs.latitude.toFixed(6) + '°' : '—', 'LONGITUDE', obs.longitude != null ? obs.longitude.toFixed(6) + '°' : '—');
  kv('ALTITUDE', obs.altitude != null ? (obs.altitude * 0.3048).toFixed(2) + ' m' : '—', 'HAUTEUR', obs.height != null ? (obs.height * 0.3048).toFixed(2) + ' m' : '—');
  kv('STATUT', obs.status || '—', 'PROPRIÉTAIRE', obs.owner || '—');

  y += 2;

  // ── Section 3 : Analyse OLS ────────────────────────────────────────
  section('3', 'ANALYSE OLS (OACI ANNEXE 14)');

  let admStr = '—', surfStr = '—', clearanceStr = '—', clearanceVal = null;
  let horsSurfaces = false;
  if (typeof computeObstacleClearance === 'function') {
    const res = computeObstacleClearance(obs);
    horsSurfaces = !!res.horsSurfaces;
    if (horsSurfaces) {
      admStr = 'Hors surfaces'; surfStr = '—'; clearanceStr = '—';
    } else {
      admStr = res.admissibleM != null ? res.admissibleM.toFixed(1) + ' m' : '—';
      clearanceVal = res.clearanceM;
      clearanceStr = res.clearanceM != null ? (res.clearanceM >= 0 ? '+' : '') + res.clearanceM.toFixed(1) + ' m' : '—';
      surfStr = res.surfaceLabel || '—';
    }
  }
  if (typeof computeBreachedSurfaces === 'function') {
    const breached = computeBreachedSurfaces(obs);
    if (breached.length > 0) surfStr = breached.map(s => (s.label || s.name || s).slice(0, 25)).join(', ');
  }

  kv('ALT. ADMISSIBLE', admStr, 'SURFACE CONCERNÉE', surfStr);
  kv('DÉGAGEMENT', clearanceStr);

  y += 4;

  // ── Section 4 : Tableau synthèse (une seule ligne, même format global) ─
  section('4', 'SYNTHÈSE TABULAIRE');
  _drawObstaclesTable(doc, [obs], y, { BG, PANEL, TEXT, DIM, CYAN, GREEN, RED }, W);
  y = _lastObstaclesTableY + 6;

  // ── Section 5 : Verdict ────────────────────────────────────────────
  if (y + 28 > 200) { doc.addPage(); doc.setFillColor(...BG); doc.rect(0, 0, 297, 210, 'F'); y = 15; }
  const breach = checkPenetration(obs);
  doc.setFillColor(...(breach ? [254, 226, 226] : [220, 252, 231]));
  doc.rect(10, y, W, 22, 'F');
  doc.setDrawColor(...(breach ? RED : GREEN)); doc.setLineWidth(1.2);
  doc.rect(10, y, W, 22, 'S');
  doc.setFontSize(14); doc.setFont('courier', 'bold');
  doc.setTextColor(...(breach ? RED : GREEN));
  doc.text(`VERDICT OLS : ${breach ? 'PÉNÉTRATION' : 'CONFORME'}`, 10 + W / 2, y + 10, { align: 'center' });
  doc.setFontSize(9); doc.setTextColor(...TEXT);
  const verdictSub = horsSurfaces ? 'Obstacle hors surfaces OLS (non soumis à restriction)' :
    (breach ? `Dépassement : ${clearanceStr}  |  Surface : ${surfStr}` : `Marge de dégagement : ${clearanceStr}  |  Surface : ${surfStr}`);
  doc.text(verdictSub, 10 + W / 2, y + 17, { align: 'center' });

  // ── Pied de page ──────────────────────────────────────────────────
  doc.setFontSize(7); doc.setFont('courier', 'normal'); doc.setTextColor(...DIM);
  doc.text('Références : ICAO DOC 9157 Partie 6  |  ICAO ANNEXE 14 VOL I', 14, 206);
  doc.setFillColor(...DARK); doc.rect(0, 202, 297, 8, 'F');
  doc.setDrawColor(...CYAN); doc.line(0, 202, 297, 202);
  doc.setFontSize(7); doc.setTextColor(...DIM);
  doc.text(`SIGOBS V5.0_MAP2026  ·  ${now.toLocaleDateString('fr-FR')}`, 148, 206, { align: 'center' });

  doc.save(`SIGOBS_OBS_${obs.name || id}.pdf`);
  showToast('Rapport PDF généré', 'success');
};

let _lastObstaclesTableY = 36;
function _drawObstaclesTable(doc, list, startY, colors, W) {
  const { BG, PANEL, TEXT, DIM, CYAN, GREEN, RED } = colors;
  const X = 10; let y = startY;

  // Columns: DÉSIGNATION | COORDONNÉES (LAT+LON) | ALT. | ALT.ADM. | DÉGAGEMENT | SURFACES | VERDICT
  // x0      x1            x2     x3              x4     x5         x6            x7         x8
  const x0 = X;
  const x1 = X + W * 0.16;  // fin DÉSIGNATION
  const x2 = X + W * 0.275; // milieu COORDONNÉES: Lat/Lon
  const x3 = X + W * 0.39;  // fin COORDONNÉES
  const x4 = X + W * 0.49;  // fin ALT.
  const x5 = X + W * 0.59;  // fin ALT.ADM.
  const x6 = X + W * 0.69;  // fin DÉGAGEMENT
  const x7 = X + W * 0.84;  // fin SURFACES
  const x8 = X + W;          // fin VERDICT

  const drawHeader = () => {
    doc.setFillColor(...PANEL); doc.rect(X, y, W, 14, 'F');
    doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.3);
    doc.line(x0, y, x8, y);
    doc.line(x0, y + 14, x8, y + 14);
    doc.line(x2, y + 7, x3, y + 7); // Lat / Lon separator

    // Lignes verticales
    [x0, x1, x2, x3, x4, x5, x6, x7, x8].forEach(x => doc.line(x, y, x, y + 14));

    doc.setFontSize(7.5); doc.setTextColor(...TEXT); doc.setFont('courier', 'bold');
    doc.text('DÉSIGNATION', (x0 + x1) / 2, y + 8.5, { align: 'center' });
    doc.text('COORDONNÉES', (x1 + x3) / 2, y + 4.5, { align: 'center' });
    doc.text('LATITUDE', (x1 + x2) / 2, y + 11.5, { align: 'center' });
    doc.text('LONGITUDE', (x2 + x3) / 2, y + 11.5, { align: 'center' });
    doc.text('ALT. (m)', (x3 + x4) / 2, y + 8.5, { align: 'center' });
    doc.text('ALT.ADM.(m)', (x4 + x5) / 2, y + 8.5, { align: 'center' });
    doc.text('DÉGAGT (m)', (x5 + x6) / 2, y + 8.5, { align: 'center' });
    doc.text('SURFACES', (x6 + x7) / 2, y + 8.5, { align: 'center' });
    doc.text('VERDICT OLS', (x7 + x8) / 2, y + 8.5, { align: 'center' });
    y += 14;
  };

  drawHeader();

  list.forEach((obs, ri) => {
    const breach = checkPenetration(obs);
    doc.setFillColor(...(breach ? [254, 226, 226] : (ri % 2 === 0 ? [255, 255, 255] : [248, 250, 252])));
    doc.rect(X, y, W, 7, 'F');

    doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.1);
    doc.line(x0, y + 7, x8, y + 7);
    [x0, x1, x2, x3, x4, x5, x6, x7, x8].forEach(x => doc.line(x, y, x, y + 7));

    let admStr = '—', surfStr = '—', clearanceStr = '—', clearanceVal = null;
    if (typeof computeObstacleClearance === 'function') {
      const res = computeObstacleClearance(obs);
      if (res.horsSurfaces) { admStr = 'H.S.'; surfStr = '—'; clearanceStr = 'H.S.'; }
      else {
        admStr = res.admissibleM != null ? res.admissibleM.toFixed(1) : '—';
        clearanceVal = res.clearanceM;
        clearanceStr = res.clearanceM != null ? (res.clearanceM >= 0 ? '+' : '') + res.clearanceM.toFixed(1) : '—';
        surfStr = res.surfaceLabel || '—';
      }
    }
    if (typeof computeBreachedSurfaces === 'function') {
      const breached = computeBreachedSurfaces(obs);
      if (breached.length > 0) surfStr = breached.map(s => (s.label || s.name || s).slice(0, 12)).join(', ');
    }

    doc.setFontSize(7.5); doc.setTextColor(...TEXT); doc.setFont('courier', 'normal');
    doc.text((obs.name || '—').slice(0, 18), x0 + 2, y + 4.5);

    const latStr = obs.latitude != null ? obs.latitude.toFixed(5) + '°' : '—';
    const lonStr = obs.longitude != null ? obs.longitude.toFixed(5) + '°' : '—';
    doc.text(latStr, (x1 + x2) / 2, y + 4.5, { align: 'center' });
    doc.text(lonStr, (x2 + x3) / 2, y + 4.5, { align: 'center' });

    doc.text(obs.altitude != null ? (obs.altitude * 0.3048).toFixed(1) : '—', (x3 + x4) / 2, y + 4.5, { align: 'center' });
    doc.text(admStr, (x4 + x5) / 2, y + 4.5, { align: 'center' });

    // DÉGAGEMENT : vert si marge positive, rouge si pénétration
    const clrColor = (clearanceVal == null || clearanceStr === 'H.S.') ? DIM :
      clearanceVal < 0 ? RED : GREEN;
    doc.setTextColor(...clrColor);
    doc.setFont('courier', 'bold');
    doc.text(clearanceStr, (x5 + x6) / 2, y + 4.5, { align: 'center' });

    doc.setTextColor(...TEXT); doc.setFont('courier', 'normal');
    doc.text(surfStr.slice(0, 22), x6 + 2, y + 4.5);

    doc.setTextColor(...(breach ? RED : GREEN)); doc.setFont('courier', 'bold');
    doc.text(breach ? 'PÉNÉTRATION' : 'CONFORME', (x7 + x8) / 2, y + 4.5, { align: 'center' });
    y += 7;

    // Gestion propre du saut de page selon l'orientation
    const maxY = W > 200 ? 190 : 270;
    if (y > maxY && ri < list.length - 1) {
      doc.addPage();
      const pageW = W > 200 ? 297 : 210;
      const pageH = W > 200 ? 210 : 297;
      doc.setFillColor(...(BG || [255, 255, 255])); doc.rect(0, 0, pageW, pageH, 'F');

      y = 15;
      drawHeader();
    }
  });
  _lastObstaclesTableY = y;
}

function updateConformityPanel() {
  const totalEl = document.getElementById('conf-obs-count');
  const penetEl = document.getElementById('conf-penetrations');
  const mainEl = document.getElementById('conf-main-status');
  const subEl = document.getElementById('conf-sub');

  const isAdmin = getIsAdmin();
  const myId = String(App.user?._id || App.user?.id || '');
  const normId = (id) => id ? String(id._id || id.id || id) : '';
  const scopedList = (App.showAllObstacles && isAdmin)
    ? App.allObstacles
    : App.allObstacles.filter(o => normId(o.creatorId) === myId);

  const total = scopedList.length;
  const penetrations = scopedList.filter(o => checkPenetration(o)).length;
  const validated = scopedList.filter(o => !checkPenetration(o)).length;

  if (totalEl) totalEl.textContent = total;
  if (penetEl) penetEl.textContent = penetrations;

  if (!mainEl) return;
  if (total === 0) {
    mainEl.textContent = '—'; mainEl.style.color = '';
    if (subEl) subEl.textContent = 'AUCUN OBSTACLE';
  } else if (penetrations > 0) {
    mainEl.textContent = 'NON CONFORME';
    mainEl.style.setProperty('color', '#FF1744', 'important');
    if (subEl) subEl.textContent = `${penetrations} PÉNÉTRATION(S)`;
  } else if (validated > 0) {
    mainEl.textContent = 'CONFORME';
    mainEl.style.setProperty('color', '#00E676', 'important');
    if (subEl) subEl.textContent = `${validated} CONFORME(S)`;
  } else {
    mainEl.textContent = 'EN COURS';
    mainEl.style.setProperty('color', '#FFD600', 'important');
    if (subEl) subEl.textContent = `${total} OBSTACLE(S) EN ATTENTE`;
  }
}


