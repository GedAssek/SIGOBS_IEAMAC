'use strict';
/* ═══════════════════════════════════════════════════════════
   SIGOBS — runways.js
   Gestion des pistes de l'aérodrome (ajout, modification)
   Routes :
     POST  /aerodromes/:aerodrome_id/pistes  (doc §6.4)
     PATCH /pistes/:id                       (doc §6.5)
   Dépend de : config.js (App), api.js (apiFetch, showToast),
               aerodrome.js (loadStudyAerodrome)
   ═══════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════
   AJOUTER UNE PISTE — POST /aerodromes/:id/pistes (doc §6.4)
   Énumérations :
     types_approche : ["Vue", "Classique", "Precision"]
     types_decollage: ["ODP", "SID", "Omnidirectionnel"]
══════════════════════════════════════════════════════════ */
async function submitRunway() {
  if (!App.aerodromeMongoId) {
    showToast('Aérodrome non chargé — impossible d\'ajouter une piste', 'error');
    return;
  }

  // Champs obligatoires
  const qfu1 = (document.getElementById('rwy-add-qfu1')?.value || '').trim().toUpperCase();
  const qfu2 = (document.getElementById('rwy-add-qfu2')?.value || '').trim().toUpperCase();
  const longueur = parseFloat(document.getElementById('rwy-add-longueur')?.value);
  const largeur = parseFloat(document.getElementById('rwy-add-largeur')?.value);
  const codeRef = (document.getElementById('rwy-add-code-ref')?.value || '').trim();

  if (!qfu1 || !qfu2 || isNaN(longueur) || isNaN(largeur) || !codeRef) {
    showToast('QFU 1, QFU 2, longueur, largeur et code de référence sont requis', 'warn');
    return;
  }

  // Seuils — chaque seuil est un GeoJSON Point avec coordonnées [longitude, latitude] ⚠
  // Altitudes saisies en mètres dans l'UI → converties en pieds pour le backend
  // (convention déjà utilisée pour les obstacles — cf. obstacles.js buildObstaclePayload)
  const M_TO_FT = 3.28084;
  const readDms = (prefix, hem) => {
    const deg = parseFloat(document.getElementById(prefix + '-deg')?.value) || 0;
    const min = parseFloat(document.getElementById(prefix + '-min')?.value) || 0;
    const sec = parseFloat(document.getElementById(prefix + '-sec')?.value) || 0;
    const h = document.getElementById(prefix + '-hem')?.value || hem;
    return dmsToDecimal(deg, min, sec, h);
  };
  const s1Lat = readDms('rwy-s1-lat', 'N');
  const s1Lon = readDms('rwy-s1-lon', 'E');
  const s1AltM = parseFloat(document.getElementById('rwy-seuil1-alt')?.value) || 0;
  const s1Alt = Math.round(s1AltM * M_TO_FT * 100) / 100;
  const s2Lat = readDms('rwy-s2-lat', 'N');
  const s2Lon = readDms('rwy-s2-lon', 'E');
  const s2AltM = parseFloat(document.getElementById('rwy-seuil2-alt')?.value) || 0;
  const s2Alt = Math.round(s2AltM * M_TO_FT * 100) / 100;

  if (isNaN(s1Lon) || isNaN(s1Lat) || isNaN(s2Lon) || isNaN(s2Lat)) {
    showToast('Coordonnées des deux seuils requises', 'warn');
    return;
  }

  const bandeLongueur = parseFloat(document.getElementById('rwy-add-bande-longueur')?.value);
  const bandeLargeur = parseFloat(document.getElementById('rwy-add-bande-largeur')?.value);

  // Types et champs optionnels (Seuil 1)
  const typesApprocheS1 = ['Vue', 'Classique', 'Precision'].filter(t => document.getElementById(`rwy-s1-approche-${t.toLowerCase()}`)?.checked);
  const typesDecollageS1 = ['ODP', 'SID', 'Omnidirectionnel'].filter(t => document.getElementById(`rwy-s1-decollage-${t.toLowerCase()}`)?.checked);
  const prolArretS1 = parseFloat(document.getElementById('rwy-s1-prol-arret')?.value);
  const prolDegageS1 = parseFloat(document.getElementById('rwy-s1-prol-degage')?.value);
  const largProlDegageS1 = parseFloat(document.getElementById('rwy-s1-larg-prol-degage')?.value);

  // Types et champs optionnels (Seuil 2)
  const typesApprocheS2 = ['Vue', 'Classique', 'Precision'].filter(t => document.getElementById(`rwy-s2-approche-${t.toLowerCase()}`)?.checked);
  const typesDecollageS2 = ['ODP', 'SID', 'Omnidirectionnel'].filter(t => document.getElementById(`rwy-s2-decollage-${t.toLowerCase()}`)?.checked);
  const prolArretS2 = parseFloat(document.getElementById('rwy-s2-prol-arret')?.value);
  const prolDegageS2 = parseFloat(document.getElementById('rwy-s2-prol-degage')?.value);
  const largProlDegageS2 = parseFloat(document.getElementById('rwy-s2-larg-prol-degage')?.value);

  // Construction du payload conforme à la doc §6.4 (adaptée)
  const payload = {
    qfu_1: qfu1,
    qfu_2: qfu2,
    longueur,
    largeur,
    code_reference: codeRef,
    seuils: [
      { 
        type: 'Point', coordinates: [s1Lon, s1Lat], qfu_associe: qfu1, altitude: s1Alt,
        ...(typesApprocheS1.length ? { types_approche: typesApprocheS1 } : {}),
        ...(typesDecollageS1.length ? { types_decollage: typesDecollageS1 } : {}),
        ...(!isNaN(prolArretS1) ? { longueur_prolongement_arret: prolArretS1 } : {}),
        ...(!isNaN(prolDegageS1) ? { longueur_prolongement_degage: prolDegageS1 } : {}),
        ...(!isNaN(largProlDegageS1) ? { largeur_prolongement_degage: largProlDegageS1 } : {})
      },
      { 
        type: 'Point', coordinates: [s2Lon, s2Lat], qfu_associe: qfu2, altitude: s2Alt,
        ...(typesApprocheS2.length ? { types_approche: typesApprocheS2 } : {}),
        ...(typesDecollageS2.length ? { types_decollage: typesDecollageS2 } : {}),
        ...(!isNaN(prolArretS2) ? { longueur_prolongement_arret: prolArretS2 } : {}),
        ...(!isNaN(prolDegageS2) ? { longueur_prolongement_degage: prolDegageS2 } : {}),
        ...(!isNaN(largProlDegageS2) ? { largeur_prolongement_degage: largProlDegageS2 } : {})
      },
    ],
    ...(!isNaN(bandeLongueur) && !isNaN(bandeLargeur) ? { bande: { longueur: bandeLongueur, largeur: bandeLargeur } } : {})
  };

  try {
    await apiFetch(`/aerodromes/${App.aerodromeMongoId}/pistes`, 'POST', payload);
    showToast(`Piste ${qfu1}/${qfu2} créée avec succès`, 'success');
    clearRunwayForm();
    // Recharger l'aérodrome pour rafraîchir les onglets et la liste
    await loadStudyAerodrome();
    renderRunwaysManagementList();
  } catch (e) {
    showToast('Erreur : ' + e.message, 'error');
    console.error('[submitRunway]', e);
  }
}

/* ══════════════════════════════════════════════════════════
   MODIFIER UNE PISTE — PATCH /pistes/:id (doc §6.5)
   Note : route directe /pistes/:id (pas /aerodromes/:id/pistes)
══════════════════════════════════════════════════════════ */
async function updateRunway(id, data) {
  try {
    await apiFetch(`/pistes/${id}`, 'PATCH', data);
    showToast('Piste mise à jour', 'success');
    await loadStudyAerodrome();
    renderRunwaysManagementList();
  } catch (e) {
    showToast('Erreur : ' + e.message, 'error');
    console.error('[updateRunway]', e);
  }
}

/* ══════════════════════════════════════════════════════════
   LISTE DES PISTES — Rendu dans l'onglet Pistes
══════════════════════════════════════════════════════════ */
function renderRunwaysManagementList() {
  const container = document.getElementById('runways-mgmt-list');
  if (!container) return;

  const isAdmin = typeof getIsAdmin === 'function' ? getIsAdmin() : false;
  const isEvaluator = typeof getIsEvaluator === 'function' ? getIsEvaluator() : false;

  // Masquer le formulaire d'ajout de piste si non admin/evaluator, et ajuster la grille
  const addPanel = document.querySelector('#tab-runways .panel-left');
  const appLayout = document.querySelector('#tab-runways .app-layout');
  
  if (addPanel && appLayout) {
    if (isAdmin || isEvaluator) {
      addPanel.style.display = 'flex';
      appLayout.style.gridTemplateColumns = '320px 1fr';
    } else {
      addPanel.style.display = 'none';
      appLayout.style.gridTemplateColumns = '1fr';
    }
  } else if (addPanel) {
    addPanel.style.display = (isAdmin || isEvaluator) ? 'flex' : 'none';
  }

  if (!App.runways.length) {
    container.innerHTML = '<div class="empty-msg">Aucune piste disponible pour cet aérodrome</div>';
    updateRunwaysPaginationUI();
    return;
  }

  App.runwaysCurrentPage = App.runwaysCurrentPage || 1;
  App.runwaysTotalPages = Math.ceil(App.runways.length / 25) || 1;
  
  if (App.runwaysCurrentPage > App.runwaysTotalPages) {
    App.runwaysCurrentPage = App.runwaysTotalPages;
  }
  
  const start = (App.runwaysCurrentPage - 1) * 25;
  const paginatedRunways = App.runways.slice(start, start + 25);

  container.innerHTML = paginatedRunways.map(rwy => `
    <div class="runway-mgmt-item">
      <div class="runway-mgmt-header">
        <span class="runway-mgmt-desig">RWY ${rwy.designation || '—'}</span>
        <span class="runway-meta-item">L <span>${rwy.length ?? '—'} m</span></span>
        <span class="runway-meta-item">l <span>${rwy.width ?? '—'} m</span></span>
        <span class="runway-meta-item">ÉLÉV <span>${rwy.elevation != null ? (rwy.elevation * 0.3048).toFixed(1) : '—'} m</span></span>
      </div>
      <div class="runway-mgmt-actions">
        ${rwy.typesApproche?.length ? rwy.typesApproche.map(t => `<span class="tag tag-info">${t}</span>`).join('') : '<span class="tag tag-info" style="opacity:0.6;">Approche non définie</span>'}
        ${rwy._id ? `<button class="action-btn" onclick="openEditRunwayModal('${rwy._id}')">ÉDITER</button>
                     <button class="action-btn delete" onclick="confirmDeleteRunway('${rwy._id}', '${rwy.designation || ''}')" title="Supprimer">✕</button>` : ''}
      </div>
    </div>
  `).join('');
  
  updateRunwaysPaginationUI();
}

function updateRunwaysPaginationUI() {
  const paginationDiv = document.getElementById('runways-pagination');
  const info = document.getElementById('runways-pagination-info');
  if (!paginationDiv) return;
  
  paginationDiv.style.display = 'flex';
  if (info) info.textContent = `Page ${App.runwaysCurrentPage} sur ${App.runwaysTotalPages}`;
  
  const btnPrev = paginationDiv.querySelector('button:first-child');
  const btnNext = paginationDiv.querySelector('button:last-child');
  if (btnPrev) btnPrev.disabled = App.runwaysCurrentPage <= 1;
  if (btnNext) btnNext.disabled = App.runwaysCurrentPage >= App.runwaysTotalPages;
}

function nextRunwaysPage() {
  if (App.runwaysCurrentPage < App.runwaysTotalPages) {
    App.runwaysCurrentPage++;
    renderRunwaysManagementList();
  }
}

function prevRunwaysPage() {
  if (App.runwaysCurrentPage > 1) {
    App.runwaysCurrentPage--;
    renderRunwaysManagementList();
  }
}

/* ══════════════════════════════════════════════════════════
   ÉDITION D'UNE PISTE — PATCH /pistes/:id (doc §6.5)
   Ouvre un modal complet pré-rempli avec toutes les données
   stockées en base pour la piste sélectionnée.
══════════════════════════════════════════════════════════ */
async function openEditRunwayModal(id) {
  // Recherche de la piste dans la liste locale (données complètes)
  let piste = null;
  try {
    const res = await apiFetch(`/pistes/${id}`);
    piste = res.data || res;
  } catch (e) {
    console.warn('[openEditRunwayModal] Impossible de charger la piste via GET /pistes/:id, fallback sur App.runways', e.message);
  }

  // Fallback : récupérer depuis la liste des pistes brutes si l'API /pistes/:id n'existe pas
  if (!piste || !piste._id) {
    // Essayer de récupérer depuis /aerodromes/:id/pistes
    try {
      const pistesRes = await apiFetch('/aerodromes/' + App.aerodromeMongoId + '/pistes');
      const pistesRaw = pistesRes.data || [];
      piste = pistesRaw.find(p => p._id === id);
    } catch (e2) {
      console.warn('[openEditRunwayModal] Impossible de charger les pistes', e2.message);
    }
  }

  if (!piste) {
    showToast('Impossible de charger les données de la piste', 'error');
    return;
  }

  const M_TO_FT = 3.28084;

  // Décomposer les seuils
  const seuil1 = piste.seuils?.[0] || {};
  const seuil2 = piste.seuils?.[1] || {};
  const s1Lat = seuil1.coordinates ? seuil1.coordinates[1] : 0;
  const s1Lon = seuil1.coordinates ? seuil1.coordinates[0] : 0;
  const s1AltFt = seuil1.altitude || 0;
  const s1AltM = (s1AltFt / M_TO_FT).toFixed(1);
  const s2Lat = seuil2.coordinates ? seuil2.coordinates[1] : 0;
  const s2Lon = seuil2.coordinates ? seuil2.coordinates[0] : 0;
  const s2AltFt = seuil2.altitude || 0;
  const s2AltM = (s2AltFt / M_TO_FT).toFixed(1);

  // Convertir coordonnées décimales en DMS
  const toDmsParts = (dd, axis) => {
    if (dd == null || isNaN(dd) || dd === 0) return { deg: 0, min: 0, sec: 0, hem: axis === 'lat' ? 'N' : 'E' };
    const hem = axis === 'lat' ? (dd >= 0 ? 'N' : 'S') : (dd >= 0 ? 'E' : 'W');
    const abs = Math.abs(dd);
    const deg = Math.floor(abs);
    const minFloat = (abs - deg) * 60;
    const min = Math.floor(minFloat);
    const sec = ((minFloat - min) * 60).toFixed(2);
    return { deg, min, sec, hem };
  };

  const s1LatP = toDmsParts(s1Lat, 'lat'), s1LonP = toDmsParts(s1Lon, 'lon');
  const s2LatP = toDmsParts(s2Lat, 'lat'), s2LonP = toDmsParts(s2Lon, 'lon');

  // Types d'approche et de décollage (valeurs en base, fallback sur piste pour compatibilité)
  const approcheBDS1 = seuil1.types_approche || piste.types_approche || [];
  const decollageBDS1 = seuil1.types_decollage || piste.types_decollage || [];
  const approcheBDS2 = seuil2.types_approche || piste.types_approche || [];
  const decollageBDS2 = seuil2.types_decollage || piste.types_decollage || [];

  const mkChk = (cbId, val, arr) =>
    `<label class="toggle-label"><input type="checkbox" id="${cbId}" ${arr.includes(val) ? 'checked' : ''} /> ${val}</label>`;

  const lonProlArretS1 = seuil1.longueur_prolongement_arret != null ? seuil1.longueur_prolongement_arret : (piste.longueur_prolongement_arret != null ? piste.longueur_prolongement_arret : '');
  const lonProlDegageS1 = seuil1.longueur_prolongement_degage != null ? seuil1.longueur_prolongement_degage : (piste.longueur_prolongement_degage != null ? piste.longueur_prolongement_degage : '');
  const largProlDegageS1 = seuil1.largeur_prolongement_degage != null ? seuil1.largeur_prolongement_degage : (piste.largeur_prolongement_degage != null ? piste.largeur_prolongement_degage : '');

  const lonProlArretS2 = seuil2.longueur_prolongement_arret != null ? seuil2.longueur_prolongement_arret : (piste.longueur_prolongement_arret != null ? piste.longueur_prolongement_arret : '');
  const lonProlDegageS2 = seuil2.longueur_prolongement_degage != null ? seuil2.longueur_prolongement_degage : (piste.longueur_prolongement_degage != null ? piste.longueur_prolongement_degage : '');
  const largProlDegageS2 = seuil2.largeur_prolongement_degage != null ? seuil2.largeur_prolongement_degage : (piste.largeur_prolongement_degage != null ? piste.largeur_prolongement_degage : '');

  showModal(
    `Éditer la piste ${piste.qfu_1 || ''}/${piste.qfu_2 || ''}`,
    `<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; max-height:75vh; overflow-y:auto; padding-right:4px;">

       <div class="field-group">
         <label class="field-label">QFU 1</label>
         <input type="text" id="erwy-qfu1" class="field-input" value="${piste.qfu_1 || ''}" placeholder="ex: 04" style="text-transform:uppercase;" />
       </div>
       <div class="field-group">
         <label class="field-label">QFU 2</label>
         <input type="text" id="erwy-qfu2" class="field-input" value="${piste.qfu_2 || ''}" placeholder="ex: 22" style="text-transform:uppercase;" />
       </div>
       <div class="field-group">
         <label class="field-label">LONGUEUR (m)</label>
         <input type="number" id="erwy-longueur" class="field-input" value="${piste.longueur || ''}" placeholder="L (m)" />
       </div>
       <div class="field-group">
         <label class="field-label">LARGEUR (m)</label>
         <input type="number" id="erwy-largeur" class="field-input" value="${piste.largeur || ''}" placeholder="l (m)" />
       </div>
       <div class="field-group" style="grid-column:1/-1;">
         <label class="field-label">CODE RÉFÉRENCE OACI</label>
         <input type="text" id="erwy-code-ref" class="field-input" value="${piste.code_reference || ''}" placeholder="ex: 4E" />
       </div>
       <div class="field-group" style="grid-column:1/-1;">
         <label class="field-label">BANDE DE PISTE </label>
         <div class="dms-row" style="gap:10px;">
           <input type="number" id="erwy-bande-longueur" class="field-input" value="${piste.bande?.longueur || ''}" placeholder="Longueur (m)" style="width:120px;" />
           <span class="dms-unit">×</span>
           <input type="number" id="erwy-bande-largeur" class="field-input" value="${piste.bande?.largeur || ''}" placeholder="largeur (m)" style="width:120px;" />
         </div>
       </div>




       <div class="field-group" style="grid-column:1/-1; border-top:1px solid var(--border); padding-top:8px;">
         <label class="field-label">SEUIL 1 (${piste.qfu_1 || 'QFU1'}) — COORDONNÉES</label>
         <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;">
           <div>
             <label class="field-label" style="font-size:10px;">LATITUDE</label>
             <div class="dms-row" style="gap:4px;">
               <input type="number" id="erwy-s1-lat-deg" class="field-input dms-input" value="${s1LatP.deg}" placeholder="°" style="width:60px;" />
               <span class="dms-unit">°</span>
               <input type="number" id="erwy-s1-lat-min" class="field-input dms-input" value="${s1LatP.min}" placeholder="'" style="width:60px;" />
               <span class="dms-unit">'</span>
               <input type="number" id="erwy-s1-lat-sec" class="field-input dms-input" value="${s1LatP.sec}" placeholder="&quot;" style="width:70px;" step="0.01" />
               <span class="dms-unit">"</span>
               <select id="erwy-s1-lat-hem" class="field-select dms-hem">
                 <option value="N" ${s1LatP.hem === 'N' ? 'selected' : ''}>N</option>
                 <option value="S" ${s1LatP.hem === 'S' ? 'selected' : ''}>S</option>
               </select>
             </div>
           </div>
           <div>
             <label class="field-label" style="font-size:10px;">LONGITUDE</label>
             <div class="dms-row" style="gap:4px;">
               <input type="number" id="erwy-s1-lon-deg" class="field-input dms-input" value="${s1LonP.deg}" placeholder="°" style="width:60px;" />
               <span class="dms-unit">°</span>
               <input type="number" id="erwy-s1-lon-min" class="field-input dms-input" value="${s1LonP.min}" placeholder="'" style="width:60px;" />
               <span class="dms-unit">'</span>
               <input type="number" id="erwy-s1-lon-sec" class="field-input dms-input" value="${s1LonP.sec}" placeholder="&quot;" style="width:70px;" step="0.01" />
               <span class="dms-unit">"</span>
               <select id="erwy-s1-lon-hem" class="field-select dms-hem">
                 <option value="E" ${s1LonP.hem === 'E' ? 'selected' : ''}>E</option>
                 <option value="W" ${s1LonP.hem === 'W' ? 'selected' : ''}>W</option>
               </select>
             </div>
           </div>
         </div>
          <div class="field-group" style="margin-top:6px;">
            <label class="field-label" style="font-size:10px;">ALTITUDE SEUIL 1 (m)</label>
            <input type="number" id="erwy-s1-alt-m" class="field-input" value="${s1AltM}" placeholder="Altitude (m)" step="0.1" style="width:140px;" />
          </div>
          <div class="field-group" style="margin-top:6px;">
            <label class="field-label" style="font-size:10px;">TYPES D'APPROCHE (SEUIL 1)</label>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              ${mkChk('erwy-s1-approche-vue', 'Vue', approcheBDS1)}
              ${mkChk('erwy-s1-approche-classique', 'Classique', approcheBDS1)}
              ${mkChk('erwy-s1-approche-precision', 'Precision', approcheBDS1)}
            </div>
          </div>
          <div class="field-group" style="margin-top:6px;">
            <label class="field-label" style="font-size:10px;">TYPES DE DÉCOLLAGE (SEUIL 1)</label>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              ${mkChk('erwy-s1-decollage-odp', 'ODP', decollageBDS1)}
              ${mkChk('erwy-s1-decollage-sid', 'SID', decollageBDS1)}
              ${mkChk('erwy-s1-decollage-omni', 'Omnidirectionnel', decollageBDS1)}
            </div>
          </div>
          <div style="margin-top:12px; padding:10px; background:rgba(0,0,0,0.02); border:1px solid var(--border-light); border-radius:6px;">
            <label class="field-label" style="margin-bottom:8px; display:block;">PROLONGEMENTS (m)</label>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
              <div class="field-group" style="grid-column:1 / -1;">
                <label class="field-label" style="font-size:9px; color:var(--text-muted);">LONGUEUR ARRÊT</label>
                <input type="number" id="erwy-s1-prol-arret" class="field-input" value="${lonProlArretS1}" placeholder="Optionnel" />
              </div>
              <div class="field-group">
                <label class="field-label" style="font-size:9px; color:var(--text-muted);">LONGUEUR DÉGAGÉ</label>
                <input type="number" id="erwy-s1-prol-degage" class="field-input" value="${lonProlDegageS1}" placeholder="Optionnel" />
              </div>
              <div class="field-group">
                <label class="field-label" style="font-size:9px; color:var(--text-muted);">LARGEUR DÉGAGÉ</label>
                <input type="number" id="erwy-s1-larg-prol-degage" class="field-input" value="${largProlDegageS1}" placeholder="Optionnel" />
              </div>
            </div>
          </div>
        </div>

       <div class="field-group" style="grid-column:1/-1; border-top:1px solid var(--border); padding-top:8px;">
         <label class="field-label">SEUIL 2 (${piste.qfu_2 || 'QFU2'}) — COORDONNÉES</label>
         <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;">
           <div>
             <label class="field-label" style="font-size:10px;">LATITUDE</label>
             <div class="dms-row" style="gap:4px;">
               <input type="number" id="erwy-s2-lat-deg" class="field-input dms-input" value="${s2LatP.deg}" placeholder="°" style="width:60px;" />
               <span class="dms-unit">°</span>
               <input type="number" id="erwy-s2-lat-min" class="field-input dms-input" value="${s2LatP.min}" placeholder="'" style="width:60px;" />
               <span class="dms-unit">'</span>
               <input type="number" id="erwy-s2-lat-sec" class="field-input dms-input" value="${s2LatP.sec}" placeholder="&quot;" style="width:70px;" step="0.01" />
               <span class="dms-unit">"</span>
               <select id="erwy-s2-lat-hem" class="field-select dms-hem">
                 <option value="N" ${s2LatP.hem === 'N' ? 'selected' : ''}>N</option>
                 <option value="S" ${s2LatP.hem === 'S' ? 'selected' : ''}>S</option>
               </select>
             </div>
           </div>
           <div>
             <label class="field-label" style="font-size:10px;">LONGITUDE</label>
             <div class="dms-row" style="gap:4px;">
               <input type="number" id="erwy-s2-lon-deg" class="field-input dms-input" value="${s2LonP.deg}" placeholder="°" style="width:60px;" />
               <span class="dms-unit">°</span>
               <input type="number" id="erwy-s2-lon-min" class="field-input dms-input" value="${s2LonP.min}" placeholder="'" style="width:60px;" />
               <span class="dms-unit">'</span>
               <input type="number" id="erwy-s2-lon-sec" class="field-input dms-input" value="${s2LonP.sec}" placeholder="&quot;" style="width:70px;" step="0.01" />
               <span class="dms-unit">"</span>
               <select id="erwy-s2-lon-hem" class="field-select dms-hem">
                 <option value="E" ${s2LonP.hem === 'E' ? 'selected' : ''}>E</option>
                 <option value="W" ${s2LonP.hem === 'W' ? 'selected' : ''}>W</option>
               </select>
             </div>
           </div>
         </div>
         <div class="field-group" style="margin-top:6px;">
           <label class="field-label" style="font-size:10px;">ALTITUDE SEUIL 2 (m)</label>
           <input type="number" id="erwy-s2-alt-m" class="field-input" value="${s2AltM}" placeholder="Altitude (m)" step="0.1" style="width:140px;" />
         </div>
          <div class="field-group" style="margin-top:6px;">
            <label class="field-label" style="font-size:10px;">TYPES D'APPROCHE (SEUIL 2)</label>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              ${mkChk('erwy-s2-approche-vue', 'Vue', approcheBDS2)}
              ${mkChk('erwy-s2-approche-classique', 'Classique', approcheBDS2)}
              ${mkChk('erwy-s2-approche-precision', 'Precision', approcheBDS2)}
            </div>
          </div>
          <div class="field-group" style="margin-top:6px;">
            <label class="field-label" style="font-size:10px;">TYPES DE DÉCOLLAGE (SEUIL 2)</label>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              ${mkChk('erwy-s2-decollage-odp', 'ODP', decollageBDS2)}
              ${mkChk('erwy-s2-decollage-sid', 'SID', decollageBDS2)}
              ${mkChk('erwy-s2-decollage-omni', 'Omnidirectionnel', decollageBDS2)}
            </div>
          </div>
          <div style="margin-top:12px; padding:10px; background:rgba(0,0,0,0.02); border:1px solid var(--border-light); border-radius:6px;">
            <label class="field-label" style="margin-bottom:8px; display:block;">PROLONGEMENTS (m)</label>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
              <div class="field-group" style="grid-column:1 / -1;">
                <label class="field-label" style="font-size:9px; color:var(--text-muted);">LONGUEUR ARRÊT</label>
                <input type="number" id="erwy-s2-prol-arret" class="field-input" value="${lonProlArretS2}" placeholder="Optionnel" />
              </div>
              <div class="field-group">
                <label class="field-label" style="font-size:9px; color:var(--text-muted);">LONGUEUR DÉGAGÉ</label>
                <input type="number" id="erwy-s2-prol-degage" class="field-input" value="${lonProlDegageS2}" placeholder="Optionnel" />
              </div>
              <div class="field-group">
                <label class="field-label" style="font-size:9px; color:var(--text-muted);">LARGEUR DÉGAGÉ</label>
                <input type="number" id="erwy-s2-larg-prol-degage" class="field-input" value="${largProlDegageS2}" placeholder="Optionnel" />
              </div>
            </div>
          </div>
       </div>
     </div>`,
    async () => {
      await submitEditRunway(id, piste.qfu_1, piste.qfu_2);
    }
  );
}

/**
 * Lit le formulaire d'édition de piste et envoie le PATCH /pistes/:id.
 * @param {string} id    - _id MongoDB de la piste
 * @param {string} qfu1  - QFU 1 d'origine (pour les seuils)
 * @param {string} qfu2  - QFU 2 d'origine (pour les seuils)
 */
async function submitEditRunway(id, qfu1Orig, qfu2Orig) {
  const M_TO_FT = 3.28084;

  const readDms = (prefix, hem) => {
    const deg = parseFloat(document.getElementById(prefix + '-deg')?.value) || 0;
    const min = parseFloat(document.getElementById(prefix + '-min')?.value) || 0;
    const sec = parseFloat(document.getElementById(prefix + '-sec')?.value) || 0;
    const h   = document.getElementById(prefix + '-hem')?.value || hem;
    return dmsToDecimal(deg, min, sec, h);
  };

  const qfu1 = (document.getElementById('erwy-qfu1')?.value || '').trim().toUpperCase() || qfu1Orig;
  const qfu2 = (document.getElementById('erwy-qfu2')?.value || '').trim().toUpperCase() || qfu2Orig;
  const longueur = parseFloat(document.getElementById('erwy-longueur')?.value);
  const largeur  = parseFloat(document.getElementById('erwy-largeur')?.value);
  const codeRef  = (document.getElementById('erwy-code-ref')?.value || '').trim();

  if (!qfu1 || !qfu2 || isNaN(longueur) || isNaN(largeur)) {
    showToast('QFU 1, QFU 2, longueur et largeur sont requis', 'warn');
    return;
  }

  const s1Lat = readDms('erwy-s1-lat', 'N');
  const s1Lon = readDms('erwy-s1-lon', 'E');
  const s1AltM = parseFloat(document.getElementById('erwy-s1-alt-m')?.value) || 0;
  const s1AltFt = Math.round(s1AltM * M_TO_FT * 100) / 100;

  const s2Lat = readDms('erwy-s2-lat', 'N');
  const s2Lon = readDms('erwy-s2-lon', 'E');
  const s2AltM = parseFloat(document.getElementById('erwy-s2-alt-m')?.value) || 0;
  const s2AltFt = Math.round(s2AltM * M_TO_FT * 100) / 100;

  // Types d'approche et décollage (Seuil 1)
  const typesApprocheS1 = ['Vue', 'Classique', 'Precision'].filter(t => document.getElementById(`erwy-s1-approche-${t.toLowerCase()}`)?.checked);
  const typesDecollageS1 = ['ODP', 'SID', 'Omnidirectionnel'].filter(t => {
    const cbId = t === 'Omnidirectionnel' ? 'erwy-s1-decollage-omni' : `erwy-s1-decollage-${t.toLowerCase()}`;
    return document.getElementById(cbId)?.checked;
  });

  // Types d'approche et décollage (Seuil 2)
  const typesApprocheS2 = ['Vue', 'Classique', 'Precision'].filter(t => document.getElementById(`erwy-s2-approche-${t.toLowerCase()}`)?.checked);
  const typesDecollageS2 = ['ODP', 'SID', 'Omnidirectionnel'].filter(t => {
    const cbId = t === 'Omnidirectionnel' ? 'erwy-s2-decollage-omni' : `erwy-s2-decollage-${t.toLowerCase()}`;
    return document.getElementById(cbId)?.checked;
  });

  const prolArretS1 = parseFloat(document.getElementById('erwy-s1-prol-arret')?.value);
  const prolDegageS1 = parseFloat(document.getElementById('erwy-s1-prol-degage')?.value);
  const largProlDegageS1 = parseFloat(document.getElementById('erwy-s1-larg-prol-degage')?.value);

  const prolArretS2 = parseFloat(document.getElementById('erwy-s2-prol-arret')?.value);
  const prolDegageS2 = parseFloat(document.getElementById('erwy-s2-prol-degage')?.value);
  const largProlDegageS2 = parseFloat(document.getElementById('erwy-s2-larg-prol-degage')?.value);

  const bandeLongueur = parseFloat(document.getElementById('erwy-bande-longueur')?.value);
  const bandeLargeur  = parseFloat(document.getElementById('erwy-bande-largeur')?.value);

  const patch = {
    qfu_1: qfu1,
    qfu_2: qfu2,
    longueur,
    largeur,
    ...(codeRef ? { code_reference: codeRef } : {}),
    seuils: [
      { 
        type: 'Point', coordinates: [s1Lon, s1Lat], qfu_associe: qfu1, altitude: s1AltFt,
        ...(typesApprocheS1.length ? { types_approche: typesApprocheS1 } : {}),
        ...(typesDecollageS1.length ? { types_decollage: typesDecollageS1 } : {}),
        ...(!isNaN(prolArretS1) ? { longueur_prolongement_arret: prolArretS1 } : {}),
        ...(!isNaN(prolDegageS1) ? { longueur_prolongement_degage: prolDegageS1 } : {}),
        ...(!isNaN(largProlDegageS1) ? { largeur_prolongement_degage: largProlDegageS1 } : {})
      },
      { 
        type: 'Point', coordinates: [s2Lon, s2Lat], qfu_associe: qfu2, altitude: s2AltFt,
        ...(typesApprocheS2.length ? { types_approche: typesApprocheS2 } : {}),
        ...(typesDecollageS2.length ? { types_decollage: typesDecollageS2 } : {}),
        ...(!isNaN(prolArretS2) ? { longueur_prolongement_arret: prolArretS2 } : {}),
        ...(!isNaN(prolDegageS2) ? { longueur_prolongement_degage: prolDegageS2 } : {}),
        ...(!isNaN(largProlDegageS2) ? { largeur_prolongement_degage: largProlDegageS2 } : {})
      },
    ],
    ...(!isNaN(bandeLongueur) && !isNaN(bandeLargeur) ? { bande: { longueur: bandeLongueur, largeur: bandeLargeur } } : {})
  };

  await updateRunway(id, patch);
}

/** Réinitialise le formulaire d'ajout de piste */
function clearRunwayForm() {
  [
    'rwy-add-qfu1', 'rwy-add-qfu2', 'rwy-add-longueur', 'rwy-add-largeur',
    'rwy-add-code-ref', 'rwy-add-bande-longueur', 'rwy-add-bande-largeur',
    'rwy-s1-prol-arret', 'rwy-s1-prol-degage', 'rwy-s1-larg-prol-degage',
    'rwy-s2-prol-arret', 'rwy-s2-prol-degage', 'rwy-s2-larg-prol-degage',
    'rwy-seuil1-alt', 'rwy-seuil2-alt',
    'rwy-s1-lat-deg', 'rwy-s1-lat-min', 'rwy-s1-lat-sec',
    'rwy-s1-lon-deg', 'rwy-s1-lon-min', 'rwy-s1-lon-sec',
    'rwy-s2-lat-deg', 'rwy-s2-lat-min', 'rwy-s2-lat-sec',
    'rwy-s2-lon-deg', 'rwy-s2-lon-min', 'rwy-s2-lon-sec',
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['Vue', 'Classique', 'Precision'].forEach(t => {
    const cbS1 = document.getElementById(`rwy-s1-approche-${t.toLowerCase()}`);
    const cbS2 = document.getElementById(`rwy-s2-approche-${t.toLowerCase()}`);
    if (cbS1) cbS1.checked = false;
    if (cbS2) cbS2.checked = false;
  });
  ['ODP', 'SID', 'Omnidirectionnel'].forEach(t => {
    const cbS1 = document.getElementById(`rwy-s1-decollage-${t.toLowerCase()}`);
    const cbS2 = document.getElementById(`rwy-s2-decollage-${t.toLowerCase()}`);
    if (cbS1) cbS1.checked = false;
    if (cbS2) cbS2.checked = false;
  });
}

/** Confirmation de suppression d'une piste */
async function confirmDeleteRunway(id, designation) {
  if (!confirm(`Voulez-vous vraiment supprimer la piste ${designation} (et son QFU opposé) ? Cette action est irréversible.`)) return;

  try {
    await apiFetch(`/pistes/${id}`, 'DELETE');
    showToast(`Piste supprimée avec succès`, 'success');
    
    // Recharge l'aérodrome pour rafraîchir la liste des pistes
    if (typeof loadAerodromeById === 'function' && App.currentAerodromeId) {
      await loadAerodromeById(App.currentAerodromeId);
    }
  } catch (err) {
    console.error('[confirmDeleteRunway]', err);
    showToast("Erreur lors de la suppression de la piste : " + err.message, 'error');
  }
}
