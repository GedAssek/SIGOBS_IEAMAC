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

/** Réinitialise le formulaire de saisie d'obstacle */
function clearObstacleForm() {
  ['obs-name', 'obs-proprietaire', 'obs-alt', 'obs-height',
    'lat-deg', 'lat-min', 'lat-sec',
    'lon-deg', 'lon-min', 'lon-sec',
    'lat-dd', 'lon-dd'
  ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('obs-temporal').value = 'permanent';
  document.getElementById('expiry-group').classList.add('hidden');
}

/* ══════════════════════════════════════════════════════════
   SOUMISSION D'UN OBSTACLE
   1. POST /obstacles              → sauvegarde (statut = Draft auto)
   2. POST /obstacles/:id/evaluer  → verdict OLS backend
   Conforme au workflow complet doc §11
══════════════════════════════════════════════════════════ */
async function submitObstacle() {
  const name = document.getElementById('obs-name').value.trim();
  const proprietaire = (document.getElementById('obs-proprietaire')?.value || '').trim();
  const type = document.getElementById('obs-type').value;
  const alt = parseFloat(document.getElementById('obs-alt').value);
  const height = parseFloat(document.getElementById('obs-height').value);
  const temporal = document.getElementById('obs-temporal').value;
  const expiry = document.getElementById('obs-expiry').value;
  const { lat, lon } = getCoordinates();

  if (!name || isNaN(alt) || isNaN(height) || isNaN(lat) || isNaN(lon)) {
    showToast('Veuillez remplir tous les champs', 'warn'); return;
  }
  if (!App.aerodromeMongoId) {
    showToast('Aérodrome non chargé, impossible de soumettre', 'error'); return;
  }

  // Payload conforme à la doc §7.4 — champs backend exacts
  const payload = {
    aerodrome_id: App.aerodromeMongoId,
    nom: name,
    proprietaire: proprietaire || undefined,        // Propriétaire de l'obstacle
    type_obstacle: labelToTypeObstacle(type),
    geometrie: { type: 'Point', coordinates: [lon, lat] },
    altitude_max: alt,
    hauteur: height,
    zone_de_couverture: '3',
    permanence: temporal === 'temporary' ? 'Temporaire' : 'Permanent',
    ...(temporal === 'temporary' && expiry ? { date_expiration: expiry } : {})
  };

  try {
    // 1. Sauvegarder l'obstacle — réponse: { success, data: obstacle }
    const res = await apiFetch('/obstacles', 'POST', payload);
    const apiObs = normalizeObstacleFromAPI(res.data);

    // 2. Évaluation OLS — réponse: { success, data: { perce, statut_resultant, percements, surfaces_testees } }
    try {
      const evalRes = await apiFetch('/obstacles/' + apiObs._id + '/evaluer', 'POST');
      const evalData = evalRes.data || {};
      // Mettre à jour le statut local depuis la réponse backend
      if (evalData.statut_resultant) apiObs.status = normalizeStatusBack(evalData.statut_resultant);
      if (evalData.perce !== undefined) apiObs.perce = evalData.perce;
      displayEvalResult(apiObs, evalData);
    } catch (e) {
      console.warn('[submitObstacle] Erreur évaluation:', e.message);
      showToast('Obstacle sauvegardé — évaluation OLS non disponible', 'warn');
    }

    if (!apiObs.creatorId) apiObs.creatorId = App.user?._id || App.user?.id;
    App.obstacles.push(apiObs);
    App.allObstacles.push(apiObs);
    showToast('Obstacle sauvegardé et évalué', 'success');
  } catch (e) {
    showToast('Erreur API : ' + e.message, 'error');
    console.error('[submitObstacle]', e);
    return;
  }

  clearObstacleForm();
  filterObstacles();
  // Forcer la mise à jour de la couche carte avec le nouvel obstacle
  updateObstaclesLayer();
  updateConformityPanel();
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

  if (evalData.perce) {
    mainEl.textContent = 'NON CONFORME';
    mainEl.style.setProperty('color', '#FF1744', 'important');
    subEl.textContent = `${evalData.percements?.length || 0} SURFACE(S) PERCÉE(S)`;
  } else {
    mainEl.textContent = 'CONFORME';
    mainEl.style.setProperty('color', '#00E676', 'important');
    subEl.textContent = `${evalData.surfaces_testees || evalData.surfaces_testées || 0} SURFACES TESTÉES`;
  }

  if (surfListEl && evalData.percements?.length) {
    surfListEl.innerHTML = evalData.percements.map(p =>
      `<div class="conf-surface-row breach">
        <span>${p.surface_type || p.type_surface || p.qfu || '—'}</span>
        <span>—</span>
        <span>${p.altitude_surface != null ? Number(p.altitude_surface).toFixed(0) : '—'} ft</span>
        <span>${p.altitude_obstacle != null ? Number(p.altitude_obstacle).toFixed(0) : '—'} ft</span>
        <span style="color:var(--danger)">✗</span>
      </div>`
    ).join('');
  } else if (surfListEl) {
    surfListEl.innerHTML = '<div class="conf-surface-row"><span style="color:var(--green)">Aucune pénétration</span></div>';
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
    filterObstacles(); // au lieu de renderObstaclesList direct
    updateObstaclesLayer();
    updateConformityPanel();
  } catch (e) {
    console.warn('[loadObstaclesList]', e);
    filterObstacles();
  }
}

/** Fonction utilitaire pour évaluer la pénétration si le backend ne l'envoie pas explicitement */
function checkPenetration(obs) {
  if (obs.perce !== undefined && obs.perce !== null) return obs.perce;
  const altM = (obs.altitude || 0) * 0.3048;
  let breach = false;
  if (window.GeoMap && GeoMap.map) {
    try {
      const src = GeoMap.map.getSource('src-backend-surfaces');
      if (src && src._data && src._data.features) {
        for (const f of src._data.features) {
          const surfCeil = f.properties?.heightM || 0;
          if (surfCeil > 0 && altM > surfCeil) {
            breach = true;
            break;
          }
        }
      }
    } catch (_) { }
  }
  return breach;
}

/** Génère le HTML du tableau des obstacles et met à jour le panneau de conformité */
function renderObstaclesList(list) {
  const tbody = document.getElementById('obs-list-tbody');
  if (!tbody) return;

  // Colonne 'SOUMIS PAR' visible uniquement pour l'admin en mode "tous"
  const isAdmin = getIsAdmin();
  const showSoumis = isAdmin && App.showAllObstacles;
  const soumisColHeader = document.getElementById('obs-col-soumis');
  if (soumisColHeader) soumisColHeader.style.display = showSoumis ? '' : 'none';

  if (!list.length) {
    tbody.innerHTML = `<tr class="table-placeholder"><td colspan="${showSoumis ? 13 : 12}">Aucun obstacle trouvé</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(obs => {
    // Verdict OLS ne dépend PLUS du status (qui est juste le workflow)
    const penetrates = checkPenetration(obs);
    const verdict = penetrates
      ? '<span class="tag tag-fail">PÉNÉTRATION</span>'
      : '<span class="tag tag-pass">CONFORME</span>';

    const statusTag = `<span class="tag tag-${obs.status || 'draft'}">${statusLabel(obs.status)}</span>`;
    const temporal = obs.temporal === 'temporary'
      ? `<span class="tag tag-warn">TEMP</span>`
      : `<span class="tag tag-info">PERM</span>`;
    const soumisCell = showSoumis
      ? `<td style="font-size:10px;color:var(--text-secondary);">${obs.soumisParEmail || obs.creatorEmail || '—'}</td>`
      : '';
    return `<tr>
      <td style="font-weight:600;">${obs.name}</td>
      <td>${typeToLabel(obs.type)}</td>
      <td style="font-size:11px;color:var(--cyan);">${obs.proprietaire || '—'}</td>
      <td class="mono">${obs.latitude != null ? obs.latitude.toFixed(6) : '—'}</td>
      <td class="mono">${obs.longitude != null ? obs.longitude.toFixed(6) : '—'}</td>
      <td class="mono">${obs.altitude ?? '—'}</td>
      <td class="mono">${obs.height ?? '—'}</td>
      <td>${temporal}</td>
      <td>${statusTag}</td>
      <td>${verdict}</td>
      ${soumisCell}
      <td>${buildWorkflowActions(obs)}</td>
    </tr>`;
  }).join('');

  const pending = list.filter(o => o.status === 'pending').length;
  const pendingEl = document.getElementById('pending-count');
  if (pendingEl) pendingEl.textContent = pending;
  renderPendingList(list.filter(o => o.status === 'pending'));
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
  kv('ÉLÉVATION', `${App.aerodrome?.elevation || '—'} ft`, 'PAYS', App.aerodrome?.country || '—');
  kv('VILLE', App.aerodrome?.city || '—', 'IATA', App.aerodrome?.iata || '—');

  // Section 2 : Piste active
  if (rwy) {
    y += 2; section('2', 'PISTE ACTIVE');
    kv('DÉSIGNATION', rwy.designation || '—', 'CAP VRAI', `${rwy.trueHeading ?? '—'}°`);
    kv('LONGUEUR', `${rwy.length || '—'} m`, 'LARGEUR', `${rwy.width || '—'} m`);
    kv('ÉLÉVATION SEUIL', `${rwy.elevation || '—'} ft`, 'CODE OACI', String(rwy.icaoCode || '—'));
  }

  // Section 3 : Obstacles
  y += 2; section('3', `OBSTACLES  (${App.allObstacles.length} total)`);
  const penetrations = App.allObstacles.filter(o => o.status === 'pending').length;
  const conformes = App.allObstacles.filter(o => o.status === 'validated').length;

  if (!App.allObstacles.length) {
    doc.setTextColor(...DIM); doc.setFont('courier', 'normal'); doc.setFontSize(8);
    doc.text('Aucun obstacle enregistré pour cet aérodrome.', 14, y + 4); y += 10;
  } else {
    doc.setFillColor(15, 25, 40); doc.rect(10, y, 190, 7, 'F');
    doc.setFontSize(6.5); doc.setFont('courier', 'bold'); doc.setTextColor(...DIM);
    ['DÉSIGNATION', 'TYPE', 'ALT (ft)', 'HAUT (ft)', 'STATUT', 'VERDICT OLS']
      .forEach((h, i) => doc.text(h, 14 + [0, 50, 85, 110, 135, 163][i], y + 4.5));
    y += 7;

    App.allObstacles.forEach((obs, ri) => {
      const breach = obs.status === 'pending';
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
      doc.text(String(obs.altitude ?? '—'), 99, y + 4.2);
      doc.text(String(obs.height ?? '—'), 124, y + 4.2);
      doc.text(statusLabel(obs.status), 149, y + 4.2);
      doc.setTextColor(...(breach ? RED : obs.status === 'validated' ? GREEN : DIM));
      doc.setFont('courier', 'bold');
      doc.text(breach ? 'PÉNÉTRATION' : obs.status === 'validated' ? 'CONFORME' : 'EN ATTENTE', 177, y + 4.2);
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
