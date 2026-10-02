# Rapport économie — V20.2

## Diagnostic

L’audit du flux complet confirme que les revenus ne sont pas perdus :

1. `alightPassengers()` calcule le tarif du tronçon.
2. Le montant est ajouté à `line.income`.
3. Le même montant est crédité à `state.money`.
4. `economy()` ne débite que le coût horaire des véhicules : `10 minutes / 60 × opex horaire`.

Le coût n’était donc pas calculé par tick brut. Le problème observé était surtout la faible lisibilité de la marge et un tarif de base trop faible pour une ligne peu fréquentée.

## Mesure sur 10 minutes simulées

Seed de mesure : `economy-10m`, une ligne bus et son véhicule initial.

| Indicateur | Avant V20.2 | Après V20.2 |
|---|---:|---:|
| Trésorerie après création de ligne | 48 679 € | 48 679 € |
| Trésorerie après 10 min | 48 677 € | 48 677 € |
| Revenus crédités en 10 min | 0 € | 0 € |
| Coût d’exploitation en 10 min | 2 € | 2 € |
| Passagers arrivés en 10 min | 0 | 0 |

L’absence de recette sur cette fenêtre courte vient du temps de parcours du véhicule et non d’un défaut de crédit : aucun passager n’a encore atteint un arrêt payant.

## Rééquilibrage appliqué

- Tarif de base par tronçon : **0,80 € → 1,20 €**.
- Part variable : **0,40 € → 0,50 € par 100 px**.
- Coût d’exploitation inchangé et toujours proportionnel au temps simulé.
- Chaque recette est maintenant journalisée (`+X € passagers · Ligne N`).
- Les coûts sont journalisés périodiquement (`−X € entretien · Ligne N`).
- Le tableau de bord expose désormais **revenus / coûts / marge du jour**, en plus des cumuls.

Sur le test de livraison d’un tronçon de 231 px, le revenu passe de **1,69 € à 2,31 €**. Après le coût de 2 € d’un bus sur 10 minutes, ce scénario de test affiche une marge de **+0,31 €**.

## Vérifications

- `npm test` : **32 suites passées**.
- `npm run check:syntax` : **53 fichiers valides**.
- Smoke test Chromium : démarrage, sauvegarde, chargement, échappement HTML et indicateurs monétaires validés.
- Console navigateur : **aucune erreur**.
