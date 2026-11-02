# CHANGES

L'historique complet des évolutions est dans l'historique Git ; ce fichier
résume l'état courant du jeu et les derniers changements.

## V48 — Carte allégée : voiries générées droites + mini-carte flottante

Deux irritants de la carte, signalés en zoom maximal ; anti-cache bumpé
`?v=48` (cache SW `vtl-cache-v48`), nouveaux gels de non-régression
`tests/v48-map-clutter.mjs`.

- **Voiries générées : fin des « arêtes de poisson »** — depuis le V28, chaque
  croisement pliait à 90° la voirie la plus récente (bras de 22 px) : un
  segment d'arrêt à arrêt qui en croisait plusieurs finissait en zigzags et
  boucles illisibles qui surchargeaient la carte au zoom maximal. La ville se
  génère désormais avec `skipGeneratedBends` : les voiries d'arrêt à arrêt
  restent droites, les croisements restent de simples X (esprit V29.6) et
  l'arrêt de carrefour y est toujours posé — le réseau fusionne par position.
  Les tracés du joueur (`opts.road`) conservent leur redressement à 90°.
- **Sauvegardes héritées décrassées automatiquement** — nouvelle fonction
  `straightenGeneratedRoads` (pruning.js) : au chargement d'une partie, les
  polylines pliées des voiries générées (et uniquement elles — jamais les
  voiries construites, corridors ou tracés libres) retrouvent leur géométrie
  directe arrêt → arrêt. Idempotent, appelé dans `rationaliseCityRoads` avant
  le déssaimage, avec reconstruction du réseau.
- **Mini-carte flottante (mobile ≤959px)** — elle était posée en bas à droite
  du canvas et le menu du bas la recouvrait en partie. Elle devient
  `position: fixed`, ancrée juste au-dessus du menu du bas (elle peut en
  chevaucher le haut, le menu garde le dessus), réduite à 120×80 pour ne pas
  manger la carte, remonte quand la barre flottante est visible et
  s'escamote quand la feuille du bas est ouverte. Le desktop (≥960px) ne
  change pas.

## V47 — Correctifs d'audit (affichage, contrats, avance rapide, sauvegardes)

Correctifs issus de l'audit complet du code ; anti-cache bumpé `?v=47`
(cache SW `vtl-cache-v47`), nouveaux gels de non-régression
`tests/v47-bugfixes.mjs`.

- **style.css — 3 déclarations cassées par un saut de ligne en plein mot**
  (corruption silencieuse invisible en jeu) : `overscroll-behavior: none`
  (le scroll chaining revient sur mobile quand un doigt glisse hors canvas),
  `word-break: break-word` (débordements des noms longs dans les chips) et
  `font-weight:bold` des badges de ligne (gras perdu). Recollées ; la CI ne
  lintant pas le CSS, le nouveau test vérifie désormais l'intégrité.
- **Rapport du jour (renderer)** : le panneau lisait `report.avgWait` /
  `report.abandoned`, champs inexistants — il affichait « Attente : NaN min »
  et « Abandons : undefined ». Il lit désormais les vrais champs
  `avgWaitMinutes` / `abandonedCount` de `createDailyReport`.
- **Panneau Contrats (renderer)** : la progression est une fraction 0–1
  mais était affichée telle quelle (« 0.25% » au lieu de « 25 % »), et le
  statut `c.status` n'existe pas (la classe `.completed` ne s'appliquait
  jamais, `contract-row undefined` dans le DOM). Corrigé :
  `Math.round(c.progress * 100)` et branchement sur `c.completed`.
- **Contrats — off-by-one silencieux (engine)** : au passage du jour
  d'échéance, `refreshContracts` remplaçait la paire **avant** l'évaluation :
  un objectif atteint pendant le dernier jour affiché (« encore 1 jour »)
  était perdu sans récompense. L'évaluation précède désormais le
  renouvellement.
- **Contrats — robustesse** : un id inconnu (sauvegarde éditée à la main)
  faisait planter `contractSummary` (TypeError sur `type.target`) et
  `evaluateContracts` créditait `NaN` ; les ids inconnus sont ignorés
  proprement.
- **Avance rapide (+1 j) — interface gelée** : pendant la simulation
  (Web Worker), l'UI restait cliquable et toute action était silencieusement
  écrasée au retour par l'état du worker. Le corps porte désormais
  `ff-busy` (pointer-events coupés, curseur d'attente) et `clickMap`
  refuse d'agir pendant la simulation.
- **Avance rapide — aléa relayé** : `boot(..., { rngState: null })` remettait
  le générateur principal à son flux initial à chaque +1 j (répétitions
  d'événements aléatoires). Le protocole worker transporte désormais l'état
  final du générateur (`rngState`) et le boot le réapplique.
- **Sauvegardes allégées** : la grille de valeur foncière (`Float32Array`
  sérialisée en objet `{0:…}` volumineux, de toute façon rejetée puis
  reconstruite au premier cycle horaire) et les piles d'annulation voirie
  (remises à zéro au démarrage) ne sont plus écrites dans les sauvegardes —
  des dizaines de Ko de JSON mort en moins par sauvegarde.
- **Coquilles** : « Carrefur des Acacias » → « Carrefour des Acacias »,
  « n'essime pas » → « n'essaim pas »/« essaime » (commentaires).
- Vérifié et **non modifié** : l'expiration des événements et campagnes au
  jour `endsDay` est cohérente avec l'affichage « encore N jour(s) »
  (sémantique verrouillée par `tests/v15-events.mjs`) — pas d'off-by-one
  là-bas.

## V40 — 100 % local : PWA installable et jeu hors ligne

- **Service worker (`sw.js`)** : cache-first de tous les fichiers du jeu
  (même origine). La première visite en ligne remplit le cache (tous les
  modules sont chargés au démarrage) ; ensuite le jeu démarre
  **intégralement hors ligne**, y compris après un rechargement. Les
  versions de cache suivent l'anti-cache (`vtl-cache-v47`) ; les requêtes
  ignorent le paramètre `?v=` côté cache (imports internes sans
  paramètre).
- **Installable partout** : le manifest est complété (id, scope,
  description, orientation, icônes 192/512 + maskable) — **Android** :
  Chrome propose « Installer l'app » (icône écran d'accueil, plein écran,
  fonctionne sans réseau, même en avion). **Windows** : Edge/Chrome
  proposent « Installer » (fenêtre autonome, raccourci menu démarrer).
  Aucun fichier à distribuer : le site GitHub Pages devient l'app.
- **Enregistrement** dans index.html après le chargement (échec
  silencieux et sans impact si le SW est indisponible — le jeu en ligne
  reste identique).
- **Sonde CI** : `tests/v40-pwa-offline.mjs` charge le jeu, attend le
  service worker actif, **coupe le réseau** (émulation CDP hors ligne),
  recharge, et vérifie que le jeu démarre entièrement depuis le cache —
  deux fois de suite.
- Anti-cache bumpé `?v=46`.

## V39 — Feuille du tableau de bord défilante au doigt + taps robustes

- **Le « menu » des captures est le tableau de bord** (bottom sheet
  plein écran) : **cause racine du « impossible de descendre »** — les
  onglets sont des flex-items du corps (flex column) et rétrécissaient
  par défaut (`flex-shrink`), leur contenu se faisait rogné sous le bord
  au lieu de faire déborder le corps : `scrollHeight` restait égal à
  `clientHeight` et le défilement ne s'armait jamais. Ils sont désormais
  non-rétrécissables (`flex: 0 0 auto`) et débordent réellement ; le
  corps ouvert déclare en outre `touch-action: pan-y`,
  `overscroll-behavior-y: contain` et `-webkit-overflow-scrolling:
  touch` : geste vertical attribué au panneau, défilement natif garanti,
  overscroll contenu.
- **« Terminer ne fonctionne pas toujours »** : sur un vrai doigt, un
  léger glissé (quelques pixels) suffit au navigateur pour confier le
  geste à un conteneur défilable de la chaîne (page, barre horizontale,
  panneau scrollable) — il émet `pointercancel`, ni click ni pointerup,
  et le bouton paraît inerte par intermittence. `bindTap` et
  `bindDelegatedTap` récupèrent maintenant ces taps annulés : touche
  courte sans dérive de scroll des ancêtres (≤ 12 px) = c'était un tap —
  le mini-dérapage est annulé et le handler invoqué.
- **Sonde CI** : `tests/v39-feuille-scroll.mjs` rejoue sur viewport
  mobile réel (360×740, tactile) l'ouverture de la feuille, un **vrai
  swipe** (doigt qui glisse) qui doit la faire défiler, la fermeture,
  la création d'une ligne terminée par un **tap dérivé** (dérapage
  12 px) sur ✅ Terminer, et le scroll du panneau en cascade.
- Anti-cache bumpé `?v=45`.

## V38 — Scroll des sous-menus sur smartphone

- **Panneau défilant** : sur mobile (≤ 959 px), le panneau du menu en cascade
  (`.map-menu`, fixé en bas d'écran) n'avait ni hauteur maximale ni
  défilement — une page plus haute que l'écran (police système agrandie,
  écran court, paysage) masquait des boutons sans aucun recours. Il est
  désormais plafonné (`calc(100dvh - 180px)`, repli `vh`) et défile au doigt
  (`overflow-y: auto`, `touch-action: pan-y`, `overscroll-behavior:
  contain` — le glissé ne se propage ni à la carte ni à la page).
- **Sonde CI** : `tests/v38-sousmenu-scroll.mjs` parcourt les 12 pages de la
  cascade sur trois viewports mobiles (412×915, 360×740, 740×360 paysage)
  et vérifie que chaque bouton est intégralement à l'écran et réellement
  tapable (`elementFromPoint`), que le panneau est scrollable, et qu'une
  page plus haute que l'écran défile réellement (scrollTop).
- Anti-cache bumpé `?v=44`.

## V29.1 — Fond de carte naturel, voiries directes, menu auto-réparant

- **Fond de carte** : les îlots carrés décoratifs ont disparu — générés par
  bruit, ils ne correspondaient à rien (ni zones, ni bâtiments réels, ni
  voirie) et « quadrillaient » la carte pour rien. Le fond reste une herbe
  douce ponctuée de parcs organiques.
- **Voiries naturelles** : les routes d'arrêt à arrêt ne font plus de détours
  A* « autour des îlots » décoratifs (des escaliers de segments très
  artificiels) — elles sont dessinées en ligne directe, et tous les angles
  (y compris les plis à 90° des carrefours) sont arrondis au rendu.
- **Menu en cascade auto-réparant** : si le shell HTML est périmé (cache
  navigateur, copie locale ancienne), la barre flottante et le menu sont
  reconstruits de zéro ; si l'initialisation échoue, les boutons historiques
  sont réaffichés en secours — le jeu ne reste jamais sans outils.
- **Anti-cache d'assets bumpé** (?v=29 → ?v=30) : un navigateur servant une
  copie ancienne de main.js/style.css était la cause la plus probable du
  menu « disparu ».

## V36 — Menu en cascade reconstruit : pages statiques, ✕ fiable

- **Fin des bugs à répétition** : le menu n'est plus détruit/recréé à
  chaque interaction. Chaque niveau (std, voirie, urbanisme, ligne,
  arrêts et pages annexes) est construit UNE FOIS au démarrage comme
  page `.map-menu-page` masquée par `[hidden]` ; `setMapMenu` se contente
  de basculer la page visible et de rafraîchir le surlignage (des
  classes, rien d'autre).
- **✕ immédiat** : la croix ne dépend plus d'aucune reconstruction du
  DOM — elle bascule la page racine à l'instant du tap, y compris en
  double tap ou pendant un armement d'outil (l'outil reste armé, la
  racine surligne sa branche). Aucun bouton ne pouvant plus disparaître
  pendant un tap, le « click » synthétique du navigateur ne peut plus
  viser un bouton disparu ou reconstruit — la source des régressions
  V28 à V35 (actions « qui ne réagissent pas », ✕ inerte, taps perdus).
- Tests : `v35-menu-arrets` étendu (croix : retour racine, page rouverte,
  outil armé conservé) ; `v27-map-menu` épingle l'architecture pages.
- Anti-cache bumpé `?v=42`.


**V36.1 — click fantôme (cause racine des bugs récurrents de la croix).**
Sur tactile, le handler de `pointerup` change la page du menu pendant le tap
(✕ → racine, « ▸ » → sous-page) : le bouton tapé est masqué et le click
synthétique émis après le `touchend` retombe sur le bouton révélé au même
endroit — le ✕ ramenait à la racine puis le fantôme rouvrait « Voirie », et
la navigation vers Arrêts armait « Pôle multimodal » sans raison. Correctif :
`bindTap` / `bindDelegatedTap` annulent ce click parasite sur tactile (branche
PointerEvent) — `pointerup` a déjà tout traité. Anti-cache v43.
## V35 — Menu arrêts : une ligne, taps fiables

- **Une seule ligne de boutons** : sur mobile, la croix ✕ n'occupe plus une
  rangée entière au-dessus des boutons — la cascade passe en 4 colonnes
  compactes (racine et pages : ✕ + actions sur la même ligne, texte plus
  petit, cibles ≥ 44 px). Demande joueur : « met ces boutons sur la même
  ligne, quitte à ce que les boutons soient plus petits ».
- **Taps enfin réactifs** : le menu n'est plus reconstruit pendant le tap
  lui-même. Auparavant, pointerup → action → updateInstructions détruisait
  et recréait les boutons au milieu de l'événement ; le « click »
  synthétique du navigateur pouvait alors viser le bouton reconstruit et
  invoquer le handler une seconde fois : l'outil s'armait puis se
  désarmait aussitôt — « on dirait qu'ils ne réagissent pas ». Le rendu du
  menu est désormais coalescé et différé d'une frame
  (requestAnimationFrame) : le bouton tapé survit à toute la chaîne
  d'événements, et les reconstructions multiples se fondent en une seule.
- **Arrêts initiaux suppressibles** : confirmé et verrouillé par test — la
  démolition n'a jamais distingué arrêts générés et arrêts du joueur ;
  seul un arrêt desservi par une ligne (ou dans un tracé en cours) reste
  protégé. Le nouveau test navigateur démolit réellement un arrêt initial.
- Anti-cache bumpé `?v=41` ; test `tests/v35-menu-arrets.mjs` (viewport
  mobile 412×915, taps réels Input.dispatchTouchEvent : navigation,
  armement stable, construction, démolition d'un arrêt initial, une seule
  ligne).

## V34 — Scénarios & défis (réécriture complète de l'ébauche V9)

- **Objectifs multiples** par défi : chaque scénario liste désormais
  plusieurs objectifs mesurables (passagers transportés, bilan net,
  ligne d'un mode donné : bus/tram/métro) plus une **contrainte
  continue** « satisfaction minimale » (échec immédiat si violée). Le
  bandeau affiche chaque objectif avec sa progression et une barre
  globale.
- **Deux nouveaux défis** : « Cap sur le métro » (ouvrir une ligne de
  métro + 400 passagers) et « Ville qui grandit » (croissance ×2,
  demande ×1,2, 900 passagers). Les trois défis historiques (Premiers
  pas, Expansion express, Crise infrastructure) sont repris avec
  descriptions et objectifs rééquilibrés ; le bac à sable reste libre.
- **Médailles or / argent / bronze** à la victoire selon la marge de
  temps, et **record par scénario** conservé entre les parties (clé
  localStorage dédiée, hors sauvegarde → aucune migration du format
  V32, qui reste en v4).
- Compatibilité : `evaluateScenario` / `scenarioProgress` gardent leurs
  signatures (engine.js inchangé) ; une sauvegarde V33 au format
  mono-objectif reste jouable (repli automatique sur `objective`).
- Anti-cache bumpé `?v=40` ; test `tests/v34-scenarios.mjs`.

## V33 — Mode planification : construire en pause, payer d'un bloc

- **📋 Planifier** dans les contrôles de temps : la partie se met en pause
  et les travaux se posent **sans être payés** — segments de voirie (outil
  🛣️ Construire) et arrêts (page 🚏 Arrêts ▸ ➕). Le bandeau d'instructions
  affiche en permanence le nombre de travaux et le **total estimé**.
- **✅ Valider** : paiement **atomique** de la file (refus explicite si le
  budget est insuffisant, rien n'est débité sinon). **✖ Abandonner** (ou
  re-touche 📋) : les travaux planifiés sont retirés **sans frais** — ils
  n'avaient jamais été payés. La pause est restituée à la sortie.
- Options conservatrices : la file ne couvre que routes + arrêts (les
  lignes gardent leur estimation V25) ; les travaux planifiés n'entrent
  pas dans la pile d'annulation voirie (la file remplace) ; un arrêt
  planifié devenu desservi par une ligne ou une route réutilisée par un
  itinéraire est **conservé** à l'abandon plutôt que de casser une ligne.
- Anti-cache bumpé `?v=39` ; test `tests/v33-plan-mode.mjs`.

## V32 — Versioning & migration des sauvegardes

- **Format de sauvegarde versionné** : passage au format 4 (localStorage et
  exports fichiers). Le chargement applique une **chaîne de migrations
  ascendantes** (`MIGRATIONS` dans persistence.js) jusqu'à la version courante.
- **Migration 3 → 4** : drapeau `multimodal` rendu explicite sur chaque arrêt
  (absent = faux, cohérent avec la V30), compteur `customStopCount` des arrêts
  construits par le joueur recalculé si absent.
- **Refus explicites plutôt que conversions hasardeuses** : plus ancien que le
  format 3 (avant-V20) ou plus récent que le jeu -> message clair (nouvelle
  partie ou mise à jour), jamais de reconstruction silencieuse.
- **Traçabilité** : les étapes jouées sont journalisées au chargement et à
  l'import (« 💾 Sauvegarde migrée… ») via `payload.migrationNotes`.
- Test : `tests/v32-migrations.mjs` (sérialisation v4, migration d'une
  sauvegarde v3, refus trop ancien/trop récent, idempotence, storage factice,
  câblage statique).

## V31 — Web Worker : avance rapide d'un jour

- **⏩ +1 j** dans les contrôles de temps : simule exactement une journée
  (144 ticks à vitesse 1) **dans un Web Worker** (`src/engine-worker.js`,
  module ES) — l'interface reste fluide, la carte reste manipulable.
- **Repli synchrone garanti** : si `Worker` est indisponible, que le module
  échoue ou que l'état n'est pas clonable, la simulation repart de l'état
  original sur le fil principal (jamais de double application).
- Choix conservateur : la boucle de jeu par tick reste sur le fil principal
  (rendu + état partagés) ; seul le calcul long est déporté. Les drapeaux
  pause/vitesse du joueur sont restaurés de part en part.
- Anti-cache bumpé `?v=38` ; test `tests/v31-worker.mjs` (exactitude,
  déterminisme, clonabilité postMessage, repli synchrone, câblage).

## V30 — Gestion des arrêts & multimodalité

- **Construire un arrêt** (🚏 Arrêts ▸ ➕) : pose d'un arrêt neuf à 1 200 €,
  avec validation propre — refus motivé si trop proche d'un arrêt existant
  (espacement minimal 80 px), hors du territoire, ou sans les fonds. Le nouvel
  arrêt se raccorde ensuite à la voirie et aux lignes comme les autres.
- **Supprimer un arrêt** (➖) : refusé tant qu'il est desservi par une ligne
  (option conservatrice : retirez d'abord la ligne) ou sélectionné dans un
  tracé en cours. Sinon : voirie raccordée supprimée, passagers en attente à
  cet arrêt abandonnés et comptés, demandes purgées.
- **Pôle multimodal** (⬆️) : upgrade d'un arrêt à 6 000 € — un passager EN
  CORRESPONDANCE y attend deux fois moins vite, et l'arrêt est 20 % plus
  attractif comme destination. Rétrogradation possible (remboursement 50 %).
  Rendu : anneau pointillé ciel autour de l'arrêt. Sauvegardes compatibles
  sans migration (champ `multimodal` optionnel).
- Anti-cache bumpé `?v=37` ; test `tests/v30-stops.mjs`.

## V29.7 — Quartier léger autour des arrêts

- **Anneau pointillé au lieu du disque plein** : le halo jaune de population
  qui noyait chaque arrêt (opacité jusqu'à 0.5) devient une **limite de
  quartier en pointillés** avec un voile intérieur imperceptible (0.06) —
  comme sur un plan de cadastre. La densité reste lisible : plus un arrêt
  est peuplé, plus le pointillé est opaque.
- Anti-cache bumpé `?v=36` ; test `tests/v29.7-leger-autour-arret.mjs`.

## V29.6 — Ville lisible : croisements simples, voirie fine, vue d'ensemble

- **Adieu la « soupe de ronds-points »** : les plaques giratoires systématiques
  (V29.3) disparaissent — les croisements redeviennent de simples T/croix,
  dessinés proprement par les voiries arrondies. Seuls les feux des jonctions
  signalisées restent matérialisés.
- **Voirie plus fine** : rue 6 px, avenue 9, boulevard 13, voie rapide 16
  (au lieu de 8/13/19/24) — les bâtiments et les arrêts respirent.
- **Vue d'ensemble** : 🎯 Recentrer (et l'ouverture) cadrent désormais TOUTE
  la ville, même sur mobile — le zoom minimum passe de 0.5 à 0.25.
- **Niveau de détail** : en vue d'ensemble (zoom < 0.55), les étiquettes
  d'arrêts s'effacent d'elles-mêmes ; les compteurs rouges restent bornés.
- Anti-cache bumpé `?v=35` ; test `tests/v29.6-ville-lisible.mjs` ; v28 et
  v29.3 mis à jour (croisements simples), v29.5 (garde LOD).

## V29.5 — Noms des arrêts masquables

- **Nouveau bouton 🔤** dans la barre d'overlays de la carte (à côté de 🔥
  congestion, 📍 couverture, 💰 valeur foncière, 🗺️ zones) : masque ou
  réaffiche les étiquettes des arrêts — la carte redevient lisible quand
  on consulte les zones, la valeur foncière ou la couverture. Les pastilles
  d'attente (compteurs rouges) restent toujours visibles.
- Anti-cache bumpé `?v=34` ; test `tests/v29.5-stop-names.mjs`.

## V29.4 — Le menu en cascade enfin VISIBLE sur mobile (cause racine)

- **Cause racine** : `transform: translateX(-50%)` sur `.floating-toolbar` —
  un ancêtre transformé devient le bloc conteneur de ses descendants
  `position: fixed`. Le `#mapMenu` (fixé `left:10px; right:10px; bottom:10px`
  sur mobile) était donc calé sur la **barre flottante réduite à presque
  rien** (boutons historiques cachés) : un menu de **20 px de large**, hors
  champ, recouvert. Cassé depuis la V28.2, invisible pour la CI qui ne
  testait la visibilité ni en viewport mobile.
- **Correctif** : la barre est centrée par `margin: 0 auto; width:
  fit-content` (sans transform) — le menu redevient relatif à l'écran.
- **Sonde CI permanente** : `tests/v29.4-map-menu-visible.mjs` charge le jeu
  en conditions réelles (HTTP + Chromium CDP) en desktop 1280×900 **puis en
  mobile 412×915**, et vérifie existence, boutons ≥ 3, styles, largeur
  (≥ 300 px en mobile) et non-recouvrement (`elementFromPoint`) — avec un
  diagnostic compact dans l'annotation en cas d'échec.
- Anti-cache bumpé `?v=33`.

## V29.3 — Carrefours lisibles (plaques giratoires)

- **La « route étrange » en Y** : trois voiries convergeant au même point
  ne ressemblaient à rien. Chaque croisement réel (géométrique, via
  `computeCarrefours` mis en cache jusqu'à la prochaine invalidation du
  réseau, ou nœud de jonction) est désormais matérialisé par une **plaque
  giratoire** : disque clair bordé d'encre, îlot central pointillé,
  passages piétons aux quatre abords. Les convergences deviennent un
  aménagement assumé, plus un accident de tracé.
- Anti-cache bumpé `?v=32` ; test `tests/v29.3-carrefour-render.mjs`.

## V29.2 — Déssaimage de la voirie & ceinture du menu

- **Trop de carrefours** : la génération urbaine (secondes liaisons, boucles de secours) finissait par croiser inutilement ses voiries — chaque croisement devenait un carrefour redressé à 90° et la carte se couvrait de nœuds. Nouveau module `src/pruning.js` :
  - `pruneRedundantRoads(city)` : retire au boot les tronçons **redondants** (dont le retrait ne déconnecte aucun arrêt — union-find, les ponts ne sont jamais retirés), en priorisant les voiries qui créent le plus de croisements puis les plus longues. Les voiries du joueur (construites, corridors, tracés libres) ne sont jamais candidates.
  - `pruneOrphanCarrefourStops(city, protectedIds)` : fait disparaître les arrêts de carrefour devenus orphelins (plus aucune voirie à ≤ 16 px), sauf s'ils servent une ligne, sont en sélection en cours ou chargés de passagers.
  - `main.js` journalise « 🧹 Voirie rationalisée : … » et reconstruit le réseau (itinéraires recalculés par `rebuildNetwork`).
- **Ceinture du menu** : après chaque boot, si `#mapMenu` s'avérait vide, il est repeuplé immédiatement.
- Anti-cache bumpé `?v=31` ; nouveau test `tests/v29.2-road-pruning.mjs` (corde redondante retirée, pont conservé, voiries joueur protégées, orphelins de carrefour, idempotence, ville générée saine après déssaimage).

## V29 — Réseau : identité géométrique des nœuds + garde-fou d'invariants

- **Identité = géométrie** : l'identité d'un nœud du graphe est sa position
  (fusion ≤ 2 px), plus jamais une chaîne fabriquée. L'ancien registre testait
  l'id AVANT la position : toute collision d'étiquettes (« waypoint-undefined-N »
  entre voiries sans id, id de voirie dupliqué dans une sauvegarde importée)
  fusionnait des nœuds géographiquement éloignés et cousait des arêtes
  parasites à travers la carte, sans aucun message. Une étiquette demandée ne
  peut plus jamais réutiliser l'id d'un nœud situé ailleurs (suffixe dérivé).
- **Garde-fou structurel (validateNetwork)** : invariants vérifiables —
  références pendantes, arêtes plus longues que la diagonale de la carte,
  identités corrompues, arrêts absents du graphe, quasi-doublons
  géométriques. Journalisé dans la ville au boot et après chaque édition de
  voirie ; verrouillé par des tests CI adversaires (voiries sans id, ids
  dupliqués, croisements confondus, carrefours pliés à 90°).
- **Ids de nœuds éphémères** : la règle est formalisée — les ids du graphe
  vivent le temps d'une construction et ne se persistent jamais ; seuls les
  ids d'arrêts et de lignes sont stables, le graphe se reconstruit toujours
  depuis city.roads et les véhicules sont ré-ancrés à chaque recalcul
  d'itinéraire.

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








