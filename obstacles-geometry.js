'use strict';
/* ═══════════════════════════════════════════════════════════
   SIGOBS — obstacles-geometry.js
   Calculs géométriques côté client à partir des polygones de
   surfaces OLS déjà chargés sur la carte (GeoMap.surfacesGeoJSON).

   Principe : le backend fournit les surfaces OLS sous forme de
   polygones GeoJSON, chacun portant une altitude de "sommet"
   (altitude_sommet, en pieds). Cette valeur backend est utilisée telle
   quelle pour la plupart des surfaces, SAUF pour la surface horizontale
   intérieure et la surface conique, dont l'altitude admissible dépend
   de la POSITION de l'obstacle (cf. computeAdmissibleAltitude) :
     - horizontale intérieure : altadm = 45 + alt_ad (constante)
     - conique                : altadm = 45 + alt_ad + d × 0,05
       où d = distance horizontale au bord intérieur (surface horizontale)
   En testant l'appartenance du point de l'obstacle à chaque polygone
   (point-in-polygon, via Turf.js) et en prenant le MINIMUM des sommets
   des polygones qui le contiennent, on obtient :
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
 * Altitude de référence de l'aérodrome (alt_ad dans la formule), en mètres.
 * App.aerodrome.elevation est stockée en pieds côté client (cf. api.js).
 */
function getAerodromeRefAltitudeM() {
  const ft = App.aerodrome?.elevation ?? 0;
  return (ft || 0) * 0.3048;
}

/**
 * Distance horizontale minimale (mètres) entre un point et le contour de
 * la surface horizontale intérieure — sert de référence à la surface
 * conique, qui s'appuie sur ce bord (cf. schéma manuscrit).
 * @returns {number|null} null si la surface horizontale intérieure n'est pas chargée
 */
function distanceToHorizontaleInterieure(lat, lon) {
  const fc = GeoMap.surfacesGeoJSON;
  if (!fc || !fc.features?.length || typeof turf === 'undefined') return null;
  const pt = turf.point([lon, lat]);
  let minDist = null;
  fc.features.forEach(f => {
    if (f.properties?.normalized_type !== 'horizontale_interieure' || !f.geometry) return;
    try {
      const line = (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
        ? turf.polygonToLine(f)
        : f;
      const d = turf.pointToLineDistance(pt, line, { units: 'meters' });
      if (minDist == null || d < minDist) minDist = d;
    } catch (e) {
      // Géométrie invalide — ignorée silencieusement
    }
  });
  return minDist;
}

/**
 * Calcule `d`, la distance horizontale entre l'obstacle et le bord
 * intérieur de la surface conique, selon la formule fournie :
 *
 *   d = √( [min(distance(A, surf horizontale))]² − [45 + alt_ad − altobs + Hobs]² )
 *
 * où alt_ad = altitude de référence aérodrome, altobs = altitude obstacle,
 * Hobs = hauteur obstacle (toutes converties en mètres).
 * @param {Object} obs
 * @param {number} altAdRefM - altitude de référence aérodrome, en mètres
 * @returns {number|null} d en mètres, ou null si indéterminable
 */
function computeConicalD(obs, altAdRefM) {
  const distMin = distanceToHorizontaleInterieure(obs.latitude, obs.longitude);
  if (distMin == null) return null;
  const altobsM = (obs.altitude || 0) * 0.3048;
  const hobsM = (obs.height || 0) * 0.3048;
  const heightTerm = 45 + altAdRefM - altobsM + hobsM;
  const inner = (distMin * distMin) - (heightTerm * heightTerm);
  return inner < 0 ? 0 : Math.sqrt(inner);
}

/** 
 * Trouve le seuil de piste le plus proche de l'obstacle et retourne sa distance et son altitude.
 */
function getClosestThreshold(lat, lon) {
  if (!App.runways || !App.runways.length || typeof turf === 'undefined') return null;
  const pt = turf.point([lon, lat]);
  let minDist = null;
  let altSeuilM = getAerodromeRefAltitudeM();
  App.runways.forEach(r => {
    if (r.thresholdLat != null && r.thresholdLon != null) {
      const tPt = turf.point([r.thresholdLon, r.thresholdLat]);
      const d = turf.distance(pt, tPt, { units: 'meters' });
      if (minDist == null || d < minDist) {
        minDist = d;
        altSeuilM = (r.elevation || 0) * 0.3048;
      }
    }
  });
  return { dist: minDist, altM: altSeuilM };
}

/** 
 * Trouve la distance minimale à la bande de piste.
 */
function getClosestRunwayStripDist(lat, lon) {
  const fc = GeoMap.surfacesGeoJSON;
  if (!fc || !fc.features?.length || typeof turf === 'undefined') return null;
  const pt = turf.point([lon, lat]);
  let minDist = null;
  
  // 1. Chercher si un polygone bande_piste existe
  fc.features.forEach(f => {
    if (f.properties?.normalized_type !== 'bande_piste' || !f.geometry) return;
    try {
      const line = (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') ? turf.polygonToLine(f) : f;
      const d = turf.pointToLineDistance(pt, line, { units: 'meters' });
      if (minDist == null || d < minDist) minDist = d;
    } catch (e) {}
  });
  if (minDist != null) return minDist;

  // 2. Fallback: distance à l'axe de piste - 75m (demi-largeur typique)
  if (!App.runways || !App.runways.length) return null;
  App.runways.forEach(r => {
    if (r.thresholdLat != null && r.thresholdLon != null && r.reciprocal) {
      const opp = App.runways.find(op => op.designation === r.reciprocal);
      if (opp && opp.thresholdLat != null && opp.thresholdLon != null) {
        const line = turf.lineString([[r.thresholdLon, r.thresholdLat], [opp.thresholdLon, opp.thresholdLat]]);
        const d = turf.pointToLineDistance(pt, line, { units: 'meters' });
        const stripD = Math.max(0, d - 75);
        if (minDist == null || stripD < minDist) minDist = stripD;
      }
    }
  });
  return minDist;
}

/**
 * Calcule, pour une position donnée (lat/lon), l'altitude admissible
 * (en mètres AMSL) et la liste des surfaces OLS qui couvrent ce point.
 *
 * Pour les surfaces horizontale intérieure et conique, l'altitude
 * admissible est recalculée dynamiquement selon la position de
 * l'obstacle (formule manuscrite fournie), plutôt que d'utiliser la
 * valeur fixe envoyée par le backend :
 *   - horizontale intérieure : altadm = 45 + alt_ad
 *   - conique                : altadm = 45 + alt_ad + d × 0,05
 *     (d = distance au bord intérieur, cf. computeConicalD)
 *
 * @param {number} lat
 * @param {number} lon
 * @param {Object} [obs] - obstacle normalisé (requis pour le calcul dynamique de la surface conique)
 * @returns {{ admissibleM: number|null, coveringSurfaces: Array<{label:string, sommetM:number}>, horsSurfaces: boolean }}
 */
function computeAdmissibleAltitude(lat, lon, obs) {
  const fc = GeoMap.surfacesGeoJSON;
  if (!fc || !fc.features || !fc.features.length || typeof turf === 'undefined') {
    return { admissibleM: null, coveringSurfaces: [], horsSurfaces: null }; // indéterminé (pas de données)
  }

  const pt = turf.point([lon, lat]);
  const altAdRefM = getAerodromeRefAltitudeM();
  const covering = [];
  const dynamicTypesSeen = new Set();

  fc.features.forEach(f => {
    if (!f.geometry) return;
    try {
      let contains = false;
      if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
        contains = turf.booleanPointInPolygon(pt, f);
      }
      if (!contains) return;

      const type = f.properties?.normalized_type;

      // altitude admissible dynamique ne dépend pas de la tranche mais
      // uniquement de la position de l'obstacle, on ne les compte qu'UNE
      const dynamicTypes = ['horizontale_interieure', 'conique', 'approche', 'approche_troncon1', 'approche_troncon2', 'approche_troncon3', 'decollage', 'decollage_rect', 'transition', 'transition_gauche', 'transition_droite'];
      if (dynamicTypes.includes(type) && dynamicTypesSeen.has(type)) {
        return;
      }

      let sommetM = f.properties?.heightM ?? null;
      const altobsM = (obs && obs.altitude) ? obs.altitude * 0.3048 : 0;
      const hobsM = (obs && obs.height) ? obs.height * 0.3048 : 0;

      if (type === 'horizontale_interieure') {
        sommetM = 45 + altAdRefM;
        dynamicTypesSeen.add(type);
      } else if (type === 'conique' && obs) {
        const d = computeConicalD(obs, altAdRefM);
        if (d != null) sommetM = 45 + altAdRefM + (d * 0.05);
        dynamicTypesSeen.add(type);
      } else if ((type === 'approche' || type === 'approche_troncon1' || type === 'approche_troncon2' || type === 'approche_troncon3' || type === 'decollage' || type === 'decollage_rect') && obs) {
        const seuil = getClosestThreshold(lat, lon);
        if (seuil && seuil.dist != null) {
          let inner = (seuil.dist * seuil.dist) - Math.pow(altAdRefM + hobsM - altobsM, 2);
          if (inner < 0) inner = 0;
          const dSlanted = Math.sqrt(inner);
          
          if (type.startsWith('decollage')) {
            const d = Math.max(0, dSlanted - 60);
            sommetM = 2 * altAdRefM - seuil.altM + 0.02 * d;
          } else {
            let pente = 0.02;
            let d_i = Math.max(0, dSlanted - 60);
            if (type === 'approche_troncon2') {
              pente = 0.025;
              d_i = Math.max(0, dSlanted - 3060);
            } else if (type === 'approche_troncon3') {
              pente = 0;
              d_i = Math.max(0, dSlanted - 6660);
            }
            sommetM = 2 * altAdRefM - seuil.altM + d_i * pente;
          }
        }
        dynamicTypesSeen.add(type);
      } else if ((type === 'transition' || type === 'transition_gauche' || type === 'transition_droite') && obs) {
        const distBande = getClosestRunwayStripDist(lat, lon);
        if (distBande != null) {
          // Formule correcte : AltAdm = Alt_aérodrome + 45 - (pente × d)
          // d = min(distancePoint_vers_limite_sup, limiteSup)
          // La limite supérieure est la projection horizontale du bord supérieur
          // de la surface de transition sur l'horizontale où elle s'appuie.
          // limiteSup = 45 / pente = 45 / (1/7) ≈ 315 m depuis le bord de la bande
          const pente = 1 / 7; // ≈ 0.14286
          const limiteSup = 45 / pente; // ≈ 315 m
          // d = distance horizontale de l'obstacle vers la limite supérieure
          const distToUpperLimit = Math.max(0, limiteSup - distBande);
          const d = Math.min(distToUpperLimit, limiteSup);
          sommetM = altAdRefM + 45 - (pente * d);
        }
        dynamicTypesSeen.add(type);
      }

      covering.push({
        label: f.properties?.label || f.properties?.type_surface || 'Surface',
        sommetM,
      });
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
  const { admissibleM, coveringSurfaces, horsSurfaces } = computeAdmissibleAltitude(obs.latitude, obs.longitude, obs);
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
 * Liste TOUTES les surfaces pénétrées par un obstacle (altitude obstacle >
 * sommet de la surface), avec le dépassement en mètres pour chacune.
 * Nécessaire car POST /obstacles/:id/evaluer ne renvoie qu'un booléen
 * `perce` global, sans détail par surface (cf. doc API §7.8) — le tableau
 * `percements` renvoyé par le backend est toujours vide/absent en pratique.
 * @param {Object} obs
 * @returns {Array<{label:string, sommetM:number, depassementM:number}>}
 */
function computeBreachedSurfaces(obs) {
  if (obs.latitude == null || obs.longitude == null) return [];
  const { coveringSurfaces } = computeAdmissibleAltitude(obs.latitude, obs.longitude, obs);
  const obstacleAltM = (obs.altitude || 0) * 0.3048;
  return coveringSurfaces
    .filter(c => c.sommetM != null && obstacleAltM > c.sommetM)
    .map(c => ({ label: c.label, sommetM: c.sommetM, depassementM: obstacleAltM - c.sommetM }));
}

/**
 * Formate le dégagement/dépassement en un badge HTML, utilisé dans le
 * tableau des obstacles et le panneau de détail conformité.
 *
 * Aligné sur le verdict qui fait autorité (checkPenetration(), basé sur
 * `obs.perce` renvoyé par le backend) :
 *  - obstacle CONFORME       → aucun badge affiché (case vide),
 *  - obstacle en PÉNÉTRATION → dépassement en rouge, calculé à partir
 *    des surfaces réellement percées (computeBreachedSurfaces).
 */
function formatClearanceBadge(obs) {
  const penetrates = (typeof checkPenetration === 'function') ? checkPenetration(obs) : false;

  // Obstacle conforme : rien à afficher.
  if (!penetrates) return '';

  if (typeof turf === 'undefined' || !GeoMap.surfacesGeoJSON) {
    return '<span class="tag tag-fail">PÉNÉTRATION</span>';
  }

  const breached = computeBreachedSurfaces(obs);
  if (!breached.length) {
    return '<span class="tag tag-fail">PÉNÉTRATION</span>';
  }

  const worst = breached.reduce((max, b) => (b.depassementM > max.depassementM ? b : max), breached[0]);
  return `<span class="tag tag-fail" title="Surface concernée : ${worst.label}">−${worst.depassementM.toFixed(1)} m</span>`;
}
