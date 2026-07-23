/**
 * Gestion de la Corbeille (éléments supprimés logiciellement)
 */

async function loadCorbeille() {
  const typeSelect = document.getElementById('corbeille-type-select');
  if (!typeSelect) return;
  const type = typeSelect.value; // 'obstacles', 'aerodromes', 'pistes', 'utilisateurs'

  const tbody = document.getElementById('corbeille-list-tbody');
  const thead = document.getElementById('corbeille-thead-tr');
  
  if (!tbody || !thead) return;

  tbody.innerHTML = '<tr class="table-placeholder"><td colspan="5">Chargement...</td></tr>';

  // Configurer l'en-tête selon le type
  let theadHtml = '';
  switch (type) {
    case 'obstacles':
      theadHtml = '<th>NOM</th><th>TYPE</th><th>ALTITUDE</th><th>ACTIONS</th>';
      break;
    case 'aerodromes':
      theadHtml = '<th>OACI</th><th>NOM</th><th>VILLE</th><th>ACTIONS</th>';
      break;
    case 'pistes':
      theadHtml = '<th>QFU</th><th>AÉRODROME</th><th>LONGUEUR</th><th>ACTIONS</th>';
      break;
    case 'utilisateurs':
      theadHtml = '<th>EMAIL</th><th>RÔLE</th><th>ACTIONS</th>';
      break;
  }
  thead.innerHTML = theadHtml;

  try {
    const res = await apiFetch(`/${type}/deleted`);
    let data = res.data || [];
    
    // Filtrage local pour les non-admins : restreindre aux aérodromes autorisés
    const isAdmin = typeof getIsAdmin === 'function' ? getIsAdmin() : false;
    const isEvaluator = typeof getIsEvaluator === 'function' ? getIsEvaluator() : false;
    
    if (!isAdmin && !isEvaluator) {
      if (type === 'obstacles' || type === 'pistes') {
        const allowedIds = (App.aerodromesList || []).map(a => a._id);
        if (allowedIds.length > 0) {
          data = data.filter(item => {
            const aeroId = typeof item.aerodrome_id === 'object' ? item.aerodrome_id?._id : item.aerodrome_id;
            return allowedIds.includes(aeroId);
          });
        } else {
          data = [];
        }
      } else {
        // Un non-admin n'a pas accès aux aérodromes/utilisateurs supprimés
        data = [];
      }
    }

    App.corbeilleList = data;
    App.corbeilleCurrentType = type;
    App.corbeilleCurrentPage = 1;
    renderCorbeilleList();
  } catch (e) {
    console.error('[loadCorbeille]', e);
    tbody.innerHTML = `<tr class="table-placeholder"><td colspan="5" style="color:var(--danger);">Erreur : ${e.message}</td></tr>`;
  }
}

function renderCorbeilleList() {
  const tbody = document.getElementById('corbeille-list-tbody');
  if (!tbody) return;
  const data = App.corbeilleList || [];
  const type = App.corbeilleCurrentType;

  if (!data.length) {
    tbody.innerHTML = `<tr class="table-placeholder"><td colspan="5">Aucun élément supprimé trouvé.</td></tr>`;
    App.corbeilleCurrentPage = 1;
    App.corbeilleTotalPages = 1;
    updateCorbeillePaginationUI();
    return;
  }
  
  App.corbeilleCurrentPage = App.corbeilleCurrentPage || 1;
  App.corbeilleTotalPages = Math.ceil(data.length / 25) || 1;
  if (App.corbeilleCurrentPage > App.corbeilleTotalPages) App.corbeilleCurrentPage = App.corbeilleTotalPages;
  
  const start = (App.corbeilleCurrentPage - 1) * 25;
  const paginated = data.slice(start, start + 25);

  let rowsHtml = '';
  paginated.forEach(item => {
      rowsHtml += '<tr>';
      
      switch (type) {
        case 'obstacles':
          rowsHtml += `
            <td style="font-weight:600;">${item.nom}</td>
            <td>${item.type_obstacle || '—'}</td>
            <td class="mono">${item.altitude_max || '—'}</td>
          `;
          break;
        case 'aerodromes':
          rowsHtml += `
            <td style="font-weight:600;" class="mono">${item.code_oaci}</td>
            <td>${item.nom}</td>
            <td>${item.ville || '—'}</td>
          `;
          break;
        case 'pistes':
          rowsHtml += `
            <td style="font-weight:600;" class="mono">${item.qfu_1}/${item.qfu_2}</td>
            <td>${item.aerodrome_id?.code_oaci || item.aerodrome_id || '—'}</td>
            <td class="mono">${item.longueur} m</td>
          `;
          break;
        case 'utilisateurs':
          rowsHtml += `
            <td style="font-weight:600;">${item.email}</td>
            <td>${item.role?.nomRole || item.role_id?.nomRole || item.role || '—'}</td>
          `;
          break;
      }

      rowsHtml += `
        <td>
          <button class="action-btn" style="border-color:var(--green); color:var(--green)" onclick="restoreItem('${type}', '${item._id}')" title="Restaurer l'élément">RESTAURER</button>
        </td>
      </tr>`;
    });

    tbody.innerHTML = rowsHtml;
    updateCorbeillePaginationUI();
}

function updateCorbeillePaginationUI() {
  const paginationDiv = document.getElementById('corbeille-pagination');
  const info = document.getElementById('corbeille-pagination-info');
  if (!paginationDiv) return;
  
  paginationDiv.style.display = 'flex';
  if (info) info.textContent = `Page ${App.corbeilleCurrentPage} sur ${App.corbeilleTotalPages}`;
  
  const btnPrev = paginationDiv.querySelector('button:first-child');
  const btnNext = paginationDiv.querySelector('button:last-child');
  if (btnPrev) btnPrev.disabled = App.corbeilleCurrentPage <= 1;
  if (btnNext) btnNext.disabled = App.corbeilleCurrentPage >= App.corbeilleTotalPages;
}

function nextCorbeillePage() {
  if (App.corbeilleCurrentPage < App.corbeilleTotalPages) {
    App.corbeilleCurrentPage++;
    renderCorbeilleList();
  }
}

function prevCorbeillePage() {
  if (App.corbeilleCurrentPage > 1) {
    App.corbeilleCurrentPage--;
    renderCorbeilleList();
  }
}

async function restoreItem(type, id) {
  if (!confirm('Voulez-vous vraiment restaurer cet élément ?')) return;

  try {
    await apiFetch(`/${type}/${id}/undelete`, 'PATCH');
    showToast('Élément restauré avec succès.', 'success');
    
    // Recharger la corbeille
    loadCorbeille();

    // Actualiser les données en mémoire si possible
    if (type === 'obstacles' && typeof loadObstaclesList === 'function') {
      loadObstaclesList();
    } else if (type === 'aerodromes' && typeof loadAllAerodromes === 'function') {
      loadAllAerodromes();
    } else if (type === 'pistes' && typeof loadRunwaysAdminList === 'function') {
      loadRunwaysAdminList();
    } else if (type === 'utilisateurs' && typeof loadUsers === 'function') {
      loadUsers();
    }
  } catch (e) {
    console.error('[restoreItem]', e);
    showToast('Erreur lors de la restauration : ' + e.message, 'error');
  }
}

// Intercepter les changements d'onglet pour charger automatiquement la corbeille
document.addEventListener('DOMContentLoaded', () => {
  const corbeilleBtn = document.getElementById('tab-btn-corbeille');
  if (corbeilleBtn) {
    corbeilleBtn.addEventListener('click', () => {
      loadCorbeille();
    });
  }
});
