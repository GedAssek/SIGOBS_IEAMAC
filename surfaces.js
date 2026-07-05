'use strict';
/* ═══════════════════════════════════════════════════════════
   SIGOBS — surfaces.js  (v2)
   Récupération et rendu des surfaces OLS depuis le backend.
   Routes :
     GET /aerodromes/:aerodrome_id/surfaces  → surfaces globales
     GET /pistes/:piste_id/surfaces          → surfaces par piste (§6.2)

   Rendu MapLibre GL JS :
     - fill-extrusion 3D (opacité 0.25 — semi-transparent, lisible sur satellite)
     - line 2D contours  (opacité 0.55)
     - fill 2D léger     (opacité 0.04)
     - Légende avec cases à cocher opérationnelles

   Dépend de : config.js (App, GeoMap), api.js (apiFetch, showToast)
   ═══════════════════════════════════════════════════════════ */

/* ── Palette surfaces : couleurs lisibles sur fond satellite ── */
const SURFACE_META = {
  horizontale_interieure: { label: 'Horizontale intérieure', color: '#FFD600' },
  conique: { label: 'Conique', color: '#FF6D00' },
  approche_troncon1: { label: 'Approche tronçon 1', color: '#00B0FF' },
  approche_troncon2: { label: 'Approche tronçon 2', color: '#0091EA' },
  approche_troncon3: { label: 'Approche tronçon 3', color: '#01579B' },
  transition_gauche: { label: 'Transition gauche', color: '#69F0AE' },
  transition_droite: { label: 'Transition droite', color: '#00E676' },
  decollage: { label: 'Décollage', color: '#CE93D8' },
  decollage_rect: { label: 'Décollage rect.', color: '#AB47BC' },
  approche_interieure: { label: 'Approche intérieure', color: '#FF80AB' },
  transition_interieure: { label: 'Transition intérieure', color: '#82B1FF' },
  atterrissage_interrompu: { label: 'Atterrissage interrompu', color: '#FF1744' },
  obstacle: { label: 'Obstacle', color: '#FF1744' },
};

/** Normalise un type_surface backend → clé interne */
function normalizeSurfaceType(rawType) {
  return (rawType || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // retire les accents
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/* ══════════════════════════════════════════════════════════
   RÉCUPÉRATION ET RENDU DES SURFACES OLS
   Charge les surfaces de l'aérodrome ET de TOUTES les pistes.
══════════════════════════════════════════════════════════ */
async function fetchSurfacesFromAPI() {
  const map = GeoMap.map;
  if (!map || !App.aerodromeMongoId) return;

  try {
    const geojson = { type: 'FeatureCollection', features: [] };

    // 1. Surfaces globales de l'aérodrome
    try {
      const resAero = await apiFetch('/aerodromes/' + App.aerodromeMongoId + '/surfaces');
      const features = (resAero.data && resAero.data.features)
        ? resAero.data.features
        : (resAero.surfaces && resAero.surfaces.features ? resAero.surfaces.features : []);
      geojson.features.push(...features);
      console.table(features);

    } catch (e) {
      console.warn('[surfaces] Surfaces aérodrome:', e.message);
    }

    // 2. Surfaces de TOUTES les pistes (pas seulement la piste active)
    const pistes = App.runways
      .filter(r => r._id)
      // Dédupliquer par _id de piste (chaque piste a 2 QFU mais même _id)
      .filter((r, i, arr) => arr.findIndex(x => x._id === r._id) === i);

    for (const piste of pistes) {
      try {
        const resRwy = await apiFetch('/pistes/' + piste._id + '/surfaces');
        const features = (resRwy.data && resRwy.data.features)
          ? resRwy.data.features
          : (resRwy.surfaces && resRwy.surfaces.features ? resRwy.surfaces.features : []);
        geojson.features.push(...features);
      } catch (e) {
        console.warn('[surfaces] Piste ' + piste.designation + ':', e.message);
      }
    }

    if (!geojson.features.length) {
      console.warn('[surfaces] Aucune surface trouvée');
      updateSurfaceLegend([]);
      return;
    }


    const ANNEX14_CEILING = {
      // [hauteur_max_m, pente_label]
      horizontale_interieure: [45, '0%'],
      conique: [145, '5%'],
      approche: [150, '3.33%'],
      approche_troncon1: [100, '3.33%'],
      approche_troncon2: [190, '2.5%'],
      approche_troncon3: [190, '0%'],
      transition: [45, '14.3%'],
      transition_gauche: [45, '14.3%'],
      transition_droite: [45, '14.3%'],
      decollage: [300, '2%'],
      decollage_rect: [300, '2%'],
      approche_interieure: [18, '2%'],
      transition_interieure: [45, '33.3%'],
      atterrissage_interrompu: [45, '3.33%'],
    };

    // Épaisseur visuelle des dalles flottantes (en mètres).
    // La surface "plafond" aura heightM = sommet, baseM = sommet - EPAISSEUR (dalle épaisse).
    const EPAISSEUR_M = 10;

    // 3. Injecter couleur, type normalisé ET hauteurs converties en mètres pour MapLibre
    geojson.features.forEach(f => {
      if (!f.properties) f.properties = {};
      const rawType = f.properties.type_surface || f.properties.surface_type || '';
      const t = normalizeSurfaceType(rawType);
      const meta = SURFACE_META[t] || { label: rawType || 'Inconnu', color: '#90A4AE' };
      f.properties.normalized_type = t;
      f.properties.color = meta.color;
      f.properties.label = meta.label || rawType;

      // Hauteur sommet : on préfère la valeur du backend.
      // Si le backend envoie 0 / null, on utilise la hauteur de référence Annexe 14.
      const rawSommetFt = parseFloat(f.properties.altitude_sommet ?? f.properties.top_elevation ?? 0);
      const fallback = ANNEX14_CEILING[t];
      let sommetM;
      if (rawSommetFt > 0) {
        sommetM = rawSommetFt * 0.3048;
      } else if (fallback) {
        sommetM = fallback[0];
        // Injecter la pente de référence si le backend ne la fournit pas
        if (!f.properties.pente) f.properties.pente = fallback[1];
      } else {
        sommetM = 0;
      }

      // ─── RÈGLE DE RENDU ────────────────────────────────────────────────────
      //  • horizontale_interieure → bloc plein du sol jusqu'au plafond (base = 0)
      //  • Toutes les autres       → DALLE FLOTTANTE au plafond avec épaisseur EPAISSEUR_M
      //    (base = sommet - EPAISSEUR_M)
      //    → Si le backend découpe la surface en tranches, chaque tranche sera
      //      une dalle flottante indépendante qui simule la pente en escalier.
      // ───────────────────────────────────────────────────────────────────────
      let baseM;
      if (t === 'horizontale_interieure') {
        baseM = 0; // Seule exception : bloc plein du sol au plafond
      } else {
        // Dalle flottante : la base est juste en-dessous du plafond
        baseM = Math.max(0, sommetM - EPAISSEUR_M);
      }

      f.properties.heightM = sommetM;
      f.properties.baseM = baseM;
    });


    // 4. Mettre à jour ou créer source + couches MapLibre
    // Conserver la collection en mémoire pour les calculs géométriques côté
    // client (altitude admissible, dégagement, détection "hors surfaces")
    // — cf. obstacles-geometry.js
    GeoMap.surfacesGeoJSON = geojson;
    if (map.getSource('src-backend-surfaces')) {
      map.getSource('src-backend-surfaces').setData(geojson);
    } else {
      map.addSource('src-backend-surfaces', { type: 'geojson', data: geojson });

      // Couche extrusion 3D — utilise les valeurs pré-converties en mètres (heightM/baseM)
      map.addLayer(
        {
          id: 'backend-surfaces-extrude',
          type: 'fill-extrusion',
          source: 'src-backend-surfaces',
          paint: {
            'fill-extrusion-color': ['get', 'color'],
            'fill-extrusion-opacity': 0.35,
            'fill-extrusion-height': ['to-number', ['coalesce', ['get', 'heightM'], 0]],
            'fill-extrusion-base': ['to-number', ['coalesce', ['get', 'baseM'], 0]],
          }
        },
        'ols-obstacles-extrude'
      );

      // Les couches 2D (line + fill) ont été supprimées volontairement.
      // Seule la couche fill-extrusion 3D est conservée pour éviter que
      // les polygones s'affichent à plat sur le sol en plus des dalles 3D.

      // Popup au clic
      map.on('click', 'backend-surfaces-extrude', (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties;
        const c = p.color || '#90A4AE';
        const html = `<div style="font-family:monospace;font-size:11px;color:#d0e8f5;
            background:#0b1220;border:1px solid ${c}55;padding:10px 13px;
            border-radius:5px;min-width:190px;line-height:1.8;">
          <b style="color:${c};font-size:12px;">${p.label || p.type_surface || 'Surface OLS'}</b>
          <hr style="border:none;border-top:1px solid #1e3a5f;margin:5px 0;">
          ${p.qfu ? `<span style="color:#6A8AA8">QFU :</span> <b>${p.qfu}</b><br>` : ''}
          ${p.pente ? `<span style="color:#6A8AA8">Pente :</span> <b>${p.pente}</b><br>` : ''}
          ${p.altitude_sommet != null ? `<span style="color:#6A8AA8">Sommet :</span> <b>${(Number(p.altitude_sommet) * 0.3048).toFixed(1)} m</b><br>` : ''}
          ${p.altitude_base != null ? `<span style="color:#6A8AA8">Base :</span>   <b>${(Number(p.altitude_base) * 0.3048).toFixed(1)} m</b><br>` : ''}
        </div>`;
        new maplibregl.Popup({ closeButton: true, offset: 15, maxWidth: '280px' })
          .setLngLat(e.lngLat).setHTML(html).addTo(map);
      });

      map.on('mouseenter', 'backend-surfaces-extrude', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'backend-surfaces-extrude', () => { map.getCanvas().style.cursor = ''; });
    }

    // 5. Légende depuis les types réellement présents
    const typesPresents = [...new Set(geojson.features.map(f => f.properties.normalized_type))];
    updateSurfaceLegend(typesPresents);

    // 6. Réappliquer le filtre actif (cases à cocher)
    applyCurrentSurfaceFilter();

  } catch (e) {
    console.warn('[surfaces] Erreur globale:', e.message);
  }
}

/* ══════════════════════════════════════════════════════════
   LÉGENDE DYNAMIQUE
   Affiche uniquement les surfaces réellement présentes.
══════════════════════════════════════════════════════════ */
function updateSurfaceLegend(typesPresents) {
  const legendEl = document.getElementById('map3d-legend-surfaces');
  if (!legendEl) return;

  if (!typesPresents.length) {
    legendEl.innerHTML = '<span style="color:#4a6a8a;font-size:11px;">Aucune surface chargée</span>';
    return;
  }

  // Construire les items pour les types présents (ordre de SURFACE_META, puis inconnus)
  const orderedKeys = Object.keys(SURFACE_META);
  const sorted = [
    ...orderedKeys.filter(k => typesPresents.includes(k)),
    ...typesPresents.filter(t => !orderedKeys.includes(t)),
  ];

  legendEl.innerHTML = sorted.map(key => {
    const meta = SURFACE_META[key] || { label: key, color: '#90A4AE' };
    return `<label class="legend-item toggle-label"
        style="cursor:pointer;display:flex;align-items:center;gap:5px;padding:2px 0;user-select:none;">
      <input type="checkbox" checked value="${key}" class="surface-toggle-cb"
        onchange="applyCurrentSurfaceFilter()"
        style="accent-color:${meta.color};width:13px;height:13px;cursor:pointer;flex-shrink:0;">
      <span class="legend-dot" style="background:${meta.color};flex-shrink:0;"></span>
      <span style="font-size:10px;line-height:1.3;">${meta.label}</span>
    </label>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════
   FILTRE ACTIF — applique les cases à cocher aux couches MapLibre
   Exposé globalement pour le onchange inline ET pour la réinitialisation.
══════════════════════════════════════════════════════════ */
window.applyCurrentSurfaceFilter = function () {
  const map = GeoMap && GeoMap.map;
  if (!map) return;

  const checkboxes = document.querySelectorAll('.surface-toggle-cb');
  const activeTypes = Array.from(checkboxes)
    .filter(cb => cb.checked)
    .map(cb => cb.value);

  let filter;
  if (activeTypes.length === 0) {
    filter = ['==', ['get', 'normalized_type'], '__none__'];
  } else if (activeTypes.length === 1) {
    filter = ['==', ['get', 'normalized_type'], activeTypes[0]];
  } else {
    filter = ['in', ['get', 'normalized_type'], ['literal', activeTypes]];
  }

  // 'backend-surfaces-line' et 'backend-surfaces-fill' ont été supprimées — uniquement extrude 3D
  ['backend-surfaces-extrude'].forEach(id => {
    if (map.getLayer(id)) map.setFilter(id, filter);
  });
};

// Alias pour compatibilité avec l'ancienne signature onchange="filterSurfacesLayer()"
window.filterSurfacesLayer = window.applyCurrentSurfaceFilter;

/* ══════════════════════════════════════════════════════════
   EXPORT GEOJSON DES SURFACES OLS — retour utilisateur n°13
   Génère un fichier .geojson standard (RFC 7946), directement
   lisible par QGIS, ArcGIS ou tout autre logiciel SIG, à partir des
   surfaces déjà chargées sur la carte.
══════════════════════════════════════════════════════════ */
function exportSurfacesGeoJSON() {
  const fc = GeoMap.surfacesGeoJSON;
  if (!fc || !fc.features || !fc.features.length) {
    showToast('Aucune surface chargée à exporter — ouvrez d\'abord l\'onglet Analyse OLS', 'warn');
    return;
  }

  // Nettoyer les propriétés internes de rendu (color, heightM, baseM) qui
  // n'ont de sens que pour MapLibre, et conserver les attributs métier.
  const exportFc = {
    type: 'FeatureCollection',
    name: `surfaces_ols_${App.aerodrome?.icao || 'aerodrome'}`,
    features: fc.features.map(f => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        type_surface: f.properties?.label || f.properties?.type_surface || f.properties?.normalized_type,
        pente: f.properties?.pente ?? null,
        altitude_sommet_m: f.properties?.heightM != null ? Number(f.properties.heightM.toFixed(2)) : null,
        altitude_base_m: f.properties?.baseM != null ? Number(f.properties.baseM.toFixed(2)) : null,
        qfu: f.properties?.qfu ?? null,
      },
    })),
  };

  const blob = new Blob([JSON.stringify(exportFc, null, 2)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sigobs_surfaces_${App.aerodrome?.icao || 'aerodrome'}_${new Date().toISOString().slice(0, 10)}.geojson`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`${exportFc.features.length} surface(s) exportée(s) au format GeoJSON`, 'success');
}

/* ════════════════════════════════════════════════════════
   PANNEAU LÉGENDE — Toggle, Tout Activer, Tout Masquer
════════════════════════════════════════════════════════ */

/** Ouvre/ferme le panneau vertical de surfaces */
window.toggleLegendPanel = function () {
  const panel = document.getElementById('surfaces-legend-panel');
  if (!panel) return;
  panel.classList.toggle('open');
};

/** Coche toutes les surfaces (tout activer) */
window.selectAllSurfaces = function () {
  document.querySelectorAll('.surface-toggle-cb').forEach(cb => { cb.checked = true; });
  window.applyCurrentSurfaceFilter();
};

/** Décoche toutes les surfaces (tout masquer) */
window.deselectAllSurfaces = function () {
  document.querySelectorAll('.surface-toggle-cb').forEach(cb => { cb.checked = false; });
  window.applyCurrentSurfaceFilter();
};
