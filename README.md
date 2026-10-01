# Transport Tycoon — Transp V19.0

Jeu de gestion et de simulation de réseau de transport en JavaScript natif, Canvas et modules ES.

## Fonctionnalités

- génération de villes déterministe par seed ;
- lignes bus, tramway et métro souterrain ;
- passagers avec correspondances et routage intermodal ;
- congestion, pannes et travaux routiers ;
- croissance urbaine et scénarios ;
- économie par ligne, satisfaction et statistiques ;
- heatmap de congestion et journal de ville ;
- sauvegarde locale et export/import JSON ;
- interface adaptée au mobile.

La V14.1 ajoute un cache de routage automatiquement invalidé lors des
modifications de lignes, ainsi qu’un nettoyage borné des passagers arrivés ou
abandonnés. Les compteurs historiques sont conservés et les passagers encore
à bord ne sont jamais supprimés.

La V14.2 centralise les rafraîchissements de l’interface, expose l’état
accessible de la heatmap, ajoute sa légende visuelle et vérifie le contrat
HTML/JavaScript/CSS par un test Node sans dépendance de navigateur.

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
npm test
```

La suite couvre les versions historiques V2.3 à V13 ainsi que le routage intermodal, les métriques de correspondance et la heatmap V14.

## Structure

- `src/city.js` : génération de ville ;
- `src/network.js` : graphes routier et souterrain ;
- `src/routing.js` : itinéraires passagers ;
- `src/vehicles.js` : véhicules, tarifs, congestion ;
- `src/engine.js` : simulation et économie ;
- `src/renderer.js` : rendu Canvas et tableaux de bord ;
- `src/persistence.js` : sauvegarde locale et fichiers JSON ;
- `index.html` : shell de l’application ;
- `tests/` : tests automatisés.


La V15 introduit les événements urbains dynamiques : festivals, marchés, mouvements sociaux et canicules. Ils modifient temporairement la demande, la tarification et la satisfaction, et sont visibles dans le panneau d’événements et le journal de ville.

La V15.1 remplace le tirage aveugle par des événements déclenchés par la santé réelle du réseau, conserve leur cause dans l'historique et applique un cooldown pour éviter les répétitions.

La V16 ajoute une progression persistante : objectifs de réseau, réputation, rang opérateur et récompenses financières.

La V16.1 évalue les objectifs immédiatement après les actions du joueur dans
le jeu web : créer une ligne ou ouvrir un métro peut donc débloquer sa
récompense sans attendre le prochain changement de jour.

La V17 ajoute des contrats réseau renouvelables tous les trois jours, avec objectifs de fréquentation, qualité, couverture et intermodalité récompensés en argent et réputation.

La V18 ajoute un rapport quotidien conservant les 14 derniers bilans, avec finances, satisfaction, attente, abandons et recommandations actionnables.

La V19 introduit un calendrier saisonnier de 28 jours : les saisons modifient la demande, les tarifs, la croissance urbaine et apparaissent dans les rapports.
