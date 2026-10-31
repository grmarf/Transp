# CHANGES

L'historique complet des évolutions est dans l'historique Git ; ce fichier
résume l'état courant du jeu et les derniers changements.

## V28.4 — Audit V2 : collisions de waypoints, routage aller-retour, compteurs morts

- **Waypoints de voiries sans id** : les routes générées pliées en carrefour
  produisaient des nœuds « waypoint-undefined-N » fusionnant entre voiries
  différentes (arêtes parasites traversant la carte) ; chaque voirie reçoit
  désormais un uid stable.
- **Routage passager aligné sur l'aller-retour** : le coût entre deux arrêts
  d'une ligne est |i−j|, plus un modèle circulaire qui sous-estimait les
  trajets vers l'arrière.
- **Sans-abri et demande perdue rendus visibles** : la démolition d'un
  bâtiment occupé pèse désormais sur la satisfaction (le journal le
  promettait, le calcul non) ; la demande OD perdue faute d'arrêt couvert
  apparaît dans le journal de ville.
- **Démolition de voirie** : les lignes réellement reroutées sont signalées
  (les voiries libres n'étaient jamais détectées).
- **Smoke test non flaky** : la ville est régénérée avec une graine aléatoire
  à chaque exécution ; le tracé fixe de l'étape « construction d'une route »
  finissait par croiser un bâtiment occupé ou viser un arrêt saturé (refus
  silencieux, CI intermittente). Le tracé est désormais choisi dynamiquement,
  à distance des arrêts et hors de toute zone construite.
- **Valeur foncière** échantillonnée au centre du bâtiment, densité
  saisonnière recalculée depuis la population, essaimage urbain non plus
  annulé par un candidat carrefour, progression du scénario « satisfaction »
  suivant l'objectif, log d'entretien au vrai franchissement horaire,
  message du lanceur Termux corrigé.

## V28.3 — Correctifs de bugs silencieux (véhicules gelés, tramway, travaux, NaN)

- **Véhicules gelés après édition de voirie** : `rebuildNetwork()` recalcule
  désormais les itinéraires de toutes les lignes (`refreshAllLineRoutes`) —
  auparavant, construire/démolir/améliorer une route ou annuler/rétablir
  laissait les lignes sur des nœuds disparus du graphe reconstruit : véhicules
  figés sans message, passagers jamais descendus, recettes à zéro.
- **Tramway rerouté sur ses propres voies** : `refreshAllLineRoutes` utilise
  le réseau tram indépendant quand il existe (aligné sur `finishLine`),
  au lieu de rabattre les lignes de tram sur la voirie.
- **Travaux possibles sur un réseau multi-composantes** : une fermeture n'est
  refusée que si elle *augmente* le nombre de composantes ; l'exigence
  « réseau en une seule composante » taisait tous les travaux dès qu'une
  route libre non raccordée existait.
- **NaN dans la génération de demande** : garde sur `totalWeight` nul (ville
  sans emplois ni commerces) — le NaN polluait `totalDemand`, la satisfaction
  et rendait la sauvegarde impossible (validation stricte V20).
- **Chargement de sauvegarde** : itinéraires recalculés une fois les fermetures
  pour travaux restaurées.

## V28 — Carrefours à 90°, arrêts de croisement & bâtiments qui pop

- **Bâtiments « cartoon tycoon »** : fini les carrés plats — corps arrondi
  avec liseré encré, toit à deux pentes (maisons), terrasse à acrotère
  (immeubles) ou couronnement à antenne (tours), fenêtres allumées au gré
  d'un bruit déterministe, ombre portée, et **animation pop** (rebond
  450 ms) à chaque émergence. Les ruines sont grisées avec fissure.
- **Fond de carte rafraîchi** : herbe douce et îlots crème remplacent le
  beige uniforme — les voiries et les bâtiments colorés ressortent ; les
  parcs sont plus verts.
- **Carrefours à 90°** : deux voiries qui se croisent loin de l'angle droit
  forment désormais un vrai carrefour — la route la plus récente est pliée
  en coude pour traverser l'autre perpendiculairement (module pur
  `carrefours.js`, valable pour la génération comme pour les tracés
  joueur, sauf bâtiment occupé sur le pli). Une plaque claire avec
  passages piétons marque chaque croisement.
- **Arrêt sur chaque carrefour** : un arrêt supplémentaire est posé sur
  chaque croisement desservable (jamais sur voie rapide), raccordé au
  réseau par fusion de jonction — il capte la demande des alentours et
  peut recevoir des feux. Un carrefour n'essime pas de nouveau quartier.
- **Anti-superposition stricte** : un bâtiment ne peut plus ni chevaucher
  un voisin ni déborder sur l'enrobé d'une voirie (gabarit =
  demi-épaisseur + liseré). L'émergence essaie plusieurs emplacements ;
  la montée en densité est reportée si l'agrandissement débordait.
- Test : `tests/v28-carrefours.mjs` (géométrie 90°, arrêts de carrefour,
  fusion réseau, non-superposition bâtiments/voirie, câblage UI).
- **V28.1 — placement robuste** : l'émergence tente d'abord le coin de zone
  (front de rue aligné, la place voisine reste libre), puis les tirages
  jitter, puis un balayage systématique — si une place nette existe, elle
  est trouvée. `tests/v27-buildings.mjs` adapté : une zone à cheval sur un
  boulevard ne peut plus porter deux bâtiments sous la règle « jamais sur
  l'enrobé » (une seconde voirie fournit le second bâtiment du scénario).
- **V28.2 — cascade réactive sur mobile** : le menu de la carte devient un
  panneau plein largeur au-dessus de la barre (3 colonnes égales, croix sur
  sa propre ligne, cibles ≥ 46 px — fini le défilement horizontal) ; une
  action n'effondre plus la cascade sur la racine : on reste sur la page
  pour changer d'outil en un tap et l'outil armé est surligné ; la barre
  flottante vide se réduit à rien et l'état « hover collant » des
  navigateurs tactiles est neutralisé. Desktop inchangé ; cache busting
  `?v=29`.

## V27.6 — Cascades fiabilisées (cache + robustesse)

- **Anti-cache des assets** : `main.js` et `style.css` chargés avec `?v=27.6`
  (balise script et vérificateur d'imports alignés) — après les poussées
  rapprochées V27.2→V27.5, un navigateur pouvait mêler un index.html ancien
  (sans conteneur menu) à un main.js neuf : la barre restait vide.
- **Conteneur de secours** : si `#mapMenu` manque dans le HTML, il est créé
  au démarrage — le menu s'affiche quel que soit l'état du shell.
- **Retour visuel** : la branche racine liée à l'outil armé (voirie /
  urbanisme / ligne) est surlignée ; le surlignage se rafraîchit à chaque
  changement de mode.
- Test : `tests/v27-map-menu.mjs` étendu (sections 7).

## V27.5 — Menu en cascade dans la carte

- **3 boutons par niveau** (std → n1 → n2) : chaque clic remplace le trio
  affiché ; bouton **✕** pour revenir au menu racine (Échap aussi).
- Racine : 🛣️ Voirie · 🏙️ Urbanisme · 🚌 Ligne. Sous-niveaux : construction
  par type de voirie, éditions (améliorer, sens unique, historique),
  zonage par type, modes de transport, recentrage.
- Les contrôles historiques restent dans le DOM (branchés, testables) mais
  cèdent la place au menu ; « ✅ Terminer » garde sa logique propre.
- Test : `tests/v27-map-menu.mjs` (3 boutons/menu, navigation, cibles DOM).

## V27.4 — Tableau de bord utilisable sur smartphone

- **Vue plein écran dédiée** : ouvert, le tableau de bord occupe tout l'écran
  (100dvh, repli vh) au lieu d'un coin de carte ; la poignée devient un en-tête
  collant « ✕ Fermer ».
- **Barre d'outils retirée** pendant la consultation : elle recouvrait le bas
  du panneau (z-index 130 > 120).
- **Accordéon exclusif** sur mobile : ouvrir un onglet referme les autres
  (comportement desktop inchangé).
- Test : `tests/v27-dashboard-mobile.mjs`.

## V27.3 — Dette traitée : collision au tracé & congestion par capacité

- **Collision bâtiment↔route au tracé** (dette §7 reportée) : un segment de
  voirie ne peut plus traverser un bâtiment occupé — le refus est expliqué au
  joueur. Les ruines abandonnées croisées sont expropriées sans créer de
  sans-abri. Nouvelles fonctions pures `segmentIntersectsRect`,
  `traceBlockedBuildings`, `expropriateAbandonedAlongTrace`.
- **Congestion pondérée par la capacité de voirie** (dette V1.5) : le
  ralentissement dépend désormais de la catégorie de voirie traversée — la rue
  (400 veh/h) reste la référence historique, une avenue sature deux fois
  moins vite, une voie rapide quatre fois moins. La heatmap et le mouvement
  des véhicules utilisent la capacité réelle de l'arête.
- **README remis à jour** : descriptif courant du jeu (voirie, urbanisme,
  OD, congestion par capacité), sans énumération version par version.
- Tests : `tests/v27-road-conflicts.mjs` (géométrie segment/rectangle,
  collision, expropriation, congestion × capacité, câblage UI).

## V27.2 — Jouabilité immédiate & en-tête compact

Bâtiments peuplés dès la fondation (`spawnInitialBuildings`, OD active à t0) ;
pastille 👥 = population de la ville (transportés au survol + tableau de bord) ;
en-tête compact ≤ 959 px (boutons topbar 34 px) ; tableau de bord 85vh avec
premier onglet déplié à l'ouverture.

## V27 à V27.1 — Construction de routes & bâtiments

Routes typées multi-points (rue/avenue/boulevard/voie rapide, sens unique,
amélioration, démolition, annuler/rétablir) ; urbanisme : zonage le long de
la voirie, croissance/densité/abandon, valeur foncière, inspection ; demande
OD des bâtiments ; UI/HUD urbanisme ; amorçage automatique des zones ;
ergonomie mobile (barre flottante, cibles tactiles 44 px).

## Compromis et dette restants

- La suppression d'une route utilisée par une ligne **avertit** au lieu de
  refuser (choix assumé) ;
- Sauvegardes compatibles ; constructions abandonnées conservées ;
- Les dettes §7 (collision au tracé, embouteillages/capacité) sont **traitées
  en V27.3**.








