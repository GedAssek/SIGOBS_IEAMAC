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

/**
 * Récupère les événements d'audit depuis le backend (GET /evenements),
 * filtrés sur l'aérodrome courant. Retombe sur le journal local si
 * l'utilisateur n'a pas le rôle requis (403) ou en cas d'erreur réseau.
 * Stocke le résultat dans App.cachedEvents pour un accès instantané
 * depuis l'historique par obstacle (sans re-fetch).
 */
async function fetchArchiveEntries(forceRefresh = false) {
  // Utiliser le cache si disponible et pas de rafraîchissement forcé
  if (!forceRefresh && App.cachedEvents && App.cachedEvents.length > 0) {
    return { source: 'backend', entries: App.cachedEvents, fromCache: true };
  }
  try {
    const res = await apiFetch('/evenements');
    const events = res.data || [];
    App.cachedEvents = events;
    return { source: 'backend', entries: events, fromCache: false };
  } catch (e) {
    console.warn('[fetchArchiveEntries] /evenements indisponible, repli local :', e.message);
    App.cachedEvents = null;
    return { source: 'local', entries: getLocalArchiveEntries() };
  }
}

/** Rendu de l'onglet Archive */
async function renderArchiveTab(forceRefresh = false) {
  const tbody = document.getElementById('archive-list-tbody');
  const sourceNote = document.getElementById('archive-source-note');
  if (!tbody) return;
  tbody.innerHTML = '<tr class="table-placeholder"><td colspan="7">Chargement du journal…</td></tr>';

  const { source, entries, fromCache } = await fetchArchiveEntries(forceRefresh);

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
      const summary = propsMods.length ? `Champs: ${propsMods.join(', ')}` : '—';
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
      const actionTag = {
        creation: 'tag-pass', modification: 'tag-info', suppression: 'tag-fail',
        statut: 'tag-info', balisage: 'tag-warn', action_recommandee: 'tag-warn',
      }[e.actionType] || 'tag-info';
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
}

/** Affiche les détails d'un événement d'audit */
async function showEventDetails(id) {
  try {
    const res = await apiFetch(`/evenements/${id}/detail`);
    const ev = res.data;
    const diffList = (ev.changements || []).map(c => `
      <div style="margin-bottom:8px; border-bottom:1px solid var(--border-light); padding-bottom:8px;">
        <div style="font-weight:bold; color:var(--text-main);">${c.propriete}</div>
        <div style="display:flex; justify-content:space-between; margin-top:4px; font-size:12px;">
          <div style="flex:1; color:var(--red); text-decoration:line-through; word-break:break-all; padding-right:8px;">
            ${c.ancienne_valeur !== undefined ? JSON.stringify(c.ancienne_valeur) : 'N/A'}
          </div>
          <div style="flex:1; color:var(--green); word-break:break-all;">
            ${c.nouvelle_valeur !== undefined ? JSON.stringify(c.nouvelle_valeur) : 'N/A'}
          </div>
        </div>
      </div>
    `).join('');
    showModal("Détails de l'événement", `<div style="max-height: 400px; overflow-y:auto; overflow-x:hidden;">${diffList || 'Aucun détail technique'}</div>`);
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