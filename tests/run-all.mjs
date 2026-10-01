#!/usr/bin/env node
// V20.1 — Lanceur de tests multi-plateforme : exécute tous les tests/*.mjs
// (sauf ce fichier) via Node, sans dépendre d'une boucle shell UNIX.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir)
  .filter(f => f.endsWith('.mjs') && f !== 'run-all.mjs')
  .sort();

if (files.length === 0) {
  console.log('Aucun fichier de test trouvé dans ' + dir);
  process.exit(0);
}

let failed = 0;
for (const f of files) {
  console.log(`\n=== tests/${f} ===`);
  const result = spawnSync(process.execPath, [join(dir, f)], { stdio: 'inherit' });
  if (result.status !== 0) {
    failed += 1;
    console.error(`ÉCHEC : tests/${f}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} test(s) en échec.`);
  process.exit(1);
}
console.log('\nTous les tests sont passés.');
