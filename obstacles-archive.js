'use strict';
/* ═══════════════════════════════════════════════════════════
   SIGOBS — obstacles-archive.js
   Journal d'archive des actions effectuées sur la base (obstacles,
   aérodromes, pistes).

   Source de vérité : GET /evenements (doc API §8) — endpoint d'audit
   RÉEL et persistant du backend, généré automatiquement à chaque
   Create/Update/Delete, réservé aux rôles Admin et Evaluator.
   Ne prend qu'un filtre `document_id` ; comme il n'existe pas de
   filtre par aérodrome côté serveur, on récupère tous les événements
   puis on ne garde que ceux liés à l'aérodrome courant (ses
   obstacles, lui-même, ses pistes).

   Repli local (localStorage) : conservé uniquement pour les rôles
   sans accès à /evenements (ex. Data Technician → 403) ou en cas
   d'indisponibilité réseau, afin de ne jamais laisser l'onglet vide.

   ── Lien avec la temporalité AIXM 5.2 ──────────────────────
   AIXM 5.2 modélise l'évolution d'un objet aéronautique par une
   succession de "timeSlices" : chaque timeSlice porte une période de
   validité (validTime) et un type d'événement (BASELINE = état
   initial, PERMDELTA = changement permanent, TEMPDELTA = changement
   temporaire réversible, comme un obstacle de chantier). On reprend
   cette classification pour annoter chaque événement :
     - CREATE                         → BASELINE
     - UPDATE                         → PERMDELTA
     - obstacle temporaire concerné   → TEMPDELTA
     - DELETE                         → PERMDELTA (fin de validité)

   Dépend de : config.js (App), api.js (apiFetch, showToast)
   ═══════════════════════════════════════════════════════════ */

const ARCHIVE_STORAGE_PREFIX = 'sigobs_archive_';
const ARCHIVE_MAX_ENTRIES = 500;

/**
 * Enregistre une action dans le journal LOCAL (repli uniquement — voir
 * en-tête du fichier). Les actions passant par l'API sont de toute façon
 * déjà tracées par le backend via /evenements.
 */
function logAction(actionType, objetType, objetNom, detail, temporality) {
  if (!App.aerodromeMongoId) return;
  const entry = {
    ts: new Date().toISOString(),
    user: App.user?.email || '—',
    actionType, objetType, objetNom, detail: detail || '',
    temporality: temporality || (actionType === 'creation' ? 'BASELINE' : 'PERMDELTA'),
  };
  const key = ARCHIVE_STORAGE_PREFIX + App.aerodromeMongoId;
  let list = [];
  try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { list = []; }
  list.unshift(entry);
  if (list.length > ARCHIVE_MAX_ENTRIES) list = list.slice(0, ARCHIVE_MAX_ENTRIES);
  try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { console.warn('[logAction] localStorage plein', e); }
}

/** Repli local : récupère le journal stocké côté client pour l'aérodrome courant */
function getLocalArchiveEntries() {
  if (!App.aerodromeMongoId) return [];
  const key = ARCHIVE_STORAGE_PREFIX + App.aerodromeMongoId;
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; }
}

const ACTION_LABELS_BACKEND = { CREATE: 'Création', UPDATE: 'Modification', DELETE: 'Suppression' };
const ACTION_TAG_BACKEND = { CREATE: 'tag-pass', UPDATE: 'tag-info', DELETE: 'tag-fail' };
const TEMPORALITY_LABELS = {
  BASELINE: 'BASELINE (état initial)',
  PERMDELTA: 'PERMDELTA (changement permanent)',
  TEMPDELTA: 'TEMPDELTA (changement temporaire)',
};

// Fonctions obsolètes supprimées (summarizeEventDiff, resolveEventObjectName, eventBelongsToCurrentAerodrome)

App.archiveCurrentPage = App.archiveCurrentPage || 1;
App.archiveTotalPages = App.archiveTotalPages || 1;

/**
 * Récupère les événements d'audit depuis le backend (GET /evenements),
 * avec prise en charge de la pagination.
 */
async function fetchArchiveEntries(forceRefresh = false) {
  // Client-side pagination strategy: fetch all (or large number) once, then paginate
  if (!forceRefresh && App.allArchiveEvents) {
    const start = (App.archiveCurrentPage - 1) * 25;
    const paginated = App.allArchiveEvents.slice(start, start + 25);
    return { source: 'backend', entries: paginated, fromCache: true };
  }
  
  try {
    // Attempt to fetch a large number to ensure we have all elements for client-side pagination
    const res = await apiFetch(`/evenements?limit=10000&size=10000&per_page=10000`);
    const events = res.data || (Array.isArray(res) ? res : []);
    
    App.allArchiveEvents = events;
    App.archiveTotalPages = Math.ceil(events.length / 25) || 1;
    
    if (App.archiveCurrentPage > App.archiveTotalPages) App.archiveCurrentPage = App.archiveTotalPages;
    const start = (App.archiveCurrentPage - 1) * 25;
    const paginated = events.slice(start, start + 25);
    
    return { source: 'backend', entries: paginated, fromCache: false };
  } catch (e) {
    console.warn('[fetchArchiveEntries] /evenements indisponible, repli local :', e.message);
    const local = getLocalArchiveEntries();
    App.archiveTotalPages = Math.ceil(local.length / 25) || 1;
    if (App.archiveCurrentPage > App.archiveTotalPages) App.archiveCurrentPage = App.archiveTotalPages;
    
    const start = (App.archiveCurrentPage - 1) * 25;
    const paginatedLocal = local.slice(start, start + 25);
    return { source: 'local', entries: paginatedLocal };
  }
}

function updateArchivePaginationUI() {
  const paginationDiv = document.getElementById('archive-pagination');
  const info = document.getElementById('archive-pagination-info');
  if (!paginationDiv) return;
  
  paginationDiv.style.display = 'flex';
  if (info) info.textContent = `Page ${App.archiveCurrentPage} sur ${App.archiveTotalPages}`;
  
  const btnPrev = paginationDiv.querySelector('button:first-child');
  const btnNext = paginationDiv.querySelector('button:last-child');
  if (btnPrev) btnPrev.disabled = App.archiveCurrentPage <= 1;
  if (btnNext) btnNext.disabled = App.archiveCurrentPage >= App.archiveTotalPages;
}

async function nextArchivePage() {
  if (App.archiveCurrentPage < App.archiveTotalPages) {
    App.archiveCurrentPage++;
    await renderArchiveTab(true);
  }
}

async function prevArchivePage() {
  if (App.archiveCurrentPage > 1) {
    App.archiveCurrentPage--;
    await renderArchiveTab(true);
  }
}

const INTERNAL_KEYS = ['_id', '__v', 'createdAt', 'updatedAt', 'id', 'is_deleted', 'aerodrome_id', 'piste_id', 'document_id', 'utilisateur_id', 'balisage'];

/** Formate une clé technique en libellé lisible pour l'utilisateur */
function formatEventKey(k) {
  const labels = {
    'geometrie': 'Position (Coordonnées)', 'altitude_max': 'Altitude Maximum (m)', 'hauteur': 'Hauteur (m)',
    'zone_de_couverture': 'Zone de couverture', 'frangibilite': 'Frangible', 'statut_validation': 'Statut',
    'nom': 'Nom', 'type_obstacle': "Type d'obstacle", 'precision': 'Précision', 'source': 'Source',
    'mobilite': 'Mobilité', 'permanence': 'Permanence', 'id_visible': 'Identifiant Visible',
    'proprietaire': 'Propriétaire', 'description': 'Description', 'date_recensement': 'Date du relevé',
    'qfu_1': 'QFU 1', 'qfu_2': 'QFU 2', 'longueur': 'Longueur (m)', 'largeur': 'Largeur (m)',
    'code_reference': 'Code de référence', 'altitude': 'Altitude', 'var': 'Déclinaison magnétique',
    'ville': 'Ville', 'code_oaci': 'Code OACI', 'code_iata': 'Code IATA', 'pays': 'Pays'
  };
  return labels[k] || k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ');
}

/** Rendu de l'onglet Archive */
async function renderArchiveTab(forceRefresh = false) {
  const tbody = document.getElementById('archive-list-tbody');
  const sourceNote = document.getElementById('archive-source-note');
  if (!tbody) return;
  tbody.innerHTML = '<tr class="table-placeholder"><td colspan="7">Chargement du journal…</td></tr>';

  let { source, entries, fromCache } = await fetchArchiveEntries(forceRefresh);

  if (sourceNote) {
    const cacheNote = fromCache ? ' (données en cache — cliquer ACTUALISER pour rafraîchir)' : '';
    sourceNote.textContent = source === 'backend'
      ? `✓ Journal officiel du serveur (GET /evenements)${cacheNote}`
      : '⚠ Journal local de secours (accès /evenements refusé ou indisponible — rôle Admin/Evaluator requis)';
    sourceNote.style.color = source === 'backend' ? 'var(--green)' : 'var(--amber)';
  }

  if (!entries.length) {
    tbody.innerHTML = '<tr class="table-placeholder"><td colspan="7">Aucune action enregistrée</td></tr>';
    return;
  }

  if (source === 'backend') {
    tbody.innerHTML = entries.map(ev => {
      const date = new Date(ev.date_heure);
      const auteur = ev.auteur || 'Système';
      let actionClass = 'tag-info';
      if (ev.action?.toLowerCase().includes('création')) actionClass = 'tag-pass';
      if (ev.action?.toLowerCase().includes('suppression')) actionClass = 'tag-fail';
      
      const propsMods = Array.isArray(ev.proprietes_modifiees) ? ev.proprietes_modifiees : [];
      // Filtrer les champs internes et formater
      const visibleProps = propsMods
        .filter(k => !INTERNAL_KEYS.includes(k))
        .map(formatEventKey);
      
      const summary = visibleProps.length ? `Champs: ${visibleProps.join(', ')}` : '—';
      return `<tr>
        <td class="mono" style="font-size:11px;">${date.toLocaleDateString('fr-FR')} ${date.toLocaleTimeString('fr-FR')}</td>
        <td><span class="tag ${actionClass}">${ev.action || '—'}</span></td>
        <td>${ev.collection || '—'}</td>
        <td style="font-weight:600;">${ev.nom_semantique || '—'}</td>
        <td style="font-size:11px;color:var(--text-secondary);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${summary}">${summary}</td>
        <td style="font-size:11px;color:var(--text-dim);">${auteur}</td>
        <td><button class="action-btn" style="font-size:10px; padding: 2px 6px;" onclick="showEventDetails('${ev.id}')">DÉTAILS</button></td>
      </tr>`;
    }).join('');
  } else {
    tbody.innerHTML = entries.map(e => {
      const date = new Date(e.ts);
      let actionTag = 'tag-info';
      if (e.actionType === 'creation') actionTag = 'tag-pass';
      if (e.actionType === 'suppression') actionTag = 'tag-fail';
      const labels = {
        creation: 'Création', modification: 'Modification', suppression: 'Suppression',
        statut: 'Changement de statut', balisage: 'État de balisage', action_recommandee: 'Action recommandée',
      };
      return `<tr>
        <td class="mono" style="font-size:11px;">${date.toLocaleDateString('fr-FR')} ${date.toLocaleTimeString('fr-FR')}</td>
        <td><span class="tag ${actionTag}">${labels[e.actionType] || e.actionType}</span></td>
        <td>${e.objetType}</td>
        <td style="font-weight:600;">${e.objetNom}</td>
        <td style="font-size:11px;color:var(--text-secondary);">${e.detail || '—'}</td>
        <td style="font-size:11px;color:var(--text-dim);">${e.user || '—'}</td>
        <td></td>
      </tr>`;
    }).join('');
  }
  updateArchivePaginationUI();
}

/** Affiche les détails d'un événement d'audit */
async function showEventDetails(id) {
  try {
    const res = await apiFetch(`/evenements/${id}/detail`);
    const ev = res.data || res; // Supporte si le backend renvoie l'objet directement
    
    const typeActionRaw = (ev.type_action || ev.action || 'Action système').toUpperCase();
    let actionLabel = typeActionRaw;
    let actionCategory = 'UPDATE';
    if (typeActionRaw.includes('INSERT') || typeActionRaw.includes('CRÉATION') || typeActionRaw.includes('CREATE')) {
      actionLabel = 'Création';
      actionCategory = 'CREATE';
    } else if (typeActionRaw.includes('DELETE') || typeActionRaw.includes('SUPPRESSION')) {
      actionLabel = 'Suppression';
      actionCategory = 'DELETE';
    } else if (typeActionRaw.includes('UPDATE') || typeActionRaw.includes('MODIFICATION')) {
      actionLabel = 'Modification';
      actionCategory = 'UPDATE';
    }

    const anciennes = ev.anciennes_valeurs || {};
    const nouvelles = ev.nouvelles_valeurs || {};
    const allKeys = new Set([...Object.keys(anciennes), ...Object.keys(nouvelles)]);
    
    let changements = [];

    // Priorité absolue : générer les diffs à partir des objets structurés (anciennes/nouvelles valeurs)
    if (allKeys.size > 0) {
      changements = Array.from(allKeys)
        .map(key => ({
          propriete: key,
          ancienne_valeur: anciennes[key],
          nouvelle_valeur: nouvelles[key]
        }));
    } else {
      // Repli si le backend a envoyé une structure différente (ex: ev.changements)
      let rawChangements = ev.changements || ev.diff || res.changements || [];
      changements = rawChangements.map(c => {
        if (typeof c === 'string') return { propriete: c };
        return c;
      });
    }

    // Filtrer les clés internes et les changements sans valeur exploitable
    changements = changements.filter(c => {
      const prop = c.propriete || c.field || c.nom;
      if (!prop || INTERNAL_KEYS.includes(prop)) return false;

      const o = c.ancienne_valeur !== undefined ? c.ancienne_valeur : c.old;
      const n = c.nouvelle_valeur !== undefined ? c.nouvelle_valeur : c.new;
      
      // En création ou suppression on a besoin d'au moins une des deux valeurs
      if (o === undefined && n === undefined) return false;
      return true;
    });

    // Filtrer les changements selon le type d'action pour ne garder que ce qui a varié
    if (actionCategory === 'UPDATE') {
      changements = changements.filter(c => {
        const o = c.ancienne_valeur !== undefined ? c.ancienne_valeur : c.old;
        const n = c.nouvelle_valeur !== undefined ? c.nouvelle_valeur : c.new;
        return JSON.stringify(o) !== JSON.stringify(n); 
      });
    }

    const formatValue = (v) => {
      if (v === null || v === undefined || v === '') return '—';
      if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
      if (typeof v === 'object') {
        if (v.type === 'Point' && Array.isArray(v.coordinates)) {
          return `Lat ${v.coordinates[1].toFixed(5)}, Lng ${v.coordinates[0].toFixed(5)}`;
        }
        if (Array.isArray(v)) return v.join(', ');
        return JSON.stringify(v);
      }
      if (typeof v === 'string' && v.match(/^\d{4}-\d{2}-\d{2}T/)) {
        try { return new Date(v).toLocaleString('fr-FR'); } catch(e) {}
      }
      return String(v);
    };

    let diffListHtml = '';
    
    if (changements.length > 0) {
      diffListHtml = changements.map(c => {
        const propKey = c.propriete || c.field || c.nom;
        const prop = formatEventKey(propKey || 'Propriété');
        let oldV = c.ancienne_valeur !== undefined ? c.ancienne_valeur : (c.old !== undefined ? c.old : null);
        let newV = c.nouvelle_valeur !== undefined ? c.nouvelle_valeur : (c.new !== undefined ? c.new : null);
        
        // Convertir altitude_max et hauteur de ft en m
        if (propKey === 'altitude_max' || propKey === 'hauteur' || propKey === 'altitude') {
          if (typeof oldV === 'number') oldV = Math.round((oldV / 3.28084) * 100) / 100;
          if (typeof newV === 'number') newV = Math.round((newV / 3.28084) * 100) / 100;
        }

        let valHtml = '';
        if (actionCategory === 'CREATE') {
          valHtml = `<div style="color:var(--green); word-break:break-word;">${formatValue(newV)}</div>`;
        } else if (actionCategory === 'DELETE') {
          valHtml = `<div style="color:var(--red); text-decoration:line-through; word-break:break-word;">${formatValue(oldV)}</div>`;
        } else {
          valHtml = `
            <div style="flex:1; color:var(--red); text-decoration:line-through; word-break:break-word; padding-right:8px;">${formatValue(oldV)}</div>
            <div style="flex:1; color:var(--green); word-break:break-word;">${formatValue(newV)}</div>
          `;
        }
        
        return `
        <div style="margin-bottom:8px; border-bottom:1px solid var(--border-light); padding-bottom:8px;">
          <div style="font-weight:bold; color:var(--text-main); margin-bottom:4px;">${prop}</div>
          <div style="display:flex; justify-content:space-between; font-size:13px;">
            ${valHtml}
          </div>
        </div>
        `;
      }).join('');
    }

    const nomElement = (ev.document_id && ev.document_id.nom) ? ev.document_id.nom : (ev.nom_semantique || ev.collection_impactee || ev.collection || 'Élément inconnu');

    // Afficher les détails textuels renvoyés par le serveur s'ils existent (notes ou log système)
    let detailsLogsHtml = '';
    if (ev.details && Array.isArray(ev.details) && ev.details.length > 0) {
      // Filtrer pour éviter de réafficher des trucs redondants si on a déjà un diffListeHtml
      const logsToKeep = diffListHtml ? ev.details.filter(d => !d.startsWith('[~] Modification')) : ev.details;
      if (logsToKeep.length > 0) {
        detailsLogsHtml = `
          <div style="margin-top:15px; padding:10px; background:var(--bg-subtle); border-radius:6px; font-size:12px; color:var(--text-secondary); border:1px solid var(--border-light);">
            <strong style="display:block; margin-bottom:5px; color:var(--text-main);">Notes du système :</strong>
            <ul style="margin:0; padding-left:20px; line-height:1.4;">
              ${logsToKeep.map(d => `<li>${d}</li>`).join('')}
            </ul>
          </div>
        `;
      }
    }

    let bodyHtml = '';
    if (diffListHtml) {
      bodyHtml = `
        <div style="margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid var(--border-light);">
          <div style="margin-bottom: 4px;"><strong>Type d'action :</strong> <span class="tag tag-info">${actionLabel}</span></div>
          <div><strong>Élément concerné :</strong> ${nomElement}</div>
        </div>
        ${diffListHtml}
        ${detailsLogsHtml}
      `;
    } else {
      let iconColor = 'var(--primary)';
      let msgTitle = "Aucun détail technique disponible.";
      let msgDesc = "Cet événement a été enregistré sans données détaillées.";
      
      if (actionCategory === 'CREATE') {
        iconColor = 'var(--green)';
        msgTitle = "Création effectuée";
        msgDesc = "L'élément a été créé avec succès.";
      } else if (actionCategory === 'DELETE') {
        iconColor = 'var(--red)';
        msgTitle = "Suppression effectuée";
        msgDesc = "L'élément a été supprimé.";
      } else {
        msgTitle = "Aucune modification de valeur détectée.";
        msgDesc = "Il est possible que l'élément ait été sauvegardé sans aucun changement par l'utilisateur.";
      }
      
      bodyHtml = `
      <div style="padding: 15px; color:var(--text-main); font-size: 14px; text-align:center; background: var(--bg-soft); border-radius: 8px; margin-top: 10px;">
        <i class="fa fa-info-circle" style="font-size:24px; color:${iconColor}; margin-bottom: 10px;"></i>
        <div style="margin-bottom: 8px; font-weight:bold;">${msgTitle}</div>
        <div style="color:var(--text-secondary); font-size: 13px;">${msgDesc}</div>
        <div style="margin-top: 15px; text-align:left; border-top: 1px solid var(--border-light); padding-top: 10px;">
          <div style="margin-bottom: 4px;"><strong>Type d'action :</strong> <span class="tag tag-info">${actionLabel}</span></div>
          <div><strong>Élément concerné :</strong> ${nomElement}</div>
        </div>
        ${detailsLogsHtml}
      </div>`;
    }

    showModal("Détails de l'événement", `<div style="max-height: 400px; overflow-y:auto; overflow-x:hidden;">${bodyHtml}</div>`);
  } catch (e) {
    showToast('Erreur lors du chargement des détails', 'error');
  }
}

/** Vide le journal LOCAL de secours de l'aérodrome courant (n'affecte pas /evenements, en lecture seule côté backend) */
function clearArchive() {
  if (!App.aerodromeMongoId) return;
  showModal(
    "Vider le journal local",
    "Confirmer la suppression du journal de secours stocké localement pour cet aérodrome ? Le journal officiel du serveur (/evenements) n'est pas affecté — il est en lecture seule.",
    () => {
      localStorage.removeItem(ARCHIVE_STORAGE_PREFIX + App.aerodromeMongoId);
      renderArchiveTab();
      showToast('Journal local vidé', 'success');
    }
  );
}