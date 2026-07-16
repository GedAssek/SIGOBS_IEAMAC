'use strict';
/* ═══════════════════════════════════════════════════════════
   SIGOBS — obstacles-csv-import.js
   Import par lot d'obstacles depuis un fichier CSV (export du modèle
   Excel officiel "Attributs obligatoires"), dessinés sur la carte et
   évalués automatiquement (POST /obstacles puis
   POST /obstacles/:id/evaluer pour chaque ligne).

   En-têtes attendues (exactement celles du modèle Excel fourni,
   dans n'importe quel ordre) :
     Zone de couverture
     Identificateur du créateur des données
     Identificateur de la source des données
     Identificateur d'obstacle          *obligatoire*
     Précision horizontale
     Latitude                            *obligatoire* (format DMS : 06°10′23.3″N)
     Longitude                           *obligatoire* (format DMS : 001°15′41.3″E)
     Résolution horizontale
     Système de référence horizontal
     Altitude (topographique)            *obligatoire*
     Hauteur                             *obligatoire*
     Précision verticale
     Résolution verticale
     Système de référence vertical
     Type d'obstacle
     Type de géométrie
     Indication de la date et de l'heure
     Unité de mesure employée            *obligatoire* (m ou ft)
     Balisage lumineux                   *obligatoire* (OUI / NON)
     Marque                              *obligatoire* (OUI / NON)

   Seuls les champs marqués *obligatoire* ci-dessus (ceux renseignés
   dans le modèle Excel fourni) sont exigés non-vides sur chaque
   ligne ; tous les autres sont facultatifs.

   Dépend de : config.js (App), api.js (showToast),
               obstacles.js (labelToTypeObstacle, createAndEvaluateObstacle)
   ═══════════════════════════════════════════════════════════ */

let _csvParsedRows = [];

/** Remet la drop-zone dans son état initial (avant chargement) */
function resetCsvDropZone() {
  const zone = document.getElementById('csv-drop-zone');
  if (zone) {
    zone.classList.remove('drop-zone-loaded', 'drop-zone-error');
    zone.innerHTML = `
      <svg class="drop-icon" viewBox="0 0 40 40" fill="none" width="32" height="32">
        <path d="M20 6v20M12 18l8 8 8-8M8 30h24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="drop-text">Glissez un fichier .csv ici</span>
      <span class="drop-sub">ou cliquez pour parcourir</span>`;
  }
  const infoEl = document.getElementById('csv-file-info');
  const btnImport = document.getElementById('btn-csv-import');
  const logEl = document.getElementById('csv-import-log');
  if (infoEl) infoEl.classList.add('hidden');
  if (btnImport) btnImport.classList.add('hidden');
  if (logEl) { logEl.classList.add('hidden'); logEl.innerHTML = ''; }
  const fileInput = document.getElementById('csv-file-input');
  if (fileInput) fileInput.value = '';
}

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

/**
 * Lit un fichier texte en détectant automatiquement son encodage :
 *  - UTF-8 si un BOM (EF BB BF) est présent en tête de fichier,
 *  - sinon Windows-1252 (encodage par défaut d'Excel FR pour l'export
 *    CSV "standard", par opposition à "CSV UTF-8") — sans ce repli,
 *    les caractères accentués (é, è, à…) sont mal décodés en UTF-8
 *    forcé et ne correspondent plus aux en-têtes attendues.
 * @returns {Promise<string>}
 */
function readCsvFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const bytes = new Uint8Array(ev.target.result);
      const hasBOM = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
      try {
        const decoder = new TextDecoder(hasBOM ? 'utf-8' : 'windows-1252');
        resolve(decoder.decode(hasBOM ? bytes.subarray(3) : bytes));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(new Error('Impossible de lire le fichier'));
    reader.readAsArrayBuffer(file);
  });
}

/** Lit et parse le fichier CSV sélectionné */
async function loadCsvFile(file) {
  console.log('[loadCsvFile] Fichier sélectionné :', file?.name, file?.size, 'octets');

  const zone = document.getElementById('csv-drop-zone');
  const infoEl = document.getElementById('csv-file-info');
  const btnImport = document.getElementById('btn-csv-import');

  /* Validation extension */
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showToast('Veuillez sélectionner un fichier .csv', 'warn');
    return;
  }

  /* Indicateur de chargement dans la zone de drop */
  if (zone) {
    zone.classList.remove('drop-zone-loaded', 'drop-zone-error');
    zone.innerHTML = `
      <svg class="drop-icon csv-spin" viewBox="0 0 40 40" fill="none" width="32" height="32">
        <circle cx="20" cy="20" r="14" stroke="currentColor" stroke-width="2" stroke-dasharray="44 44" stroke-linecap="round"/>
      </svg>
      <span class="drop-text">Lecture en cours…</span>
      <span class="drop-sub">${file.name}</span>`;
  }

  try {
    const text = await readCsvFileAsText(file);
    console.log('[loadCsvFile] Texte décodé, longueur :', text.length, '— premières 200 car. :', text.slice(0, 200));

    const { rows, skipped } = parseObstaclesCsv(text);
    console.log('[loadCsvFile] Parsing terminé — lignes valides :', rows.length, '— lignes ignorées :', skipped.length);
    _csvParsedRows = rows;

    /* ── Mise à jour de la drop-zone avec le résultat ── */
    if (zone) {
      if (rows.length > 0) {
        zone.classList.add('drop-zone-loaded');
        const skipNote = skipped.length
          ? `<span class="csv-skip-note">⚠ ${skipped.length} ligne(s) ignorée(s)</span>`
          : '';
        zone.innerHTML = `
          <svg class="drop-icon" viewBox="0 0 40 40" fill="none" width="32" height="32">
            <circle cx="20" cy="20" r="14" fill="rgba(16,185,129,0.12)" stroke="var(--green)" stroke-width="2"/>
            <path d="M13 20l5 5 9-9" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="drop-text" style="color:var(--green)">📄 ${file.name}</span>
          <span class="drop-sub">${rows.length} obstacle(s) prêt(s) à importer</span>
          ${skipNote}
          <button id="btn-csv-import-inline" class="btn-csv-launch" onclick="runCsvImport()">⬆ IMPORTER ET ÉVALUER</button>
          <button class="btn-csv-reset" onclick="event.stopPropagation(); resetCsvDropZone()">✕ Changer de fichier</button>`;
      } else {
        zone.classList.add('drop-zone-error');
        const reason = skipped.length
          ? `${skipped.length} ligne(s) rejetée(s) — champs obligatoires manquants`
          : 'Aucune ligne valide trouvée';
        zone.innerHTML = `
          <svg class="drop-icon" viewBox="0 0 40 40" fill="none" width="32" height="32">
            <circle cx="20" cy="20" r="14" fill="rgba(239,68,68,0.10)" stroke="var(--red)" stroke-width="2"/>
            <path d="M14 14l12 12M26 14l-12 12" stroke="var(--red)" stroke-width="2.5" stroke-linecap="round"/>
          </svg>
          <span class="drop-text" style="color:var(--red)">Fichier invalide</span>
          <span class="drop-sub">${reason}</span>
          <button class="btn-csv-reset" onclick="event.stopPropagation(); resetCsvDropZone()">↺ Réessayer</button>`;
      }
    }

    /* ── Mise à jour des éléments legacy (compatibilité) ── */
    console.log('[loadCsvFile] Éléments DOM — csv-file-info :', !!infoEl, '— btn-csv-import :', !!btnImport);
    if (infoEl) {
      infoEl.classList.toggle('hidden', rows.length === 0);
      if (rows.length > 0) {
        const skipNote = skipped.length ? ` — ${skipped.length} ligne(s) ignorée(s)` : '';
        infoEl.innerHTML = `<span>📄</span><span>${file.name}</span><span class="file-size">${rows.length} ligne(s) valide(s)${skipNote}</span>`;
      }
    }
    /* Le bouton principal est maintenant intégré dans la drop-zone. On cache le bouton externe. */
    if (btnImport) btnImport.classList.add('hidden');

    if (skipped.length) {
      console.warn('[loadCsvFile] Lignes ignorées :', skipped);
      if (rows.length > 0) showToast(`${skipped.length} ligne(s) ignorée(s) — voir détail dans la zone`, 'warn');
    }
    if (!rows.length) showToast('Aucune ligne valide trouvée dans le fichier', 'warn');

  } catch (err) {
    /* Erreur de lecture ou d'en-têtes CSV non conformes */
    if (zone) {
      zone.classList.add('drop-zone-error');
      zone.innerHTML = `
        <svg class="drop-icon" viewBox="0 0 40 40" fill="none" width="32" height="32">
          <circle cx="20" cy="20" r="14" fill="rgba(239,68,68,0.10)" stroke="var(--red)" stroke-width="2"/>
          <path d="M14 14l12 12M26 14l-12 12" stroke="var(--red)" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        <span class="drop-text" style="color:var(--red)">Erreur de lecture</span>
        <span class="drop-sub" style="max-width:220px;text-align:center;line-height:1.4">${err.message}</span>
        <button class="btn-csv-reset" onclick="event.stopPropagation(); resetCsvDropZone()">↺ Réessayer</button>`;
    }
    showToast('Erreur CSV : ' + err.message, 'error');
    console.error('[loadCsvFile] Erreur :', err);
    _csvParsedRows = [];
  }
}

/**
 * Parse une coordonnée au format DMS : 06°10′23.3″N ou 001°15′41.3″E
 *
 * Formats acceptés (séparateurs degrés/minutes/secondes) :
 *  - Symboles typographiques : °, º, ⁰  /  ′, ʹ, \u2032  /  ″, \u2033
 *  - Apostrophe/guillemet droits : ' (U+0027) / " (U+0022)
 *  - Apostrophes typographiques : ' (U+2018/2019)
 *  - Point d'interrogation ? (U+003F) — produit par certains exports
 *    Excel/CSV lorsque les symboles DMS sont convertis via Windows-1252
 *  - Tout autre caractère non-numérique entre les valeurs numériques
 *
 * Séparateur décimal : point ou virgule (ex. 23.3 ou 23,3).
 * @returns {number} degrés décimaux (négatif pour S ou W), ou NaN si pas DMS
 */
function parseDMS(str) {
  if (!str) return NaN;
  const s = str.trim();
  // Regex ultra-permissive : accepte TOUT séparateur non-chiffre entre les
  // groupes numériques, tant que la chaîne se termine par N/S/E/W.
  // Format attendu : DDDXMMXSS.sXHEM (X = n'importe quel non-chiffre, 1+)
  const match = s.match(/^(\d{1,3})\D+(\d{1,2})\D+([\d.,]+)\D*([NSEWnsew])$/i);
  if (!match) return NaN;
  const deg = parseInt(match[1], 10);
  const min = parseInt(match[2], 10);
  const sec = parseFloat(match[3].replace(',', '.'));
  const dir = match[4].toUpperCase();
  // Validation de base (intervalle raisonnable)
  if (min >= 60 || sec >= 60) return NaN;
  let dec = deg + (min / 60) + (sec / 3600);
  if (dir === 'S' || dir === 'W') dec = -dec;
  return dec;
}

/**
 * Extrait une coordonnée depuis une cellule CSV :
 *  1. Tente le format DMS (06°10′23.3″N, 06°10?23.3?N, etc.)
 *  2. Retombe sur un nombre décimal brut si non-DMS
 *     (accepte la virgule comme séparateur décimal).
 * Ne retourne JAMAIS de valeur par défaut — si la cellule est vide
 * ou illisible, retourne NaN pour déclencher le rejet de la ligne.
 */
function parseCoordCell(str) {
  const dms = parseDMS(str);
  if (!isNaN(dms)) return dms;
  return parseFloat((str || '').trim().replace(',', '.'));
}

/**
 * Parseur CSV minimal (sans dépendance externe) : gère les guillemets,
 * les virgules ou points-virgules comme séparateur, et l'en-tête.
 */
function splitCsvLine(line, delimiter) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let cur = '';
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i+1] === '"') {
            cur += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          cur += line[i];
          i++;
        }
      }
      out.push(cur.trim());
      while (i < line.length && line[i] !== delimiter) {
        i++;
      }
      i++; // skip delimiter
    } else {
      let start = i;
      while (i < line.length && line[i] !== delimiter) {
        i++;
      }
      out.push(line.substring(start, i).trim());
      i++; // skip delimiter
    }
  }
  if (line[line.length - 1] === delimiter) {
    out.push('');
  }
  return out;
}

/** Normalise un en-tête pour une comparaison tolérante (accents, casse, espaces, apostrophes) */
function normalizeHeader(s) {
  return (s || '')
    .replace(/^\uFEFF/, '')                          // BOM éventuel
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // retire les accents
    .toLowerCase()
    // Normalise toutes les variantes d'apostrophes typographiques → apostrophe ASCII
    .replace(/[\u2018\u2019\u201A\u201B\u02BC\u02B9\u0060]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * En-têtes attendues (modèle Excel officiel), sous forme normalisée
 * (sans accents, minuscules) → nom de colonne interne.
 * `required: true` = doit être non-vide sur chaque ligne.
 */
const CSV_COLUMNS = [
  { key: 'zone_couverture', header: 'zone de couverture', required: false },
  { key: 'createur', header: 'identificateur du createur des donnees', required: false },
  { key: 'source', header: 'identificateur de la source des donnees', required: false },
  { key: 'nom', header: "identificateur d'obstacle", required: true },
  { key: 'precision_h', header: 'precision horizontale', required: false },
  { key: 'lat', header: 'latitude', required: true },
  { key: 'lon', header: 'longitude', required: true },
  { key: 'resolution_h', header: 'resolution horizontale', required: false },
  { key: 'ref_h', header: 'systeme de reference horizontal', required: false },
  { key: 'altitude', header: 'altitude (topographique)', required: true },
  { key: 'hauteur', header: 'hauteur', required: true },
  { key: 'precision_v', header: 'precision verticale', required: false },
  { key: 'resolution_v', header: 'resolution verticale', required: false },
  { key: 'ref_v', header: 'systeme de reference vertical', required: false },
  { key: 'type_obstacle', header: "type d'obstacle", required: false },
  { key: 'type_geometrie', header: 'type de geometrie', required: false },
  { key: 'date_heure', header: "indication de la date et de l'heure", required: false },
  { key: 'unite_mesure', header: 'unite de mesure employee', required: true },
  { key: 'balisage_lumineux', header: 'balisage lumineux', required: true },
  { key: 'marque', header: 'marque', required: true },
];

/**
 * Parse le fichier CSV complet : valide l'en-tête (les 20 colonnes du
 * modèle Excel doivent toutes être présentes, dans n'importe quel
 * ordre), puis chaque ligne (les champs obligatoires ne doivent pas
 * être vides).
 * @returns {{ rows: Array<Object>, skipped: Array<{ligne:number, raison:string}> }}
 */
function parseObstaclesCsv(text) {
  const lines = text.split(/\r?\n/).map(l => l.replace(/\r$/, '')).filter(l => l.trim().length);
  if (lines.length < 2) return { rows: [], skipped: [] };

  const delimiter = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const rawHeader = splitCsvLine(lines[0], delimiter).map(normalizeHeader);

  // Associe chaque colonne attendue à son index dans le fichier
  const colIndex = {};
  const missing = [];
  CSV_COLUMNS.forEach(col => {
    const idx = rawHeader.findIndex(h => h === col.header);
    colIndex[col.key] = idx;
    if (idx === -1) missing.push(col.header);
  });

  if (missing.length) {
    throw new Error(
      "En-tête(s) manquante(s) ou différente(s) du modèle attendu : " + missing.join(', ')
    );
  }

  const rows = [];
  const skipped = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delimiter);
    const get = (key) => (cells[colIndex[key]] || '').trim();

    // Validation : tous les champs obligatoires doivent être renseignés
    const missingFields = CSV_COLUMNS.filter(c => c.required && !get(c.key)).map(c => c.header);
    if (missingFields.length) {
      skipped.push({ ligne: i + 1, raison: `Champ(s) obligatoire(s) vide(s) : ${missingFields.join(', ')}` });
      continue;
    }

    const lat = parseCoordCell(get('lat'));
    const lon = parseCoordCell(get('lon'));
    if (isNaN(lat) || isNaN(lon)) {
      skipped.push({ ligne: i + 1, raison: `Latitude/Longitude illisible(s) (attendu : 06°10′23.3″N)` });
      continue;
    }

    let altM = parseFloat(get('altitude').replace(',', '.'));
    let heightM = parseFloat(get('hauteur').replace(',', '.'));
    if (isNaN(altM) || isNaN(heightM)) {
      skipped.push({ ligne: i + 1, raison: `Altitude/Hauteur illisible(s)` });
      continue;
    }

    // L'unité de mesure déclarée sur la ligne fait foi : si "ft", on
    // convertit en mètres (convention interne de l'application).
    const uniteMesure = get('unite_mesure');
    if (/^ft$|^pieds?$/i.test(uniteMesure)) {
      const FT_TO_M = 0.3048;
      altM *= FT_TO_M;
      heightM *= FT_TO_M;
    }

    const balisageRaw = get('balisage_lumineux').toUpperCase();
    const marqueRaw = get('marque').toUpperCase();
    if (!/^(OUI|NON)$/.test(balisageRaw) || !/^(OUI|NON)$/.test(marqueRaw)) {
      skipped.push({ ligne: i + 1, raison: `Balisage lumineux / Marque doivent valoir OUI ou NON` });
      continue;
    }

    rows.push({
      name: get('nom'),
      type: normalizeCsvObsType(get('type_obstacle')),
      lat, lon, altM, heightM,
      temporal: 'permanent', // non couvert par le modèle Excel officiel
      zoneCouverture: get('zone_couverture') || undefined,
      identificateurCreateur: get('createur') || undefined,
      identificateurSource: get('source') || undefined,
      precisionHorizontale: get('precision_h') || undefined,
      resolutionHorizontale: get('resolution_h') || undefined,
      systemeReferenceHorizontal: get('ref_h') || undefined,
      precisionVerticale: get('precision_v') || undefined,
      resolutionVerticale: get('resolution_v') || undefined,
      systemeReferenceVertical: get('ref_v') || undefined,
      typeGeometrie: get('type_geometrie') || 'Point',
      dateHeureReleve: get('date_heure') || undefined,
      uniteMesure: uniteMesure || 'm',
      balisageLumineux: balisageRaw === 'OUI' ? 'Oui' : 'Non',
      marque: marqueRaw === 'OUI' ? 'Oui' : 'Non',
    });
  }

  return { rows, skipped };
}

/** Normalise la valeur "type" du CSV vers les clés internes connues */
function normalizeCsvObsType(raw) {
  const v = (raw || '').trim().toLowerCase();
  const known = ['building', 'tower', 'vegetation', 'crane', 'antenna', 'powerline', 'water_tower', 'other'];
  return known.includes(v) ? v : 'other';
}

/**
 * Construit le payload backend pour une ligne CSV déjà validée/parsée.
 * Autonome (ne dépend pas de champs de formulaire DOM), contrairement à
 * la saisie unitaire, puisqu'un lot d'obstacles est traité en dehors de
 * la page de saisie.
 */
function buildCsvObstaclePayload(row) {
  const M_TO_FT = 3.28084;
  const payload = {
    aerodrome_id: App.aerodromeMongoId,
    nom: row.name,
    type_obstacle: (typeof labelToTypeObstacle === 'function') ? labelToTypeObstacle(row.type) : row.type,
    geometrie: { type: 'Point', coordinates: [row.lon, row.lat] },
    latitude: row.lat,
    longitude: row.lon,
    altitude_max: Math.round(row.altM * M_TO_FT * 100) / 100,
    hauteur: !isNaN(row.heightM) ? Math.round(row.heightM * M_TO_FT * 100) / 100 : undefined,
    zone_de_couverture: row.zoneCouverture || '3', // Valeur par défaut souvent obligatoire en backend
    permanence: 'Permanent',
    type_temporel: 'permanent', // Manquait pour l'import CSV
    identificateur_createur_donnees: row.identificateurCreateur,
    identificateur_source_donnees: row.identificateurSource,
    precision_horizontale: row.precisionHorizontale ? parseFloat(row.precisionHorizontale) : undefined,
    resolution_horizontale: row.resolutionHorizontale ? parseFloat(row.resolutionHorizontale) : undefined,
    systeme_reference_horizontal: row.systemeReferenceHorizontal,
    precision_verticale: row.precisionVerticale ? parseFloat(row.precisionVerticale) : undefined,
    resolution_verticale: row.resolutionVerticale ? parseFloat(row.resolutionVerticale) : undefined,
    systeme_reference_vertical: row.systemeReferenceVertical,
    type_geometrie: row.typeGeometrie || 'Point',
    date_heure_releve: row.dateHeureReleve,
    unite_mesure: row.uniteMesure || 'm',
    balisage_lumineux: row.balisageLumineux || 'Non',
    marque: row.marque || 'Non',
  };
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
  return payload;
}

/** Lance l'import : crée et évalue chaque obstacle séquentiellement, journalise la progression */
async function runCsvImport() {
  console.log('[runCsvImport] Déclenché — lignes en mémoire :', _csvParsedRows.length, '— aerodromeMongoId :', App.aerodromeMongoId);
  if (!_csvParsedRows.length) { showToast('Aucune ligne à importer', 'warn'); console.warn('[runCsvImport] Arrêt : aucune ligne en mémoire'); return; }
  if (!App.aerodromeMongoId) { showToast('Aérodrome non chargé', 'error'); console.warn('[runCsvImport] Arrêt : App.aerodromeMongoId absent'); return; }

  const zone = document.getElementById('csv-drop-zone');
  const btnInline = document.getElementById('btn-csv-import-inline');
  const btn = document.getElementById('btn-csv-import');
  const logEl = document.getElementById('csv-import-log');
  const total = _csvParsedRows.length;

  /* Désactiver le bouton inline pendant l'import */
  if (btnInline) { btnInline.disabled = true; btnInline.textContent = `⏳ Import en cours… (0 / ${total})`; }
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

  let success = 0, failed = 0, duplicates = 0;
  /* Import séquentiel pour ne pas saturer le backend et garder un log lisible */
  for (const row of _csvParsedRows) {
    console.log('[runCsvImport] Traitement de la ligne :', row.name, row);

    // ── Vérification de doublon avant envoi au backend ──────────────────────
    if (typeof isObstacleDuplicate === 'function' && isObstacleDuplicate(row.name, row.lat, row.lon)) {
      duplicates++;
      log(`${row.name} — refusé : obstacle déjà existant (même identifiant et mêmes coordonnées)`, false);
      console.warn('[runCsvImport] Doublon détecté, ligne ignorée :', row.name, { lat: row.lat, lon: row.lon });
      /* Mise à jour du compteur en temps réel */
      if (btnInline) btnInline.textContent = `⏳ Import en cours… (${success + failed + duplicates} / ${total})`;
      continue;
    }
    // ────────────────────────────────────────────────────────────────

    try {
      const payload = buildCsvObstaclePayload(row);
      console.log('[runCsvImport] Payload construit :', payload);
      const obs = await createAndEvaluateObstacle(payload);
      console.log('[runCsvImport] Résultat createAndEvaluateObstacle :', obs);
      if (obs) {
        success++;
        log(`${row.name} — importé et évalué`);
      } else {
        failed++;
        log(`${row.name} — échec`, false);
      }
    } catch (e) {
      console.error('[runCsvImport] Erreur sur la ligne', row.name, ':', e);
      failed++;
      log(`${row.name} — erreur : ${e.message}`, false);
    }
    /* Mise à jour du compteur en temps réel */
    if (btnInline) btnInline.textContent = `⏳ Import en cours… (${success + failed + duplicates} / ${total})`;
  }

  /* ── Afficher le résumé final dans la drop-zone ── */
  const allOk = failed === 0 && duplicates === 0;
  const hasDuplicates = duplicates > 0;
  if (zone) {
    zone.classList.remove('drop-zone-loaded', 'drop-zone-error');
    zone.classList.add(allOk ? 'drop-zone-loaded' : 'drop-zone-error');
    const dupNote = hasDuplicates ? `<span class="csv-skip-note">⚠ ${duplicates} doublon(s) refusé(s)</span>` : '';
    zone.innerHTML = `
      <svg class="drop-icon" viewBox="0 0 40 40" fill="none" width="32" height="32">
        <circle cx="20" cy="20" r="14" fill="rgba(${allOk ? '16,185,129' : '245,158,11'},0.12)"
          stroke="var(--${allOk ? 'green' : 'amber'})" stroke-width="2"/>
        <path d="M13 20l5 5 9-9" stroke="var(--${allOk ? 'green' : 'amber'})" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="drop-text" style="color:var(--${allOk ? 'green' : 'amber'})">
        Import terminé
      </span>
      <span class="drop-sub">
        ${success} importé(s) avec succès${failed ? ` · ${failed} échec(s)` : ''}${hasDuplicates ? ` · ${duplicates} doublon(s) ignoré(s)` : ''}
      </span>
      ${dupNote}
      <button class="btn-csv-reset" onclick="event.stopPropagation(); resetCsvDropZone()">↺ Nouveau fichier</button>`;
  }

  showToast(
    `Import terminé — ${success} obstacle(s) importé(s)${failed ? `, ${failed} échec(s)` : ''}${duplicates ? `, ${duplicates} doublon(s) ignoré(s)` : ''}`,
    (failed || duplicates) ? 'warn' : 'success'
  );

  _csvParsedRows = [];
  const infoEl = document.getElementById('csv-file-info');
  if (infoEl) infoEl.classList.add('hidden');
  if (btn) { btn.disabled = false; btn.textContent = 'IMPORTER ET ÉVALUER LES OBSTACLES'; btn.classList.add('hidden'); }
}