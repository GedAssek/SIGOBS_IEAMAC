'use strict';
/* ═══════════════════════════════════════════════════════════
   SIGOBS — map.js
   Carte MapLibre GL JS : initialisation, couches, tooltips,
   preview marker, contrôles caméra
   Style satellite : ESRI World Imagery (sans token)
   Dépend de : config.js (App, GeoMap, SATELLITE_STYLE),
               api.js   (showToast),
               surfaces.js (fetchSurfacesFromAPI)
   ═══════════════════════════════════════════════════════════ */

/* ── Variable module pour le popup tooltip actif ─────────── */
let mapTooltip = null;

/* ══════════════════════════════════════════════════════════
   INITIALISATION DE LA CARTE MAPLIBRE GL JS
   Appel unique après login. Le style satellite ESRI ne
   requiert aucun token API.
══════════════════════════════════════════════════════════ */
function geoMapInit() {
  if (GeoMap.initialized) return;

  const container = document.getElementById('map3d-container');
  if (!container) return;

  // Créer le div MapLibre s'il n'existe pas encore
  if (!document.getElementById('maplibre-container')) {
    const mapDiv = document.createElement('div');
    mapDiv.id = 'maplibre-container';
    mapDiv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    container.appendChild(mapDiv);
  }

  const emptyEl = document.getElementById('map3d-empty');

  try {
    GeoMap.map = new maplibregl.Map({
      container: 'maplibre-container',
      style:     SATELLITE_STYLE,
      // Centre : Aéroport International de Lomé-Tokoin (DXXX) — position par défaut
      center:    [1.2546, 6.1656],
      zoom:      13,
      pitch:     45,
      bearing:   0,
      antialias: true,
    });

    // Contrôles de navigation (zoom + boussole + inclinaison)
    GeoMap.map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right'
    );
    // Échelle métrique
    GeoMap.map.addControl(
      new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left'
    );

    GeoMap.map.on('load', () => {
      if (emptyEl) emptyEl.style.display = 'none';
      GeoMap.initialized = true;
      if (App.activeRunway) geoMapRender();
    });

    GeoMap.map.on('error', e =>
      console.warn('MapLibre error:', e.error?.message || e)
    );

  } catch (err) {
    console.warn('MapLibre GL non disponible:', err.message);
    if (emptyEl) {
      emptyEl.style.display = 'flex';
      const p = emptyEl.querySelector('p');
      if (p) p.innerHTML = 'Carte non disponible<br><small>Vérifiez votre connexion Internet</small>';
    }
  }
}

/* ══════════════════════════════════════════════════════════
   RENDU PRINCIPAL DE LA CARTE
   Orchestration : setup des couches → obstacles → surfaces OLS
══════════════════════════════════════════════════════════ */
function geoMapRender() {
  const map = GeoMap.map;
  if (!map || !App.activeRunway) return;
  // Attendre que la carte et le style soient prêts
  if (!map.loaded() || !map.isStyleLoaded()) {
    map.once('idle', () => geoMapRender());
    return;
  }
  setupMapLayers();
  updateObstaclesLayer();
  fetchSurfacesFromAPI();
}

/* ══════════════════════════════════════════════════════════
   COUCHES OBSTACLES ET PREVIEW
   Créées une seule fois au premier rendu
══════════════════════════════════════════════════════════ */

/** Crée un polygone circulaire approximatif autour d'un point (extrusion 3D obstacles) */
function makePointBufferPolygon(lon, lat, radiusM) {
  const pts    = 16;
  const coords = [];
  for (let i = 0; i < pts; i++) {
    const angle = (i * 360 / pts) * Math.PI / 180;
    const dx    = radiusM * Math.cos(angle);
    const dy    = radiusM * Math.sin(angle);
    const latM  = lat + (dy / 111320);
    const lonM  = lon + (dx / (40075000 * Math.cos(lat * Math.PI / 180) / 360));
    coords.push([lonM, latM]);
  }
  coords.push(coords[0]); // Fermer l'anneau
  return { type: 'Polygon', coordinates: [coords] };
}

/** Initialise les sources et couches MapLibre pour les obstacles et le preview */
function setupMapLayers() {
  const map = GeoMap.map;
  if (!map) return;

  // ── Source + couches obstacles ────────────────────────────
  if (!map.getSource('src-obstacles')) {
    map.addSource('src-obstacles', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    // Extrusion 3D (corps de l'obstacle)
    map.addLayer({
      id: 'ols-obstacles-extrude', type: 'fill-extrusion', source: 'src-obstacles',
      paint: {
        'fill-extrusion-color':   ['get', 'color'],
        'fill-extrusion-opacity': 0.88,
        'fill-extrusion-height':  ['get', 'heightM'],
        'fill-extrusion-base':    ['get', 'baseH'],
      }
    });

    // Cercle 2D (visible depuis le dessus)
    map.addLayer({
      id: 'ols-obstacles-circles', type: 'circle', source: 'src-obstacles',
      paint: {
        'circle-radius':       9,
        'circle-color':        ['get', 'color'],
        'circle-opacity':      0.95,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      }
    });

    // Tooltip au survol
    map.on('mouseenter', 'ols-obstacles-circles', showObstacleTooltip);
    map.on('mouseleave', 'ols-obstacles-circles', hideTooltip);
  }

  // ── Source + couches preview (obstacle en cours de saisie) ─
  if (!map.getSource('src-preview')) {
    map.addSource('src-preview', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
      id: 'preview-extrude', type: 'fill-extrusion', source: 'src-preview',
      paint: {
        'fill-extrusion-color':   ['get', 'color'],
        'fill-extrusion-opacity': 0.75,
        'fill-extrusion-height':  ['get', 'heightM'],
        'fill-extrusion-base':    ['get', 'baseH'],
      }
    });

    map.addLayer({
      id: 'preview-circles', type: 'circle', source: 'src-preview',
      paint: {
        'circle-radius':       12,
        'circle-color':        '#00E5FF',
        'circle-opacity':      0.90,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
      }
    });
  }
}

/* ══════════════════════════════════════════════════════════
   COUCHE OBSTACLES — Mise à jour depuis App.obstacles
══════════════════════════════════════════════════════════ */
function updateObstaclesLayer() {
  const map = GeoMap.map;
  if (!map || !map.loaded() || !map.getSource('src-obstacles')) return;

  const features = App.obstacles
    .filter(o => o.latitude != null && o.longitude != null)
    .map(obs => {
      // Couleur selon le statut OLS (vrai calcul de pénétration)
      let color = '#6AB4FF'; // par défaut → bleu
      if (typeof checkPenetration === 'function') {
        const penetrates = checkPenetration(obs);
        color = penetrates ? '#FF1744' : '#00E676';
      }

      // L'obstacle part TOUJOURS du sol (baseH = 0).
      // hauteur AGL en mètres = obs.height * 0.3048
      // Pour visualisation 3D, on extrude depuis 0 jusqu'à la hauteur AGL.
      const heightM = Math.max(5, (obs.height || 0) * 0.3048); // au moins 5m visible

      // Rayon du cylindre proportionnel à la hauteur (plus visible pour les grands obstacles)
      const radiusM = Math.max(8, Math.min(40, heightM * 0.3));

      return {
        type: 'Feature',
        properties: {
          name:     obs.name,
          type:     typeToLabel(obs.type),
          altitude: obs.altitude,
          height:   obs.height,
          color,
          heightM,       // sommet = hauteur AGL en m (depuis le sol)
          baseH: 0,      // BASE TOUJOURS AU SOL
          status:   obs.status,
        },
        geometry: makePointBufferPolygon(obs.longitude, obs.latitude, radiusM)
      };
    });

  map.getSource('src-obstacles').setData({ type: 'FeatureCollection', features });
}

/* ══════════════════════════════════════════════════════════
   PREVIEW MARKER — Obstacle en cours de saisie dans le formulaire
══════════════════════════════════════════════════════════ */

/** Met à jour le marqueur preview sur la carte depuis les valeurs du formulaire */
function updatePreviewMarker() {
  // Le preview temps réel sur la carte a été désactivé à la demande de l'utilisateur.
}

/** Efface le marqueur preview de la carte */
function clearPreviewMarker() {
  // Le preview temps réel sur la carte a été désactivé à la demande de l'utilisateur.
}

/* ══════════════════════════════════════════════════════════
   TOOLTIPS OBSTACLES
══════════════════════════════════════════════════════════ */

/** Masque le tooltip actif et réinitialise le curseur */
function hideTooltip() {
  const map = GeoMap.map;
  if (map) map.getCanvas().style.cursor = '';
  if (mapTooltip) { mapTooltip.remove(); mapTooltip = null; }
}

/** Affiche un popup d'info obstacle au survol */
function showObstacleTooltip(e) {
  const map = GeoMap.map;
  if (!map || !e.features?.length) return;
  map.getCanvas().style.cursor = 'pointer';

  const p = e.features[0].properties;
  const verdictColor = p.status === 'validated' ? '#00E676'
    : p.status === 'pending' ? '#FF1744' : '#6AB4FF';
  const verdictTxt   = p.status === 'validated' ? 'CONFORME'
    : p.status === 'pending' ? 'PÉNÉTRATION' : 'EN ATTENTE';

  const html = `<div style="font-family:monospace;font-size:11px;color:#d0e8f5;background:#0b1220;
    border:1px solid #00E5FF33;padding:10px 13px;border-radius:5px;min-width:170px;line-height:1.7;">
    <b style="color:#00E5FF;font-size:12px;">${p.name}</b><br>
    <span style="color:#6A8AA8">${p.type}</span><br>
    <span style="color:#6A8AA8">Alt :</span> <b>${p.altitude} ft AMSL</b><br>
    <span style="color:#6A8AA8">Haut :</span> <b>${p.height} ft AGL</b><br>
    <b style="color:${verdictColor};font-size:12px;">${verdictTxt}</b>
  </div>`;

  if (mapTooltip) mapTooltip.remove();
  mapTooltip = new maplibregl.Popup({ closeButton: false, offset: 15, maxWidth: '260px' })
    .setLngLat(e.lngLat).setHTML(html).addTo(map);
}

/* ══════════════════════════════════════════════════════════
   CONTRÔLES CAMÉRA
══════════════════════════════════════════════════════════ */

/** Recentre la vue sur la piste active ou l'aérodrome */
function map3dResetCamera() {
  const map = GeoMap.map;
  if (!map) return;
  if (App.activeRunway)
    map.flyTo({
      center:  [App.activeRunway.thresholdLon, App.activeRunway.thresholdLat],
      zoom:    12, pitch: 55, bearing: App.activeRunway.trueHeading || 0, duration: 800
    });
  else if (App.aerodrome)
    map.flyTo({
      center:  [App.aerodrome.longitude, App.aerodrome.latitude],
      zoom:    11, pitch: 45, bearing: 0, duration: 800
    });
}

/** Bascule la visibilité des cercles d'obstacles */
function map3dToggleLabels() {
  App.map3dLabels = !App.map3dLabels;
  const map = GeoMap.map;
  if (!map) return;
  ['ols-obstacles-circles', 'preview-circles'].forEach(id => {
    if (map.getLayer(id))
      map.setLayoutProperty(id, 'visibility', App.map3dLabels ? 'visible' : 'none');
  });
  showToast(`Labels ${App.map3dLabels ? 'activés' : 'désactivés'}`, 'info');
}

/** Force un recalcul de la taille de la carte (utile lors du redimensionnement du panneau) */
function map3dResize() {
  if (GeoMap.map) GeoMap.map.resize();
}
