# Vie t'Lignes

Jeu de gestion et de simulation de réseau de transport urbain en JavaScript natif, Canvas et modules ES. Construis une ville vivante : trace la voirie, aménage les quartiers, puis exploite bus, tramways et métros pour servir une population origine-destination.

## Fonctionnalités

- **Villes déterministes** par seed : voirie, arrêts, quartiers et population reproductibles ;
- **Construction de routes** multi-points : rue, avenue, boulevard et voie rapide (coût, vitesse et capacité propres), sens unique, amélioration, démolition remboursée, annuler/rétablir ;
- **Voirie physique** : les véhicules circulent sur le graphe routier, les croisements créent des jonctions, et la **congestion dépend de la capacité** de chaque voirie (une rue sature bien plus vite qu'une voie rapide) ;
- **Urbanisme** : zones résidentielles, commerciales, industrielles, bureaux, services et loisirs le long de la voirie ; bâtiments qui émergent, montent en densité, perdent de la valeur ou sont abandonnés ; collision bâtiment↔route contrôlée au tracé (les ruines sont expropriées) ;
- **Passagers origine-destination** : les trajets naissent dans les bâtiments (domicile → emploi le matin, retour le soir), avec routage intermodal et correspondances ;
- **Lignes bus / tramway / métro** souterrain, flotte achetable, pannes et travaux ;
- **Groupes de passagers** avec sensibilité tarifaire, **overlay de couverture** de la population, campagnes publicitaires, salaires du personnel ;
- **Événements urbains** dynamiques (festivals, mouvements sociaux, canicules…), calendrier saisonnier ;
- **Progression** : objectifs, réputation, rang d'opérateur, contrats renouvelables, rapport quotidien ;
- **Heatmap de congestion**, journal de ville, statistiques détaillées ;
- **Économie complète** par ligne : tarifs, recettes, entretien, dette visible ;
- **Sauvegarde locale** et export/import JSON (format strict, pas de migration des anciens formats) ;
- **Interface adaptée au mobile** : en-tête compact, barre d'outils flottante, tableau de bord plein écran.

## Lancer le jeu

Les modules ES doivent être servis par HTTP :

```bash
npm run serve
```

Puis ouvrir <http://localhost:8791>.

Alternative sans npm :

```bash
python3 -m http.server 8791
```

Le script `launch-termux.sh` permet également un lancement sur Android/Termux.

## Tester

```bash
npm test             # tests métier + smoke test Chromium
npm run check:syntax # vérification syntaxique de src/ et tests/
npm run check        # les deux contrôles
```

La suite couvre le moteur (routage, passagers, véhicules, économie, croissance, événements, saisons, contrats…), la voirie et l'urbanisme (routes typées, bâtiments, OD, collisions), l'ergonomie mobile et un parcours réel dans Chromium. Le smoke test navigateur nécessite `chromium` installé localement. La CI GitHub exécute les contrôles sur `main` et les pull requests.

## Structure

- `src/city.js` : génération de ville ;
- `src/network.js` : graphe routier typé, jonctions, plus courts chemins ;
- `src/buildings.js` : zonage, bâtiments, valeur foncière, collisions tracé ;
- `src/od.js` : demande origine-destination ;
- `src/routing.js` : itinéraires passagers ;
- `src/vehicles.js` : véhicules, tarifs, congestion ;
- `src/engine.js` : simulation et économie ;
- `src/renderer.js` : rendu Canvas et tableaux de bord ;
- `src/persistence.js` : sauvegarde locale et fichiers JSON ;
- `src/demographics.js`, `src/coverage.js`, `src/advertising.js` : clientèle, couverture, publicité ;
- `index.html` : shell de l'application ;
- `tests/` : tests automatisés (Node pur, découverts automatiquement).

Les détails historiques des évolutions sont dans `CHANGES.md` et l'historique Git.

