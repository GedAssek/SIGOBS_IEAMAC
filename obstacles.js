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

/**
 * Helper global : résout le rôle de l'utilisateur connecté quelle que soit
 * la forme retournée par l'API (string ou objet { _id, nomRole }).
 * @returns {boolean} true si l'utilisateur est admin
 */
function getIsAdmin() {
  const roleRaw = App.user?.role;
  let roleName;
  if (typeof roleRaw === 'object' && roleRaw !== null) {
    roleName = roleRaw.nomRole || roleRaw.name || '';
  } else {
    roleName = String(roleRaw || '');
  }
  // Utiliser aussi _roleName stocké par auth.js si disponible
  return (App.user?._roleName || roleName).toLowerCase() === 'admin';
}

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

  await createAndEvaluateObstacle(payload);
  clearObstacleForm();
}

/**
 * Construit le payload backend pour un obstacle à partir de valeurs déjà
 * extraites (mètres). Centralise la conversion m → ft et l'ajout des
 * attributs étendus (Annexe 15 / Tableau A6-2) afin d'être réutilisable
 * par la saisie unitaire ET par l'import CSV par lot.
 */
function buildObstaclePayload({ name, proprietaire, type, lat, lon, altM, heightM, temporal, expiry }) {
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
    altitude_max: Math.round(altFt * 100) / 100,
    ...(heightFt !== undefined ? { hauteur: Math.round(heightFt * 100) / 100 } : {}),
    zone_de_couverture: getVal('oe-zone-couverture') || '3',
    // 'construction' = obstacle temporaire de chantier à surveiller jusqu'à
    // la fin du projet (retour n°15) — traité comme "Temporaire" côté
    // backend, avec un sous-type conservé côté client pour le voyant dédié.
    permanence: temporal === 'permanent' ? 'Permanent' : 'Temporaire',
    type_temporel: temporal, // 'permanent' | 'temporary' | 'construction'
    ...(temporal !== 'permanent' && expiry ? { date_expiration: expiry } : {}),

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
    unite_mesure: getVal('oe-unite-mesure') || 'm',
    operations: getVal('oe-operations') || undefined,
    applicabilite: getVal('oe-applicabilite') || undefined,
    balisage_lumineux: getVal('oe-balisage') || 'Non',
    balisage_lumineux_type: getVal('oe-balisage') === 'Oui' ? (getVal('oe-balisage-type') || undefined) : undefined,
    marque: getVal('oe-marque') || 'Non',
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
    // Conserver les attributs étendus localement (le backend peut ne pas les renvoyer)
    apiObs.extended = extractExtendedAttributes(payload);

    // 2. Évaluation OLS — réponse: { success, data: { perce, statut_resultant, percements, surfaces_testees } }
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
async function loadObstaclesList() {
  const mongoId = App.aerodromeMongoId;
  if (!mongoId) return;
  try {
    const res = await apiFetch(`/obstacles?aerodrome_id=${mongoId}`);
    const raw = res.data || [];
    App.allObstacles = raw.map(normalizeObstacleFromAPI);
    App.obstacles = [...App.allObstacles];
    
    await fetchObstacleCreators();
    
    filterObstacles(); // au lieu de renderObstaclesList direct
    updateObstaclesLayer();
    updateConformityPanel();

    await reconcileObstacleVerdicts();
  } catch (e) {
    console.warn('[loadObstaclesList]', e);
    filterObstacles();
  }
}

/**
 * Retrouve le vrai soumetteur de chaque obstacle en croisant GET /evenements
 * (le modèle Obstacle lui-même ne porte aucun champ créateur — seule la
 * trace d'audit sait "qui a créé quoi", via utilisateur_id sur l'événement
 * CREATE). Réservé à l'admin, seul rôle autorisé à voir la colonne
 * SOUMIS PAR — on évite ainsi un appel réseau inutile pour les autres rôles.
 */
async function fetchObstacleCreators() {
  if (!getIsAdmin()) return;
  try {
    const res = await apiFetch('/evenements');
    const events = res.data || [];
    const creations = events.filter(ev => ev.type_action === 'CREATE' && ev.collection_impactee === 'Obstacle');
    // En cas de plusieurs événements CREATE pour un même document_id (rare),
    // on garde le plus récent.
    const byObstacleId = {};
    creations.forEach(ev => {
      const existing = byObstacleId[ev.document_id];
      if (!existing || new Date(ev.createdAt) > new Date(existing.createdAt)) {
        byObstacleId[ev.document_id] = ev;
      }
    });
    App.allObstacles.forEach(obs => {
      const ev = byObstacleId[obs._id];
      if (ev?.utilisateur_id?.email) obs.soumisParEmail = ev.utilisateur_id.email;
    });
    filterObstacles();
  } catch (e) {
    console.warn('[fetchObstacleCreators]', e.message);
  }
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
    tbody.innerHTML = `<tr class="table-placeholder"><td colspan="${showSoumis ? 15 : 14}">Aucun obstacle trouvé</td></tr>`;
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
    const clearance = (typeof formatClearanceBadge === 'function') ? formatClearanceBadge(obs) : '—';
    const soumisCell = showSoumis
      ? `<td style="font-size:10px;color:var(--text-secondary);">${obs.soumisParEmail || obs.creatorEmail || '—'}</td>`
      : '';
    return `<tr>
      <td style="font-weight:600;">${obs.name}</td>
      <td>${typeToLabel(obs.type)}</td>
      <td style="font-size:11px;color:var(--cyan);">${obs.proprietaire || '—'}</td>
      <td class="mono" title="${obs.latitude != null ? ddToDms(obs.latitude, 'lat') : ''}">${obs.latitude != null ? obs.latitude.toFixed(6) : '—'}</td>
      <td class="mono" title="${obs.longitude != null ? ddToDms(obs.longitude, 'lon') : ''}">${obs.longitude != null ? obs.longitude.toFixed(6) : '—'}</td>
      <td class="mono">${obs.altitude != null ? (obs.altitude * 0.3048).toFixed(1) : '—'}</td>
      <td class="mono">${obs.height != null && obs.height !== 0 ? (obs.height * 0.3048).toFixed(1) : '—'}</td>
      <td>${temporal}</td>
      <td>${verdict}</td>
      <td>${clearance}</td>
      <td>${buildBalisageSelect(obs)}</td>
      <td>${buildActionSelect(obs)}</td>
      <td>${statusTag}</td>
      ${soumisCell}
      <td>${buildWorkflowActions(obs)}</td>
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
  const isConstruction = obs.temporal === 'construction';
  if (!obs.expiry) {
    return isConstruction
      ? `<span class="tag tag-warn">🔶 À SURVEILLER (chantier)</span>`
      : `<span class="tag tag-warn">TEMP</span>`;
  }
  const now = new Date();
  const exp = new Date(obs.expiry);
  const daysLeft = Math.ceil((exp - now) / 86400000);
  if (isNaN(daysLeft)) {
    return isConstruction ? `<span class="tag tag-warn">🔶 À SURVEILLER (chantier)</span>` : `<span class="tag tag-warn">TEMP</span>`;
  }
  if (daysLeft < 0) {
    return `<span class="tag tag-fail" title="Échéance dépassée le ${exp.toLocaleDateString('fr-FR')}">EXPIRÉ</span>`;
  }
  // Un projet de construction reste "à surveiller" tant qu'il n'a pas expiré,
  // quel que soit le nombre de jours restants — c'est le voyant demandé.
  if (isConstruction) {
    return `<span class="tag tag-warn" title="Fin de chantier prévue : ${exp.toLocaleDateString('fr-FR')}">🔶 À SURVEILLER · J-${daysLeft}</span>`;
  }
  if (daysLeft <= 30) {
    return `<span class="tag tag-warn" title="Échéance : ${exp.toLocaleDateString('fr-FR')}">À SURVEILLER · J-${daysLeft}</span>`;
  }
  return `<span class="tag tag-info" title="Échéance : ${exp.toLocaleDateString('fr-FR')}">TEMP · J-${daysLeft}</span>`;
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
    if (breach && obs.status !== 'pending') return false;
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
  const isAdmin = getIsAdmin();

  // Voir le détail de pénétration (surfaces percées, dépassement en mètres)
  actions.push(`<button class="action-btn" onclick="showObstacleConformityDetail('${obs._id}')" title="Détail conformité">DÉTAIL</button>`);

  // Édition des attributs — retours n°10 (manipuler les obstacles) et n°18
  actions.push(`<button class="action-btn" onclick="editObstacle('${obs._id}')" title="Modifier l'obstacle">MODIFIER</button>`);

  // Tout utilisateur peut soumettre son brouillon
  if (obs.status === 'draft')
    actions.push(`<button class="action-btn pending" onclick="setObstacleStatus('${obs._id}','pending')">SOUMETTRE</button>`);

  // Admin peut VALIDER ou REJETER les obstacles en attente
  if (obs.status === 'pending' && isAdmin) {
    actions.push(`<button class="action-btn validate" onclick="setObstacleStatus('${obs._id}','validated')">VALIDER</button>`);
    actions.push(`<button class="action-btn reject"   onclick="setObstacleStatus('${obs._id}','draft')">REJETER</button>`);
  }

  // Admin peut toujours supprimer. Utilisateur peut supprimer son brouillon.
  if (isAdmin || obs.status === 'draft') {
    actions.push(`<button class="action-btn delete" onclick="confirmDelete('${obs._id}','${obs.name.replace(/'/g, "\\'")}')">✕</button>`);
  }
  return `<div class="action-group">${actions.join('')}</div>`;
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
    if (horsSurfaces) {
      geomLine = ' — HORS SURFACES OLS (aucune surface ne couvre cette position)';
    } else if (admissibleM != null) {
      geomLine = clearanceM >= 0
        ? ` — Altitude admissible : ${admissibleM.toFixed(1)} m · Dégagement : +${clearanceM.toFixed(1)} m (${surfaceLabel || '—'})`
        : ` — Altitude admissible : ${admissibleM.toFixed(1)} m · Dépassement : ${Math.abs(clearanceM).toFixed(1)} m (${surfaceLabel || '—'})`;
    }
  }
  if (subEl) subEl.textContent = `OBSTACLE : ${obs.name}${geomLine}`;
  renderSurfacesBreachTable(surfListEl, obs);
}

/* ══════════════════════════════════════════════════════════
   WORKFLOW STATUT
   PATCH /obstacles/:id { statut_validation: ... }  (doc §7.6)
══════════════════════════════════════════════════════════ */
async function setObstacleStatus(id, newStatus) {
  const backendStatus = { draft: 'Draft', pending: 'Pending', validated: 'Validated' }[newStatus] || newStatus;
  try {
    await apiFetch(`/obstacles/${id}`, 'PATCH', { statut_validation: backendStatus });
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
  try { await apiFetch(`/obstacles/${id}`, 'PATCH', { balisage_etat: value }); }
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
  try { await apiFetch(`/obstacles/${id}`, 'PATCH', { action_recommandee: value }); }
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
    const res = await apiFetch(`/obstacles/${id}`, 'PATCH', payload);
    const updated = normalizeObstacleFromAPI(res.data || { ...payload, _id: id });
    updated._id = id;

    // Ré-évaluer après modification (la position/altitude a pu changer)
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
   pénètrent une ou plusieurs surfaces OLS, avec le dépassement en
   mètres et la surface concernée.
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
   PANNEAU DE CONFORMITÉ — Métriques globales
   Filtrées par utilisateur (l'admin voit tout, les autres voient les leurs)
══════════════════════════════════════════════════════════ */
function updateConformityPanel() {
  const totalEl = document.getElementById('conf-obs-count');
  const penetEl = document.getElementById('conf-penetrations');
  const mainEl = document.getElementById('conf-main-status');
  const subEl = document.getElementById('conf-sub');

  // Portée : admin (avec toggle) → tous, sinon → seulement les siens
  const isAdmin = getIsAdmin();
  const myId = String(App.user?._id || App.user?.id || '');
  const normId = (id) => {
    if (!id) return '';
    if (typeof id === 'object') return String(id._id || id.id || id);
    return String(id);
  };
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

/* ══════════════════════════════════════════════════════════
   RAPPORT PDF
   Génère un rapport PDF complet de l'analyse OLS
   Utilise jsPDF (chargé via CDN dans index.html)
══════════════════════════════════════════════════════════ */
async function generatePdfReport() {
  if (!window.jspdf) { showToast('Génération PDF indisponible', 'error'); return; }
  if (!App.aerodrome) { showToast('Aérodrome non chargé', 'warn'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const rwy = App.activeRunway, now = new Date();
  const CYAN = [0, 229, 255], GREEN = [0, 230, 118], RED = [255, 23, 68];
  const BG = [5, 10, 18], DARK = [8, 14, 26], PANEL = [11, 18, 32];
  const TEXT = [208, 232, 245], DIM = [51, 77, 99];

  // En-tête
  doc.setFillColor(...BG); doc.rect(0, 0, 210, 297, 'F');
  doc.setFillColor(...DARK); doc.rect(0, 0, 210, 28, 'F');
  doc.setDrawColor(...CYAN); doc.setLineWidth(0.5); doc.line(0, 28, 210, 28);
  doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(...CYAN);
  doc.text("RAPPORT D'ANALYSE OLS", 32, 12);
  doc.setFontSize(9); doc.setFont('courier', 'normal'); doc.setTextColor(...DIM);
  doc.text("ICAO ANNEXE 14 — SURFACES DE LIMITATION D'OBSTACLES", 32, 19);
  doc.setFontSize(8); doc.setTextColor(...TEXT);
  doc.text(`Généré le : ${now.toLocaleDateString('fr-FR')} ${now.toLocaleTimeString('fr-FR')}Z`, 210, 10, { align: 'right' });
  doc.text(`Opérateur : ${App.user?.email || '—'}`, 210, 16, { align: 'right' });
  doc.text('Moteur : API Backend PANS-OPS', 210, 22, { align: 'right' });

  let y = 36;
  const section = (n, title) => {
    doc.setFillColor(...PANEL); doc.rect(10, y, 190, 6, 'F');
    doc.setTextColor(...CYAN); doc.setFont('courier', 'bold'); doc.setFontSize(8);
    doc.text(`${n}. ${title}`, 14, y + 4.2); y += 8;
  };
  const kv = (k, v, k2, v2) => {
    doc.setFontSize(7.5); doc.setFont('courier', 'bold'); doc.setTextColor(...DIM);
    doc.text(k, 14, y + 4);
    doc.setTextColor(...TEXT); doc.setFont('courier', 'normal'); doc.text(String(v), 50, y + 4);
    if (k2) {
      doc.setFont('courier', 'bold'); doc.setTextColor(...DIM); doc.text(k2, 110, y + 4);
      doc.setTextColor(...TEXT); doc.setFont('courier', 'normal'); doc.text(String(v2), 146, y + 4);
    }
    y += 7;
  };

  // Section 1 : Aérodrome
  section('1', 'INFORMATIONS AÉRODROME');
  kv('OACI', App.aerodrome?.icao || '—', 'NOM', App.aerodrome?.name || '—');
  kv('ÉLÉVATION', `${App.aerodrome?.elevation != null ? (App.aerodrome.elevation * 0.3048).toFixed(1) : '—'} m`, 'PAYS', App.aerodrome?.country || '—');
  kv('VILLE', App.aerodrome?.city || '—', 'IATA', App.aerodrome?.iata || '—');

  // Section 2 : Piste active
  if (rwy) {
    y += 2; section('2', 'PISTE ACTIVE');
    kv('DÉSIGNATION', rwy.designation || '—', 'CAP VRAI', `${rwy.trueHeading ?? '—'}°`);
    kv('LONGUEUR', `${rwy.length || '—'} m`, 'LARGEUR', `${rwy.width || '—'} m`);
    kv('ÉLÉVATION SEUIL', `${rwy.elevation != null ? (rwy.elevation * 0.3048).toFixed(1) : '—'} m`, 'CODE OACI', String(rwy.icaoCode || '—'));
  }

  // Section 3 : Obstacles
  y += 2; section('3', `OBSTACLES  (${App.allObstacles.length} total)`);
  // Le statut de conformité doit refléter le verdict OLS réel (checkPenetration),
  // et non le statut de workflow (draft/pending/validated) qui ne dit rien sur
  // la conformité — cf. correction du bug de persistance de la conformité.
  const penetrations = App.allObstacles.filter(o => checkPenetration(o)).length;
  const conformes = App.allObstacles.filter(o => !checkPenetration(o)).length;

  if (!App.allObstacles.length) {
    doc.setTextColor(...DIM); doc.setFont('courier', 'normal'); doc.setFontSize(8);
    doc.text('Aucun obstacle enregistré pour cet aérodrome.', 14, y + 4); y += 10;
  } else {
    doc.setFillColor(15, 25, 40); doc.rect(10, y, 190, 7, 'F');
    doc.setFontSize(6.5); doc.setFont('courier', 'bold'); doc.setTextColor(...DIM);
    ['DÉSIGNATION', 'TYPE', 'ALT (m)', 'HAUT (m)', 'STATUT', 'VERDICT OLS']
      .forEach((h, i) => doc.text(h, 14 + [0, 50, 85, 110, 135, 163][i], y + 4.5));
    y += 7;

    App.allObstacles.forEach((obs, ri) => {
      const breach = checkPenetration(obs);
      doc.setFillColor(
        breach ? 30 : (ri % 2 === 0 ? 11 : 8),
        breach ? 5 : (ri % 2 === 0 ? 18 : 14),
        breach ? 8 : (ri % 2 === 0 ? 32 : 26)
      );
      doc.rect(10, y, 190, 6.5, 'F');
      doc.setFontSize(7); doc.setFont('courier', 'bold'); doc.setTextColor(...TEXT);
      doc.text((obs.name || '—').slice(0, 18), 14, y + 4.2);
      doc.setFont('courier', 'normal'); doc.setTextColor(...DIM);
      doc.text(typeToLabel(obs.type).slice(0, 12), 64, y + 4.2);
      doc.setTextColor(...TEXT);
      doc.text(obs.altitude != null ? (obs.altitude * 0.3048).toFixed(1) : '—', 99, y + 4.2);
      doc.text(obs.height != null && obs.height !== 0 ? (obs.height * 0.3048).toFixed(1) : '—', 124, y + 4.2);
      doc.text(statusLabel(obs.status), 149, y + 4.2);
      doc.setTextColor(...(breach ? RED : GREEN));
      doc.setFont('courier', 'bold');
      doc.text(breach ? 'PÉNÉTRATION' : 'CONFORME', 177, y + 4.2);
      y += 6.5;
      if (y > 270) { doc.addPage(); doc.setFillColor(...BG); doc.rect(0, 0, 210, 297, 'F'); y = 15; }
    });

    y += 4;
    doc.setFillColor(...PANEL); doc.rect(10, y, 190, 22, 'F');
    doc.setDrawColor(...(penetrations > 0 ? RED : GREEN)); doc.setLineWidth(1);
    doc.rect(10, y, 190, 22, 'S'); doc.setLineWidth(0.1);
    doc.setFontSize(14); doc.setFont('courier', 'bold');
    doc.setTextColor(...(penetrations > 0 ? RED : GREEN));
    doc.text(`STATUT GLOBAL : ${penetrations > 0 ? 'NON CONFORME' : 'CONFORME'}`, 105, y + 10, { align: 'center' });
    doc.setFontSize(8); doc.setTextColor(...TEXT);
    doc.text(
      `${App.allObstacles.length} obstacle(s)  |  ${conformes} conforme(s)  |  ${penetrations} pénétration(s)`,
      105, y + 17, { align: 'center' }
    );
    y += 28;
  }

  // Pied de page
  y += 2; doc.setFontSize(7); doc.setFont('courier', 'normal'); doc.setTextColor(...DIM);
  doc.text('Références : ICAO DOC 9157 Partie 6  |  ICAO ANNEXE 14 VOL I  |  PANS-OLS', 14, y);
  doc.setFillColor(...DARK); doc.rect(0, 289, 210, 8, 'F');
  doc.setDrawColor(...CYAN); doc.line(0, 289, 210, 289);
  doc.setFontSize(7); doc.setTextColor(...DIM);
  doc.text(`SIGOBS V5.0  ·  Moteur OLS Backend  ·  ${now.toLocaleDateString('fr-FR')}`, 105, 294, { align: 'center' });

  const icao = App.aerodrome?.icao || 'XXXX';
  const rwyDesig = rwy?.designation || 'ALL';
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  doc.save(`SIGOBS_OLS_${icao}_RWY${rwyDesig}_${dateStr}.pdf`);
  showToast('Rapport PDF généré', 'success');

  // Sauvegarde optionnelle en base (non bloquante)
  try {
    await apiFetch('/reports', 'POST', {
      aerodromeIcao: icao, runwayDesig: rwyDesig,
      summary: {
        totalObstacles: App.allObstacles.length,
        breaches: penetrations, conformes,
        globalStatus: penetrations > 0 ? 'NON CONFORME' : 'CONFORME',
      },
    });
  } catch (e) {
    console.warn('[generatePdfReport] Sauvegarde base non disponible');
  }
}
