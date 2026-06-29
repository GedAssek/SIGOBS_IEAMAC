'use strict';
/* ═══════════════════════════════════════════════════════════
   SIGOBS — aerodrome.js
   Chargement de l'aérodrome d'étude, normalisation, pistes
   Routes : GET /aerodromes?code_oaci=  (doc §5.3)
            GET /aerodromes/:id/pistes  (doc §6.3)
   Dépend de : config.js, api.js (apiFetch, normalizeAerodromeFromAPI,
               setApiStatus, showToast)
   ═══════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════
   STATUT AÉRODROME D'ÉTUDE
══════════════════════════════════════════════════════════ */
function setAerodromeStatus(state, msg) {
  const dot    = document.getElementById('study-status-dot');
  const nameEl = document.getElementById('study-name');
  if (dot) dot.className = `study-status-dot ${state}`;
  if (state === 'loading' && nameEl && !App.aerodrome) nameEl.textContent = msg || 'Chargement…';
}

/* ══════════════════════════════════════════════════════════
   CHARGEMENT AÉRODROME UNIQUE D'ÉTUDE
   Séquence :
     1. GET /aerodromes?code_oaci=ICAO  → récupère le _id MongoDB
     2. GET /aerodromes/:id/pistes      → liste des pistes (doc §6.3)
     3. normalisation + mise à jour UI
     4. chargement des obstacles
══════════════════════════════════════════════════════════ */
async function loadStudyAerodrome() {
  const icao = STUDY_AERODROME_ICAO;
  setAerodromeStatus('loading', 'Chargement ' + icao + '…');
  try {
    // 1. Chercher l'aérodrome par code_oaci pour obtenir le _id MongoDB
    const listRes = await apiFetch('/aerodromes?code_oaci=' + icao);
    const rawList = listRes.data || [];
    if (!rawList.length) throw new Error('Aérodrome ' + icao + ' introuvable dans la base');
    const raw = rawList[0];

    // 2. Stocker le _id MongoDB (requis pour /surfaces, /pistes, /obstacles)
    App.aerodromeMongoId = raw._id;

    // 3. Charger les pistes séparément — doc §6.3 : GET /aerodromes/:id/pistes
    let pistesRaw = [];
    try {
      const pistesRes = await apiFetch('/aerodromes/' + raw._id + '/pistes');
      pistesRaw = pistesRes.data || [];
      console.log('[loadStudyAerodrome] Pistes chargées:', pistesRaw.length,
        pistesRaw.map(function (p) { return p.qfu_1 + '/' + p.qfu_2; }));
    } catch (e) {
      console.warn('[loadStudyAerodrome] Impossible de charger les pistes:', e.message);
    }

    // 4. Normaliser aérodrome + pistes ensemble
    const schema = normalizeAerodromeFromAPI(raw, pistesRaw);
    applyAerodromeToUI(schema);
    await loadObstaclesList();
    // Afficher le nombre de QFU (pistes normalisées) et non le count brut API
    const qfuCount = schema.runways.length;
    const pisteCount = pistesRaw.filter(p => !p.fermee).length;
    showToast(`Aérodrome chargé — ${pisteCount} piste(s) · ${qfuCount} QFU`, 'success');
  } catch (err) {
    setAerodromeStatus('error', icao + ' — erreur de chargement');
    setApiStatus('disconnected', 'API inaccessible');
    console.error('[loadStudyAerodrome]', err);
    showToast('Impossible de charger l\'aérodrome : ' + err.message, 'error');
  }
}

/* ══════════════════════════════════════════════════════════
   APPLICATION DU SCHÉMA AÉRODROME À L'INTERFACE
══════════════════════════════════════════════════════════ */
function applyAerodromeToUI(schema) {
  App.aerodrome = schema;
  App.runways   = schema.runways || [];

  const icaoEl = document.getElementById('study-icao');
  const nameEl = document.getElementById('study-name');
  const elevEl = document.getElementById('study-elev');
  const dotEl  = document.getElementById('study-status-dot');

  if (icaoEl) icaoEl.textContent = schema.icao || '—';
  if (nameEl) nameEl.textContent = `${schema.name}${schema.iata ? '  (' + schema.iata + ')' : ''}`;
  if (elevEl) elevEl.textContent = `ELEV ${schema.elevation ?? '—'} ft  ·  ${schema.city || schema.country || ''}`;
  if (dotEl)  dotEl.className    = 'study-status-dot ready';

  const aeroInfoDiv = document.getElementById('aerodrome-info');
  if (aeroInfoDiv) aeroInfoDiv.classList.remove('hidden');

  buildRunwayTabs();

  // Sélectionner la première piste ouverte par défaut
  const firstOpen = App.runways.find(r => !r.closed) || App.runways[0];
  if (firstOpen) selectRunway(firstOpen);

  // Centrer la carte sur l'aérodrome
  if (GeoMap.map)
    GeoMap.map.flyTo({ center: [schema.longitude, schema.latitude], zoom: 13, pitch: 50, bearing: 0, duration: 2000 });
}

/* ══════════════════════════════════════════════════════════
   PISTES — Onglets et sélection
══════════════════════════════════════════════════════════ */

/** Construit les onglets de sélection de piste dans la barre runway */
function buildRunwayTabs() {
  const container = document.getElementById('runway-tabs');
  const meta      = document.getElementById('runway-meta');
  container.innerHTML = '';
  meta.innerHTML      = '';

  if (!App.runways.length) {
    container.innerHTML = '<span class="no-runway-msg">— Aucune piste disponible —</span>';
    return;
  }

  App.runways.forEach((rwy, idx) => {
    const btn = document.createElement('button');
    btn.className = 'runway-tab-btn' + (idx === 0 ? ' active' : '');
    btn.textContent = rwy.designation || `RWY ${idx + 1}`;
    btn.onclick = () => {
      document.querySelectorAll('.runway-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectRunway(rwy);
    };
    container.appendChild(btn);
  });
}

/** Sélectionne une piste, met à jour le panneau de droite et rafraîchit la carte */
function selectRunway(rwy) {
  App.activeRunway = rwy;

  const label = document.getElementById('active-runway-label');
  if (label) label.textContent = `RWY ${rwy.designation || '—'}  |  ${rwy.length || '—'} m  ×  ${rwy.width || '—'} m`;

  document.getElementById('rwy-desig').textContent   = rwy.designation || '—';
  document.getElementById('rwy-length').textContent  = rwy.length   ? `${rwy.length} m`     : '—';
  document.getElementById('rwy-width').textContent   = rwy.width    ? `${rwy.width} m`      : '—';
  document.getElementById('rwy-bearing').textContent = rwy.trueHeading != null ? `${rwy.trueHeading}°` : '—';
  document.getElementById('rwy-elev').textContent    = rwy.elevation != null   ? `${rwy.elevation} ft` : '—';
  document.getElementById('rwy-code').textContent    = rwy.icaoCode || '—';

  const meta = document.getElementById('runway-meta');
  meta.innerHTML =
    `<span class="runway-meta-item">CAP <span>${rwy.trueHeading ?? '—'}°</span></span>` +
    `<span class="runway-meta-item">L <span>${rwy.length ?? '—'} m</span></span>` +
    `<span class="runway-meta-item">l <span>${rwy.width ?? '—'} m</span></span>` +
    `<span class="runway-meta-item">ÉLÉV <span>${rwy.elevation ?? '—'} ft</span></span>`;

  // Rafraîchir la carte (surfaces OLS + obstacles)
  geoMapRender();
}
