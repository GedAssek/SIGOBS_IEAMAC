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
  const isAdmin = typeof getIsAdmin === 'function' ? getIsAdmin() : false;
  const isEvaluator = typeof getIsEvaluator === 'function' ? getIsEvaluator() : false;
  
  try {
    if (isAdmin || isEvaluator) {
      // Les Admins et Evaluators peuvent lister tous les aérodromes
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
  if (isAdmin || isEvaluator) renderAerodromesAdminList();
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
    pays: pays || undefined,
    ville: ville || undefined,
    iata: iata || undefined,
    altitude: isNaN(altitude) ? undefined : Math.round(altitude * 3.28084 * 100) / 100,
    var: magVar,
    point_reference: { type: 'Point', coordinates: [lon, lat] },
  };
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

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

  const isAdmin = typeof getIsAdmin === 'function' ? getIsAdmin() : false;

  // Masquer le formulaire de création si non admin
  const addPanel = document.querySelector('#tab-aerodromes .panel-left');
  if (addPanel) addPanel.style.display = isAdmin ? 'flex' : 'none';

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
        <button class="action-btn" onclick="openEditAerodromeModal('${id}')">ÉDITER</button>
        ${isAdmin ? `<button class="action-btn" onclick="openGrantAccessModal('${id}','${(a.code_oaci || a.icao || '').replace(/'/g, "\\'")}')">GÉRER LES ACCÈS</button>` : ''}
        ${isAdmin ? `<button class="action-btn delete" onclick="confirmDeleteAerodrome('${id}','${(a.code_oaci || a.icao || '').replace(/'/g, "\\'")}')">✕</button>` : ''}
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

function openEditAerodromeModal(id) {
  // Retrouver l'aérodrome dans la liste (données complètes en base)
  const a = (App.aerodromesList || []).find(x => x._id === id);
  if (!a) {
    showToast("Aérodrome introuvable", 'error');
    return;
  }

  // Décomposer le point_reference en lat/lon si disponible
  const coords = a.point_reference?.coordinates;
  const lon0 = coords ? coords[0] : (a.longitude || 0);
  const lat0 = coords ? coords[1] : (a.latitude || 0);

  // Convertir coordonnées décimales en DMS pour l'affichage
  const toDmsParts = (dd, axis) => {
    if (dd == null || isNaN(dd)) return { deg: '', min: '', sec: '', hem: axis === 'lat' ? 'N' : 'E' };
    const hem = axis === 'lat' ? (dd >= 0 ? 'N' : 'S') : (dd >= 0 ? 'E' : 'W');
    const abs = Math.abs(dd);
    const deg = Math.floor(abs);
    const minFloat = (abs - deg) * 60;
    const min = Math.floor(minFloat);
    const sec = ((minFloat - min) * 60).toFixed(2);
    return { deg, min, sec, hem };
  };

  const latParts = toDmsParts(lat0, 'lat');
  const lonParts = toDmsParts(lon0, 'lon');

  // Altitude stockée en pieds côté backend → convertir en mètres pour l'UI
  const altitudeM = a.altitude ? (a.altitude * 0.3048).toFixed(1) : '';

  showModal(
    `Éditer l'aérodrome ${a.code_oaci || a.icao || ''}`,
    `<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; max-height:70vh; overflow-y:auto; padding-right:4px;">
       <div class="field-group">
         <label class="field-label">CODE OACI</label>
         <input type="text" id="edit-aero-icao" class="field-input" value="${a.code_oaci || a.icao || ''}" maxlength="4" style="text-transform:uppercase;" />
       </div>
       <div class="field-group">
         <label class="field-label">CODE IATA</label>
         <input type="text" id="edit-aero-iata" class="field-input" value="${a.iata || ''}" maxlength="3" />
       </div>
       <div class="field-group" style="grid-column:1/-1;">
         <label class="field-label">NOM DE L'AÉRODROME</label>
         <input type="text" id="edit-aero-nom" class="field-input" value="${(a.nom || a.name || '').replace(/"/g, '&quot;')}" />
       </div>
       <div class="field-group">
         <label class="field-label">VILLE</label>
         <input type="text" id="edit-aero-ville" class="field-input" value="${a.ville || a.city || ''}" />
       </div>
       <div class="field-group">
         <label class="field-label">PAYS</label>
         <input type="text" id="edit-aero-pays" class="field-input" value="${a.pays || a.country || ''}" />
       </div>
       <div class="field-group">
         <label class="field-label">ALTITUDE DE RÉFÉRENCE (m)</label>
         <input type="number" id="edit-aero-alt" class="field-input" value="${altitudeM}" step="0.1" />
       </div>
       <div class="field-group">
         <label class="field-label">VARIATION MAGNÉTIQUE (°)</label>
         <input type="number" id="edit-aero-var" class="field-input" value="${a.var !== undefined ? a.var : ''}" step="0.1" />
       </div>
       <div class="field-group" style="grid-column:1/-1;">
         <label class="field-label">POINT DE RÉFÉRENCE — LATITUDE (DMS)</label>
         <div class="dms-row" style="gap:6px;">
           <input type="number" id="edit-aero-lat-deg" class="field-input dms-input" placeholder="°" value="${latParts.deg}" min="0" max="90" style="width:70px;" />
           <span class="dms-unit">°</span>
           <input type="number" id="edit-aero-lat-min" class="field-input dms-input" placeholder="'" value="${latParts.min}" min="0" max="59" style="width:70px;" />
           <span class="dms-unit">'</span>
           <input type="number" id="edit-aero-lat-sec" class="field-input dms-input" placeholder="&quot;" value="${latParts.sec}" min="0" max="59.99" step="0.01" style="width:80px;" />
           <span class="dms-unit">"</span>
           <select id="edit-aero-lat-hem" class="field-select dms-hem">
             <option value="N" ${latParts.hem === 'N' ? 'selected' : ''}>N</option>
             <option value="S" ${latParts.hem === 'S' ? 'selected' : ''}>S</option>
           </select>
         </div>
       </div>
       <div class="field-group" style="grid-column:1/-1;">
         <label class="field-label">POINT DE RÉFÉRENCE — LONGITUDE (DMS)</label>
         <div class="dms-row" style="gap:6px;">
           <input type="number" id="edit-aero-lon-deg" class="field-input dms-input" placeholder="°" value="${lonParts.deg}" min="0" max="180" style="width:70px;" />
           <span class="dms-unit">°</span>
           <input type="number" id="edit-aero-lon-min" class="field-input dms-input" placeholder="'" value="${lonParts.min}" min="0" max="59" style="width:70px;" />
           <span class="dms-unit">'</span>
           <input type="number" id="edit-aero-lon-sec" class="field-input dms-input" placeholder="&quot;" value="${lonParts.sec}" min="0" max="59.99" step="0.01" style="width:80px;" />
           <span class="dms-unit">"</span>
           <select id="edit-aero-lon-hem" class="field-select dms-hem">
             <option value="E" ${lonParts.hem === 'E' ? 'selected' : ''}>E</option>
             <option value="W" ${lonParts.hem === 'W' ? 'selected' : ''}>W</option>
           </select>
         </div>
       </div>
     </div>`,
    async () => {
      const nom     = (document.getElementById('edit-aero-nom')?.value || '').trim();
      const icao    = (document.getElementById('edit-aero-icao')?.value || '').trim().toUpperCase();
      const iata    = (document.getElementById('edit-aero-iata')?.value || '').trim().toUpperCase();
      const ville   = (document.getElementById('edit-aero-ville')?.value || '').trim();
      const pays    = (document.getElementById('edit-aero-pays')?.value || '').trim();
      const altM    = parseFloat(document.getElementById('edit-aero-alt')?.value);
      const magVar  = parseFloat(document.getElementById('edit-aero-var')?.value);

      // Lire les coordonnées DMS
      const readDmsEdit = (prefix, hem) => {
        const deg = parseFloat(document.getElementById(prefix + '-deg')?.value) || 0;
        const min = parseFloat(document.getElementById(prefix + '-min')?.value) || 0;
        const sec = parseFloat(document.getElementById(prefix + '-sec')?.value) || 0;
        const h   = document.getElementById(prefix + '-hem')?.value || hem;
        return dmsToDecimal(deg, min, sec, h);
      };
      const lat = readDmsEdit('edit-aero-lat', 'N');
      const lon = readDmsEdit('edit-aero-lon', 'E');

      if (!nom || !icao) {
        showToast('Nom et code OACI sont requis', 'warn');
        return;
      }
      if (isNaN(magVar)) {
        showToast('La variation magnétique est requise', 'warn');
        return;
      }

      const patch = {
        code_oaci: icao,
        nom,
        ...(iata ? { iata } : {}),
        ...(ville ? { ville } : {}),
        ...(pays ? { pays } : {}),
        ...(!isNaN(altM) ? { altitude: Math.round(altM * 3.28084 * 100) / 100 } : {}),
        var: magVar,
        ...(!isNaN(lat) && !isNaN(lon) ? { point_reference: { type: 'Point', coordinates: [lon, lat] } } : {}),
      };

      try {
        await apiFetch(`/aerodromes/${id}`, 'PATCH', patch);
        showToast(`Aérodrome ${icao} mis à jour`, 'success');
        await loadAllAerodromes();
        // Si c'est l'aérodrome courant, recharger pour mettre à jour l'UI
        if (id === App.currentAerodromeId) await loadStudyAerodrome();
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

  // 1. Filtrer les utilisateurs qui ont DÉJÀ accès (soit comme aerodrome principal, soit dans le tableau)
  const usersWithAccess = users.filter(u => {
    const isMain = typeof u.aerodrome_id === 'object' ? u.aerodrome_id?._id === aerodromeId : u.aerodrome_id === aerodromeId;
    const isAuthorized = Array.isArray(u.aerodromes_autorises) && u.aerodromes_autorises.includes(aerodromeId);
    return isMain || isAuthorized;
  });

  // 2. Filtrer ceux qui N'ONT PAS encore accès pour la liste déroulante d'ajout
  const usersWithoutAccess = users.filter(u => !usersWithAccess.includes(u));

  let html = `<div style="max-height:200px; overflow-y:auto; margin-bottom:15px; border:1px solid rgba(148, 163, 184, 0.2); border-radius:4px; padding:4px;">`;
  
  if (usersWithAccess.length === 0) {
    html += `<div style="padding:8px; font-size:12px; color:var(--text-dim);">Aucun utilisateur associé.</div>`;
  } else {
    usersWithAccess.forEach(u => {
      const roleRef = u.role || u.role_id;
      let roleLabel = '—';
      if (typeof roleRef === 'object' && roleRef !== null) {
        roleLabel = roleRef.nomRole || roleRef.name || '—';
      } else if (roleRef) {
        const cached = (typeof _cachedRoles !== 'undefined') ? _cachedRoles.find(r => r._id === roleRef || r.id === roleRef) : null;
        roleLabel = cached ? (cached.nomRole || cached.name) : roleRef;
      }
      
      const isAdmin = roleLabel.toLowerCase().includes('admin');
      
      html += `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; border-bottom:1px solid rgba(148, 163, 184, 0.1);">
          <div>
            <div style="font-weight:600; font-size:13px;">${u.email}</div>
            <div style="font-size:11px; color:var(--text-dim);">${roleLabel}</div>
          </div>
          ${!isAdmin ? `<button class="action-btn delete" onclick="revokeAerodromeAccess('${u._id}', '${aerodromeId}', '${icao}')" title="Retirer l'accès">✕</button>` : `<span style="font-size:11px; color:var(--dim);">Fixe</span>`}
        </div>
      `;
    });
  }
  html += `</div>`;

  html += `<p style="margin-bottom:8px; font-weight:600; font-size:13px;">Ajouter un accès :</p>`;
  if (usersWithoutAccess.length === 0) {
    html += `<div style="font-size:12px; color:var(--text-dim);">Tous les utilisateurs ont déjà accès.</div>`;
  } else {
    const options = usersWithoutAccess.map(u => `<option value="${u._id}">${u.email}</option>`).join('');
    html += `<select id="grant-access-user-select" class="field-select" style="width:100%;">${options}</select>`;
  }

  showModal(
    `Accès à ${icao}`,
    html,
    async () => {
      const selectEl = document.getElementById('grant-access-user-select');
      if (!selectEl) return;
      const userId = selectEl.value;
      if (!userId) return;
      
      // Trouver l'utilisateur pour récupérer ses accès existants
      const user = usersWithoutAccess.find(u => u._id === userId);
      let newAutorises = Array.isArray(user?.aerodromes_autorises) ? [...user.aerodromes_autorises] : [];
      if (!newAutorises.includes(aerodromeId)) newAutorises.push(aerodromeId);

      try {
        await apiFetch(`/utilisateurs/${userId}`, 'PATCH', {
          aerodrome_id: aerodromeId, // Optionnel, mais on maintient la logique de base
          aerodromes: newAutorises,
        });
        showToast('Accès accordé', 'success');
        if (typeof loadUsers === 'function') loadUsers();
      } catch (e) {
        showToast("Erreur lors de l'attribution de l'accès : " + e.message, 'error');
      }
    }
  );
  
  // Changer le texte du bouton confirmer de showModal pour être plus clair
  const confirmBtn = document.querySelector('.modal-actions .btn-danger');
  if (confirmBtn) {
    confirmBtn.textContent = 'AJOUTER L\'ACCÈS';
    confirmBtn.className = 'btn-primary'; // Changer le style rouge en bleu primaire
  }
}

/**
 * Fonction globale pour retirer l'accès d'un utilisateur à un aérodrome
 */
window.revokeAerodromeAccess = async function(userId, aerodromeId, icao) {
  if (!confirm(`Voulez-vous vraiment retirer l'accès de cet utilisateur à l'aérodrome ${icao} ?`)) return;
  
  try {
    const res = await apiFetch('/utilisateurs');
    const users = res.data || [];
    const user = users.find(u => u._id === userId);
    
    if (!user) throw new Error("Utilisateur introuvable");
    
    let newAutorises = Array.isArray(user.aerodromes_autorises) ? user.aerodromes_autorises.filter(id => id !== aerodromeId) : [];
    
    // Si l'aérodrome retiré était son aérodrome principal, on le nullifie ou on prend un autre
    let patchData = { aerodromes: newAutorises };
    const currentMainId = typeof user.aerodrome_id === 'object' ? user.aerodrome_id?._id : user.aerodrome_id;
    if (currentMainId === aerodromeId) {
      patchData.aerodrome_id = newAutorises.length > 0 ? newAutorises[0] : null;
    }
    
    await apiFetch(`/utilisateurs/${userId}`, 'PATCH', patchData);
    showToast(`Accès retiré`, 'success');
    
    // Rafraîchir la modale d'accès
    closeModal();
    if (typeof loadUsers === 'function') loadUsers();
    openGrantAccessModal(aerodromeId, icao);
  } catch (e) {
    showToast("Erreur lors du retrait de l'accès : " + e.message, 'error');
  }
};
