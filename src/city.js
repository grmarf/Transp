const DISTRICT_BASE_NAMES = [
  "Centre", "Nord", "Sud", "Ouest", "Est", "Nord-Ouest",
  "Nord-Est", "Sud-Ouest", "Sud-Est", "Parc", "Université", "Gare"
];
const DISTRICT_PREFIXES = [
  "Grand", "Petit", "Vieux", "Nouveau", "Haut", "Bas", "Bel", "Sainte",
  "Saint", "Long", "Doux", "Clair", "Vert", "Royal", "Central", "Rive",
  "Pont", "Mont", "Val", "Bois", "Clos", "Champ", "Côte", "Bourg",
  "Port", "Lac", "Plaine", "Jardin", "Roc", "Belle"
];
const DISTRICT_NAMES = [
  ...DISTRICT_BASE_NAMES,
  ...DISTRICT_PREFIXES.flatMap(prefix => DISTRICT_BASE_NAMES.map(name => `${prefix} ${name}`))
];

const STOP_BASE_NAMES = [
  "Bellevue", "Les Tilleuls", "La Roseraie", "Montfleury", "Les Acacias",
  "Saint-Roch", "La Prairie", "Beauséjour", "Les Platanes", "Val Fleuri",
  "Les Ormes", "La Fontaine", "Les Cèdres", "Petit-Moulin", "Les Vignes",
  "La Passerelle", "Saint-Clair", "Les Alouettes", "Le Clos", "La Verrière",
  "Les Marronniers", "La Colline", "Les Lilas", "Le Belvédère", "La Clairière",
  "Les Jardins", "Le Hameau", "La Source", "Les Érables", "Le Rivage"
];
const STOP_PREFIXES = [
  "Belle", "Grand", "Petit", "Vieux", "Nouveau", "Haut", "Bas", "Saint",
  "Sainte", "Clair", "Vert", "Doux", "Joli", "Long", "Mont", "Val",
  "Bois", "Rive", "Pont", "Port", "Lac", "Plaine", "Champ", "Côte",
  "Clos", "Jardin", "Roc", "Aube", "Étoile", "Horizon"
];
const STOP_SUFFIXES = [
  "des Fleurs", "des Pins", "des Sources", "du Moulin", "du Parc", "du Pont",
  "des Vignes", "de la Gare", "du Lac", "des Prés", "des Peupliers", "des Roses",
  "du Château", "des Écoles", "du Marché", "des Hirondelles", "du Verger", "de la Plaine",
  "des Lumières", "du Canal", "des Oliviers", "du Belvédère", "des Artisans", "de la Rivière",
  "du Coteau", "des Érables", "de la Fontaine", "des Jardins", "du Levant", "des Acacias"
];
// 30 noms historiques + 30 × 30 combinaisons = 930 possibilités.
const STOP_NAMES = [
  ...STOP_BASE_NAMES,
  ...STOP_PREFIXES.flatMap(prefix => STOP_SUFFIXES.map(suffix => `${prefix} ${suffix}`))
];
export const STOP_NAME_CATALOG_SIZE = STOP_NAMES.length;
export const DISTRICT_NAME_CATALOG_SIZE = DISTRICT_NAMES.length;

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
export function averageStopSpacing(stops) {
  if (!Array.isArray(stops) || stops.length < 2) return 105;
  let total = 0;
  for (const stop of stops) {
    let nearest = Infinity;
    for (const other of stops) {
      if (other === stop) continue;
      nearest = Math.min(nearest, Math.hypot(stop.x - other.x, stop.y - other.y));
    }
    total += nearest;
  }
  return total / stops.length;
}

function randomStopName(rng, used, index) {
  const available = STOP_NAMES.filter(name => !used.has(name));
  const pool = available.length ? available : STOP_NAMES;
  const name = pool[Math.floor(rng() * pool.length)] || `Arrêt ${index + 1}`;
  used.add(name);
  return name;
}
function roadDegree(roads, stopId) {
  return roads.reduce((degree, road) => degree + ((road.a === stopId || road.b === stopId) ? 1 : 0), 0);
}
function nearestThreeStops(stop, stops, roads = null) {
  return stops
    .filter(other => other.id !== stop.id)
    .filter(other => !roads || (roadDegree(roads, other.id) < 3 && roadDegree(roads, stop.id) < 3))
    .sort((a, b) => Math.hypot(stop.x - a.x, stop.y - a.y) - Math.hypot(stop.x - b.x, stop.y - b.y))
    .slice(0, 3);
}
function chooseRoadParents(stop, availableStops, rng, roads = null) {
  const nearest = nearestThreeStops(stop, availableStops, roads);
  if (!nearest.length) return [];
  // Le premier raccordement est tiré parmi les trois voisins les plus
  // proches. Une seconde liaison apparaît parfois, mais reste dans ce même
  // voisinage pour limiter les croisements et les longues diagonales.
  const primary = nearest[Math.floor(rng() * nearest.length)];
  const parents = [primary];
  if (nearest.length > 1 && rng() < 0.35) {
    const alternatives = nearest.filter(candidate => candidate.id !== primary.id);
    parents.push(alternatives[Math.floor(rng() * alternatives.length)]);
  }
  return parents;
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

  const initialStopSpacing = averageStopSpacing(stops);
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
    // Indicateur historique conservé pour les sauvegardes : la croissance
    // moderne n’impose plus de plafond par quartier.
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
    if (roadDegree(roads, a) >= 3 || roadDegree(roads, b) >= 3) return;
    roadKeys.add(key);
    roads.push({ a, b, type, lanes: type === "arterial" ? 2 : 1,
      speed: type === "arterial" ? 1.35 : type === "secondary" ? 1.1 : 0.85,
      allowStops: type !== "arterial", built: false, ...extra });
  };
  // Deux corridors continus autour du centre, prolongés par la croissance.
  addRoad(stops[1].id, stops[0].id, "arterial", { corridorId: "north-south" });
  addRoad(stops[0].id, stops[2].id, "arterial", { corridorId: "north-south" });
  // Chaque quartier se branche aléatoirement à l’un des trois arrêts les
  // plus proches. Une seconde liaison facultative reste limitée à ces trois
  // voisins, ce qui conserve la connectivité tout en réduisant les croisements.
  for (let i = 3; i < stops.length; i++) {
    const child = stops[i];
    const parents = chooseRoadParents(child, stops.slice(0, i), rng, roads);
    parents.forEach((parent, linkIndex) => {
      addRoad(parent.id, child.id, linkIndex === 0 ? "secondary" : "local");
    });
  }

  // Une carte entièrement arborescente ne permettrait aucune fermeture de
  // route sans isoler un quartier. Si le tirage aléatoire n’a produit aucune
  // seconde liaison, on crée une boucle de secours, toujours vers l’un des
  // trois voisins les plus proches.
  if (roads.length === stops.length - 1 && stops.length > 3) {
    const child = stops[3];
    const existingParents = new Set(roads
      .filter(road => road.a === child.id || road.b === child.id)
      .map(road => road.a === child.id ? road.b : road.a));
    const backupParent = nearestThreeStops(child, stops.slice(0, 3), roads)
      .find(candidate => !existingParents.has(candidate.id));
    if (backupParent) addRoad(backupParent.id, child.id, "local");
  }

  return {
    id: `city-${numericSeed.toString(16)}`,
    name: `Ville ${stops[0].name}`,
    seed,
    numericSeed,
    width: 1000,
    height: 650,
    // Référence immuable : les quartiers futurs doivent respecter au moins
    // cet espacement moyen local observé sur la carte initiale.
    initialStopSpacing,
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
  const minDistance = Math.max(105, Number(city.initialStopSpacing) || averageStopSpacing(city.stops));
  const existing = city.stops;
  let point = null;
  // On tente plusieurs anneaux autour du parent. Chaque position est
  // validée contre TOUS les arrêts existants : aucun quartier ne peut donc
  // apparaître dans le tissu déjà occupé. Les anneaux supplémentaires
  // poussent naturellement l’expansion vers la périphérie.
  for (let ring = 0; ring < 12 && !point; ring++) {
    const radius = minDistance * (1.08 + ring * 0.38 + rng() * 0.24);
    const samples = 24 + ring * 4;
    const offset = rng() * Math.PI * 2;
    for (let sample = 0; sample < samples && !point; sample++) {
      const angle = offset + (sample / samples) * Math.PI * 2;
      const candidate = {
        x: Math.round(Math.max(40, parent.x + Math.cos(angle) * radius)),
        y: Math.round(Math.max(40, parent.y + Math.sin(angle) * radius))
      };
      if (existing.every(stop => Math.hypot(candidate.x - stop.x, candidate.y - stop.y) >= minDistance)) {
        point = candidate;
      }
    }
  }
  // À une échelle extrême, une recherche en spirale garantit quand même la
  // règle de distance au lieu de créer un arrêt trop proche par repli.
  if (!point) {
    let radius = minDistance * 6;
    while (!point) {
      const candidate = { x: Math.round(parent.x + radius), y: Math.round(Math.max(40, parent.y)) };
      if (existing.every(stop => Math.hypot(candidate.x - stop.x, candidate.y - stop.y) >= minDistance)) point = candidate;
      radius += minDistance;
    }
  }
  const { x, y } = point;
  city.width = Math.max(Number(city.width) || 1000, x + 120);
  city.height = Math.max(Number(city.height) || 650, y + 120);

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

  const parents = chooseRoadParents(stop, city.stops, rng, city.roads);
  // Le parent historique reste un filet de sécurité pour les anciennes
  // sauvegardes ou cartes atypiques, mais la règle normale passe bien par les
  // trois voisins les plus proches.
  const roadParents = parents.length
    ? parents
    : (roadDegree(city.roads, parent.id) < 3 ? [parent] : []);
  roadParents.forEach((roadParent, linkIndex) => {
    if (roadDegree(city.roads, roadParent.id) >= 3) return;
    city.roads.push({ a: roadParent.id, b: stop.id, type: linkIndex === 0 ? "secondary" : "local",
      lanes: 1, speed: linkIndex === 0 ? 1.1 : 0.85, allowStops: true, built: false,
      extensionOf: roadParent.id });
  });
  stop.roadParentIds = roadParents.map(roadParent => roadParent.id);
  city.stops.push(stop);
  return stop;
}

export function createSeedFromQuery() {
  try {
    const params = new URLSearchParams(location.search);
    const requested = params.get("seed");
    if (requested) return requested;
    return String(Math.floor(100000000 + Math.random() * 900000000));
  } catch {
    return String(Math.floor(100000000 + Math.random() * 900000000));
  }
}
