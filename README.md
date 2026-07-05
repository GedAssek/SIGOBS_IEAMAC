# SIGOBS_IEAMAC — v1.1

Outil d'analyse OLS (Obstacle Limitation Surfaces) pour l'évaluation de la
conformité des obstacles aéronautiques selon l'Annexe 14 / Annexe 15 OACI.

## Structure des modules JS (ordre de chargement)

| # | Fichier                    | Rôle                                                              |
|---|-----------------------------|--------------------------------------------------------------------|
| 1 | `config.js`                | État global (`App`), constantes, initialisation                    |
| 2 | `api.js`                   | `apiFetch`, normalisation, toasts, modale, navigation par onglets  |
| 3 | `auth.js`                  | Connexion, déconnexion, restauration de session                    |
| 4 | `aerodrome.js`              | Chargement d'un aérodrome (mono ou multi), pistes                  |
| 5 | `aerodromes-admin.js`      | CRUD aérodromes (admin), sélecteur d'aérodrome d'étude, attribution d'accès |
| 6 | `obstacles.js`              | CRUD obstacles, workflow de validation, conformité, rapport PDF    |
| 7 | `obstacle-entry-page.js`   | Page dédiée de saisie complète d'un obstacle (attributs Annexe 15) |
| 8 | `obstacles-csv-import.js`  | Import CSV par lot d'obstacles                                     |
| 9 | `runways.js`                | Gestion des pistes                                                  |
| 10| `users.js`                  | Gestion des utilisateurs et rôles                                   |
| 11| `surfaces.js`                | Surfaces OLS backend → couches MapLibre                            |
| 12| `map.js`                    | Carte MapLibre 3D, couches, info-bulles                             |

Le fichier `app.js` est une version antérieure, non modulaire, conservée
dans le dépôt mais **non chargée** par `index.html` (superseded).

## Nouveautés v1.1

- **Carte agrandie** : la saisie d'obstacle a été déplacée vers une page
  dédiée, la carte de l'onglet Analyse OLS occupe désormais tout l'espace
  disponible.
- **Page de saisie complète d'obstacle** (bouton « + OBSTACLE » / « NOUVEL
  OBSTACLE ») couvrant l'ensemble des attributs du Tableau A6-2 (Annexe 15) :
  qualité des données, précision/résolution horizontale et verticale,
  système de référence, balisage lumineux, marque, etc.
- **Saisie des hauteurs en mètres** (converties automatiquement en pieds
  pour le backend). L'affichage (tableau obstacles, info-bulles carte,
  rapport PDF) a été aligné sur les mètres.
- **Import CSV par lot** depuis la page de saisie d'obstacle : colonnes
  `nom,proprietaire,type,lat,lon,altitude_m,hauteur_m,temporel`, import et
  évaluation OLS séquentiels avec journal de progression.
- **Panneau de conformité enrichi** : affichage du dépassement en mètres et
  de la ou des surface(s) pénétrée(s) pour chaque obstacle non conforme.
- **Onglet Aérodromes (admin)** : création/suppression d'aérodromes,
  sélecteur d'aérodrome d'étude dans la barre supérieure (si plusieurs
  aérodromes sont accessibles), et attribution d'accès à un aérodrome pour
  un utilisateur non-admin (depuis l'onglet Aérodromes ou l'onglet
  Utilisateurs).
- **Correction du bug de persistance de conformité** : le verdict OLS
  (`perce`, surfaces pénétrées) est désormais systématiquement revérifié
  auprès du moteur d'évaluation backend au chargement de la liste des
  obstacles, pour éviter qu'un obstacle non conforme n'apparaisse conforme
  après une déconnexion/reconnexion.
- **Lisibilité de l'interface améliorée** : tailles de police et
  espacement des lettres augmentés, police d'affichage secondaire (labels,
  tableaux) remplacée par une police plus lisible, poids de police renforcé
  sur les libellés et les données tabulaires.

## Nouveautés v1.2 — Retours utilisateurs (2ᵉ vague)

Nouveaux modules : `obstacles-geometry.js` (calcul géométrique client via
Turf.js), `obstacles-archive.js` (journal d'actions).

- **Toutes les dimensions en mètre** : élévation aérodrome/piste, seuils de
  piste, popups de surfaces — tout est désormais saisi et affiché en
  mètres (conversion automatique en pieds en interne pour le backend).
- **Coordonnées DMS en sortie** : la table des obstacles et les info-bulles
  de la carte affichent désormais aussi le format DMS (au survol / en
  info-bulle), en plus du DD déjà utilisé en saisie.
- **Dégagement et surface concernée** (colonne « DÉGAGEMENT ») : calculé
  côté client par test point-dans-polygone (Turf.js) sur les surfaces OLS
  déjà chargées, pour les obstacles conformes ET non conformes.
- **Altitude admissible et détection « hors surfaces »** : disponibles dans
  le panneau de détail conformité (bouton DÉTAIL), avec la surface la plus
  contraignante identifiée.
- **Évaluation globale** (bouton « ÉVALUER TOUT ») : relance l'évaluation
  OLS de tous les obstacles de l'aérodrome en une seule opération.
- **Export CSV des pénétrations** (bouton « ↓ PÉNÉTRATIONS (CSV) ») :
  répertorie tous les obstacles non conformes avec dépassement en mètres.
- **Suivi des obstacles temporaires** : badge « À SURVEILLER » avec compte à
  rebours, badge « EXPIRÉ » au-delà de l'échéance, et nouveau type
  « Projet de construction » (voyant permanent jusqu'à la fin du chantier).
- **Édition des obstacles** (bouton « MODIFIER ») : ré-ouvre la page de
  saisie pré-remplie, sauvegarde via PATCH puis relance l'évaluation OLS.
- **État de balisage** (conforme / satisfaisant / non conforme) et **action
  recommandée** (supprimer / réduire / baliser / sans action) : sélecteurs
  en ligne dans le tableau des obstacles.
- **Export GeoJSON des surfaces OLS** (bouton « ↓ SURFACES (GeoJSON) ») :
  format standard directement lisible par QGIS/ArcGIS.
- **Onglet Archive** : journal des actions (création, modification,
  suppression, changement de statut/balisage/action) avec classification
  inspirée de la temporalité AIXM 5.2 (BASELINE / PERMDELTA / TEMPDELTA).

### Limitations connues (transparence technique)

- Le **journal d'archive** est stocké côté client (`localStorage`, par
  aérodrome et par navigateur) : le backend actuel n'expose pas encore de
  route d'audit persistante multi-utilisateur. `logAction()` dans
  `obstacles-archive.js` est le point d'intégration à doubler d'un appel
  API le jour où cette route existera.
- **État de balisage** et **action recommandée** sont envoyés en PATCH au
  backend (`balisage_etat`, `action_recommandee`) mais conservés côté
  client si le backend ne les persiste pas encore.
- Le **dégagement/altitude admissible** est une estimation géométrique
  côté client (point-dans-polygone sur les surfaces déjà découpées en
  paliers par le backend) ; le verdict de conformité qui fait autorité
  reste celui renvoyé par `POST /obstacles/:id/evaluer`.
- La **création d'aérodrome** reste réservée aux administrateurs (décision
  fonctionnelle) ; l'accès d'un utilisateur non-admin à un aérodrome
  donné se fait via l'onglet Aérodromes (« GÉRER LES ACCÈS ») ou l'onglet
  Utilisateurs (bouton « AÉRODROME »).
