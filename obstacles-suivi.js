'use strict';
/* ═══════════════════════════════════════════════════════════
   SIGOBS — obstacles-suivi.js
   Tableau de suivi des obstacles, style tableur Excel.

   Principe :
   - Les colonnes "auto" (désignation, type, propriétaire,
     coordonnées, altitude, hauteur, verdict OLS) sont pré-
     remplies depuis App.allObstacles et en lecture seule.
   - Les colonnes "éditable" (N° courrier ASECNA / AERIA,
     localisation du site, impact, actions exigées, état de
     mise en œuvre, efficacité, balisage diurne/nocturne,
     observations) sont saisies par l'utilisateur et stockées
     dans localStorage sous la clé :
       sigobs_suivi_<aerodromeMongoId>
   - Le bouton 💾 SAUVEGARDER persiste immédiatement.
     L'auto-sauvegarde se déclenche aussi à chaque perte de
     focus d'une cellule éditable (onblur).
   - Export CSV et Excel (via feuille HTML encodée en data URI).

   Dépend de : config.js (App), obstacles.js (typeToLabel,
   checkPenetration), obstacles-geometry.js (optionnel)
   ═══════════════════════════════════════════════════════════ */

// ── Structure des colonnes ────────────────────────────────────────────────────
/**
 * Définition des colonnes du tableau de suivi.
 * type: 'auto'   → valeur lue sur l'obstacle (non modifiable)
 * type: 'edit'   → cellule textarea éditable par l'utilisateur
 * group: optionnel, pour les en-têtes fusionnés (colspan)
 */
const SUIVI_COLS = [
  // Colonne N° (auto-incrémentée)
  { key: 'num',           label: 'N°',                            type: 'auto',  width: 40  },
  // Toutes les autres colonnes sont devenues éditables pour saisie manuelle
  { key: 'nom_projet',    label: 'NOM DU PROJET',                 type: 'edit',  width: 140 },
  { key: 'courrier_impact', label: "N° DU COURRIER D'ÉTUDES D'IMPACT", type: 'edit', width: 220 },
  { key: 'proprietaire',  label: "PROPRIÉTAIRE DE L'OUVRAGE",    type: 'edit',  width: 140 },
  { key: 'type_obstacle', label: 'OBSTACLE',                     type: 'edit',  width: 100 },
  { key: 'localisation',  label: 'LOCALISATION DU SITE',         type: 'edit',  width: 140 },
  { key: 'latitude',      label: 'LATITUDE',                     type: 'edit',  width: 110, group: 'COORDONNÉES' },
  { key: 'longitude',     label: 'LONGITUDE',                    type: 'edit',  width: 110, group: 'COORDONNÉES' },
  { key: 'altitude',      label: 'ALTITUDE',                     type: 'edit',  width: 80  },
  { key: 'hauteur',       label: 'HAUTEUR',                      type: 'edit',  width: 80  },
  { key: 'impact',        label: "IMPACT DE L'OUVRAGE",          type: 'edit',  width: 200 },
  { key: 'actions_exigees', label: 'ACTIONS EXIGÉES',            type: 'edit',  width: 180 },
  { key: 'etat_actions',    label: 'ACTIONS',                    type: 'edit',  width: 160, group: 'ÉTAT DE MISE EN ŒUVRE' },
  { key: 'etat_efficacite', label: 'EFFICACITÉ',                 type: 'edit',  width: 160, group: 'ÉTAT DE MISE EN ŒUVRE' },
  { key: 'balisage_diurne',   label: 'DIURNE',   type: 'edit', width: 110, group: 'BALISAGES' },
  { key: 'balisage_nocturne', label: 'NOCTURNE', type: 'edit', width: 110, group: 'BALISAGES' },
  { key: 'observations',  label: 'OBSERVATIONS',                 type: 'edit',  width: 200 },
];

// ── Helpers DMS ──────────────────────────────────────────────────────────────
function _toDMS(deg, isLat) {
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const mFull = (abs - d) * 60;
  const m = Math.floor(mFull);
  const s = ((mFull - m) * 60).toFixed(2);
  const dir = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W');
  return `${String(d).padStart(2,'0')}°${String(m).padStart(2,'0')}'${String(s).padStart(5,'0')}"${dir}`;
}

// ── Storage ──────────────────────────────────────────────────────────────────
function _suiviKey() {
  return 'sigobs_suivi_custom_' + (App.aerodromeMongoId || 'default');
}

function _suiviLoad() {
  try { return JSON.parse(localStorage.getItem(_suiviKey()) || '{}'); } catch { return {}; }
}

function _suiviSave(data) {
  try { localStorage.setItem(_suiviKey(), JSON.stringify(data)); } catch (e) {
    console.warn('[suivi] localStorage plein', e);
  }
}

// ── Lecture valeur auto ──────────────────────────────────────────────────────
function _autoValue(obs, key, idx) {
  if (key === 'num') return idx + 1;
  return '—';
}

// ── Construction de l'en-tête (2 lignes) ─────────────────────────────────────
function _buildSuiviThead() {
  // Première ligne : groupes (colspan) + colonnes sans groupe
  // Deuxième ligne : sous-colonnes à l'intérieur des groupes
  const groups = {}; // groupLabel → [colIndex]
  SUIVI_COLS.forEach((c, i) => {
    if (c.group) {
      if (!groups[c.group]) groups[c.group] = [];
      groups[c.group].push(i);
    }
  });

  let row1 = '', row2 = '';
  let skip = new Set();

  SUIVI_COLS.forEach((col, i) => {
    if (skip.has(i)) return;
    if (col.group) {
      // Trouver tous les membres de ce groupe
      const members = groups[col.group];
      // N'émettre le th de groupe qu'une fois
      if (members[0] === i) {
        row1 += `<th colspan="${members.length}" class="suivi-th-group ${col.type === 'edit' ? 'suivi-th-editable' : ''}">${col.group}</th>`;
        members.forEach(mi => {
          skip.add(mi);
          row2 += `<th class="suivi-th-sub ${SUIVI_COLS[mi].type === 'edit' ? 'suivi-th-editable' : ''}" style="min-width:${SUIVI_COLS[mi].width}px">${SUIVI_COLS[mi].label}</th>`;
        });
      }
    } else {
      row1 += `<th rowspan="2" class="suivi-th ${col.type === 'edit' ? 'suivi-th-editable' : ''}" style="min-width:${col.width}px">${col.label}</th>`;
    }
  });

  return `<tr>${row1}</tr><tr>${row2}</tr>`;
}

// ── Construction du corps du tableau ─────────────────────────────────────────
function _buildSuiviTbody(obstacles, stored) {
  if (!obstacles || !obstacles.length) {
    return `<tr><td colspan="${SUIVI_COLS.length}" class="suivi-empty">Aucun obstacle chargé pour cet aérodrome.</td></tr>`;
  }

  return obstacles.map((obs, idx) => {
    const obsId = obs._id || ('idx_' + idx);
    const isPenetrating = (typeof checkPenetration === 'function') ? checkPenetration(obs) : false;
    const rowClass = isPenetrating ? 'suivi-row suivi-row-breach' : 'suivi-row';

    const cells = SUIVI_COLS.map(col => {
      if (col.type === 'auto') {
        const val = _autoValue(obs, col.key, idx);
        return `<td class="suivi-cell suivi-cell-auto">${val}</td>`;
      } else {
        const savedVal = (stored[obsId] && stored[obsId][col.key]) ? stored[obsId][col.key] : '';
        const escaped = savedVal.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        return `<td class="suivi-cell suivi-cell-edit">
          <textarea
            class="suivi-textarea"
            data-obs-id="${obsId}"
            data-col-key="${col.key}"
            placeholder="—"
            onblur="suiviCellBlur(this)"
            oninput="suiviCellDirty(this)"
          >${escaped}</textarea>
        </td>`;
      }
    }).join('');

    return `<tr class="${rowClass}" data-obs-id="${obsId}">${cells}</tr>`;
  }).join('');
}

// ── Ouverture de la modale ────────────────────────────────────────────────────
function openSuiviModal() {
  const overlay = document.getElementById('suivi-modal-overlay');
  if (!overlay) return;

  // Mettre à jour le label de l'aérodrome
  const aeroLabel = document.getElementById('suivi-aerodrome-label');
  if (aeroLabel) {
    const icao = App.aerodrome?.icao || App.aerodrome?.code_oaci || '';
    const name = App.aerodrome?.name || App.aerodrome?.nom || '';
    aeroLabel.textContent = icao ? `${icao} — ${name}` : (name || '');
  }

  // Construire le tableau
  _renderSuiviTable();

  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

// ── Helpers : 30 lignes vides ────────────────────────────────────────────────
function _getDummyRows() {
  return Array.from({ length: 30 }).map((_, i) => ({ _id: 'custom_row_' + i }));
}

function _renderSuiviTable() {
  const thead = document.getElementById('suivi-thead');
  const tbody = document.getElementById('suivi-tbody');
  if (!thead || !tbody) return;

  const stored = _suiviLoad();
  thead.innerHTML = _buildSuiviThead();
  
  // Générer un tableau vierge de 30 lignes pour saisie libre
  tbody.innerHTML = _buildSuiviTbody(_getDummyRows(), stored);
}

// ── Fermeture ─────────────────────────────────────────────────────────────────
function closeSuiviModal() {
  const overlay = document.getElementById('suivi-modal-overlay');
  if (overlay) overlay.classList.add('hidden');
  document.body.style.overflow = '';
}

function closeSuiviModalIfOutside(event) {
  if (event.target && event.target.id === 'suivi-modal-overlay') {
    closeSuiviModal();
  }
}

// ── Sauvegarde ────────────────────────────────────────────────────────────────
/**
 * Appelé à chaque perte de focus d'une cellule éditable (onblur).
 * Sauvegarde en temps réel dans localStorage.
 */
function suiviCellBlur(textarea) {
  const obsId = textarea.dataset.obsId;
  const colKey = textarea.dataset.colKey;
  const val = textarea.value;
  const stored = _suiviLoad();
  if (!stored[obsId]) stored[obsId] = {};
  stored[obsId][colKey] = val;
  _suiviSave(stored);
  textarea.classList.remove('suivi-dirty');
  _suiviShowStatus('Sauvegardé ✓', 'green');
}

function suiviCellDirty(textarea) {
  textarea.classList.add('suivi-dirty');
}

/** Sauvegarde explicite par le bouton 💾 SAUVEGARDER */
function suiviSaveAll() {
  const stored = _suiviLoad();
  document.querySelectorAll('.suivi-textarea').forEach(ta => {
    const obsId = ta.dataset.obsId;
    const colKey = ta.dataset.colKey;
    if (!stored[obsId]) stored[obsId] = {};
    stored[obsId][colKey] = ta.value;
    ta.classList.remove('suivi-dirty');
  });
  _suiviSave(stored);
  _suiviShowStatus('Tout sauvegardé ✓', 'green');
  if (typeof showToast === 'function') showToast('Tableau de suivi sauvegardé', 'success');
}

function _suiviShowStatus(msg, color) {
  const el = document.getElementById('suivi-save-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = color === 'green' ? 'var(--green)' : 'var(--amber)';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.textContent = ''; }, 3000);
}

// ── Export CSV ────────────────────────────────────────────────────────────────
function suiviExportCSV() {
  const stored = _suiviLoad();
  const esc = v => `"${String(v ?? '').replace(/"/g,'""')}"`;

  // En-tête à plat (sans groupes)
  const header = SUIVI_COLS.map(c => esc(c.label)).join(',');
  const rows = _getDummyRows().map((obs, idx) => {
    const obsId = obs._id;
    return SUIVI_COLS.map(col => {
      if (col.type === 'auto') return esc(_autoValue(obs, col.key, idx));
      return esc((stored[obsId] && stored[obsId][col.key]) ? stored[obsId][col.key] : '');
    }).join(',');
  });

  const csv = [header, ...rows].join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const icao = App.aerodrome?.icao || 'SUIVI';
  a.href = url;
  a.download = `SUIVI_OBSTACLES_${icao}_${_today()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Export Excel (via HTML table → .xls) ─────────────────────────────────────
function suiviExportExcel() {
  const stored = _suiviLoad();
  const icao = App.aerodrome?.icao || App.aerodrome?.code_oaci || 'AERO';
  const aeroName = App.aerodrome?.name || App.aerodrome?.nom || '';

  // Construction du tableau HTML avec en-têtes fusion (pour Excel)
  let theadHtml = _buildSuiviThead();
  let tbodyHtml = '';
  
  _getDummyRows().forEach((obs, idx) => {
    const obsId = obs._id;
    const cells = SUIVI_COLS.map(col => {
      if (col.type === 'auto') {
        return `<td style="border:1px solid #bbb;padding:4px 6px;vertical-align:top;">${_autoValue(obs, col.key, idx)}</td>`;
      } else {
        const savedVal = (stored[obsId] && stored[obsId][col.key]) ? stored[obsId][col.key] : '';
        const escaped = savedVal.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        return `<td style="border:1px solid #bbb;padding:4px 6px;vertical-align:top;background:#ffffff;">${escaped}</td>`;
      }
    }).join('');
    tbodyHtml += `<tr>${cells}</tr>`;
  });

  const html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<style>
  th { background:#1a3a5c; color:#fff; border:1px solid #bbb; padding:5px 7px; font-size:11px; text-align:center; vertical-align:middle; }
  td { font-size:11px; }
  .grp { background:#2e6da4; }
</style>
</head>
<body>
<h3 style="font-family:Arial;margin-bottom:4px">TABLEAU DE SUIVI DES OBSTACLES — ${icao} ${aeroName}</h3>
<p style="font-family:Arial;font-size:10px;color:#555">Exporté le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}</p>
<table border="1" cellspacing="0">
<thead style="font-family:Arial">${theadHtml}</thead>
<tbody style="font-family:Arial">${tbodyHtml}</tbody>
</table>
</body></html>`;

  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SUIVI_OBSTACLES_${icao}_${_today()}.xls`;
  a.click();
  URL.revokeObjectURL(url);
}

function _today() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
