/** V31 — Web Worker : simule des pas moteur hors du fil principal pour que
 * l'interface reste fluide pendant une avance rapide. Le module reste
 * importable hors navigateur (les tests Node le chargent) : le branchement à
 * `self` est gardé par typeof. Protocole : { type: "fastForward", state,
 * seed, ticks } -> { type: "done", state, ticks, ms, rngState } ou
 * { type: "error" }. */
import { fastForwardState } from "./worker-core.js";

if (typeof self !== "undefined" && typeof self.onmessage !== "undefined" && typeof self.postMessage === "function") {
  self.onmessage = function (event) {
    const msg = event && event.data ? event.data : {};
    if (msg.type !== "fastForward") return;
    try {
      const result = fastForwardState(msg.state, msg.seed || 1, msg.ticks || 1);
      self.postMessage({ type: "done", state: result.state, ticks: result.ticks, ms: result.ms, rngState: result.rngState });
    } catch (error) {
      self.postMessage({ type: "error", message: String(error && error.message ? error.message : error) });
    }
  };
}
