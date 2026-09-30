# Transport Tycoon — Transp

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
