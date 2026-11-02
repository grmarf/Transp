// V37 — « ✅ Terminer » une ligne et zonage : parcours réel mobile.
// Régressions joueur (mobile) : « le bouton pour terminer la ligne
// créée ne semble pas fonctionnel » et « vérifie le zonage ». Ce test
// rejoue les deux parcours en viewport mobile : création d'une ligne
// (2 arrêts initiaux tapés sur la carte) puis tap réel sur Terminer,
// et peinture d'une zone le long d'une route existante.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const port = 18900 + (process.pid % 1000);
const debugPort = port + 1;
const url = `http://127.0.0.1:${port}/`;
const profile = await mkdtemp(join(tmpdir(), 'transp-v37-'));

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
const visibleHas = (label) => `Boolean([...document.querySelectorAll("#mapMenu .map-menu-page:not([hidden]) button")].some((b) => b.textContent.includes(${JSON.stringify(label)})))`;
const finishCenter = '(() => { const b = document.getElementById("finishLineBtn"); if (!b || b.hidden || b.disabled) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()';
const stateDiag = () => `(() => { const st = window.__vieTLignes.getState(); const f = document.getElementById("finishLineBtn"); return JSON.stringify({ lineMode: st.lineMode, pending: (st.pendingStops || []).length, lines: (st.lines || []).length, zoneMode: st.zoneMode, corner: !!st.pendingZoneCorner, zones: (st.city.zones || []).length, finish: f ? (f.hidden ? 'hidden' : (f.disabled ? 'disabled' : 'ok')) : 'absent', logs: (st.logs || []).slice(0, 4) }); })()`;
const traceEvents = () => `(() => {
  window.__evdiag = [];
  ["pointerdown", "pointerup", "touchstart", "touchend", "click"].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      const t = e.target;
      window.__evdiag.push(ev + ">" + (t && t.tagName ? t.tagName + (t.id ? "#" + t.id : "") : "?"));
    }, true);
  });
  return "ok";
})()`;

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
  await cdp('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxPoints: 2 });
  await cdp('Page.navigate', { url });
  await waitFor('jeu initialisé', () => evaluate('Boolean(window.__vieTLignes && window.__vieTLignes.getState && document.querySelector("#map"))'));
  await sleep(500);

  // ---- A. Terminer une ligne -----------------------------------------
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
    .catch(async function () { throw new Error('TAP ARRêt 1 SANS EFFET st=' + (await evaluate(stateDiag()))); });
  await touch(stopSpots[1].sx, stopSpots[1].sy);
  await waitFor('deux arrêts posés', () => evaluate('window.__vieTLignes.getState().pendingStops.length >= 2'), 5000)
    .catch(async function () { throw new Error('TAP ARRêt 2 SANS EFFET st=' + (await evaluate(stateDiag()))); });
  const finishSpot = await waitFor('bouton Terminer visible et actif', () => evaluate(finishCenter), 5000)
    .catch(async function () { throw new Error('TERMINER PAS DISPONIBLE st=' + (await evaluate(stateDiag()))); });
  await evaluate(traceEvents());
  await touch(finishSpot.x, finishSpot.y);
  await sleep(300);
  await waitFor('ligne créée', () => evaluate('(() => { const st = window.__vieTLignes.getState(); return !st.lineMode && (st.lines || []).length === 1; })()'), 10000)
    .catch(async function () {
      throw new Error('TERMINER INERTE @' + Math.round(finishSpot.x) + ',' + Math.round(finishSpot.y)
        + ' ev=' + (await evaluate('JSON.stringify(window.__evdiag || [])'))
        + ' st=' + (await evaluate(stateDiag()))
        + ' jserr=' + consoleErrors.slice(0, 2).join(';').slice(0, 200));
    });
  assert.equal(await evaluate('window.__vieTLignes.getState().lines.length'), 1, 'une ligne existe');

  // ---- B. Zonage le long d'une route ---------------------------------
  const cross = await waitFor('croix visible (page ligne)', () => evaluate(btnCenter('✕')));
  await touch(cross.x, cross.y);
  await waitFor('retour racine', () => evaluate(visibleHas('Voirie')));
  const zonesBefore = await evaluate('(window.__vieTLignes.getState().city.zones || []).length');
  const urbBtn = await waitFor('bouton Urbanisme visible', () => evaluate(btnCenter('Urbanisme')));
  await touch(urbBtn.x, urbBtn.y);
  await waitFor('page urbanisme ouverte', () => evaluate(visibleHas('Zoner')));
  const zoneNav = await waitFor('bouton Zoner visible', () => evaluate(btnCenter('Zoner')));
  await touch(zoneNav.x, zoneNav.y);
  await waitFor('page types de zones ouverte', () => evaluate(visibleHas('Résidentiel')));
  const resBtn = await waitFor('bouton Résidentiel visible', () => evaluate(btnCenter('Résidentiel')));
  await touch(resBtn.x, resBtn.y);
  await waitFor('outil zonage armé', () => evaluate('window.__vieTLignes.getState().zoneMode === "zone"'), 5000)
    .catch(async function () { throw new Error('ZONER INERTE st=' + (await evaluate(stateDiag()))); });
  const cand = await waitFor('boite le long d\'une route visible', () => evaluate(`(() => {
    const st = window.__vieTLignes.getState();
    const cam = window.__vieTLignes.cameraState;
    const rect = document.querySelector("#map").getBoundingClientRect();
    const toScreen = (wx, wy) => ({ sx: (wx - cam.x) * cam.zoom + rect.width / 2 + rect.left, sy: (wy - cam.y) * cam.zoom + rect.height / 2 + rect.top });
    const segs = [];
    for (const r of st.city.roads || []) {
      const pts = r.points || [];
      for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]);
      if (pts.length < 2 && r.start && r.end) segs.push([r.start, r.end]);
    }
    for (const pair of segs) {
      const a = pair[0], b = pair[1];
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const c1 = { x: m.x - 40, y: m.y - 30 };
      const c2 = { x: m.x + 40, y: m.y + 30 };
      const s1 = toScreen(c1.x, c1.y), s2 = toScreen(c2.x, c2.y);
      const onMap = (s) => s.sx >= rect.left + 10 && s.sx <= rect.right - 10 && s.sy >= rect.top + 10 && s.sy <= rect.bottom - 10 && (() => { const h = document.elementFromPoint(s.sx, s.sy); return h && h.id === "map"; })();
      if (!onMap(s1) || !onMap(s2)) continue;
      return { s1, s2 };
    }
    return null;
  })()`))
    .catch(async function () { throw new Error('PAS DE BOITE CANDIDATE st=' + (await evaluate(stateDiag()))); });
  await touch(cand.s1.sx, cand.s1.sy);
  await waitFor('premier coin posé', () => evaluate('Boolean(window.__vieTLignes.getState().pendingZoneCorner)'), 5000)
    .catch(async function () { throw new Error('COIN 1 SANS EFFET st=' + (await evaluate(stateDiag()))); });
  await sleep(500); // évite le zoom double-tap entre les deux coins
  await touch(cand.s2.sx, cand.s2.sy);
  await waitFor('zone peinte', () => evaluate(`(window.__vieTLignes.getState().city.zones || []).length > ${zonesBefore}`), 10000)
    .catch(async function () {
      throw new Error('ZONAGE REFUSé/INERTE st=' + (await evaluate(stateDiag())));
    });

  assert.equal(consoleErrors.length, 0, 'erreurs navigateur : ' + consoleErrors.join(' ; ').slice(0, 200));
  console.log(JSON.stringify({ ok: true, suite: 'v37-terminer-zonage' }));
} finally {
  socket?.close();
  if (browser.exitCode === null) { browser.kill('SIGTERM'); await sleep(500); }
  if (browser.exitCode === null) browser.kill('SIGKILL');
  server.kill('SIGTERM');
  try { await rm(profile, { recursive: true, force: true }); } catch (error) {}
}
