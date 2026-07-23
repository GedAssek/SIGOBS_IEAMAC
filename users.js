'use strict';
/* ═══════════════════════════════════════════════════════════
   SIGOBS — users.js
   Gestion des utilisateurs et des rôles RBAC
   Routes :
     GET    /utilisateurs        (doc §9.2) — Admin uniquement
     POST   /utilisateurs        (doc §9.3) — Admin uniquement
     DELETE /utilisateurs/:id    (doc §9.4) — Admin uniquement
     GET    /roles               (doc §10.2) — Admin uniquement
     POST   /roles               (doc §10.3) — Admin uniquement
   Dépend de : config.js (App), api.js (apiFetch, showToast, showModal)
   ═══════════════════════════════════════════════════════════ */

/* ── Cache des rôles (évite des appels répétés) ──────────── */
let _cachedRoles = [];

/* ══════════════════════════════════════════════════════════
   RÔLES — GET /roles
══════════════════════════════════════════════════════════ */

/** Charge la liste des rôles depuis le backend */
async function loadRoles() {
  try {
    const res = await apiFetch('/roles');
    _cachedRoles = res.data || [];
    return _cachedRoles;
  } catch (e) {
    console.warn('[loadRoles]', e.message);
    showToast('Impossible de charger les rôles', 'warn');
    return [];
  }
}

/** Remplit le select des rôles dans le formulaire de création d'utilisateur */
async function populateRoleSelect() {
  const select = document.getElementById('user-role-select');
  if (!select) return;
  if (!_cachedRoles.length) await loadRoles();
  select.innerHTML =
    '<option value="">— Choisir un rôle —</option>' +
    _cachedRoles.map(r =>
      `<option value="${r._id}">${r.nomRole}</option>`
    ).join('');
}

/** Crée un nouveau rôle — POST /roles (doc §10.3) */
async function createRole() {
  const nameEl = document.getElementById('role-name-input');
  const nomRole = nameEl ? nameEl.value.trim() : '';
  if (!nomRole) { showToast('Nom du rôle requis', 'warn'); return; }
  try {
    await apiFetch('/roles', 'POST', { nomRole });
    showToast(`Rôle « ${nomRole} » créé`, 'success');
    if (nameEl) nameEl.value = '';
    _cachedRoles = []; // Invalider le cache
    await populateRoleSelect();
  } catch (e) {
    showToast('Erreur : ' + e.message, 'error');
  }
}

/* ══════════════════════════════════════════════════════════
   UTILISATEURS — GET /utilisateurs
══════════════════════════════════════════════════════════ */

/** Charge et affiche la liste des utilisateurs */
async function loadUsers() {
  const tbody = document.getElementById('users-list-tbody');
  if (tbody) tbody.innerHTML = '<tr class="table-placeholder"><td colspan="4">Chargement…</td></tr>';
  try {
    if (!_cachedRoles.length) await loadRoles();
    populateUserAerodromes(); // Remplir la liste d'aérodromes pour la création
    const res   = await apiFetch('/utilisateurs');
    App.usersList = res.data || [];
    App.usersCurrentPage = 1;
    renderUsersList();
  } catch (e) {
    console.warn('[loadUsers]', e.message);
    if (tbody) tbody.innerHTML = '<tr class="table-placeholder"><td colspan="4">Erreur de chargement</td></tr>';
    showToast('Erreur chargement utilisateurs', 'error');
  }
}

/** Génère le tableau HTML des utilisateurs (paginé) */
function renderUsersList() {
  const tbody = document.getElementById('users-list-tbody');
  if (!tbody) return;
  const users = App.usersList || [];
  if (!users.length) {
    tbody.innerHTML = '<tr class="table-placeholder"><td colspan="4">Aucun utilisateur trouvé</td></tr>';
    updateUsersPaginationUI();
    return;
  }
  
  App.usersCurrentPage = App.usersCurrentPage || 1;
  App.usersTotalPages = Math.ceil(users.length / 25) || 1;
  if (App.usersCurrentPage > App.usersTotalPages) App.usersCurrentPage = App.usersTotalPages;
  
  const start = (App.usersCurrentPage - 1) * 25;
  const paginated = users.slice(start, start + 25);
  
  tbody.innerHTML = paginated.map(u => {
    const roleRef = u.role || u.role_id;
    let roleLabel = '—';
    if (typeof roleRef === 'object' && roleRef !== null) {
      roleLabel = roleRef.nomRole || roleRef.name || '—';
    } else if (roleRef) {
      const cached = _cachedRoles.find(r => r._id === roleRef || r.id === roleRef);
      if (cached) roleLabel = cached.nomRole || cached.name;
      else roleLabel = roleRef;
    }
    let aeroLabel = '—';
    const aeroArray = Array.isArray(u.aerodromes) ? u.aerodromes : (Array.isArray(u.aerodromes_autorises) ? u.aerodromes_autorises : null);
    if (aeroArray && aeroArray.length > 0) {
      aeroLabel = aeroArray.map(a => {
        if (typeof a === 'object') return a.code_oaci || a.icao || a.nom || 'Inconnu';
        const aero = App.aerodromesList?.find(aer => aer._id === a || aer.id === a);
        return aero ? (aero.code_oaci || aero.icao || aero.nom || 'Inconnu') : 'Inconnu';
      }).join(', ');
    } else if (u.aerodrome_id) {
      aeroLabel = u.aerodrome_id.code_oaci || u.aerodrome_id.nom || '—';
    }
    const emailSafe = (u.email || '').replace(/'/g, "\\'");
    return `<tr>
      <td style="font-weight:600;">${u.email || '—'}</td>
      <td><span class="tag tag-info">${roleLabel}</span></td>
      <td>${aeroLabel}</td>
      <td>
        <div class="action-group">
          <button class="action-btn delete" onclick="confirmDeleteUser('${u._id}','${emailSafe}')">✕</button>
        </div>
      </td>
    </tr>`;
  }).join('');
  
  updateUsersPaginationUI();
}

function updateUsersPaginationUI() {
  const paginationDiv = document.getElementById('users-pagination');
  const info = document.getElementById('users-pagination-info');
  if (!paginationDiv) return;
  
  paginationDiv.style.display = 'flex';
  if (info) info.textContent = `Page ${App.usersCurrentPage} sur ${App.usersTotalPages}`;
  
  const btnPrev = paginationDiv.querySelector('button:first-child');
  const btnNext = paginationDiv.querySelector('button:last-child');
  if (btnPrev) btnPrev.disabled = App.usersCurrentPage <= 1;
  if (btnNext) btnNext.disabled = App.usersCurrentPage >= App.usersTotalPages;
}

function nextUsersPage() {
  if (App.usersCurrentPage < App.usersTotalPages) {
    App.usersCurrentPage++;
    renderUsersList();
  }
}

function prevUsersPage() {
  if (App.usersCurrentPage > 1) {
    App.usersCurrentPage--;
    renderUsersList();
  }
}

/** 
 * Peuple la liste des cases à cocher pour le choix d'aérodromes lors de la création d'utilisateur
 */
async function populateUserAerodromes() {
  const container = document.getElementById('user-aero-checkboxes');
  if (!container) return;
  
  if (!App.aerodromesList || !App.aerodromesList.length) {
    container.innerHTML = '<div class="empty-msg" style="font-size:11px;">Chargement...</div>';
    try {
      const res = await apiFetch('/aerodromes');
      App.aerodromesList = res.data || [];
    } catch (e) {
      container.innerHTML = '<div class="empty-msg" style="font-size:11px; color:var(--danger);">Erreur chargement</div>';
      return;
    }
  }

  if (!App.aerodromesList.length) {
    container.innerHTML = '<div class="empty-msg" style="font-size:11px;">Aucun aérodrome</div>';
    return;
  }

  container.innerHTML = App.aerodromesList.map(a => `
    <label class="toggle-label user-aero-item" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
      <input type="checkbox" value="${a._id}" data-icao="${a.code_oaci || a.icao || ''}" data-name="${a.nom || a.name || ''}" />
      <span style="font-size:12px;"><strong>${a.code_oaci || a.icao || '—'}</strong> ${a.nom || a.name || ''}</span>
    </label>
  `).join('');
}

/** 
 * Filtre la liste des aérodromes dans le formulaire de création d'utilisateur
 */
function filterUserAerodromes() {
  const input = document.getElementById('user-aero-search');
  if (!input) return;
  const filter = input.value.toLowerCase();
  const items = document.querySelectorAll('.user-aero-item');
  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(filter) ? 'flex' : 'none';
  });
}

/**
 * Affiche le résumé avant de confirmer la création
 */
function reviewUserCreation() {
  const email      = (document.getElementById('user-email')?.value   || '').trim();
  const password   = email; // Le mot de passe par défaut est l'email
  const roleSelect =  document.getElementById('user-role-select');
  const roleId     =  roleSelect?.value || '';
  const roleName   =  roleSelect?.options[roleSelect.selectedIndex]?.text || '';
  
  if (!email || !roleId) {
    showToast('Email et rôle sont requis', 'warn');
    return;
  }

  // Récupérer les aérodromes sélectionnés
  const checkedBoxes = Array.from(document.querySelectorAll('#user-aero-checkboxes input[type="checkbox"]:checked'));
  const selectedAeros = checkedBoxes.map(cb => ({
    id: cb.value,
    icao: cb.getAttribute('data-icao'),
    name: cb.getAttribute('data-name')
  }));

  let aeroHtml = '<div style="margin-top:10px; padding:10px; background:rgba(0,0,0,0.05); border-radius:4px;">';
  aeroHtml += '<strong>Aérodromes associés :</strong><ul style="margin:5px 0 0 20px; font-size:13px; color:var(--text-secondary);">';
  if (selectedAeros.length > 0) {
    selectedAeros.forEach(a => aeroHtml += `<li>${a.icao} - ${a.name}</li>`);
  } else {
    aeroHtml += '<li><em>Aucun aérodrome sélectionné</em></li>';
  }
  aeroHtml += '</ul></div>';

  const bodyHtml = `
    <p>Veuillez vérifier les informations suivantes avant la création de l'utilisateur :</p>
    <div style="margin-top:15px; font-size:14px;">
      <p><strong>Email :</strong> ${email}</p>
      <p><strong>Mot de passe :</strong> <em>Identique à l'email (à changer à la première connexion)</em></p>
      <p><strong>Rôle :</strong> ${roleName}</p>
      ${aeroHtml}
    </div>
  `;

  showModal('Résumé de création', bodyHtml, () => {
    confirmCreateUser(email, password, roleId, selectedAeros.map(a => a.id));
  });
}

/** Crée l'utilisateur en envoyant les données au serveur */
async function confirmCreateUser(email, password, roleId, aerodromeIds) {
  const payload = {
    email,
    password,
    role_id: roleId,
  };
  
  // Envoyer le tableau des aérodromes associés
  if (aerodromeIds.length > 0) {
    payload.aerodromes = aerodromeIds;
  }

  try {
    await apiFetch('/utilisateurs', 'POST', payload);
    showToast(`Utilisateur « ${email} » créé avec succès`, 'success');
    clearUserForm();
    await loadUsers();
  } catch (e) {
    showToast('Erreur : ' + e.message, 'error');
    console.error('[confirmCreateUser]', e);
  }
}

/** Réinitialise le formulaire de création d'utilisateur */
function clearUserForm() {
  ['user-email', 'user-password', 'user-aero-search'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const sel = document.getElementById('user-role-select');
  if (sel) sel.value = '';
  
  // Décocher les aérodromes et réinitialiser le filtre
  const checkboxes = document.querySelectorAll('#user-aero-checkboxes input[type="checkbox"]');
  checkboxes.forEach(cb => cb.checked = false);
  filterUserAerodromes(); // Rétablir l'affichage de tous les items
}

/* ══════════════════════════════════════════════════════════
   SUPPRIMER UN UTILISATEUR — DELETE /utilisateurs/:id (doc §9.4)
   Suppression logique (soft delete — is_deleted: true)
══════════════════════════════════════════════════════════ */
function confirmDeleteUser(id, email) {
  showModal(
    "Supprimer l'utilisateur",
    `Confirmer la suppression de <strong>${email}</strong> ?<br>
     <small style="color:var(--dim)">Suppression logique — l'accès sera révoqué.</small>`,
    async () => {
      try {
        await apiFetch(`/utilisateurs/${id}`, 'DELETE');
        showToast('Utilisateur supprimé', 'success');
        await loadUsers();
      } catch (e) {
        showToast('Erreur : ' + e.message, 'error');
      }
    }
  );
}
