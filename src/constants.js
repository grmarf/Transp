/** V3.0 — shared constants.
 * Extracted from engine.js so vehicles.js can use TICK_MINUTES (for headway/
 * frequency math) without creating an engine.js <-> vehicles.js import cycle.
 */
export const TICK_MINUTES = 10;
export const STOP_RADIUS = 10;

// V6.0 — moved from engine.js: network.js needs `distance` (for edge
// weights) and, with growth.js now sitting between engine.js and
// network.js, an engine.js import here would create an import cycle
// (engine -> growth -> network -> engine). Living here instead matches the
// project's own City -> Network -> ... layering: network.js no longer
// depends upward on engine.js at all.
export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
