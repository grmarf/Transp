import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ROAD_TYPES } from "../src/network.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const failures = [];
function check(label, condition) {
  if (condition) console.log("ok - " + label);
  else failures.push(label);
}

const renderer = read("src/renderer.js");
check("plus de plaques giratoires (soupe de ronds-points)", !renderer.includes("Îlot central pointillé") && !renderer.includes("ensureCarrefourCrossings"));
check("croisements simples documentés au rendu", renderer.includes("croisements simples"));
check("LOD : étiquettes auto-effacées sous zoom 0.55", renderer.includes("camera.zoom >= 0.55"));
check("taille d'étiquette bornée (vue d'ensemble)", renderer.includes("Math.min(16, Math.max(10, 13 / camera.zoom))"));
check("pastille d'attente bornée", renderer.includes("Math.min(15, Math.max(9, 11 / camera.zoom))"));
check("camera du renderer : minZoom 0.25", renderer.includes("minZoom: 0.25"));

const main = read("src/main.js");
check("cameraState : minZoom 0.25", main.includes("minZoom: 0.25"));
check("recentrage = cadrage de toute la ville", main.includes("Math.min(size.W / spanX, size.H / spanY)"));

check("voirie fine : rue ≤ 6 px", ROAD_TYPES.street.width <= 6);
check("voirie fine : avenue ≤ 9 px", ROAD_TYPES.avenue.width <= 9);
check("voirie fine : boulevard ≤ 13 px", ROAD_TYPES.boulevard.width <= 13);
check("voirie fine : voie rapide ≤ 16 px", ROAD_TYPES.highway.width <= 16);

const index = read("index.html");
check("anti-cache bumpé v35 (plus de v34)", !index.includes("?v=34") && (index.match(/\?v=35/g) || []).length >= 3);

const changes = read("CHANGES.md");
check("CHANGES documente la V29.6", changes.includes("## V29.6"));

if (failures.length) {
  console.error("ÉCHEC — " + failures.length + " vérification(s) :");
  failures.forEach((f) => console.error("  - " + f));
  process.exit(1);
}
console.log("ok - v29.6 : ville lisible (croisements simples, voirie fine, vue d'ensemble)");
