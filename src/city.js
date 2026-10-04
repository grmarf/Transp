const DISTRICT_NAMES = [
  "Centre", "Nord", "Sud", "Ouest", "Est", "Nord-Ouest",
  "Nord-Est", "Sud-Ouest", "Sud-Est", "Parc", "Université", "Gare"
];

const STOP_NAMES = [
  "Bellevue", "Les Tilleuls", "La Roseraie", "Montfleury", "Les Acacias",
  "Saint-Roch", "La Prairie", "Beauséjour", "Les Platanes", "Val Fleuri",
  "Les Ormes", "La Fontaine", "Les Cèdres", "Petit-Moulin", "Les Vignes",
  "La Passerelle", "Saint-Clair", "Les Alouettes", "Le Clos", "La Verrière",
  "Les Marronniers", "La Colline", "Les Lilas", "Le Belvédère", "La Clairière",
  "Les Jardins", "Le Hameau", "La Source", "Les Érables", "Le Rivage"
];

const DEMAND_BASE = [1.7,1.2,1.25,1.35,1.4,.85,.95,.9,1,.8,1.1,1.65];

// V5.0 — city archetypes, in the same STOP_NAMES order:
// Centre, Nord, Sud, Ouest, Est, Nord-Ouest, Nord-Est, Sud-Ouest, Sud-Est, Parc, Université, Gare
// Residential weight (drives outbound trips as an origin).
const POP_BASE      = [0.9, 1.6, 1.5, 1.4, 1.3, 1.1, 1.0, 1.05, 1.0, 0.5, 0.6, 0.4];
// Workplace/study attraction (drives inbound trips at rush hour).
const JOBS_BASE      = [1.6, 0.5, 0.5, 0.6, 0.6, 0.5, 0.5, 0.45, 0.45, 0.3, 1.2, 1.7];
// Retail/leisure attraction (drives inbound trips off-peak).
const COMMERCE_BASE  = [1.5, 0.6, 0.6, 0.7, 0.7, 0.5, 0.5, 0.45, 0.45, 0.9, 0.7, 1.3];
// Fixed nominal district area (km²), used only to derive a density figure for display.
export const DISTRICT_AREA_KM2 = 3;

export function hashSeed(input) {
  const text = String(input ?? "ASTER");
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  rng.getState = () => a >>> 0;
  rng.setState = (next) => { a = Number(next) >>> 0; };
  return rng;
}

function jitter(rng, amount) {
  return (rng() - 0.5) * amount;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function randomStopName(rng, used, index) {
  const available = STOP_NAMES.filter(name => !used.has(name));
  const pool = available.length ? available : STOP_NAMES;
  const name = pool[Math.floor(rng() * pool.length)] || `Arrêt ${index + 1}`;
  used.add(name);
  return name;
}

export function createCity(seedInput) {
  const seed = String(seedInput || "TRANSPORT-2026").trim() || "TRANSPORT-2026";
  const numericSeed = hashSeed(seed);
  const rng = mulberry32(numericSeed);

  const positions = [];
  const minDistance = 105;
  for (let i = 0; i < 12; i++) {
    let point = null;
    for (let attempt = 0; attempt < 80 && !point; attempt++) {
      const candidate = {
        x: Math.round(90 + rng() * 820),
        y: Math.round(75 + rng() * 500)
      };
      if (positions.every(other => Math.hypot(candidate.x - other.x, candidate.y - other.y) >= minDistance)) {
        point = candidate;
      }
    }
    if (!point) {
      point = { x: Math.round(90 + rng() * 820), y: Math.round(75 + rng() * 500) };
    }
    positions.push(point);
  }

  const usedStopNames = new Set();
  const stops = positions.map(({ x, y }, i) => {
    const demand = clamp(DEMAND_BASE[i] * (0.88 + rng() * 0.24), 0.45, 2.4);
    return {
      id: `stop-${i + 1}`,
      name: randomStopName(rng, usedStopNames, i),
      x,
      y,
      demand: Number(demand.toFixed(2)),
      waiting: 0,
      waitingByDestination: {},
      districtId: `district-${i + 1}`
    };
  });

  const districts = stops.map((s, i) => ({
    id: `district-${i + 1}`,
    name: DISTRICT_NAMES[i],
    center: { x: s.x, y: s.y },
    populationFactor: Number((0.8 + rng() * 0.7).toFixed(2))
  }));

  // V5.0 — population / jobs / commerce, built in a separate pass so the
  // existing stop (x, y, demand) and district (populationFactor) generation
  // above is untouched: same seed still reproduces the same map/positions/
  // demand as V4.0, this only adds new attributes on top.
  // `populationFactor` existed since V2.1 but was never actually used
  // anywhere until now.
  stops.forEach((s, i) => {
    const factor = districts[i].populationFactor;
    s.population = Math.round(POP_BASE[i] * factor * (0.85 + rng() * 0.3) * 1800);
    s.jobs = Math.round(JOBS_BASE[i] * factor * (0.85 + rng() * 0.3) * 1400);
    s.commerce = Math.round(COMMERCE_BASE[i] * factor * (0.85 + rng() * 0.3) * 900);
    s.density = Math.round(s.population / DISTRICT_AREA_KM2);
    // V6.0: whether this stop has already produced a satellite district —
    // caps growth so the map can't spawn unboundedly from the same origin.
    s.hasSpawnedSatellite = false;
  });

  // V23 — la voirie est générée depuis la structure urbaine, pas depuis des
  // connexions aléatoires entre arrêts. Le cœur forme une petite colonne
  // continue d’artère ; les quartiers s’y accrochent par des secondaires,
  // puis par quelques boucles locales. Les arrêts restent des points de
  // desserte : une artère est marquée comme infrastructure de transit et ne
  // devient jamais une opportunité de placement d’arrêt.
  const roads = [];
  const roadKeys = new Set();
  const addRoad = (a, b, type = "local", extra = {}) => {
    if (a === b) return;
    const key = [a, b].sort().join("|");
    if (key === [stops[1].id, stops[2].id].sort().join("|")) return;
    if (roadKeys.has(key)) return;
    roadKeys.add(key);
    roads.push({ a, b, type, lanes: type === "arterial" ? 2 : 1,
      speed: type === "arterial" ? 1.35 : type === "secondary" ? 1.1 : 0.85,
      allowStops: type !== "arterial", built: false, ...extra });
  };
  // Deux corridors continus autour du centre, prolongés par la croissance.
  addRoad(stops[1].id, stops[0].id, "arterial", { corridorId: "north-south" });
  addRoad(stops[0].id, stops[2].id, "arterial", { corridorId: "north-south" });
  // Chaque nouveau quartier se branche au quartier déjà le plus proche. La
  // hiérarchie est stable pour une seed donnée et ne crée pas d’artères en
  // cascade.
  for (let i = 3; i < stops.length; i++) {
    const child = stops[i];
    const parent = stops.slice(0, i).reduce((best, candidate) =>
      Math.hypot(candidate.x - child.x, candidate.y - child.y) <
      Math.hypot(best.x - child.x, best.y - child.y) ? candidate : best);
    addRoad(parent.id, child.id, i % 3 === 0 ? "secondary" : "local");
  }
  // Boucle de rabattement : le premier axe reste fermable sans isoler la ville.
  if (stops.length > 3) {
    addRoad(stops[1].id, stops[3].id, "secondary", { corridorId: "north-south-feeder" });
    addRoad(stops[2].id, stops[3].id, "local");
  }
  // Une seule liaison secondaire par côté complète les quartiers sans
  // multiplier les croisements d’artères.
  const byX = stops.slice(3).slice().sort((a, b) => a.x - b.x);
  for (let i = 1; i < byX.length; i += 3) addRoad(byX[i - 1].id, byX[i].id, "secondary");

  return {
    id: `city-${numericSeed.toString(16)}`,
    name: `Ville ${seed}`,
    seed,
    numericSeed,
    width: 1000,
    height: 650,
    districts,
    stops,
    roads,
    // Réseaux distincts : le tram peut être tracé hors voirie, comme le métro.
    tramTracks: [],
    junctions: [],
    corridors: [
      { id: "north-south", type: "arterial", axis: "y", stopIds: [stops[1].id, stops[0].id, stops[2].id] }
    ],
    generatedAt: new Date().toISOString()
  };
}

// V6.0 — urban evolution: a well-served, populous stop can spawn a new
// satellite district connected to it by a road. Pure city-layer mutation:
// no dependency on network/lines (kept in growth.js, which orchestrates
// this together with the live network graph).
export function addSatelliteStop(city, parent, rng) {
  const angle = rng() * Math.PI * 2;
  const dist = 120 + rng() * 100;
  const x = Math.round(clamp(parent.x + Math.cos(angle) * dist, 70, 930));
  const y = Math.round(clamp(parent.y + Math.sin(angle) * dist, 60, 590));

  const index = city.stops.length;
  const stop = {
    id: `stop-${index + 1}`,
    name: randomStopName(rng, new Set(city.stops.map(s => s.name)), index),
    x, y,
    demand: parent.demand, // legacy field, kept for structural consistency; unused by the engine
    waiting: 0,
    waitingByDestination: {},
    districtId: `district-${index + 1}`,
    population: Math.round(parent.population * 0.25),
    jobs: Math.round(parent.jobs * 0.15),
    commerce: Math.round(parent.commerce * 0.2),
    density: 0,
    hasSpawnedSatellite: false
  };
  stop.density = Math.round(stop.population / DISTRICT_AREA_KM2);

  const parentDistrict = city.districts.find(d => d.id === parent.districtId);
  city.districts.push({
    id: stop.districtId,
    name: stop.name,
    center: { x: stop.x, y: stop.y },
    populationFactor: parentDistrict?.populationFactor ?? 1
  });

  city.roads.push({ a: parent.id, b: stop.id, type: "secondary", lanes: 1,
    speed: 1.1, allowStops: true, built: false, extensionOf: parent.id });
  city.stops.push(stop);
  return stop;
}

export function createSeedFromQuery() {
  try {
    const params = new URLSearchParams(location.search);
    return params.get("seed") || "TRANSPORT-2026";
  } catch {
    return "TRANSPORT-2026";
  }
}
