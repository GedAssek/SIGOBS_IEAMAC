'use strict';
/* ═══════════════════════════════════════════════════════════
   SIGOBS — aerodromes-admin.js
   Gestion des aérodromes (réservé Admin) : liste, création,
   suppression, et sélecteur d'aérodrome d'étude dans la topbar.

   Hypothèses de routes REST (mêmes conventions que pistes/obstacles/
   utilisateurs déjà en place dans ce projet) :
     GET    /aerodromes                (liste complète, admin)
     POST   /aerodromes                (création)
     DELETE /aerodromes/:id            (suppression)
   Si le backend ne les expose pas encore sous cette forme, seule
   cette page est affectée — le reste de l'application (aérodrome
   d'étude unique) continue de fonctionner normalement.

   Accès multi-aérodrome pour un utilisateur non-admin : ce module
   s'appuie sur un champ optionnel `aerodromes_autorises` (tableau
   d'_id) sur le document utilisateur si le backend le fournit ;
   à défaut, l'utilisateur ne voit que l'aérodrome unique associé
   à son compte (`aerodrome_id`), assigné par l'admin depuis
   l'onglet UTILISATEURS.

   Dépend de : config.js (App), api.js (apiFetch, showToast, showModal),
               aerodrome.js (loadAerodromeById, switchAerodrome)
   ═══════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════
   CHARGEMENT DE LA LISTE DES AÉRODROMES
══════════════════════════════════════════════════════════ */
async function loadAllAerodromes() {
  const isAdmin = (typeof getIsAdmin === 'function') && getIsAdmin();
  try {
    if (isAdmin) {
      const res = await apiFetch('/aerodromes');
      App.aerodromesList = res.data || [];
    } else {
      // Utilisateur standard : liste limitée à ce qui est explicitement autorisé
      const authorised = App.user?.aerodromes_autorises;
      if (Array.isArray(authorised) && authorised.length) {
        App.aerodromesList = authorised.map(a => (typeof a === 'object' ? a : { _id: a }));
      } else if (App.aerodrome) {
        App.aerodromesList = [{ _id: App.aerodromeMongoId, code_oaci: App.aerodrome.icao, nom: App.aerodrome.name }];
      }
    }
  } catch (e) {
    console.warn('[loadAllAerodromes]', e.message);
    if (App.aerodrome) {
      App.aerodromesList = [{ _id: App.aerodromeMongoId, code_oaci: App.aerodrome.icao, nom: App.aerodrome.name }];
    }
  }
  renderAerodromeSwitcher();
  if (isAdmin) renderAerodromesAdminList();
}

/* ══════════════════════════════════════════════════════════
   SÉLECTEUR D'AÉRODROME D'ÉTUDE — Topbar
   N'apparaît que si plus d'un aérodrome est accessible.
══════════════════════════════════════════════════════════ */
function renderAerodromeSwitcher() {
  const infoRow = document.querySelector('#study-aerodrome-display .study-aerodrome-info');
  if (!infoRow) return;

  const list = App.aerodromesList || [];
  const existingSelect = document.getElementById('aerodrome-switcher-select');

  if (list.length <= 1) {
    if (existingSelect) existingSelect.remove();
    return;
  }

  let select = existingSelect;
  if (!select) {
    select = document.createElement('select');
    select.id = 'aerodrome-switcher-select';
    select.className = 'field-select';
    select.style.cssText = 'width:150px;margin-left:6px;font-size:12.5px;padding:3px 6px;';
    select.onchange = () => switchAerodrome(select.value);
    infoRow.appendChild(select);
  }
  select.innerHTML = list.map(a =>
    `<option value="${a._id}">${a.code_oaci || a.icao || '—'} — ${(a.nom || a.name || '').slice(0, 22)}</option>`
  ).join('');
  select.value = App.currentAerodromeId || '';
}

/* ══════════════════════════════════════════════════════════
   ADMIN — CRÉATION D'UN AÉRODROME
══════════════════════════════════════════════════════════ */
async function submitAerodrome() {
  const codeOaci = (document.getElementById('aero-add-icao')?.value || '').trim().toUpperCase();
  const nom = (document.getElementById('aero-add-nom')?.value || '').trim();
  const pays = (document.getElementById('aero-add-pays')?.value || '').trim();
  const ville = (document.getElementById('aero-add-ville')?.value || '').trim();
  const iata = (document.getElementById('aero-add-iata')?.value || '').trim();
  const altitude = parseFloat(document.getElementById('aero-add-altitude')?.value);
  const magVar = parseFloat(document.getElementById('aero-add-var')?.value);
  const readDms = (prefix, hem) => {
    const deg = parseFloat(document.getElementById(prefix + '-deg')?.value) || 0;
    const min = parseFloat(document.getElementById(prefix + '-min')?.value) || 0;
    const sec = parseFloat(document.getElementById(prefix + '-sec')?.value) || 0;
    const h = document.getElementById(prefix + '-hem')?.value || hem;
    return dmsToDecimal(deg, min, sec, h);
  };
  const lat = readDms('aero-add-lat', 'N');
  const lon = readDms('aero-add-lon', 'E');
  if (!codeOaci || !nom || isNaN(lat) || isNaN(lon)) {
    showToast('Code OACI, nom et coordonnées sont requis', 'warn');
    return;
  }
  if (isNaN(magVar)) {
    showToast('La variation magnétique est requise', 'warn');
    return;
  }

  const payload = {
    code_oaci: codeOaci,
    nom,
    ville: ville || undefined,
    altitude: isNaN(altitude) ? undefined : Math.round(altitude * 3.28084 * 100) / 100,
    var: magVar,
    point_reference: { type: 'Point', coordinates: [lon, lat] },
  };
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
  // Note : `pays` et `iata` ne font pas partie du modèle Aérodrome réel → non envoyés.

  try {
    await apiFetch('/aerodromes', 'POST', payload);
    if (typeof logAction === 'function') logAction('creation', 'aerodrome', codeOaci, nom);
    showToast(`Aérodrome ${codeOaci} créé avec succès`, 'success');
    clearAerodromeForm();
    await loadAllAerodromes();
  } catch (e) {
    showToast('Erreur : ' + e.message, 'error');
    console.error('[submitAerodrome]', e);
  }
}

function clearAerodromeForm() {
  ['aero-add-icao', 'aero-add-nom', 'aero-add-pays', 'aero-add-ville',
    'aero-add-iata', 'aero-add-altitude', 'aero-add-var',
    'aero-add-lat-deg', 'aero-add-lat-min', 'aero-add-lat-sec',
    'aero-add-lon-deg', 'aero-add-lon-min', 'aero-add-lon-sec']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

/* ══════════════════════════════════════════════════════════
   ADMIN — LISTE / SUPPRESSION / SÉLECTION
══════════════════════════════════════════════════════════ */
function renderAerodromesAdminList() {
  const container = document.getElementById('aerodromes-mgmt-list');
  if (!container) return;

  if (!App.aerodromesList.length) {
    container.innerHTML = '<div class="empty-msg">Aucun aérodrome enregistré</div>';
    return;
  }

  container.innerHTML = App.aerodromesList.map(a => {
    const id = a._id;
    const isCurrent = id === App.currentAerodromeId;
    return `
    <div class="runway-mgmt-item">
      <div class="runway-mgmt-header">
        <span class="runway-mgmt-desig">${a.code_oaci || a.icao || '—'}</span>
        <span class="runway-meta-item">${a.nom || a.name || '—'}</span>
        <span class="runway-meta-item">${a.ville || a.city || ''} ${a.pays || a.country || ''}</span>
        ${isCurrent ? '<span class="tag tag-pass">AÉRODROME COURANT</span>' : ''}
      </div>
      <div class="runway-mgmt-actions">
        ${!isCurrent ? `<button class="action-btn" onclick="switchAerodrome('${id}')">SÉLECTIONNER</button>` : ''}
        <button class="action-btn" onclick="openGrantAccessModal('${id}','${(a.code_oaci || a.icao || '').replace(/'/g, "\\'")}')">GÉRER LES ACCÈS</button>
        <button class="action-btn delete" onclick="confirmDeleteAerodrome('${id}','${(a.code_oaci || a.icao || '').replace(/'/g, "\\'")}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

function confirmDeleteAerodrome(id, icao) {
  showModal(
    "Supprimer l'aérodrome",
    `Confirmer la suppression de <strong>${icao}</strong> ?<br>
     <small style="color:var(--dim)">Pistes, surfaces et obstacles associés seront également affectés.</small>`,
    async () => {
      try {
        await apiFetch(`/aerodromes/${id}`, 'DELETE');
        if (typeof logAction === 'function') logAction('suppression', 'aerodrome', icao, '', 'PERMDELTA');
        showToast(`Aérodrome ${icao} supprimé`, 'success');
        await loadAllAerodromes();
      } catch (e) {
        showToast('Erreur : ' + e.message, 'error');
      }
    }
  );
}

/* ══════════════════════════════════════════════════════════
   ACCÈS UTILISATEUR NON-ADMIN — Attribution d'un aérodrome
   Ouvre une petite sélection d'utilisateur puis met à jour son
   association (PATCH /utilisateurs/:id).
══════════════════════════════════════════════════════════ */
async function openGrantAccessModal(aerodromeId, icao) {
  let users = [];
  try {
    const res = await apiFetch('/utilisateurs');
    users = res.data || [];
  } catch (e) {
    showToast("Impossible de charger la liste des utilisateurs", 'error');
    return;
  }

  const options = users.map(u =>
    `<option value="${u._id}">${u.email}</option>`
  ).join('');

  showModal(
    `Accès à ${icao}`,
    `<p style="margin-bottom:10px;">Sélectionnez l'utilisateur à qui accorder l'accès à cet aérodrome pour ses évaluations :</p>
     <select id="grant-access-user-select" class="field-select" style="width:100%;">${options}</select>`,
    async () => {
      const userId = document.getElementById('grant-access-user-select')?.value;
      if (!userId) return;
      try {
        // Champ principal (modèle mono-aérodrome par utilisateur, déjà utilisé à la création)
        // + tentative d'ajout au tableau `aerodromes_autorises` si le backend le supporte
        // (permet le "switch" multi-aérodrome côté utilisateur non-admin).
        await apiFetch(`/utilisateurs/${userId}`, 'PATCH', {
          aerodrome_id: aerodromeId,
          aerodromes_autorises: [aerodromeId],
        });
        showToast('Accès accordé', 'success');
        if (typeof loadUsers === 'function') loadUsers();
      } catch (e) {
        showToast("Erreur lors de l'attribution de l'accès : " + e.message, 'error');
      }
    }
  );
}
