
## Correctif V27.1 — ergonomie mobile (barre flottante)

Signalement joueur (mobile) : « injouable — impossible d\u2019afficher le bouton de fermeture de ligne, les menus mangent tout en haut, le bas est invisible ».

- Les 11 contrôles V27 (Voirie + Urbanisme) empilés dans la barre flottante
  en `flex-wrap` la faisaient monter jusqu\u2019à la moitié de l\u2019écran.
- Sur ≤ 700 px, le bottom sheet V26 (z-index 120) recouvrait la barre
  flottante (z-index 100, bottom 10 px) : « ✅ Terminer » était caché
  derrière le tableau de bord.

Correctifs (`@media (max-width: 959px)` / `(max-width: 700px)`, zéro JS) :

- barre flottante sur **une seule ligne défilante** (nowrap + overflow-x) ;
- les groupes Voirie / Urbanisme / mode deviennent des **panneaux
  contextuels** au-dessus de la barre, plus jamais empilés dedans ;
- **« ✅ Terminer » passe en tête** (`order: -1`) : toujours visible en mode
  ligne, sans défilement ;
- la barre passe **au-dessus de la poignée du tableau de bord**
  (bottom 66 px, z-index 130) sur ≤ 700 px ;
- en-tête allégé : tagline masquée, statistiques sur une ligne défilante.

Test : `tests/v27-mobile-ergonomy.mjs` (statique, Node pur). Le layout
 desktop (≥ 960 px) ne change pas d\u2019un pixel ; le browser-smoke CI tourne
 à 1280×900 et n\u2019est pas concerné.

