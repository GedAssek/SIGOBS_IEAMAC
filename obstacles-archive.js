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

/** Résume les champs modifiés entre anciennes_valeurs et nouvelles_valeurs pour affichage */
function summarizeEventDiff(ev) {
  const before = ev.anciennes_valeurs || {};
  const after = ev.nouvelles_valeurs || {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  if (!keys.length) return '';
  return keys.slice(0, 3).map(k => {
    const b = before[k], a = after[k];
    if (a === undefined) return `${k} supprimé`;
    if (b === undefined) return `${k} : ${JSON.stringify(a)}`;
    return `${k} : ${JSON.stringify(b)} → ${JSON.stringify(a)}`;
  }).join(' · ') + (keys.length > 3 ? ` (+${keys.length - 3})` : '');
}

/** Retrouve un nom lisible pour le document concerné par l'événement */
function resolveEventObjectName(ev) {
  if (ev.collection_impactee === 'Obstacle') {
    const obs = App.allObstacles?.find(o => o._id === ev.document_id);
    return obs?.name || ev.document_id;
  }
  if (ev.collection_impactee === 'Aerodrome') {
    return App.aerodrome?.icao || App.aerodrome?.name || ev.document_id;
  }
  if (ev.collection_impactee === 'Piste') {
    const rwy = App.runways?.find(r => r._id === ev.document_id);
    return rwy ? `${rwy.qfu1 || ''}/${rwy.qfu2 || ''}` : ev.document_id;
  }
  return ev.document_id;
}

/** Détermine si un événement backend concerne l'aérodrome courant */
function eventBelongsToCurrentAerodrome(ev) {
  if (ev.collection_impactee === 'Aerodrome') return ev.document_id === App.aerodromeMongoId;
  if (ev.collection_impactee === 'Obstacle') {
    return (App.allObstacles || []).some(o => o._id === ev.document_id);
  }
  if (ev.collection_impactee === 'Piste') {
    return (App.runways || []).some(r => r._id === ev.document_id);
  }
  return false; // autres collections (Utilisateur, Role...) hors périmètre de cet onglet
}

/**
 * Récupère les événements d'audit depuis le backend (GET /evenements),
 * filtrés sur l'aérodrome courant. Retombe sur le journal local si
 * l'utilisateur n'a pas le rôle requis (403) ou en cas d'erreur réseau.
 */
async function fetchArchiveEntries() {
  try {
    const res = await apiFetch('/evenements');
    const events = (res.data || []).filter(eventBelongsToCurrentAerodrome);
    return { source: 'backend', entries: events };
  } catch (e) {
    console.warn('[fetchArchiveEntries] /evenements indisponible, repli local :', e.message);
    return { source: 'local', entries: getLocalArchiveEntries() };
  }
}

/** Rendu de l'onglet Archive */
async function renderArchiveTab() {
  const tbody = document.getElementById('archive-list-tbody');
  const sourceNote = document.getElementById('archive-source-note');
  if (!tbody) return;
  tbody.innerHTML = '<tr class="table-placeholder"><td colspan="6">Chargement du journal…</td></tr>';

  const { source, entries } = await fetchArchiveEntries();

  if (sourceNote) {
    sourceNote.textContent = source === 'backend'
      ? '✓ Journal officiel du serveur (GET /evenements)'
      : '⚠ Journal local de secours (accès /evenements refusé ou indisponible — rôle Admin/Evaluator requis)';
    sourceNote.style.color = source === 'backend' ? 'var(--green)' : 'var(--amber)';
  }

  if (!entries.length) {
    tbody.innerHTML = '<tr class="table-placeholder"><td colspan="6">Aucune action enregistrée pour cet aérodrome</td></tr>';
    return;
  }

  if (source === 'backend') {
    tbody.innerHTML = entries.map(ev => {
      const date = new Date(ev.createdAt);
      const temporality = ev.type_action === 'CREATE' ? 'BASELINE' : (ev.type_action === 'DELETE' ? 'PERMDELTA' : 'PERMDELTA');
      return `<tr>
        <td class="mono" style="font-size:11px;">${date.toLocaleDateString('fr-FR')} ${date.toLocaleTimeString('fr-FR')}</td>
        <td><span class="tag ${ACTION_TAG_BACKEND[ev.type_action] || 'tag-info'}">${ACTION_LABELS_BACKEND[ev.type_action] || ev.type_action}</span></td>
        <td>${ev.collection_impactee}</td>
        <td style="font-weight:600;">${resolveEventObjectName(ev)}</td>
        <td style="font-size:11px;color:var(--text-secondary);" title="${ev.utilisateur_id?.email || ''}">${summarizeEventDiff(ev) || '—'}</td>
        <td style="font-size:10.5px;color:var(--text-dim);" title="${TEMPORALITY_LABELS[temporality]}">${temporality}</td>
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
        <td style="font-size:10.5px;color:var(--text-dim);" title="${TEMPORALITY_LABELS[e.temporality] || e.temporality}">${e.temporality}</td>
      </tr>`;
    }).join('');
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