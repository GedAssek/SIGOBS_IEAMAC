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
    const data = res.data || [];

    if (!data.length) {
      tbody.innerHTML = `<tr class="table-placeholder"><td colspan="5">Aucun élément supprimé trouvé.</td></tr>`;
      return;
    }

    let rowsHtml = '';
    data.forEach(item => {
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
  } catch (e) {
    console.error('[loadCorbeille]', e);
    tbody.innerHTML = `<tr class="table-placeholder"><td colspan="5" style="color:var(--danger);">Erreur : ${e.message}</td></tr>`;
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
