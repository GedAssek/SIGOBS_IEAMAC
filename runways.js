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
  const qfu1    = (document.getElementById('rwy-add-qfu1')?.value   || '').trim().toUpperCase();
  const qfu2    = (document.getElementById('rwy-add-qfu2')?.value   || '').trim().toUpperCase();
  const longueur= parseFloat(document.getElementById('rwy-add-longueur')?.value);
  const largeur = parseFloat(document.getElementById('rwy-add-largeur')?.value);
  const codeRef = (document.getElementById('rwy-add-code-ref')?.value || '').trim();

  if (!qfu1 || !qfu2 || isNaN(longueur) || isNaN(largeur) || !codeRef) {
    showToast('QFU 1, QFU 2, longueur, largeur et code de référence sont requis', 'warn');
    return;
  }

  // Seuils — chaque seuil est un GeoJSON Point avec coordonnées [longitude, latitude] ⚠
  const s1Lon = parseFloat(document.getElementById('rwy-seuil1-lon')?.value);
  const s1Lat = parseFloat(document.getElementById('rwy-seuil1-lat')?.value);
  const s1Alt = parseFloat(document.getElementById('rwy-seuil1-alt')?.value) || 0;
  const s2Lon = parseFloat(document.getElementById('rwy-seuil2-lon')?.value);
  const s2Lat = parseFloat(document.getElementById('rwy-seuil2-lat')?.value);
  const s2Alt = parseFloat(document.getElementById('rwy-seuil2-alt')?.value) || 0;

  if (isNaN(s1Lon) || isNaN(s1Lat) || isNaN(s2Lon) || isNaN(s2Lat)) {
    showToast('Coordonnées des deux seuils requises', 'warn');
    return;
  }

  // Champs optionnels
  const lonProlArret  = parseFloat(document.getElementById('rwy-add-prol-arret')?.value)  || undefined;
  const lonProlDegage = parseFloat(document.getElementById('rwy-add-prol-degage')?.value) || undefined;
  const largBordAm    = parseFloat(document.getElementById('rwy-add-bord-am')?.value)     || undefined;
  const largBordDeg   = parseFloat(document.getElementById('rwy-add-bord-deg')?.value)    || undefined;

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
    ...(typesApproche.length   ? { types_approche:   typesApproche }   : {}),
    ...(typesDecollage.length  ? { types_decollage:  typesDecollage }  : {}),
    ...(lonProlArret  !== undefined ? { longueur_prolongement_arret:  lonProlArret  } : {}),
    ...(lonProlDegage !== undefined ? { longueur_prolongement_degage: lonProlDegage } : {}),
    ...(largBordAm    !== undefined ? { largeur_bord_amenage:         largBordAm    } : {}),
    ...(largBordDeg   !== undefined ? { largeur_bord_degage:          largBordDeg   } : {}),
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
        <span class="runway-meta-item">ÉLÉV <span>${rwy.elevation ?? '—'} ft</span></span>
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
    'rwy-seuil1-lon', 'rwy-seuil1-lat', 'rwy-seuil1-alt',
    'rwy-seuil2-lon', 'rwy-seuil2-lat', 'rwy-seuil2-alt',
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
