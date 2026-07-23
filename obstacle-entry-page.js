'use strict';
/* ═══════════════════════════════════════════════════════════
   SIGOBS — obstacle-entry-page.js
   Page dédiée à la saisie complète d'un obstacle (attributs
   Annexe 15 / Tableau A6-2) + liste des obstacles ajoutés
   pendant la session courante.
   Dépend de : config.js (App), api.js (showToast),
               obstacles.js (clearObstacleForm, typeToLabel, statusLabel)
   ═══════════════════════════════════════════════════════════ */

/** Mémorise l'onglet d'où l'utilisateur a ouvert la page de saisie, pour le retour */
let _obstacleEntryReturnTab = 'obstacles';

/** _id de l'obstacle en cours d'édition, ou null en mode création (retours n°10, n°18) */
let _editingObstacleId = null;

/** Ouvre la page de saisie complète d'obstacle (mode création) */
function openObstacleEntryPage() {
  _editingObstacleId = null;
  _openObstacleEntryPageInternal();
  const title = document.querySelector('#tab-obstacle-entry .panel-title');
  if (title) title.textContent = "SAISIE COMPLÈTE D'UN OBSTACLE — ATTRIBUTS D'OBSTACLE";
  const label = document.getElementById('oe-submit-label');
  if (label) label.textContent = "AJOUTER L'OBSTACLE ET ÉVALUER";
}

/**
 * Ouvre la page de saisie en mode ÉDITION pour un obstacle existant :
 * pré-remplit les champs principaux (identification, position, altitude/hauteur
 * en mètres, statut temporel) à partir des données déjà en mémoire. Les
 * attributs étendus (Annexe 15) précédemment saisis sont restaurés depuis
 * `obs.extended` s'ils sont disponibles côté client.
 */
function editObstacle(id) {
  const obs = App.allObstacles.find(o => o._id === id);
  if (!obs) { showToast('Obstacle introuvable', 'error'); return; }
  _editingObstacleId = id;
  _openObstacleEntryPageInternal();

  const title = document.querySelector('#tab-obstacle-entry .panel-title');
  if (title) title.textContent = `MODIFIER L'OBSTACLE — ${obs.name}`;
  const label = document.getElementById('oe-submit-label');
  if (label) label.textContent = 'ENREGISTRER LES MODIFICATIONS';

  const setVal = (id2, v) => { const el = document.getElementById(id2); if (el != null && v != null) el.value = v; };

  setVal('oe-name', obs.name);
  setVal('oe-proprietaire', obs.proprietaire || '');
  setVal('oe-type', obs.type);
  setVal('obs-alt-m', obs.altitude != null ? (obs.altitude * 0.3048).toFixed(2) : '');
  setVal('obs-height-m', obs.height ? (obs.height * 0.3048).toFixed(2) : '');
  setVal('obs-temporal', obs.temporal || 'permanent');
  if (obs.temporal === 'temporary' || obs.temporal === 'construction') {
    document.getElementById('expiry-group')?.classList.remove('hidden');
    if (obs.expiry) setVal('obs-expiry', new Date(obs.expiry).toISOString().slice(0, 10));
  }

  // Coordonnées : basculer en mode DD pour un remplissage direct et sans ambiguïté
  if (typeof setCoordMode === 'function') setCoordMode('dd');
  setVal('lat-dd', obs.latitude);
  setVal('lon-dd', obs.longitude);

  // Restaurer les attributs étendus (Annexe 15) s'ils ont été conservés à la création
  if (obs.extended) {
    const map = {
      identificateur_createur_donnees: 'oe-createur', identificateur_source_donnees: 'oe-source',
      precision_horizontale: 'oe-precision-h', resolution_horizontale: 'oe-resolution-h',
      etendue_horizontale: 'oe-etendue-h', precision_verticale: 'oe-precision-v',
      resolution_verticale: 'oe-resolution-v', operations: 'oe-operations',
      applicabilite: 'oe-applicabilite', balisage_lumineux_type: 'oe-balisage-type',
      marque_type: 'oe-marque-type',
    };
    Object.entries(map).forEach(([k, elId]) => { if (obs.extended[k] != null) setVal(elId, obs.extended[k]); });
    const selMap = {
      niveau_confiance_horizontal: 'oe-confiance-h', systeme_reference_horizontal: 'oe-ref-h',
      niveau_confiance_vertical: 'oe-confiance-v', systeme_reference_vertical: 'oe-ref-v',
      type_geometrie: 'oe-geom-type', zone_de_couverture: 'oe-zone-couverture', integrite: 'oe-integrite',
      unite_mesure: 'oe-unite-mesure', balisage_lumineux: 'oe-balisage', marque: 'oe-marque',
    };
    Object.entries(selMap).forEach(([k, elId]) => { if (obs.extended[k] != null) setVal(elId, obs.extended[k]); });
    if (obs.extended.balisage_lumineux === 'Oui') document.getElementById('oe-balisage-type-group')?.classList.remove('hidden');
    if (obs.extended.marque === 'Oui') document.getElementById('oe-marque-type-group')?.classList.remove('hidden');
    if (obs.extended.date_heure_releve) setVal('oe-datetime', obs.extended.date_heure_releve);
  }
}

/** Logique commune d'ouverture de la page (partagée création / édition) */
function _openObstacleEntryPageInternal() {
  // Repérer l'onglet actif pour pouvoir y revenir
  const activeBtn = document.querySelector('.tab-btn.active');
  if (activeBtn) {
    const id = activeBtn.id || '';
    _obstacleEntryReturnTab = id.replace('tab-btn-', '') || 'obstacles';
  }

  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const page = document.getElementById('tab-obstacle-entry');
  if (page) page.classList.add('active');

  // Pré-remplir la date/heure de relevé avec l'instant présent (mode création uniquement)
  const dtEl = document.getElementById('oe-datetime');
  if (dtEl && !dtEl.value && !_editingObstacleId) dtEl.value = new Date().toISOString().slice(0, 16);

  renderSessionList();
}

/** Ferme la page de saisie et revient à l'onglet d'origine (par défaut : Obstacles) */
function closeObstacleEntryPage() {
  _editingObstacleId = null;
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const targetId = `tab-${_obstacleEntryReturnTab}`;
  const target = document.getElementById(targetId) || document.getElementById('tab-obstacles');
  if (target) target.classList.add('active');

  const targetBtn = document.getElementById(`tab-btn-${_obstacleEntryReturnTab}`) || document.getElementById('tab-btn-obstacles');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (targetBtn) targetBtn.classList.add('active');

  if (typeof filterObstacles === 'function') filterObstacles();
  if (typeof updateObstaclesLayer === 'function') updateObstaclesLayer();
}

/* ── Liste des obstacles ajoutés pendant la session de saisie ──── */
const ObstacleEntrySession = { items: [] };

/** Ajoute un obstacle nouvellement créé au résumé de session affiché à droite */
function addToSessionList(obs) {
  ObstacleEntrySession.items.unshift(obs);
  renderSessionList();
}

function renderSessionList() {
  const el = document.getElementById('oe-session-list');
  if (!el) return;
  if (!ObstacleEntrySession.items.length) {
    el.innerHTML = '<span class="empty-msg">Aucun obstacle ajouté pour l\'instant</span>';
    return;
  }
  el.innerHTML = ObstacleEntrySession.items.map(obs => {
    const breach = (typeof checkPenetration === 'function') ? checkPenetration(obs) : false;
    return `<div class="info-block" style="padding:8px 10px;">
      <div class="info-row"><span style="font-weight:600;color:var(--text-primary);">${obs.name}</span>
        <span class="tag ${breach ? 'tag-fail' : 'tag-pass'}">${breach ? 'PÉNÉTRATION' : 'CONFORME'}</span></div>
      <div class="info-row"><span>${typeToIcon(obs.type)} ${typeToLabel(obs.type)}</span><span>${statusLabel(obs.status)}</span></div>
    </div>`;
  }).join('');
}
