// tests/browser-smoke.mjs — Smoke test navigateur pour Vie t'Lignes.
//
// Vérifie en conditions réelles (serveur HTTP + Chromium headless piloté via
// le protocole CDP, sans dépendance externe) que :
//   1. le jeu démarre et que la coquille HTML est saine ;
//   2. le tableau de bord reste visible sur écran large et reste consultable
//      avec 50 lignes (défilement interne) ;
//   3. le parcours joueur de base fonctionne : création de ligne, construction
//      et suppression de voirie, renommage de la ville, sauvegarde puis
//      rechargement ;
//   4. le rendu échappe le HTML issu de l'état (pas d'injection de balise) ;
//   5. la heatmap de congestion s'active depuis la barre d'outils.
//
// Prérequis : `chromium` et `python3` installés localement.
// Lancement : npm run test:browser
//
// Le test est découpé en étapes indépendantes évaluées une par une : en cas
// d'échec, le message d'assertion indique l'étape fautive et son contexte
// au lieu d'une exception monolithique.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const port = 18000 + (process.pid % 1000);
const debugPort = port + 1;
const url = `http://127.0.0.1:${port}/`;
const profile = await mkdtemp(join(tmpdir(), 'transp-browser-'));

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
      return await fetcher();
    } catch (error) {
      lastError = error;
      await sleep(150);
    }
  }
  throw new Error(`Délai dépassé : ${label}${lastError ? ` (${lastError.message})` : ''}`);
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
    throw new Error(`Erreur JavaScript dans la page : ${details.exception?.description || details.text}`);
  }
  return response.result?.value;
}

try {
  // --- Démarrage : serveur HTTP, cible CDP, socket, navigation --------------
  await waitFor('serveur HTTP prêt', async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`statut ${response.status}`);
    return response;
  });

  const target = await waitFor('cible de page CDP disponible', async () => {
    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const page = pages.find((item) => item.type === 'page');
    if (!page) throw new Error('aucune cible de type page');
    return page;
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
        const details = message.params.exceptionDetails;
        consoleErrors.push(`exception : ${details.exception?.description || details.text || 'inconnue'}`);
      }
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        consoleErrors.push(`log : ${message.params.entry.text}`);
      }
    });
  });

  await cdp('Runtime.enable');
  await cdp('Log.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url });

  // Attente active du démarrage du jeu (plus de sleep arbitraire).
  await waitFor('jeu initialisé', () => evaluate(
    'Boolean(window.__vieTLignes && window.__vieTLignes.getState && document.querySelector("#map") && document.querySelector("#lines"))'
  ));

  // Helper de clic en coordonnées monde, installé une fois pour toutes les étapes.
  await evaluate('window.__worldClick = (x, y) => { const canvas = document.querySelector("#map"); const rect = canvas.getBoundingClientRect(); window.__vieTLignes.clickMap({ clientX: rect.left + x * rect.width / canvas.width, clientY: rect.top + y * rect.height / canvas.height }); }; true');

  // --- Étape 1 : coquille saine, tableau de bord visible sur écran large ----
  const shell = await evaluate(`(() => {
    const dashboard = document.querySelector('.dashboard');
    const rect = dashboard.getBoundingClientRect();
    return {
      dashboardVisible: rect.width > 0 && rect.right <= window.innerWidth + 1,
      seedFieldRemoved: document.querySelector('#seedInput') === null,
      cityName: window.__vieTLignes.getState().city.name
    };
  })()`);
  assert.equal(shell.dashboardVisible, true, 'le tableau de bord droit doit rester visible sur PC');
  assert.equal(shell.seedFieldRemoved, true, 'le champ seed ne doit plus être affiché');
  assert.ok(typeof shell.cityName === 'string' && shell.cityName.length > 0, 'la ville doit avoir un nom initial');

  // --- Étape 2 : 50 lignes restent consultables par défilement interne -----
  const scroll = await evaluate(`(() => {
    const linesTab = [...document.querySelectorAll('.dashboard-tab')].find((tab) => tab.querySelector('#lines'));
    document.querySelectorAll('.dashboard-tab').forEach((tab) => { tab.open = false; });
    linesTab.open = true;
    const lines = document.querySelector('#lines');
    lines.innerHTML = Array.from({ length: 50 }, (_, index) => '<div class="line-row">Ligne ' + (index + 1) + '</div>').join('');
    const content = linesTab.querySelector('.tab-content');
    const contentRect = content.getBoundingClientRect();
    return {
      scrollable: content.scrollHeight > content.clientHeight && content.clientHeight > 0 && contentRect.bottom <= window.innerHeight + 1,
      metrics: {
        contentHeight: content.clientHeight,
        contentScrollHeight: content.scrollHeight,
        contentBottom: contentRect.bottom,
        viewportHeight: window.innerHeight
      }
    };
  })()`);
  assert.equal(scroll.scrollable, true, `50 lignes doivent rester consultables par défilement : ${JSON.stringify(scroll.metrics)}`);

  // --- Étape 3 : création d'une ligne sur les deux premiers arrêts ----------
  const lineCreation = await evaluate(`(() => {
    document.querySelector('#newLineBtn').click();
    const canvas = document.querySelector('#map');
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;
    for (const stop of window.__vieTLignes.getState().city.stops.slice(0, 2)) {
      window.__vieTLignes.clickMap({ clientX: rect.left + stop.x * scaleX, clientY: rect.top + stop.y * scaleY });
    }
    document.querySelector('#finishLineBtn').click();
    return { lines: window.__vieTLignes.getState().lines.length };
  })()`);
  assert.equal(lineCreation.lines, 1, 'la création d’une ligne doit fonctionner');

  // --- Étape 4 : construction d'une route libre -----------------------------
  const roadBuild = await evaluate(`(() => {
    document.querySelector('#buildRoadBtn').click();
    window.__worldClick(120, 100);
    window.__worldClick(250, 180);
    return { built: window.__vieTLignes.getState().city.roads.filter((road) => road.built).length };
  })()`);
  assert.equal(roadBuild.built, 1, 'une route libre doit pouvoir être construite');

  // --- Étape 5 : renommage de la ville sans écrasement -----------------------
  const renamed = await evaluate(`(() => {
    const input = document.querySelector('#cityNameInput');
    input.focus();
    input.value = 'Lyon-sur-Test';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return window.__vieTLignes.getState().city.name;
  })()`);
  assert.equal(renamed, 'Lyon-sur-Test', 'le nom de ville doit être modifiable sans écrasement');

  // --- Étape 6 : sauvegarde puis rechargement -------------------------------
  const reloaded = await evaluate(`(() => {
    document.querySelector('#saveBtn').click();
    document.querySelector('#loadBtn').click();
    const state = window.__vieTLignes.getState();
    return {
      lines: state.lines.length,
      builtRoads: state.city.roads.filter((road) => road.built).length,
      city: state.city.name
    };
  })()`);
  assert.equal(reloaded.lines, 1, 'le rechargement doit conserver la ligne');
  assert.equal(reloaded.builtRoads, 1, 'une route libre construite doit être sauvegardée puis rechargée');
  assert.equal(reloaded.city, 'Lyon-sur-Test', 'le nom de ville doit survivre à la sauvegarde/chargement');

  // --- Étape 7 : suppression d'une route initiale ----------------------------
  const removal = await evaluate(`(() => {
    const state = window.__vieTLignes.getState();
    const initialRoads = state.city.roads.filter((road) => !road.built && road.a && road.b).length;
    const initialRoad = state.city.roads.find((road) => !road.built && road.a && road.b);
    document.querySelector('#removeRoadBtn').click();
    const removeMode = document.querySelector('#removeRoadBtn').getAttribute('aria-pressed');
    if (initialRoad) {
      const a = state.city.stops.find((stop) => stop.id === initialRoad.a);
      const b = state.city.stops.find((stop) => stop.id === initialRoad.b);
      window.__worldClick((a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    const after = window.__vieTLignes.getState().city.roads.filter((road) => !road.built && road.a && road.b).length;
    return { initialRoads, after, removeMode, clicked: Boolean(initialRoad) };
  })()`);
  assert.equal(removal.removeMode, 'true', 'le mode suppression doit pouvoir être activé');
  if (removal.clicked) {
    assert.equal(removal.after, removal.initialRoads - 1, 'une route initiale doit pouvoir être supprimée');
  }

  // --- Étape 8 : échappement HTML, heatmap, budget ---------------------------
  await evaluate(`(() => {
    window.__vieTLignes.getState().logs.unshift('<img src=x onerror=alert(1)>');
    document.querySelector('#toggleHeatmapBtn').click();
    return true;
  })()`);
  await sleep(300); // laisser un cycle de rendu s'exécuter
  const security = await evaluate(`(() => ({
    escaped: document.querySelector('#log').innerHTML.includes('&lt;img'),
    executableImage: Boolean(document.querySelector('#log img')),
    heatmapPressed: document.querySelector('#toggleHeatmapBtn').getAttribute('aria-pressed'),
    money: document.querySelector('#money').textContent
  }))()`);
  assert.equal(security.escaped, true, 'le journal doit échapper le HTML issu de l’état');
  assert.equal(security.executableImage, false, 'aucune balise img ne doit être créée depuis l’état');
  assert.equal(security.heatmapPressed, 'true', 'la heatmap doit pouvoir être activée depuis la barre d’outils');
  assert.match(security.money, /€/, 'le budget doit être affiché en euros');

  // --- Bilan final ------------------------------------------------------------
  assert.equal(consoleErrors.length, 0, `erreurs navigateur : ${consoleErrors.join(' ; ')}`);
  console.log(JSON.stringify({
    ok: true,
    lines: lineCreation.lines,
    builtRoads: roadBuild.built,
    city: reloaded.city,
    consoleErrors: consoleErrors.length
  }));
} finally {
  socket?.close();
  const stopped = new Promise((resolve) => browser.once('exit', resolve));
  browser.kill('SIGTERM');
  server.kill('SIGTERM');
  await Promise.race([stopped, sleep(1000)]);
  if (browser.exitCode === null) browser.kill('SIGKILL');
  await Promise.race([stopped, sleep(500)]);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(profile, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await sleep(100);
    }
  }
}
