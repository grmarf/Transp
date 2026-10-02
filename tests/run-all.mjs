#!/usr/bin/env node
// Exécute les tests JavaScript sans dépendre d’une boucle shell UNIX.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir)
  .filter(file => file.endsWith('.mjs') && file !== 'run-all.mjs')
  .sort();

let failed = 0;
for (const file of files) {
  console.log(`\n=== tests/${file} ===`);
  const result = spawnSync(process.execPath, [join(dir, file)], { stdio: 'inherit' });
  if (result.status !== 0) {
    failed += 1;
    console.error(`ÉCHEC : tests/${file}`);
  }
}

if (failed) {
  console.error(`\n${failed} test(s) en échec.`);
  process.exit(1);
}
console.log(`\nTous les tests sont passés (${files.length}).`);
