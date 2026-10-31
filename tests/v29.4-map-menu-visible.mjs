// V29.4 — le menu en cascade doit être VISIBLE, pas seulement présent.
// Régression rapportée par le joueur : « toujours pas le menu en cascade,
// inutilisable en l'état » alors que la CI est verte — le smoke test ne
// vérifiait jamais la VISIBILITÉ du menu, et seulement en desktop.
// Ici : chargement réel (HTTP + Chromium CDP), en desktop PUIS en mobile,
// avec un diagnostic compact embarqué dans chaque message d'assertion
// (run-all tronque les annotations à ~300 caractères).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const port = 18500 + (process.pid % 1000);
const debugPort = port + 1;
const url = `http://127.0.0.1:${port}/`;
const profile = await mkdtemp(join(tmpdir(), 'transp-menu-'));

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
    const details = response.exceptionDetails;
    throw new Error(`Erreur JS page : ${details.exception?.description || details.text}`);
  }
  return response.result?.value;
}

// Diagnostic compact d'un état du menu (limité pour l'annotation CI).
const DIAG_JS = `(() => {
  const menu = document.getElementById("mapMenu");
  if (!menu) return "menu ABSENT du DOM";
  const rect = menu.getBoundingClientRect();
  const s = getComputedStyle(menu);
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  const top = (rect.width > 0 && rect.height > 0) ? document.elementFromPoint(cx, cy) : null;
  const labels = [...menu.querySelectorAll("button")].map((b) => b.textContent).join("|").slice(0, 60);
  return "btn=" + menu.querySelectorAll("button").length +
    " rect=" + Math.round(rect.width) + "x" + Math.round(rect.height) + "@" + Math.round(rect.x) + "," + Math.round(rect.y) +
    " disp=" + s.display + " vis=" + s.visibility + " op=" + s.opacity +
    " pos=" + s.position + " z=" + s.zIndex +
    " body=" + (document.body.className || "-") +
    " top=" + (top ? (top.tagName + (top.id ? "#" + top.id : "")).slice(0, 24) : "rien") +
    " contains=" + Boolean(top && menu.contains(top)) +
    " labels=" + labels +
    " vp=" + window.innerWidth + "x" + window.innerHeight;
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
        consoleErrors.push('exception : ' + (message.params.exceptionDetails.exception?.description || '').slice(0, 200));
      }
    });
  });
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url });
  await waitFor('jeu initialisé', () => evaluate('Boolean(window.__vieTLignes && window.__vieTLignes.getState && document.querySelector("#map"))'));
  await sleep(300);

  // --- Bureau 1280×900 -------------------------------------------------------
  const desktop = await evaluate(DIAG_JS);
  assert.ok(/btn=([3-9]|[1-9]\d)/.test(desktop), 'DESKTOP menu sans boutons : ' + desktop);
  assert.ok(!/vis=hidden/.test(desktop), 'DESKTOP menu caché : ' + desktop);
  const dw = Number((desktop.match(/rect=(\d+)x/) || [0, 0])[1]);
  assert.ok(dw >= 200, 'DESKTOP menu trop étroit (' + dw + 'px) : ' + desktop);
  console.log('desktop: ' + desktop);

  // --- Mobile 412×915 (media query ≤ 959 px : menu fixé en bas) -------------
  await cdp('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  await sleep(400); // media queries + reflow
  const mobile = await evaluate(DIAG_JS);
  assert.ok(/btn=([3-9]|[1-9]\d)/.test(mobile), 'MOBILE menu sans boutons : ' + mobile);
  assert.ok(!/vis=hidden/.test(mobile), 'MOBILE menu caché : ' + mobile);
  assert.ok(!/disp=none/.test(mobile), 'MOBILE menu display:none : ' + mobile);
  const mw = Number((mobile.match(/rect=(\d+)x/) || [0, 0])[1]);
  assert.ok(mw >= 300, 'MOBILE menu trop étroit (' + mw + 'px, viewport 412) : ' + mobile);
  assert.ok(!/op=0(?![.\d])/.test(mobile), 'MOBILE menu transparent : ' + mobile);
  assert.ok(/contains=true/.test(mobile), 'MOBILE menu recouvert par un autre élément : ' + mobile);
  console.log('mobile: ' + mobile);

  assert.equal(consoleErrors.length, 0, 'erreurs navigateur : ' + consoleErrors.join(' ; ').slice(0, 200));
  console.log(JSON.stringify({ ok: true, suite: 'v29.4-map-menu-visible' }));
} finally {
  socket?.close();
  if (browser.exitCode === null) { browser.kill('SIGTERM'); await sleep(500); }
  if (browser.exitCode === null) browser.kill('SIGKILL');
  server.kill('SIGTERM');
  try { await rm(profile, { recursive: true, force: true }); } catch (error) {}
}
