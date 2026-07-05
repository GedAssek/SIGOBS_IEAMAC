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

  // Champs optionnels
  const lonProlArret = parseFloat(document.getElementById('rwy-add-prol-arret')?.value) || undefined;
  const lonProlDegage = parseFloat(document.getElementById('rwy-add-prol-degage')?.value) || undefined;
  const largBordAm = parseFloat(document.getElementById('rwy-add-bord-am')?.value) || undefined;
  const largBordDeg = parseFloat(document.getElementById('rwy-add-bord-deg')?.value) || undefined;

  // Types d'approche (cases à cocher)
  const typesApproche = [];
  ['Vue', 'Classique', 'Precision'].forEach(t => {
    const cb = document.getElementById(`rwy-approche-${t.toLowerCase()}`);
    if (cb && cb.checked) typesApproche.push(t);
  });

  // Types de décollage (cases à cocher)
  const typesDecollage = [];
  ['ODP', 'SID', 'Omnidirectionnel'].forEach(t => {
    const cb = document.getElementById(`rwy-decollage-${t.toLowerCase()}`);
    if (cb && cb.checked) typesDecollage.push(t);
  });

  // Construction du payload conforme à la doc §6.4
  const payload = {
    qfu_1: qfu1,
    qfu_2: qfu2,
    longueur,
    largeur,
    code_reference: codeRef,
    seuils: [
      { type: 'Point', coordinates: [s1Lon, s1Lat], qfu_associe: qfu1, altitude: s1Alt },
      { type: 'Point', coordinates: [s2Lon, s2Lat], qfu_associe: qfu2, altitude: s2Alt },
    ],
    ...(typesApproche.length ? { types_approche: typesApproche } : {}),
    ...(typesDecollage.length ? { types_decollage: typesDecollage } : {}),
    ...(lonProlArret !== undefined ? { longueur_prolongement_arret: lonProlArret } : {}),
    ...(lonProlDegage !== undefined ? { longueur_prolongement_degage: lonProlDegage } : {}),
    ...(largBordAm !== undefined ? { largeur_bord_amenage: largBordAm } : {}),
    ...(largBordDeg !== undefined ? { largeur_bord_degage: largBordDeg } : {}),
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

  if (!App.runways.length) {
    container.innerHTML = '<div class="empty-msg">Aucune piste disponible pour cet aérodrome</div>';
    return;
  }

  container.innerHTML = App.runways.map(rwy => `
    <div class="runway-mgmt-item">
      <div class="runway-mgmt-header">
        <span class="runway-mgmt-desig">RWY ${rwy.designation || '—'}</span>
        <span class="runway-meta-item">CAP <span>${rwy.trueHeading ?? '—'}°</span></span>
        <span class="runway-meta-item">L <span>${rwy.length ?? '—'} m</span></span>
        <span class="runway-meta-item">l <span>${rwy.width ?? '—'} m</span></span>
        <span class="runway-meta-item">ÉLÉV <span>${rwy.elevation != null ? (rwy.elevation * 0.3048).toFixed(1) : '—'} m</span></span>
      </div>
      <div class="runway-mgmt-actions">
        <span class="tag tag-info">OACI ${rwy.icaoCode || '—'}</span>
        ${rwy.typesApproche?.length ? `<span class="tag tag-pass">${rwy.typesApproche.join(', ')}</span>` : ''}
        ${rwy._id ? `<button class="action-btn delete" onclick="confirmDeleteRunway('${rwy._id}','${rwy.designation}')">✕</button>` : ''}
      </div>
    </div>
  `).join('');
}

/** Réinitialise le formulaire d'ajout de piste */
function clearRunwayForm() {
  [
    'rwy-add-qfu1', 'rwy-add-qfu2', 'rwy-add-longueur', 'rwy-add-largeur',
    'rwy-add-code-ref', 'rwy-add-prol-arret', 'rwy-add-prol-degage',
    'rwy-add-bord-am', 'rwy-add-bord-deg',
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
    const cb = document.getElementById(`rwy-approche-${t.toLowerCase()}`);
    if (cb) cb.checked = false;
  });
  ['ODP', 'SID', 'Omnidirectionnel'].forEach(t => {
    const cb = document.getElementById(`rwy-decollage-${t.toLowerCase()}`);
    if (cb) cb.checked = false;
  });
}

/** Confirmation de suppression d'une piste (si l'API le supporte) */
function confirmDeleteRunway(id, designation) {
  showModal(
    'Supprimer la piste',
    `Confirmer la suppression de <strong>RWY ${designation}</strong> ?<br>
     <small style="color:var(--dim)">Les surfaces OLS associées seront recalculées.</small>`,
    async () => {
      try {
        await apiFetch(`/pistes/${id}`, 'DELETE');
        showToast(`Piste ${designation} supprimée`, 'success');
        await loadStudyAerodrome();
        renderRunwaysManagementList();
      } catch (e) {
        showToast('Erreur : ' + e.message, 'error');
      }
    }
  );
}
