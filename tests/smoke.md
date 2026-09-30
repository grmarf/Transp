# Smoke tests V2.1

## ST-01 — lancement
- Ouvrir `index.html`.
- La carte s'affiche.
- Le budget initial est de 50 000 €.
- Le panneau affiche une seed et un nom de ville.

## ST-02 — reproductibilité
- Noter la seed affichée.
- Recharger avec la même seed.
- Les positions, noms et niveaux de demande des arrêts sont identiques.
- La ville porte le même identifiant.

## ST-03 — nouvelle ville
- Saisir une autre seed.
- Cliquer « Générer la ville ».
- Les positions ou demandes changent.
- Les lignes et véhicules de l'ancienne partie sont réinitialisés.

## ST-04 — seed URL
- Ouvrir `index.html?seed=TEST-123`.
- Vérifier que `TEST-123` est affichée.
- Recharger la page.
- Vérifier que la même ville est reconstruite.

## ST-05 — compatibilité V1.1
- Créer une ligne avec au moins 2 arrêts.
- Un véhicule apparaît.
- La simulation produit des passagers et des recettes.
- Pause et vitesse 1×/2×/4× restent fonctionnelles.

## ST-06 — Android
- Ouvrir en portrait.
- Tous les contrôles restent accessibles.
- Toucher les arrêts fonctionne.
- Générer une nouvelle ville fonctionne au tactile.
- Aucun débordement horizontal.

## ST-07 — périmètre V2.1
- Aucun graphe de routing ni logique OD avancée n'est requis.
- Les routes de V2.1 sont une infrastructure visuelle préparatoire.
