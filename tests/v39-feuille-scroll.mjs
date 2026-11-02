// V39 — Feuille du tableau de bord défilante au doigt + taps robustes.
// Régressions joueur (mobile Samsung) : « impossible de descendre dans le
// menu » (le tableau de bord plein écran, contenu coupé sous « Modifier »)
// et « Terminer ne fonctionne pas toujours ». Ce test rejoue en viewport
// mobile réel (360×740, tactile) : ouverture de la feuille, VRAI SWIPE qui
// doit la faire défiler, fermeture, création d'une ligne terminée par un
// TAP DÉRIVÉ (dérapage de 12 px) sur ✅ Terminer, et scroll du panneau
// en cascade.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const port = 19200 + (process.pid % 1000);
const debugPort = port + 1;
const url = `http://127.0.0.1:${port}/`;
const profile = await mkdtemp(join(tmpdir(), 'transp-v39-'));

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
// Vrai glissé de doigt : 8 touchMove espacés — le navigateur doit confier
// le geste au conteneur défilable sous le doigt.
async function swipe(x, y, dx, dy) {
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let i = 1; i <= 8; i++) {
    await sleep(16);
    await cdp('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (dx * i) / 8, y: y + (dy * i) / 8, id: 1 }]
    });
  }
  await sleep(40);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
// Tap réel légèrement dérivé : le doigt glisse de 12 px pendant la touche.
async function driftTap(x, y) {
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await sleep(30);
  await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 12, y: y + 6, id: 1 }] });
  await sleep(30);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const btnCenter = (label) => `(() => { const b = [...document.querySelectorAll("#mapMenu .map-menu-page:not([hidden]) button")].find((x) => x.textContent.includes(${JSON.stringify(label)})); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`;
const visibleHas = (label) => `Boolean([...document.querySelectorAll("#mapMenu .map-menu-page:not([hidden]) button")].some((b) => b.textContent.includes(${JSON.stringify(label)})))`;
const finishCenter = '(() => { const b = document.getElementById("finishLineBtn"); if (!b || b.hidden || b.disabled) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()';
const stateDiag = () => `(() => { const st = window.__vieTLignes.getState(); const f = document.getElementById("finishLineBtn"); const body = document.querySelector(".dashboard-body"); const cs = body ? getComputedStyle(body) : null; return JSON.stringify({ lineMode: st.lineMode, pending: (st.pendingStops || []).length, lines: (st.lines || []).length, overflowY: cs ? cs.overflowY : null, touchAction: cs ? cs.touchAction : null, sheetOpen: document.body.classList.contains("sheet-open"), logs: (st.logs || []).slice(0, 4) }); })()`;
const sheetDiag = () => `(() => { const b = document.querySelector(".dashboard-body"); if (!b) return "body absent"; const cs = getComputedStyle(b); return JSON.stringify({ overflowY: cs.overflowY, touchAction: cs.touchAction, overscroll: cs.overscrollBehaviorY, delta: b.scrollHeight - b.clientHeight, scrollTop: b.scrollTop, docScroll: document.scrollingElement.scrollTop }); })()`;

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
        if (!text.includes('vibrate')) consoleErrors.push('log : ' + text.slice(0, 200));
      }
    });
  });
  await cdp('Runtime.enable');
  await cdp('Log.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 2, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxPoints: 2 });
  await cdp('Page.navigate', { url });
  await waitFor('jeu initialisé', () => evaluate('Boolean(window.__vieTLignes && window.__vieTLignes.getState && document.querySelector("#map"))'));
  await sleep(500);

  // ---- A. Ouvrir la feuille (le « menu » des captures) ----------------
  const handle = await waitFor('poignée du tableau de bord', () => evaluate('(() => { const h = document.getElementById("sheetHandle"); if (!h) return null; const r = h.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()'));
  await touch(handle.x, handle.y);
  await waitFor('feuille ouverte', () => evaluate('document.body.classList.contains("sheet-open") && document.querySelector(".dashboard").classList.contains("sheet-open")'))
    .catch(async function () { throw new Error('OUVERTURE INERTE st=' + (await evaluate(stateDiag()))); });
  const sheetCss = await evaluate('(() => { const b = document.querySelector(".dashboard-body"); const cs = getComputedStyle(b); return { overflowY: cs.overflowY, touchAction: cs.touchAction, overscroll: cs.overscrollBehaviorY }; })()');
  assert.equal(sheetCss.overflowY, 'auto', 'corps de feuille scrollable (overflow-y auto)');
  assert.equal(sheetCss.touchAction, 'pan-y', 'geste vertical attribué au panneau (pan-y)');
  // Garantir un contenu plus haut que l'écran (comme chez le joueur) :
  const forced = await evaluate('(() => { const b = document.querySelector(".dashboard-body"); if (b.scrollHeight - b.clientHeight >= 60) return false; b.style.paddingBottom = "600px"; return true; })()');

  // ---- B. VRAI SWIPE : la feuille doit défiler au doigt ----------------
  async function swipeSheet() {
    const before = await evaluate('document.querySelector(".dashboard-body").scrollTop');
    await swipe(180, 620, 0, -240);
    await sleep(250);
    return await evaluate('document.querySelector(".dashboard-body").scrollTop') - before;
  }
  let moved = await swipeSheet();
  if (moved < 25) moved = await swipeSheet(); // une seule relance
  assert.ok(moved >= 25, 'SWIPE FEUILLE SANS DÉFILEMENT moved=' + moved + ' css=' + (await evaluate(sheetDiag())) + ' doc=' + (await evaluate('document.scrollingElement.scrollTop')));
  if (forced) await evaluate('document.querySelector(".dashboard-body").style.paddingBottom = ""');

  // ---- C. Fermer la feuille -------------------------------------------
  const closeHandle = await evaluate('(() => { const h = document.getElementById("sheetHandle"); const r = h.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()');
  await touch(closeHandle.x, closeHandle.y);
  await waitFor('feuille fermée', () => evaluate('!document.body.classList.contains("sheet-open")'))
    .catch(async function () { throw new Error('FERMETURE INERTE st=' + (await evaluate(stateDiag()))); });

  // ---- D. Ligne terminée par un TAP DÉRIVÉ sur ✅ Terminer -----------
  const ligneBtn = await waitFor('bouton Ligne visible', () => evaluate(btnCenter('Ligne')));
  await touch(ligneBtn.x, ligneBtn.y);
  await waitFor('page ligne ouverte', () => evaluate(visibleHas('Nouvelle ligne')));
  const newLineBtn = await waitFor('bouton Nouvelle ligne visible', () => evaluate(btnCenter('Nouvelle ligne')));
  await touch(newLineBtn.x, newLineBtn.y);
  await waitFor('mode création armé', () => evaluate('window.__vieTLignes.getState().lineMode === true'), 5000)
    .catch(async function () { throw new Error('NOUVELLE LIGNE INERTE st=' + (await evaluate(stateDiag()))); });
  const stopSpots = await waitFor('2 arrêts visibles sur la carte', () => evaluate(`(() => {
    const st = window.__vieTLignes.getState();
    const cam = window.__vieTLignes.cameraState;
    const rect = document.querySelector("#map").getBoundingClientRect();
    const pts = [];
    for (const s of st.city.stops) {
      const sx = (s.x - cam.x) * cam.zoom + rect.width / 2 + rect.left;
      const sy = (s.y - cam.y) * cam.zoom + rect.height / 2 + rect.top;
      if (sx < rect.left + 10 || sx > rect.right - 10 || sy < rect.top + 10 || sy > rect.bottom - 10) continue;
      const hit = document.elementFromPoint(sx, sy);
      if (!hit || hit.id !== "map") continue;
      pts.push({ id: s.id, sx, sy });
      if (pts.length >= 2) break;
    }
    return pts.length >= 2 ? pts : null;
  })()`));
  await touch(stopSpots[0].sx, stopSpots[0].sy);
  await waitFor('premier arrêt posé', () => evaluate('window.__vieTLignes.getState().pendingStops.length >= 1'), 5000)
    .catch(async function () { throw new Error('TAP ARRêT 1 SANS EFFET st=' + (await evaluate(stateDiag()))); });
  await touch(stopSpots[1].sx, stopSpots[1].sy);
  await waitFor('deux arrêts posés', () => evaluate('window.__vieTLignes.getState().pendingStops.length >= 2'), 5000)
    .catch(async function () { throw new Error('TAP ARRêT 2 SANS EFFET st=' + (await evaluate(stateDiag()))); });
  const finishSpot = await waitFor('bouton Terminer visible et actif', () => evaluate(finishCenter), 5000)
    .catch(async function () { throw new Error('TERMINER PAS DISPONIBLE st=' + (await evaluate(stateDiag()))); });
  await driftTap(finishSpot.x, finishSpot.y); // doigt qui dérape de 12 px
  await sleep(300);
  await waitFor('ligne créée malgré le dérapage', () => evaluate('(() => { const st = window.__vieTLignes.getState(); return !st.lineMode && (st.lines || []).length === 1; })()'), 10000)
    .catch(async function () { throw new Error('TERMINER INERTE (TAP DéRIVé) st=' + (await evaluate(stateDiag()))); });
  assert.equal(await evaluate('window.__vieTLignes.getState().lines.length'), 1, 'une ligne existe');

  // ---- E. Panneau en cascade : vrai swipe le fait défiler -------------
  const cross = await waitFor('croix visible (page ligne)', () => evaluate(btnCenter('✕')));
  await touch(cross.x, cross.y);
  await waitFor('retour racine', () => evaluate(visibleHas('Voirie')));
  await evaluate('(() => { const page = document.querySelector("#mapMenu .map-menu-page:not([hidden])"); for (let i = 0; i < 60; i++) { const b = document.createElement("button"); b.setAttribute("data-filler", "1"); b.type = "button"; b.textContent = "filler " + i; page.appendChild(b); } return true; })()');
  const panelRect = await evaluate('(() => { const p = document.querySelector(".map-menu"); const r = p.getBoundingClientRect(); return { x: r.x + r.width / 2, y: Math.min(r.y + r.height - 40, r.y + 160) }; })()');
  await swipe(panelRect.x, panelRect.y, 0, -200);
  await sleep(250);
  const panelScroll = await evaluate('(() => { const p = document.querySelector(".map-menu"); const s = p.scrollTop; const cs = getComputedStyle(p); return JSON.stringify({ s, oy: cs.overflowY, ta: cs.touchAction, mh: cs.maxHeight }); })()');
  await evaluate('(() => { [...document.querySelectorAll("button[data-filler]")].forEach(function (b) { b.remove(); }); const p = document.querySelector(".map-menu"); p.scrollTop = 0; return true; })()');
  assert.ok(JSON.parse(panelScroll).s > 20, 'SWIPE PANNEAU SANS DÉFILEMENT ' + panelScroll);

  assert.equal(consoleErrors.length, 0, 'erreurs navigateur : ' + consoleErrors.join(' ; ').slice(0, 200));
  console.log(JSON.stringify({ ok: true, suite: 'v39-feuille-scroll' }));
} finally {
  socket?.close();
  if (browser.exitCode === null) { browser.kill('SIGTERM'); await sleep(500); }
  if (browser.exitCode === null) browser.kill('SIGKILL');
  server.kill('SIGTERM');
  try { await rm(profile, { recursive: true, force: true }); } catch (error) {}
}
