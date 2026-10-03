import assert from 'node:assert/strict';
import { mulberry32 } from '../src/city.js';
import { DEMOGRAPHICS, demographicById, fareAcceptance, pickDemographic, waitToleranceMinutes } from '../src/demographics.js';
import { createPassenger } from '../src/passengers.js';

// Tirage pondéré hors pointe : les parts doivent être respectées.
const rng = mulberry32(20221003);
const counts = { commuter: 0, student: 0, retiree: 0, worker: 0 };
const N = 8000;
for (let i = 0; i < N; i++) counts[pickDemographic(rng, 3)]++;
for (const [id, demo] of Object.entries(DEMOGRAPHICS)) {
  assert.ok(Math.abs(counts[id] / N - demo.share) < 0.03, `part de ${id} respectée (${counts[id] / N})`);
}

// Sensibilité tarifaire : à tarif normal tout le monde voyage.
assert.equal(fareAcceptance('student', 1), 1);
assert.ok(fareAcceptance('student', 1.5) < fareAcceptance('commuter', 1.5), 'les étudiants sont plus sensibles que les actifs');
assert.ok(fareAcceptance('worker', 2) < 0.3, 'les ouvriers refusent un tarif ×2');
assert.ok(fareAcceptance('commuter', 2) >= 0.3, 'les actifs tolèrent un tarif ×2');
assert.equal(fareAcceptance(undefined, 1.5), 1, 'sans groupe (legacy), pas de filtrage');
assert.equal(fareAcceptance('student', 0.8), 1, 'un tarif réduit ne refoule personne');

// Tolérance d'attente relative : ouvrier < actif < étudiant < retraité.
assert.ok(waitToleranceMinutes('worker') < waitToleranceMinutes('commuter'));
assert.ok(waitToleranceMinutes('commuter') < waitToleranceMinutes('student'));
assert.ok(waitToleranceMinutes('student') < waitToleranceMinutes('retiree'));

// createPassenger reste compatible sans groupe.
const p = createPassenger({ originId: 'a', destinationId: 'b' });
assert.equal(p.demographic, null);
p.demographic = 'student';
assert.equal(demographicById('student').id, 'student');
assert.equal(demographicById('inconnu').id, 'commuter', 'groupe inconnu → actifs par défaut');

console.log(JSON.stringify({ ok: true, groups: Object.keys(DEMOGRAPHICS).length, samples: N }));
