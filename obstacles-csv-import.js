'use strict';
/* ═══════════════════════════════════════════════════════════
   SIGOBS — obstacles-csv-import.js
   Import par lot d'obstacles depuis un fichier CSV, dessinés sur
   la carte et évalués automatiquement (POST /obstacles puis
   POST /obstacles/:id/evaluer pour chaque ligne).
   Colonnes attendues : nom,proprietaire,type,lat,lon,altitude_m,hauteur_m,temporel
   Dépend de : config.js (App), api.js (showToast),
               obstacles.js (buildObstaclePayload, createAndEvaluateObstacle)
   ═══════════════════════════════════════════════════════════ */

let _csvParsedRows = [];

/** Gestion du drop de fichier sur la zone dédiée */
function handleCsvDrop(e) {
  e.preventDefault();
  document.getElementById('csv-drop-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadCsvFile(file);
}

/** Gestion de la sélection via l'input file */
function handleCsvFileSelect(e) {
  const file = e.target.files[0];
  if (file) loadCsvFile(file);
}

/** Lit et parse le fichier CSV sélectionné */
function loadCsvFile(file) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showToast('Veuillez sélectionner un fichier .csv', 'warn');
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      _csvParsedRows = parseObstaclesCsv(ev.target.result);
      const infoEl = document.getElementById('csv-file-info');
      const btnImport = document.getElementById('btn-csv-import');
      if (infoEl) {
        infoEl.classList.remove('hidden');
        infoEl.innerHTML = `<span>📄</span><span>${file.name}</span><span class="file-size">${_csvParsedRows.length} ligne(s) détectée(s)</span>`;
      }
      if (btnImport) btnImport.classList.toggle('hidden', _csvParsedRows.length === 0);
      if (!_csvParsedRows.length) showToast('Aucune ligne valide trouvée dans le fichier', 'warn');
    } catch (err) {
      showToast('Erreur de lecture du CSV : ' + err.message, 'error');
      console.error('[loadCsvFile]', err);
    }
  };
  reader.onerror = () => showToast('Impossible de lire le fichier', 'error');
  reader.readAsText(file, 'UTF-8');
}

/**
 * Parseur CSV minimal (sans dépendance externe) : gère les guillemets,
 * les virgules ou points-virgules comme séparateur, et l'en-tête.
 */
function parseObstaclesCsv(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length);
  if (lines.length < 2) return [];

  const delimiter = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const splitLine = (line) => {
    // Découpage simple respectant les champs entre guillemets
    const out = []; let cur = ''; let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuotes = !inQuotes; continue; }
      if (c === delimiter && !inQuotes) { out.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    out.push(cur.trim());
    return out;
  };

  const header = splitLine(lines[0]).map(h => h.toLowerCase());
  const col = (name) => header.indexOf(name);

  const idxNom = col('nom'); const idxProp = col('proprietaire');
  const idxType = col('type'); const idxLat = col('lat');
  const idxLon = col('lon'); const idxAlt = col('altitude_m');
  const idxHeight = col('hauteur_m'); const idxTemp = col('temporel');

  if (idxNom === -1 || idxLat === -1 || idxLon === -1 || idxAlt === -1) {
    throw new Error('En-têtes requis manquants (nom, lat, lon, altitude_m)');
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const name = (cells[idxNom] || '').trim();
    const lat = parseFloat(cells[idxLat]);
    const lon = parseFloat(cells[idxLon]);
    const altM = parseFloat(cells[idxAlt]);
    if (!name || isNaN(lat) || isNaN(lon) || isNaN(altM)) continue; // ligne ignorée si incomplète
    rows.push({
      name,
      proprietaire: idxProp !== -1 ? (cells[idxProp] || '') : '',
      type: idxType !== -1 ? normalizeCsvObsType(cells[idxType]) : 'other',
      lat, lon, altM,
      heightM: idxHeight !== -1 ? parseFloat(cells[idxHeight]) : NaN,
      temporal: idxTemp !== -1 ? normalizeCsvTemporal(cells[idxTemp]) : 'permanent',
    });
  }
  return rows;
}

/** Normalise la valeur "temporel" du CSV : permanent / temporary / construction */
function normalizeCsvTemporal(raw) {
  const v = (raw || '').trim().toLowerCase();
  if (v.startsWith('construct') || v.startsWith('chantier')) return 'construction';
  if (v.startsWith('temp')) return 'temporary';
  return 'permanent';
}

/** Normalise la valeur "type" du CSV vers les clés internes connues */
function normalizeCsvObsType(raw) {
  const v = (raw || '').trim().toLowerCase();
  const known = ['building', 'tower', 'vegetation', 'crane', 'antenna', 'powerline', 'water_tower', 'other'];
  return known.includes(v) ? v : 'other';
}

/** Lance l'import : crée et évalue chaque obstacle séquentiellement, journalise la progression */
async function runCsvImport() {
  if (!_csvParsedRows.length) { showToast('Aucune ligne à importer', 'warn'); return; }
  if (!App.aerodromeMongoId) { showToast('Aérodrome non chargé', 'error'); return; }

  const btn = document.getElementById('btn-csv-import');
  const logEl = document.getElementById('csv-import-log');
  if (btn) { btn.disabled = true; btn.textContent = 'IMPORT EN COURS…'; }
  if (logEl) { logEl.classList.remove('hidden'); logEl.innerHTML = ''; }

  const log = (msg, ok = true) => {
    if (!logEl) return;
    const line = document.createElement('div');
    line.style.color = ok ? 'var(--green)' : 'var(--red)';
    line.textContent = (ok ? '✓ ' : '✗ ') + msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  };

  let success = 0, failed = 0;
  // Import séquentiel pour ne pas saturer le backend et garder un log lisible
  for (const row of _csvParsedRows) {
    try {
      const payload = buildObstaclePayload({
        name: row.name, proprietaire: row.proprietaire, type: row.type,
        lat: row.lat, lon: row.lon, altM: row.altM, heightM: row.heightM,
        temporal: row.temporal, expiry: '',
      });
      const obs = await createAndEvaluateObstacle(payload);
      if (obs) { success++; log(`${row.name} — importé et évalué`); }
      else { failed++; log(`${row.name} — échec`, false); }
    } catch (e) {
      failed++; log(`${row.name} — erreur : ${e.message}`, false);
    }
  }

  if (btn) { btn.disabled = false; btn.textContent = 'IMPORTER ET ÉVALUER LES OBSTACLES'; btn.classList.add('hidden'); }
  showToast(`Import terminé — ${success} obstacle(s) importé(s)${failed ? `, ${failed} échec(s)` : ''}`, failed ? 'warn' : 'success');

  _csvParsedRows = [];
  const infoEl = document.getElementById('csv-file-info');
  if (infoEl) infoEl.classList.add('hidden');
  const fileInput = document.getElementById('csv-file-input');
  if (fileInput) fileInput.value = '';
}
