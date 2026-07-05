'use strict';
/* ═══════════════════════════════════════════════════════════
   SIGOBS — obstacles-geometry.js
   Calculs géométriques côté client à partir des polygones de
   surfaces OLS déjà chargés sur la carte (GeoMap.surfacesGeoJSON).

   Principe : le backend fournit les surfaces OLS sous forme de
   polygones GeoJSON, chacun portant une altitude de "sommet"
   (altitude_sommet, en pieds). Lorsqu'une surface en pente est
   sécante par tranches (le backend découpe la pente en paliers —
   cf. commentaires de surfaces.js), chaque tranche est un polygone
   distinct avec son propre sommet. En testant l'appartenance du
   point de l'obstacle à chaque polygone (point-in-polygon, via
   Turf.js) et en prenant le MINIMUM des sommets des polygones qui
   le contiennent, on obtient une approximation fiable de :
     - l'altitude admissible à cet endroit (le plafond le plus bas
       parmi toutes les surfaces qui couvrent la position),
     - le dégagement (marge) = altitude admissible − altitude obstacle,
     - la détection "hors surfaces" (aucun polygone ne contient le point).

   ⚠️ Cette évaluation est un COMPLÉMENT côté client à l'évaluation
   OLS faisant autorité, renvoyée par POST /obstacles/:id/evaluer.
   Le verdict backend (`perce` / `percements`) reste la source de
   vérité pour la conformité ; ce module sert à enrichir l'affichage
   (dégagement, surface concernée, altitude admissible) y compris
   pour les obstacles CONFORMES, pour lesquels le backend ne renvoie
   généralement pas de détail par surface.

   Dépend de : config.js (GeoMap), Turf.js (CDN, cf. index.html)
   ═══════════════════════════════════════════════════════════ */

/**
 * Calcule, pour une position donnée (lat/lon), l'altitude admissible
 * (en mètres AMSL) et la liste des surfaces OLS qui couvrent ce point.
 * @param {number} lat
 * @param {number} lon
 * @returns {{ admissibleM: number|null, coveringSurfaces: Array<{label:string, sommetM:number}>, horsSurfaces: boolean }}
 */
function computeAdmissibleAltitude(lat, lon) {
  const fc = GeoMap.surfacesGeoJSON;
  if (!fc || !fc.features || !fc.features.length || typeof turf === 'undefined') {
    return { admissibleM: null, coveringSurfaces: [], horsSurfaces: null }; // indéterminé (pas de données)
  }

  const pt = turf.point([lon, lat]);
  const covering = [];

  fc.features.forEach(f => {
    if (!f.geometry) return;
    try {
      let contains = false;
      if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
        contains = turf.booleanPointInPolygon(pt, f);
      }
      if (contains) {
        covering.push({
          label: f.properties?.label || f.properties?.type_surface || 'Surface',
          sommetM: f.properties?.heightM ?? null,
        });
      }
    } catch (e) {
      // Géométrie invalide — ignorée silencieusement pour ne pas bloquer l'affichage
    }
  });

  if (!covering.length) {
    return { admissibleM: null, coveringSurfaces: [], horsSurfaces: true };
  }

  const admissibleM = Math.min(...covering.map(c => c.sommetM).filter(v => v != null));
  return { admissibleM: isFinite(admissibleM) ? admissibleM : null, coveringSurfaces: covering, horsSurfaces: false };
}

/**
 * Calcule le dégagement (clearance) d'un obstacle par rapport à
 * l'altitude admissible à sa position.
 * @param {Object} obs - obstacle normalisé (obs.latitude, obs.longitude, obs.altitude en ft)
 * @returns {{ clearanceM: number|null, admissibleM: number|null, surfaceLabel: string|null, horsSurfaces: boolean|null }}
 */
function computeObstacleClearance(obs) {
  if (obs.latitude == null || obs.longitude == null) {
    return { clearanceM: null, admissibleM: null, surfaceLabel: null, horsSurfaces: null };
  }
  const { admissibleM, coveringSurfaces, horsSurfaces } = computeAdmissibleAltitude(obs.latitude, obs.longitude);
  if (admissibleM == null) {
    return { clearanceM: null, admissibleM: null, surfaceLabel: null, horsSurfaces };
  }
  const obstacleAltM = (obs.altitude || 0) * 0.3048;
  const clearanceM = admissibleM - obstacleAltM; // positif = marge, négatif = pénétration
  // La surface concernée est la plus contraignante (celle qui fixe l'altitude admissible)
  const limiting = coveringSurfaces.reduce((min, c) =>
    (min == null || (c.sommetM != null && c.sommetM < min.sommetM)) ? c : min, null);
  return { clearanceM, admissibleM, surfaceLabel: limiting?.label || null, horsSurfaces: false };
}

/**
 * Formate le résultat de computeObstacleClearance en un badge HTML lisible,
 * utilisé dans le tableau des obstacles et le panneau de détail conformité.
 */
function formatClearanceBadge(obs) {
  if (typeof turf === 'undefined' || !GeoMap.surfacesGeoJSON) {
    return '<span class="tag" style="color:var(--text-dim);border-color:var(--border);">N/D</span>';
  }
  const { clearanceM, surfaceLabel, horsSurfaces } = computeObstacleClearance(obs);
  if (horsSurfaces) {
    return '<span class="tag" style="color:var(--text-dim);border-color:var(--border);">HORS SURFACES</span>';
  }
  if (clearanceM == null) {
    return '<span class="tag" style="color:var(--text-dim);border-color:var(--border);">N/D</span>';
  }
  if (clearanceM < 0) {
    return `<span class="tag tag-fail" title="Surface concernée : ${surfaceLabel || '—'}">−${Math.abs(clearanceM).toFixed(1)} m</span>`;
  }
  return `<span class="tag tag-pass" title="Surface la plus contraignante : ${surfaceLabel || '—'}">+${clearanceM.toFixed(1)} m</span>`;
}
