// V40 — PWA « 100 % local » : service worker + démarrage hors ligne.
// Le jeu doit démarrer entièrement depuis le cache, réseau coupé.
// Étapes : chargement en ligne → service worker actif et contrôleur
// installé → émulation réseau hors ligne (CDP) → rechargement × 2 →
// le jeu doit être initialisé à chaque fois (window.__vieTLignes).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const port = 19300 + (process.pid % 1000);
const debugPort = port + 1;
const url = `http://127.0.0.1:${port}/`;
const profile = await mkdtemp(join(tmpdir(), 'transp-v40-'));

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const browser = spawn('chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(label, fetcher, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await fetcher();
      if (value) return value;
      lastError = new Error('condition non remplie');
    } catch (error) { lastError = error; }
    await sleep(200);
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
const gameReady = 'Boolean(window.__vieTLignes && window.__vieTLignes.getState && document.querySelector("#map"))';

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
  await cdp('Network.enable');
  await cdp('Page.navigate', { url });
  await waitFor('jeu initialisé (en ligne)', () => evaluate(gameReady));
  await sleep(500);

  // ---- 1. Service worker enregistré, actif et contrôleur -------------
  const swState = await waitFor('service worker actif', () => evaluate('navigator.serviceWorker.ready.then(function (r) { return { scope: r.active ? r.active.scriptURL : null, ctrl: !!navigator.serviceWorker.controller }; })'));
  assert.ok(swState && /sw\.js$/.test(String(swState.scope)), 'service worker actif: ' + JSON.stringify(swState));
  assert.ok(swState.ctrl, 'la page est contrôlée par le service worker');
  // Le cache est rempli (les modules ont été chargés par la page).
  const cacheInfo = await waitFor('cache rempli', () => evaluate('caches.keys().then(function (keys) { var k = keys[0]; return k ? caches.open(k).then(function (c) { return c.keys().then(function (reqs) { return { n: reqs.length, main: reqs.some(function (r) { return String(r.url).indexOf("main.js") >= 0; }) }; }); }) : null; })'));
  assert.ok(cacheInfo && cacheInfo.n >= 10, 'cache rempli: ' + JSON.stringify(cacheInfo));
  assert.ok(cacheInfo.main, 'main.js est dans le cache');

  // ---- 2. Réseau coupé : le jeu doit recharger depuis le cache --------
  await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  const reloadBootsOffline = async function (label) {
    await cdp('Page.navigate', { url });
    await waitFor(label, () => evaluate(gameReady), 30000)
      .catch(async function () { throw new Error(label + ' INERTE sw=' + JSON.stringify(await evaluate('navigator.serviceWorker.getRegistrations().then(function (r) { return r.length; })')) + ' err=' + consoleErrors.slice(0, 2).join(';')); });
    return true;
  };
  await reloadBootsOffline('jeu initialisé (hors ligne, 1er rechargement)');
  await sleep(400);
  await reloadBootsOffline('jeu initialisé (hors ligne, 2e rechargement)');
  const ctrlOffline = await evaluate('Boolean(navigator.serviceWorker.controller)');
  assert.ok(ctrlOffline, 'toujours contrôlé hors ligne');

  await cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  assert.equal(consoleErrors.length, 0, 'erreurs navigateur : ' + consoleErrors.join(' ; ').slice(0, 200));
  console.log(JSON.stringify({ ok: true, suite: 'v40-pwa-offline' }));
} finally {
  socket?.close();
  if (browser.exitCode === null) { browser.kill('SIGTERM'); await sleep(500); }
  if (browser.exitCode === null) browser.kill('SIGKILL');
  server.kill('SIGTERM');
  try { await rm(profile, { recursive: true, force: true }); } catch (error) {}
}
