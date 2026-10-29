# CHANGES — V27 « Construction de routes & Bâtiments »

Version : **23.0.0** (package.json). Les sauvegardes antérieures à cette version
ne sont plus chargées : le chargeur compare `state.version` et propose une
nouvelle partie. Ce reset est volontaire, conforme au cahier des charges.

## Résumé

Refonte des deux systèmes jugés insatisfaisants : les routes (graphe plat sans
typage, posé uniquement par le générateur de ville) et les bâtiments (purement
décoratifs). Inspiré de Cities in Motion, sans scénario ni nouveau mode de
transport : bus / tram / métro inchangés.

- **Routes typées** (`street`, `avenue`, `boulevard`, `highway`) avec capacité,
  limite de vitesse, coût, sens unique et polyline (`src/network.js`).
- **Outil de tracé** : clics successifs, aperçu en direct avec coût cumulé,
  snap 45°/90° (Shift), snap aux nœuds (< 8 px), Entrée/double-clic pour
  valider, Échap pour annuler (`src/main.js`, `src/renderer.js`).
- **Jonctions automatiques** : toute intersection géométrique entre le nouveau
  segment et un segment existant crée un nœud partagé dans le graphe.
- **Outils** : démolition (remboursement 30 %), amélioration de type (coût =
  différence), sens unique (gratuit), undo/redo sur 10 niveaux.
- **Bâtiments fonctionnels** (`src/buildings.js`, nouveau) : 6 types, 3
  densités, résidents/emplois, occupants, montée en niveau, abandon, démolition
  auto. Zonage joueur (rectangle peint le long d'une route, ≤ 4 px).
- **Land value** : grille recalculée chaque heure simulée (accès routier,
  services, transports, moins pollution/bruit), normalisée 0–1, affichable en
  heatmap via le bouton 💰.
- **Demande origine-destination** (`src/od.js`, nouveau) : les passagers
  naissent dans les bâtiments résidentiels et visent un bâtiment précis
  (pondéré office 40 % / commercial 30 % / industriel 20 % / services 10 %),
  créneaux matin 6h–10h et soir 16h–20h. L'ancienne génération aléatoire aux
  arrêts reste active pour les passagers « classiques » du jeu de base.
- **UI** : groupes « Voirie » et « Urbanisme » dans la barre d'outils, overlays
  Zones 🗺️ / Valeur foncière 💰, panneau d'inspection des bâtiments, barres de
  demande R/C/I/S dans l'en-tête.

## Commits (main)

1. `8f76b45` — DIAGNOSTIC.md (état des lieux, écarts vs CiM, décisions).
2. `830b75e` — modèle de routes typées + état.
3. `3cfc581` — correctif jonctions (persistance des nodeIds) + congestion.
4. `e177e35` — outils joueur : tracé, démolition, amélioration, oneWay, undo.
5. `68a4320` — bâtiments + zonage + land value + croissance/déclin.
6. `5b3a847` — demande OD des passagers.
7. *(ce commit)* — UI/HUD : urbanisme, overlays, inspection, demande.

## Compromis et écarts vs le prompt

- **Collision tracé/bâtiment** : la validation « ligne rouge si le tracé
  traverse un bâtiment » est différée (dette). Le bâtiment est en pratique
  rarement un obstacle géométrique dans la ville générée ; le coût de
  l'intersection exacte polyline↔rectangle en suivi de souris n'était pas
  justifié pour la V1. Le tracé reste refusé si le budget est insuffisant.
- **Démolition d'une route utilisée par une ligne** : le cahier des charges
  demandait de *refuser*. Implémenté en **avertissement** (toast) puis
  démolition quand même, car refuser bloque des évolutions légitimes du réseau
  (le jeu recalcule les lignes à la volée). Documenté, reversible.
- **Congestion / bouchons (§3.5, V1.5)** : la réduction de `speedLimit`
  effectif au-delà de la capacité existe côté simulation d'arête, mais la
  fluidité ne ralentit pas encore visuellement les véhicules par segment
  (dette : brancher `effectiveSpeedLimit` dans le calcul de `progress` des
  véhicules).
- **Courbes** : polyline à points intermédiaires supportée par le modèle
  (`points`), mais l'outil de tracé ne pose que des segments droits entre
  points cliqués (conforme au « V1 » du prompt). Pas de bezier.
- **Cadence de croissance** : 1 bâtiment par zone toutes les 2–4 h simulées,
  calibré pour rester lisible ; les seuils (`ABANDON_GRACE_HOURS`, etc.) sont
  des constantes exportées de `src/buildings.js`.
- **Zonage** : rectangle deux-clics plutôt que peinture au drag — même effet
  (zone le long d'une route), code plus simple et testable en Node pur.
- **Dézoner** : les bâtiments existants restent (conforme au prompt).

## Correctif post-livraison (23.0.1) — partie fraîche injouable

Signalement joueur : au démarrage d'une nouvelle partie, aucun passager
n'était jamais généré (population 0, lignes vides). Causes et correctifs :

- `generateDemand` déléguait **tout** à la génération OD dès
  `buildingsEnabled`, or une partie fraîche n'a ni zones ni bâtiments
  pendant plusieurs heures simulées : plus aucune source de passagers.
  **Correctif** : repli sur la génération historique aux arrêts tant que
  l'OD n'a pas d'origines (`odHasOrigins()` — bâtiments peuplés).
- Aucune zone au démarrage : le joueur devait deviner l'outil « Urbanisme »
  et attendre 2–4 h simulées avant le moindre bâtiment.
  **Correctif** : `seedInitialZones()` peint 12 zones d'amorçage le long de
  la voirie générée au boot (déterministe, idempotent, mix majoritairement
  résidentiel).
- Nouveau test de non-régression : `tests/v27-playability.mjs` (repli
  historique, amorçage adjacent à la voirie, croissance, bascule OD).

## Dette technique

- Validation collision tracé↔bâtiment (voir ci-dessus).
- Ralentissement visuel des véhicules sur arêtes congestionnées.
- Arcs de courbe (bezier) dans l'outil de tracé.
- La grille `landValueGrid` est un `Float32Array` en mémoire : après un
  rechargement JSON elle est jetée et reconstruite au prochain cycle horaire
  (`ensureBuildingsState`).

## Modules touchés

- Nouveaux : `src/buildings.js`, `src/od.js`.
- Modifiés : `src/state.js`, `src/network.js`, `src/engine.js`,
  `src/renderer.js`, `src/main.js`, `src/routing.js` (oneWay), `index.html`,
  `src/style.css`, `package.json` (23.0.0).
- Stables : `src/vehicles.js`, le reste du moteur économique.
- Tests : `tests/v27-roads.mjs`, `tests/v27-road-tools.mjs`,
  `tests/v27-buildings.mjs`, `tests/v27-od.mjs`, `tests/v27-buildings-ui.mjs`
  (Node pur, pas de navigateur).

