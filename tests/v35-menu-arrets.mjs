// V35 — page Arrêts du menu en cascade : une seule ligne, taps réactifs.
// Régression joueur (mobile) : la croix ✕ occupait toute une ligne
// au-dessus des boutons d'arrêts, et « impossible de se servir des
// boutons, on dirait qu'ils ne réagissent pas ». Ce test rejoue le
// parcours RÉEL en viewport mobile 412×915 : taps via
// Input.dispatchTouchEvent (chaîne pointer + click complète, comme un
// doigt), armement STABLE de l'outil (pas de toggle-off par click
// retargeté sur un bouton reconstruit), construction d'un arrêt puis
// démolition d'un arrêt INITIAL non desservi (bonus V35).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const port = 18700 + (process.pid % 1000);
const debugPort = port + 1;
const url = `http://127.0.0.1:${port}/`;
const profile = await mkdtemp(join(tmpdir(), 'transp-arrets-'));

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const browser = spawn('chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(label, fetcher, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await fetcher();
      if (value) return value;
      lastError = new Error('condition non remplie');
    } catch (error) { lastError = error; }
    await sleep(150);
  }
  throw new Error(`Délai dépassé : ${label} (${lastError ? lastError.message : ''})`);
}

let socket = null;
let nextId = 1;
const pending = new Map();
const consoleErrors = [];
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) {
    throw new Error('Erreur JS page : ' + (response.exceptionDetails?.exception?.description || response.exceptionDetails.text));
  }
  return response.result?.value;
}
async function touch(x, y) {
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await sleep(60);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const btnCenter = (label) => `(() => { const b = [...document.querySelectorAll("#mapMenu .map-menu-page:not([hidden]) button")].find((x) => x.textContent.includes(${JSON.stringify(label)})); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`;

try {
  await waitFor('serveur HTTP prêt', async () => (await fetch(url)).ok);
  const target = await waitFor('cible CDP', async () => {
    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    return pages.find((item) => item.type === 'page');
  });
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        consoleErrors.push('exception : ' + (message.params.exceptionDetails?.exception?.description || '').slice(0, 200));
      }
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        const text = message.params.entry.text || '';
        // le retour haptique est optionnel : Chromium le refuse hors
        // interaction utilisateur sans que ce soit une régression.
        if (!text.includes('vibrate')) consoleErrors.push('log : ' + text.slice(0, 200));
      }
    });
  });
  await cdp('Runtime.enable');
  await cdp('Log.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxPoints: 2 });
  await cdp('Page.navigate', { url });
  await waitFor('jeu initialisé', () => evaluate('Boolean(window.__vieTLignes && window.__vieTLignes.getState && document.querySelector("#map"))'));
  await sleep(500); // premier rendu du menu (différé d'une frame) + recadrage

  // --- 1. La racine tient sur UNE ligne (4 boutons, mêmes tops) ----------
  const stdTopsRaw = await evaluate('[...document.querySelectorAll("#mapMenu .map-menu-page:not([hidden]) button")].map((b) => Math.round(b.getBoundingClientRect().top))');
  assert.equal(stdTopsRaw.length, 4, 'std : 4 boutons attendus, tops=' + JSON.stringify(stdTopsRaw));
  assert.equal(new Set(stdTopsRaw).size, 1, 'std : les boutons tiennent sur une seule ligne, tops=' + JSON.stringify(stdTopsRaw));

  // --- 2. Tap réel sur « 🚏 Arrêts ▸ » → page Arrêts ---------------------
  let target2 = await waitFor('bouton Arrêts visible', () => evaluate(btnCenter('Arrêts')));
  await touch(target2.x, target2.y);
  await waitFor('page arrets ouverte', () => evaluate('Boolean([...document.querySelectorAll("#mapMenu .map-menu-page:not([hidden]) button")].some((b) => b.textContent.includes("Construire")))'));
  const pageTops = await evaluate('[...document.querySelectorAll("#mapMenu .map-menu-page:not([hidden]) button")].map((b) => Math.round(b.getBoundingClientRect().top))');
  assert.equal(pageTops.length, 4, 'page arrets : ✕ + 3 actions, tops=' + JSON.stringify(pageTops));
  assert.equal(new Set(pageTops).size, 1, 'page arrets : ✕ et les 3 actions sur la MÊME ligne, tops=' + JSON.stringify(pageTops));

  // --- 3. Tap réel sur « ➕ Construire » : armement STABLE ----------------
  const buildBtn = await waitFor('bouton Construire visible', () => evaluate(btnCenter('Construire')));
  const stopsBefore = await evaluate('window.__vieTLignes.getState().city.stops.length');
  await touch(buildBtn.x, buildBtn.y);
  await waitFor('outil arrêt armé', () => evaluate('window.__vieTLignes.getState().stopToolMode === "build"'), 5000)
    .catch(() => { throw new Error('tap réel sur ➕ Construire : outil NON armé — le bouton ne réagit pas'); });
  await sleep(500); // un click retargeté sur un bouton reconstruit désarmerait ici
  assert.equal(await evaluate('window.__vieTLignes.getState().stopToolMode'), 'build',
    'armement stable : pas de désarmement immédiat (double invocation)');

  // --- 4. Tap réel sur la carte : l'arrêt est construit -------------------
  const spot = await evaluate(`(() => {
    const st = window.__vieTLignes.getState();
    const cam = window.__vieTLignes.cameraState;
    const el = document.querySelector("#map");
    const rect = el.getBoundingClientRect();
    let far = null;
    outer: for (let y = 60; y <= 580; y += 20) {
      for (let x = 60; x <= 930; x += 20) {
        let ok = true;
        for (const s of st.city.stops) { if (Math.hypot(s.x - x, s.y - y) < 160) { ok = false; break; } }
        if (!ok) continue;
        const sx = (x - cam.x) * cam.zoom + rect.width / 2 + rect.left;
        const sy = (y - cam.y) * cam.zoom + rect.height / 2 + rect.top;
        if (sx < rect.left + 6 || sx > rect.right - 6 || sy < rect.top + 6 || sy > rect.bottom - 6) continue;
        const hit = document.elementFromPoint(sx, sy);
        if (!hit || hit.id !== "map") continue;
        far = { sx, sy }; break outer;
      }
    }
    return far;
  })()`);
  assert.ok(spot, 'une position libre atteignable existe (tous overlays exclus)');
  await touch(spot.sx, spot.sy);
  await waitFor('arrêt construit', () => evaluate(`window.__vieTLignes.getState().city.stops.length > ${stopsBefore}`));
  const built = await evaluate('(() => { const st = window.__vieTLignes.getState(); const s = st.city.stops[st.city.stops.length - 1]; return { by: s.builtByPlayer === true, mode: st.stopToolMode }; })()');
  assert.ok(built.by, 'arrêt construit marqué builtByPlayer');
  assert.equal(built.mode, null, 'outil désarmé après la pose');

  // --- 5. Tap réel sur « ➖ Supprimer » → arrêt INITIAL démoli -------------
  const demolishBtn = await waitFor('bouton Supprimer visible', () => evaluate(btnCenter('Supprimer')));
  await touch(demolishBtn.x, demolishBtn.y);
  await waitFor('outil suppression armé', () => evaluate('window.__vieTLignes.getState().stopToolMode === "demolish"'), 5000)
    .catch(() => { throw new Error('tap réel sur ➖ Supprimer : outil NON armé — le bouton ne réagit pas'); });
  const initStop = await evaluate(`(() => {
    const st = window.__vieTLignes.getState();
    const cam = window.__vieTLignes.cameraState;
    const rect = document.querySelector("#map").getBoundingClientRect();
    const cand = st.city.stops.filter((s) => !s.builtByPlayer && !(st.lines || []).some((l) => (l.stopIds || []).includes(s.id)));
    for (const s of cand) {
      const sx = (s.x - cam.x) * cam.zoom + rect.width / 2 + rect.left;
      const sy = (s.y - cam.y) * cam.zoom + rect.height / 2 + rect.top;
      if (sx < rect.left + 8 || sx > rect.right - 8 || sy < rect.top + 8 || sy > rect.bottom - 8) continue;
      const hit = document.elementFromPoint(sx, sy);
      if (!hit || hit.id !== "map") continue;
      return { id: s.id, sx, sy };
    }
    return null;
  })()`);
  assert.ok(initStop, 'un arrêt initial non desservi est visible sur la carte');
  await touch(initStop.sx, initStop.sy);
  await waitFor('arrêt initial démoli', () => evaluate(`!window.__vieTLignes.getState().city.stops.some((s) => s.id === ${JSON.stringify(initStop.id)})`), 5000)
    .catch(() => { throw new Error('arrêt initial non supprimé : ' + initStop.id); });

  // --- 6. La croix ✕ bascule instantanément vers la racine ----------------
  const cross1 = await waitFor('croix visible (page arrets)', () => evaluate(btnCenter('✕')));
  await touch(cross1.x, cross1.y);
  await waitFor('croix : retour std', () => evaluate('Boolean([...document.querySelectorAll(' + String.fromCharCode(34) + '#mapMenu .map-menu-page:not([hidden]) button' + String.fromCharCode(34) + ')].some((b) => b.textContent.includes("Voirie")))'));
  assert.equal(await evaluate('Boolean([...document.querySelectorAll(' + String.fromCharCode(34) + '#mapMenu .map-menu-page:not([hidden]) button' + String.fromCharCode(34) + ')].some((b) => b.textContent.includes("Construire")))'), false,
    'la croix a bien quitté la page Arrêts');
  // retour sur Arrêts, armement, puis ✕ : l'outil reste armé (la racine surligne la branche)
  const arrets2 = await waitFor('bouton Arrêts re-visible', () => evaluate(btnCenter('Arrêts')));
  await touch(arrets2.x, arrets2.y);
  await waitFor('page arrets rouverte', () => evaluate(btnCenter('Construire')));
  const build2 = await evaluate(btnCenter('Construire'));
  await touch(build2.x, build2.y);
  await waitFor('outil ré-armé', () => evaluate('window.__vieTLignes.getState().stopToolMode === "build"'), 5000);
  const cross2 = await waitFor('croix re-visible', () => evaluate(btnCenter('✕')));
  await touch(cross2.x, cross2.y);
  await waitFor('croix : retour std (2)', () => evaluate('Boolean([...document.querySelectorAll(' + String.fromCharCode(34) + '#mapMenu .map-menu-page:not([hidden]) button' + String.fromCharCode(34) + ')].some((b) => b.textContent.includes("Voirie")))'));
  assert.equal(await evaluate('window.__vieTLignes.getState().stopToolMode'), 'build',
    '✕ ne désarme pas l\'outil : la racine surligne la branche armée');

  assert.equal(consoleErrors.length, 0, 'erreurs navigateur : ' + consoleErrors.join(' ; ').slice(0, 200));
  console.log(JSON.stringify({ ok: true, suite: 'v35-menu-arrets' }));
} finally {
  socket?.close();
  if (browser.exitCode === null) { browser.kill('SIGTERM'); await sleep(500); }
  if (browser.exitCode === null) browser.kill('SIGKILL');
  server.kill('SIGTERM');
  try { await rm(profile, { recursive: true, force: true }); } catch (error) {}
}
