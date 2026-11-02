import { readFileSync } from "node:fs";
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
import { fileURLToPath } from "node:url";
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
import { dirname, join } from "node:path";
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
import { ROAD_TYPES } from "../src/network.js";
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g

nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
const read = (p) => readFileSync(join(root, p), "utf8");
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g

nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
const failures = [];
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
function check(label, condition) {
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
  if (condition) console.log("ok - " + label);
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
  else failures.push(label);
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
}
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g

nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
const renderer = read("src/renderer.js");
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("plus de plaques giratoires (soupe de ronds-points)", !renderer.includes("Îlot central pointillé") && !renderer.includes("ensureCarrefourCrossings"));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("croisements simples documentés au rendu", renderer.includes("croisements simples"));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("LOD : étiquettes auto-effacées sous zoom 0.55", renderer.includes("camera.zoom >= 0.55"));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("taille d'étiquette bornée (vue d'ensemble)", renderer.includes("Math.min(16, Math.max(10, 13 / camera.zoom))"));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("pastille d'attente bornée", renderer.includes("Math.min(15, Math.max(9, 11 / camera.zoom))"));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("camera du renderer : minZoom 0.25", renderer.includes("minZoom: 0.25"));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g

nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
const main = read("src/main.js");
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("cameraState : minZoom 0.25", main.includes("minZoom: 0.25"));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("recentrage = cadrage de toute la ville", main.includes("Math.min(size.W / spanX, size.H / spanY)"));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g

nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("voirie fine : rue ≤ 6 px", ROAD_TYPES.street.width <= 6);
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("voirie fine : avenue ≤ 9 px", ROAD_TYPES.avenue.width <= 9);
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("voirie fine : boulevard ≤ 13 px", ROAD_TYPES.boulevard.width <= 13);
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("voirie fine : voie rapide ≤ 16 px", ROAD_TYPES.highway.width <= 16);
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g

nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
const index = read("index.html");
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("anti-cache bumpé v46 (plus de v45)", !index.includes("?v=45") && (index.match(/\?v=46/g) || []).length >= 3);
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g

nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
const changes = read("CHANGES.md");
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("CHANGES documente la V29.6", changes.includes("## V29.6"));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g

nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
if (failures.length) {
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
  console.error("ÉCHEC — " + failures.length + " vérification(s) :");
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
  failures.forEach((f) => console.error("  - " + f));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
  process.exit(1);
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
}
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
console.log("ok - v29.6 : ville lisible (croisements simples, voirie fine, vue d'ensemble)");
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
