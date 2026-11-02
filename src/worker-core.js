/** V31 — Cœur d'avance rapide, partagé entre le Web Worker et le repli
 * synchrone. Pur et headless : importable dans Node (tests) comme dans le
 * navigateur. Simule `ticks` pas moteur à vitesse 1, en restaurant
 * exactement les drapeaux paused/speed du joueur autour de la simulation.
 */
import { mulberry32 } from "./city.js";
import { step } from "./engine.js";

export function fastForwardState(state, seed, ticks) {
  if (!state) throw new Error("fastForwardState : état manquant");
  const rng = mulberry32((seed >>> 0) || 1);
  const wasPaused = state.paused;
  const wasSpeed = state.speed;
  // La simulation tourne toujours à vitesse 1, non suspendue : l'avance
  // rapide simule un nombre de ticks précis, indépendamment des réglages.
  state.paused = false;
  state.speed = 1;
  const now = (typeof Date !== "undefined" && Date.now) ? Date.now : function () { return 0; };
  const t0 = now();
  for (let i = 0; i < ticks; i++) step(state, rng, function () {});
  const ms = now() - t0;
  state.paused = wasPaused;
  state.speed = wasSpeed;
  // V47 — l'état final du générateur est renvoyé : le fil principal peut
  // poursuivre le flux au lieu de redémarrer le sien après chaque avance.
  return { state, ticks, ms, rngState: rng.getState() };
}
