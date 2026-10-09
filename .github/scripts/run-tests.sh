#!/bin/bash
# Script pour exécuter les tests dans le dépôt Transp

echo "=== Exécution des tests ==="

# Chemin vers le dossier tests
TEST_DIR="tests"
exec -a node ./node_modules/.bin/node $TEST_DIR/run-all.mjs