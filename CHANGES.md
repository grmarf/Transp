# CHANGES

## V27.2 — Jouabilité immédiate & en-tête compact

**Problèmes signalés (captures 1000014730/35)** : en-tête occupant ~15 % de l'écran sur mobile, tableau de bord replié et vide à l'ouverture, ville déserte pendant les premières heures simulées alors que les arrêts affichaient des habitants, pastille 👥 ambiguë (passagers transportés, lue comme population).

- `spawnInitialBuildings(state, rng, log)` (buildings.js) : chaque zone d'amorçage reçoit un bâtiment peuplé dès la fondation — l'OD a des origines à t0, la ville n'est jamais déserte. Idempotent (no-op si des bâtiments existent).
- Boot (main.js) : `spawnInitialBuildings` appelé juste après `seedInitialZones`.
- HUD (renderer.js) : la pastille 👥 affiche désormais la **population de la ville** (somme des `stop.population`), cohérente avec les habitants mentionnés aux arrêts ; les passagers transportés restent au survol (title) et dans le tableau de bord.
- index.html : aria-label de la pastille → « Population de la ville ».
- CSS (≤ 959 px) : en-tête compact — boutons topbar 34 px, polices/paddings réduits, chips plus petites (la barre d'outils flottante garde ses cibles tactiles 44 px).
- CSS (≤ 700 px) : tableau de bord `max-height: 85vh` + premier onglet déplié automatiquement à l'ouverture (bindSheet) — le panneau est immédiatement lisible et utile.

## V27.1 — Ergonomie mobile

- Barre d'outils flottante : une seule ligne défilante (≤ 959 px), groupes en panneaux contextuels fixes, bouton « Terminer » en tête et jamais hors écran en mode ligne.
- À ≤ 700 px, la barre flotte au-dessus de la poignée du tableau de bord (bottom sheet V26).
- En-tête allégé : tagline masquée, statistiques sur une ligne défilante.
- Cibles tactiles ≥ 44 px sur mobile (a11y) ; layout desktop ≥ 960 px inchangé.
- Zones d'amorçage automatiques (`seedInitialZones`) : une partie fraîche lance l'urbanisme sans geste du joueur ; repli historique de la demande tant que l'OD n'a pas d'origines (testé par v27-playability.mjs).

## 23.0.1 — Corrections de jouabilité

- Panneau bâtiment : fermeture et démolition fiables, pas de reconstruction DOM par frame.
- Carte : buildings/zones/valeur foncière dessinés null-safe (anciennes sauvegardes).
- Fermeture de ligne : bouton toujours atteignable en mobile.

## 23.0.0 — V27 « Construction de routes & Bâtiments »

Routes typées + outil de tracé multi-points (8f76b45 DIAGNOSTIC, 830b75e/3cfc581 nœuds & carrefours, e177e35 outils voirie) ; bâtiments, zonage, valeur foncière, croissance/abandon (68a4320) ; demande origine-destination des passagers (5b3a847) ; UI urbanisme + HUD (924b671).

**Compromis et dette connus (§7)** :
- Le contrôle de collision bâtiment-route lors du tracé est reporté (dette).
- La suppression d'une route utilisée par une ligne **avertit** au lieu de refuser (choix assumé, documenté).
- Sémantique de congestion modifiée lors du passage au tracé typé.
- Embouteillages/capacité de voirie : reportés (dette V1.5).
- Sauvegardes compatibles ; constructions abandonnées conservées.

Modules 100 % purs testables en Node : buildings.js, od.js (+ city/state/constants/coverage inchangés en couche). Tests : v27-road-tools, v27-buildings, v27-od, v27-buildings-ui, v27-playability, v27-mobile-ergonomy.

