'use strict';
/* ═══════════════════════════════════════════════════════════
   SIGOBS — obstacles-archive.js
   Journal d'archive des actions effectuées sur la base (obstacles,
   aérodromes) : création, modification, suppression, changement de
   statut / balisage / action recommandée.

   ⚠️ LIMITATION IMPORTANTE (transparence technique) :
   Ce journal est actuellement stocké côté client (localStorage, par
   aérodrome), car le backend actuel n'expose pas encore de route
   d'audit persistante multi-utilisateur. Il permet de démontrer et
   tester le concept d'historisation demandé, mais n'est PAS partagé
   entre navigateurs/utilisateurs tant qu'un endpoint backend dédié
   (ex. POST/GET /aerodromes/:id/journal) n'est pas mis en place.
   Pour une traçabilité multi-utilisateur persistante, chaque appel
   à logAction() ci-dessous devra être doublé d'un POST vers ce futur
   endpoint — la fonction est centralisée pour rendre ce branchement
   trivial le moment venu.

   ── Lien avec la temporalité AIXM 5.2 ──────────────────────
   AIXM 5.2 modélise l'évolution d'un objet aéronautique par une
   succession de "timeSlices" : chaque timeSlice porte une période de
   validité (validTime) et un type d'événement (BASELINE = état
   initial, PERMDELTA = changement permanent, TEMPDELTA = changement
   temporaire réversible, comme un obstacle de chantier). Le journal
   ci-dessous adopte la même logique :
     - la création d'un obstacle correspond à un BASELINE,
     - une modification (édition, changement de balisage/action)
       correspond à un PERMDELTA,
     - un obstacle marqué "temporaire" (projet de construction,
       obstacle avec date d'expiration) correspond conceptuellement à
       un TEMPDELTA : sa présence n'est valide que sur la fenêtre
       [créé_le, date_expiration], après quoi l'obstacle "redevient"
       l'état antérieur (absence d'obstacle).
   Chaque entrée du journal porte donc un champ `temporality` qui
   reprend cette classification, consultable dans l'onglet Archive.

   Dépend de : config.js (App), api.js (showToast)
   ═══════════════════════════════════════════════════════════ */

const ARCHIVE_STORAGE_PREFIX = 'sigobs_archive_';
const ARCHIVE_MAX_ENTRIES = 500;

/**
 * Enregistre une action dans le journal d'archive de l'aérodrome courant.
 * @param {string} actionType - 'creation' | 'modification' | 'suppression' | 'statut' | 'balisage' | 'action_recommandee'
 * @param {string} objetType  - 'obstacle' | 'aerodrome' | 'piste'
 * @param {string} objetNom   - nom lisible de l'objet concerné
 * @param {string} [detail]   - détail lisible complémentaire (ex: "Statut : validé")
 * @param {'BASELINE'|'PERMDELTA'|'TEMPDELTA'} [temporality]
 */
function logAction(actionType, objetType, objetNom, detail, temporality) {
  if (!App.aerodromeMongoId) return;
  const entry = {
    ts: new Date().toISOString(),
    user: App.user?.email || '—',
    actionType,
    objetType,
    objetNom,
    detail: detail || '',
    temporality: temporality || (actionType === 'creation' ? 'BASELINE' : 'PERMDELTA'),
  };

  const key = ARCHIVE_STORAGE_PREFIX + App.aerodromeMongoId;
  let list = [];
  try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { list = []; }
  list.unshift(entry);
  if (list.length > ARCHIVE_MAX_ENTRIES) list = list.slice(0, ARCHIVE_MAX_ENTRIES);
  try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { console.warn('[logAction] localStorage plein', e); }

  if (document.getElementById('tab-archive')?.classList.contains('active')) renderArchiveTab();
}

/** Récupère le journal d'archive de l'aérodrome courant */
function getArchiveEntries() {
  if (!App.aerodromeMongoId) return [];
  const key = ARCHIVE_STORAGE_PREFIX + App.aerodromeMongoId;
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; }
}

const ACTION_LABELS = {
  creation: 'Création', modification: 'Modification', suppression: 'Suppression',
  statut: 'Changement de statut', balisage: 'État de balisage', action_recommandee: 'Action recommandée',
};
const TEMPORALITY_LABELS = {
  BASELINE: 'BASELINE (état initial)',
  PERMDELTA: 'PERMDELTA (changement permanent)',
  TEMPDELTA: 'TEMPDELTA (changement temporaire)',
};

/** Rendu de l'onglet Archive */
function renderArchiveTab() {
  const tbody = document.getElementById('archive-list-tbody');
  if (!tbody) return;
  const entries = getArchiveEntries();

  if (!entries.length) {
    tbody.innerHTML = '<tr class="table-placeholder"><td colspan="6">Aucune action enregistrée pour cet aérodrome</td></tr>';
    return;
  }

  tbody.innerHTML = entries.map(e => {
    const date = new Date(e.ts);
    const actionTag = {
      creation: 'tag-pass', modification: 'tag-info', suppression: 'tag-fail',
      statut: 'tag-info', balisage: 'tag-warn', action_recommandee: 'tag-warn',
    }[e.actionType] || 'tag-info';
    return `<tr>
      <td class="mono" style="font-size:11px;">${date.toLocaleDateString('fr-FR')} ${date.toLocaleTimeString('fr-FR')}</td>
      <td><span class="tag ${actionTag}">${ACTION_LABELS[e.actionType] || e.actionType}</span></td>
      <td>${e.objetType}</td>
      <td style="font-weight:600;">${e.objetNom}</td>
      <td style="font-size:11px;color:var(--text-secondary);">${e.detail || '—'}</td>
      <td style="font-size:10.5px;color:var(--text-dim);" title="${TEMPORALITY_LABELS[e.temporality] || e.temporality}">${e.temporality}</td>
    </tr>`;
  }).join('');
}

/** Vide le journal d'archive de l'aérodrome courant (confirmation requise) */
function clearArchive() {
  if (!App.aerodromeMongoId) return;
  showModal(
    "Vider l'archive",
    "Confirmer la suppression définitive du journal d'actions pour cet aérodrome ? Cette opération est irréversible.",
    () => {
      localStorage.removeItem(ARCHIVE_STORAGE_PREFIX + App.aerodromeMongoId);
      renderArchiveTab();
      showToast('Journal vidé', 'success');
    }
  );
}
