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
    const res   = await apiFetch('/utilisateurs');
    const users = res.data || [];
    renderUsersList(users);
  } catch (e) {
    console.warn('[loadUsers]', e.message);
    if (tbody) tbody.innerHTML = '<tr class="table-placeholder"><td colspan="4">Erreur de chargement</td></tr>';
    showToast('Erreur chargement utilisateurs', 'error');
  }
}

/** Génère le tableau HTML des utilisateurs */
function renderUsersList(users) {
  const tbody = document.getElementById('users-list-tbody');
  if (!tbody) return;
  if (!users.length) {
    tbody.innerHTML = '<tr class="table-placeholder"><td colspan="4">Aucun utilisateur trouvé</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => {
    const roleRef = u.role || u.role_id;
    let roleLabel = '—';
    if (typeof roleRef === 'object' && roleRef !== null) {
      roleLabel = roleRef.nomRole || roleRef.name || '—';
    } else if (roleRef) {
      const cached = _cachedRoles.find(r => r._id === roleRef || r.id === roleRef);
      if (cached) roleLabel = cached.nomRole || cached.name;
      else roleLabel = roleRef;
    }
    const aeroLabel = u.aerodrome_id?.code_oaci || u.aerodrome_id?.nom || '—';
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
}

/* ══════════════════════════════════════════════════════════
   CRÉER UN UTILISATEUR — POST /utilisateurs (doc §9.3)
   Le mot de passe est hashé automatiquement côté backend (bcrypt).
   Le champ password ne revient jamais dans les réponses.
══════════════════════════════════════════════════════════ */
async function createUser() {
  const email      = (document.getElementById('user-email')?.value   || '').trim();
  const password   =  document.getElementById('user-password')?.value || '';
  const roleId     =  document.getElementById('user-role-select')?.value || '';
  // Scope optionnel : associer l'utilisateur à l'aérodrome d'étude courant
  const aerodromeId = App.aerodromeMongoId || '';

  if (!email || !password || !roleId) {
    showToast('Email, mot de passe et rôle sont requis', 'warn');
    return;
  }

  const payload = {
    email,
    password,
    role_id: roleId,
    ...(aerodromeId ? { aerodrome_id: aerodromeId } : {}),
  };

  try {
    await apiFetch('/utilisateurs', 'POST', payload);
    showToast(`Utilisateur « ${email} » créé avec succès`, 'success');
    clearUserForm();
    await loadUsers();
  } catch (e) {
    showToast('Erreur : ' + e.message, 'error');
    console.error('[createUser]', e);
  }
}

/** Réinitialise le formulaire de création d'utilisateur */
function clearUserForm() {
  ['user-email', 'user-password'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const sel = document.getElementById('user-role-select');
  if (sel) sel.value = '';
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
