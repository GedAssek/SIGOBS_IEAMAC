'use strict';
/**
 * SIGOBS — corbeille.js
 * Gestion de la Corbeille (éléments supprimés logiciellement)
 * FILTRAGE STRICT par aérodrome courant pour obstacles et pistes.
 */

/* ══════════════════════════════════════════════════════════
   CHARGEMENT DE LA CORBEILLE
   GET /{type}/deleted?aerodrome_id=:id  (obstacles & pistes)
   GET /{type}/deleted                   (aérodromes, utilisateurs — admin)
══════════════════════════════════════════════════════════ */
async function loadCorbeille() {
  const typeSelect = document.getElementById('corbeille-type-select');
  if (!typeSelect) return;
  const type = typeSelect.value; // 'obstacles' | 'aerodromes' | 'pistes' | 'utilisateurs'

  const tbody = document.getElementById('corbeille-list-tbody');
  const thead = document.getElementById('corbeille-thead-tr');

  if (!tbody || !thead) return;

  tbody.innerHTML = '<tr class="table-placeholder"><td colspan="6"><div class="loading-indicator"><svg class="spin" width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" stroke-dasharray="40 20"/></svg> Chargement…</div></td></tr>';

  // Mettre à jour le badge de l'aérodrome courant dans le header
  _updateCorbeilleAerodromeContext(type);

  // Configurer l'en-tête selon le type
  let theadHtml = '';
  switch (type) {
    case 'obstacles':
      theadHtml = '<th>NOM</th><th>TYPE</th><th>ALTITUDE</th><th>SUPPRIMÉ LE</th><th>ACTIONS</th>';
      break;
    case 'aerodromes':
      theadHtml = '<th>OACI</th><th>NOM</th><th>VILLE</th><th>SUPPRIMÉ LE</th><th>ACTIONS</th>';
      break;
    case 'pistes':
      theadHtml = '<th>QFU</th><th>AÉRODROME</th><th>LONGUEUR</th><th>SUPPRIMÉ LE</th><th>ACTIONS</th>';
      break;
    case 'utilisateurs':
      theadHtml = '<th>EMAIL</th><th>RÔLE</th><th>SUPPRIMÉ LE</th><th>ACTIONS</th>';
      break;
  }
  thead.innerHTML = theadHtml;

  try {
    const isAdmin    = typeof getIsAdmin    === 'function' ? getIsAdmin()    : false;
    const isEvaluator = typeof getIsEvaluator === 'function' ? getIsEvaluator() : false;

    // Construction de l'URL — filtrage par aérodrome courant côté backend pour obstacles et pistes
    let url = `/${type}/deleted`;
    const currentAeroId = App.currentAerodromeId || App.aerodromeMongoId;

    if ((type === 'obstacles' || type === 'pistes') && currentAeroId) {
      url += `?aerodrome_id=${currentAeroId}`;
    }

    const res = await apiFetch(url);
    let data = res.data || (Array.isArray(res) ? res : []);

    // ── Filtrage défensif côté client (double sécurité) ──────────
    if (!isAdmin && !isEvaluator) {
      // Les utilisateurs non-admin : restreindre aux éléments de l'aérodrome courant
      if (type === 'obstacles' || type === 'pistes') {
        if (currentAeroId) {
          data = data.filter(item => {
            const rawAeroId = item.aerodrome_id || item.aerodromeId || item.aerodrome;
            const aeroId = (typeof rawAeroId === 'object' && rawAeroId !== null)
              ? (rawAeroId._id || rawAeroId.id || rawAeroId)
              : rawAeroId;
            return String(aeroId) === String(currentAeroId);
          });
        } else {
          data = [];
        }
      } else if (type === 'aerodromes') {
        // Filtrer sur les aérodromes autorisés pour l'utilisateur
        const allowedIds = (App.aerodromesList || []).map(a => a._id || a);
        if (allowedIds.length > 0) {
          data = data.filter(item => allowedIds.includes(item._id));
        } else {
          data = [];
        }
      } else {
        // utilisateurs : réservé admin/évaluateur
        data = [];
      }
    } else if (type === 'obstacles' || type === 'pistes') {
      // Admin/évaluateur : filtrer quand même sur l'aérodrome courant
      // (l'admin ne doit voir que les éléments de l'aérodrome qu'il consulte)
      if (currentAeroId) {
        data = data.filter(item => {
          const rawAeroId = item.aerodrome_id || item.aerodromeId || item.aerodrome;
          const aeroId = (typeof rawAeroId === 'object' && rawAeroId !== null)
            ? (rawAeroId._id || rawAeroId.id || rawAeroId)
            : rawAeroId;
          return String(aeroId) === String(currentAeroId);
        });
      }
    }

    App.corbeilleList        = data;
    App.corbeilleCurrentType = type;
    App.corbeilleCurrentPage = 1;
    renderCorbeilleList();
  } catch (e) {
    tbody.innerHTML = `<tr class="table-placeholder"><td colspan="6" class="error-cell">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="vertical-align:middle; margin-right:6px;">
        <circle cx="12" cy="12" r="10" stroke="var(--danger)" stroke-width="1.5"/>
        <line x1="12" y1="8" x2="12" y2="12" stroke="var(--danger)" stroke-width="2" stroke-linecap="round"/>
        <circle cx="12" cy="16" r="1" fill="var(--danger)"/>
      </svg>
      Erreur lors du chargement : ${e.message}
    </td></tr>`;
  }
}

/** Met à jour le badge contextuel de l'aérodrome dans le header de la corbeille */
function _updateCorbeilleAerodromeContext(type) {
  const badge = document.getElementById('corbeille-aerodrome-badge');
  if (!badge) return;

  const icao = App.aerodrome?.icao || App.aerodrome?.code_oaci || null;
  const showBadge = (type === 'obstacles' || type === 'pistes') && icao;

  if (showBadge) {
    badge.textContent = `Aérodrome : ${icao}`;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

/* ══════════════════════════════════════════════════════════
   RENDU DU TABLEAU
══════════════════════════════════════════════════════════ */
function renderCorbeilleList() {
  const tbody = document.getElementById('corbeille-list-tbody');
  if (!tbody) return;
  const data = App.corbeilleList || [];
  const type = App.corbeilleCurrentType;
  const isAdmin = typeof getIsAdmin === 'function' ? getIsAdmin() : false;
  const isEvaluator = typeof getIsEvaluator === 'function' ? getIsEvaluator() : false;
  const canHardDelete = isAdmin; // seul l'admin peut supprimer définitivement

  if (!data.length) {
    const icao = App.aerodrome?.icao || '';
    const contextMsg = (type === 'obstacles' || type === 'pistes') && icao
      ? `pour l'aérodrome <strong>${icao}</strong>`
      : '';
    tbody.innerHTML = `<tr class="table-placeholder"><td colspan="6">
      <div class="empty-corbeille">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style="opacity:0.3; margin-bottom:8px;">
          <polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" stroke="currentColor" stroke-width="1.5"/>
        </svg>
        <span>Aucun élément supprimé ${contextMsg}</span>
      </div>
    </td></tr>`;
    App.corbeilleCurrentPage = 1;
    App.corbeilleTotalPages  = 1;
    updateCorbeillePaginationUI();
    return;
  }

  App.corbeilleCurrentPage  = App.corbeilleCurrentPage || 1;
  App.corbeilleTotalPages   = Math.ceil(data.length / 25) || 1;
  if (App.corbeilleCurrentPage > App.corbeilleTotalPages) {
    App.corbeilleCurrentPage = App.corbeilleTotalPages;
  }

  const start     = (App.corbeilleCurrentPage - 1) * 25;
  const paginated = data.slice(start, start + 25);

  let rowsHtml = '';
  paginated.forEach(item => {
    const deletedAt = item.deletedAt || item.deleted_at || item.updatedAt || null;
    const dateStr   = deletedAt ? new Date(deletedAt).toLocaleDateString('fr-FR', {
      day:   '2-digit', month: '2-digit', year: 'numeric',
      hour:  '2-digit', minute: '2-digit',
    }) : '—';

    rowsHtml += '<tr class="corbeille-row">';

    switch (type) {
      case 'obstacles':
        rowsHtml += `
          <td style="font-weight:600;">${item.nom || item.name || '—'}</td>
          <td><span class="type-badge">${item.type_obstacle || item.type || '—'}</span></td>
          <td class="mono">${item.altitude_max != null ? item.altitude_max + ' m' : '—'}</td>
        `;
        break;
      case 'aerodromes':
        rowsHtml += `
          <td style="font-weight:600;" class="mono">${item.code_oaci || '—'}</td>
          <td>${item.nom || '—'}</td>
          <td>${item.ville || '—'}</td>
        `;
        break;
      case 'pistes':
        rowsHtml += `
          <td style="font-weight:600;" class="mono">${[item.qfu_1, item.qfu_2].filter(Boolean).join('/') || '—'}</td>
          <td>${item.aerodrome_id?.code_oaci || item.aerodrome_id || '—'}</td>
          <td class="mono">${item.longueur != null ? item.longueur + ' m' : '—'}</td>
        `;
        break;
      case 'utilisateurs':
        rowsHtml += `
          <td style="font-weight:600;">${item.email || '—'}</td>
          <td>${item.role?.nomRole || item.role_id?.nomRole || item.role || '—'}</td>
        `;
        break;
    }

    // Colonne date suppression
    rowsHtml += `<td class="date-cell">${dateStr}</td>`;

    // Colonne actions
    rowsHtml += `<td class="actions-cell">
      <button class="action-btn restore-btn" onclick="restoreItem('${type}', '${item._id}')" title="Restaurer l'élément">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.64"/>
        </svg>
        RESTAURER
      </button>`;

    if (canHardDelete) {
      rowsHtml += `
      <button class="action-btn delete-btn" onclick="hardDeleteItem('${type}', '${item._id}', '${(item.nom || item.name || item.code_oaci || item.email || '').replace(/'/g, "\\'")}')" title="Supprimer définitivement">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14H6L5 6"/>
        </svg>
        DÉFINITIF
      </button>`;
    }

    rowsHtml += '</td></tr>';
  });

  tbody.innerHTML = rowsHtml;
  updateCorbeillePaginationUI();
}

/* ══════════════════════════════════════════════════════════
   PAGINATION
══════════════════════════════════════════════════════════ */
function updateCorbeillePaginationUI() {
  const paginationDiv = document.getElementById('corbeille-pagination');
  const info          = document.getElementById('corbeille-pagination-info');
  if (!paginationDiv) return;

  const total = App.corbeilleTotalPages || 1;
  const current = App.corbeilleCurrentPage || 1;

  paginationDiv.style.display = total > 1 ? 'flex' : 'none';
  if (info) info.textContent = `Page ${current} / ${total}`;

  const btnPrev = paginationDiv.querySelector('button:first-child');
  const btnNext = paginationDiv.querySelector('button:last-child');
  if (btnPrev) btnPrev.disabled = current <= 1;
  if (btnNext) btnNext.disabled = current >= total;
}

function nextCorbeillePage() {
  if ((App.corbeilleCurrentPage || 1) < (App.corbeilleTotalPages || 1)) {
    App.corbeilleCurrentPage++;
    renderCorbeilleList();
  }
}

function prevCorbeillePage() {
  if ((App.corbeilleCurrentPage || 1) > 1) {
    App.corbeilleCurrentPage--;
    renderCorbeilleList();
  }
}

/* ══════════════════════════════════════════════════════════
   RESTAURATION
══════════════════════════════════════════════════════════ */
async function restoreItem(type, id) {
  showModal(
    'RESTAURER L\'ÉLÉMENT',
    '<p style="margin:0; color:var(--text-secondary); font-size:13px;">Voulez-vous vraiment restaurer cet élément ? Il redeviendra visible et actif dans le système.</p>',
    async () => {
      try {
        await apiFetch(`/${type}/${id}/undelete`, 'PATCH');
        showToast('Élément restauré avec succès.', 'success');
        loadCorbeille();

        // Actualiser les données connexes
        if (type === 'obstacles'    && typeof loadObstaclesList     === 'function') loadObstaclesList();
        else if (type === 'aerodromes' && typeof loadAllAerodromes  === 'function') loadAllAerodromes();
        else if (type === 'pistes'     && typeof loadRunwaysAdminList === 'function') loadRunwaysAdminList();
        else if (type === 'utilisateurs' && typeof loadUsers        === 'function') loadUsers();
      } catch (e) {
        showToast('Erreur lors de la restauration : ' + e.message, 'error');
      }
    }
  );

  // Modifier le texte du bouton de confirmation dans la modale
  setTimeout(() => {
    const confirmBtn = document.querySelector('#modal-overlay .modal-actions button:last-child');
    if (confirmBtn) {
      confirmBtn.textContent = 'RESTAURER';
      confirmBtn.className = 'btn-primary';
      confirmBtn.style.background = 'var(--green)';
    }
  }, 0);
}

/* ══════════════════════════════════════════════════════════
   SUPPRESSION DÉFINITIVE (admin uniquement)
══════════════════════════════════════════════════════════ */
async function hardDeleteItem(type, id, label) {
  const isAdmin = typeof getIsAdmin === 'function' ? getIsAdmin() : false;
  if (!isAdmin) {
    showToast('Action réservée aux administrateurs.', 'error');
    return;
  }

  showModal(
    'SUPPRESSION DÉFINITIVE',
    `<p style="margin:0 0 10px; color:var(--text-secondary); font-size:13px;">
      Vous êtes sur le point de supprimer <strong style="color:var(--danger);">${label || 'cet élément'}</strong>
      définitivement. Cette action est <strong>irréversible</strong>.
    </p>
    <p style="margin:0; color:var(--danger); font-size:12px; font-weight:700;">⚠ Aucune restauration possible après cette opération.</p>`,
    async () => {
      try {
        await apiFetch(`/${type}/${id}`, 'DELETE');
        showToast('Élément supprimé définitivement.', 'success');
        loadCorbeille();
      } catch (e) {
        showToast('Erreur lors de la suppression : ' + e.message, 'error');
      }
    }
  );
}

/* ══════════════════════════════════════════════════════════
   INITIALISATION — Chargement automatique à l'activation de l'onglet
══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  const corbeilleBtn = document.getElementById('tab-btn-corbeille');
  if (corbeilleBtn) {
    corbeilleBtn.addEventListener('click', () => loadCorbeille());
  }
});
