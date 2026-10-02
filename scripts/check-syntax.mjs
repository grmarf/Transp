#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const directories = ['src', 'tests'];
const files = directories.flatMap(directory => readdirSync(join(root, directory))
  .filter(file => file.endsWith('.js') || file.endsWith('.mjs'))
  .map(file => join(root, directory, file)));

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntaxe valide : ${files.length} fichiers.`);
