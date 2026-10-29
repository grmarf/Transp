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
  // Sortie capturée pour pouvoir annoter l'échec (workflow command GitHub),
  // puis rejouée intégralement dans le journal de la CI.
  const result = spawnSync(process.execPath, [join(dir, file)], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe']
  });
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  if (result.status !== 0) {
    failed += 1;
    console.error(`ÉCHEC : tests/${file}`);
    const lines = String(result.stderr || '').split('\n').filter(line => line.trim());
    const detail = (lines.find(line => /AssertionError|Assertion failed|Error:/.test(line)) || lines[0] || 'sortie vide')
      .replace(/[\r\n]+/g, ' ')
      .replace(/%/g, '%25')
      .replace(/:/g, '%3A')
      .slice(0, 300);
    console.error(`::error title=%C3%89chec tests/${file}::%C3%89CHEC tests/${file} %E2%80%94 ${detail}`);
  }
}

if (failed) {
  console.error(`\n${failed} test(s) en échec.`);
  process.exit(1);
}
console.log(`\nTous les tests sont passés (${files.length}).`);
