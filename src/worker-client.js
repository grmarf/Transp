/** V31 — Client du Web Worker d'avance rapide, côté fil principal. Les deux
 * chemins aboutissent au même contrat : onDone(result, mode) appelé
 * exactement une fois, mode valant "worker" (arrière-plan) ou "sync" (repli
 * synchrone — Worker indisponible, erreur de module, ou état non clonable).
 * En cas d'échec du worker, l'état du fil principal n'a jamais été touché :
 * le repli synchrone repart de l'original, sans double application. */
import { fastForwardState } from "./worker-core.js";

export function workerSupported() {
  return typeof Worker !== "undefined";
}

export function fastForwardDay(state, seed, ticks, onDone) {
  if (typeof onDone !== "function") throw new Error("fastForwardDay : rappel manquant");
  if (!workerSupported()) {
    onDone(fastForwardState(state, seed, ticks), "sync");
    return "sync";
  }
  let settled = false;
  let worker = null;
  const fallback = function () {
    if (settled) return;
    settled = true;
    if (worker) worker.terminate();
    onDone(fastForwardState(state, seed, ticks), "sync");
  };
  try {
    worker = new Worker("./engine-worker.js", { type: "module" });
    worker.onmessage = function (event) {
      const msg = event && event.data ? event.data : {};
      if (msg.type === "done" && !settled) {
        settled = true;
        worker.terminate();
        onDone(msg, "worker");
      } else if (msg.type === "error") {
        fallback();
      }
    };
    worker.onerror = fallback;
    worker.onmessageerror = fallback;
    worker.postMessage({ type: "fastForward", state, seed, ticks });
    return "worker";
  } catch (error) {
    fallback();
    return "sync";
  }
}
