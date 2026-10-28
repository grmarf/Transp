// tests/browser-smoke.mjs â Smoke test navigateur pour Vie t'Lignes.
//
// VÃ©rifie en conditions rÃ©andinues (serveur HTTP + Chromium headless pilotÃ© via
// le protocole CDP, sans dÃ©pendance externe) que :
//   1. le jeu dÃ©marre et que la coquille HTML est saine ;
//   2. le tableau de bord reste visible sur Ã©cran large et reste consultable
//      avec 50 lignes (dÃ©filement interne) ;
//   3. le parcours joueur de base fonctionne : crÃ©ation de ligne, construction
//      et suppression de voirie, renommage de la ville, sauvegarde puis
//      rechargement ;
//   4. le rendu Ã©chappe le HTML issu de l'Ã©tat (pas d'injection de balise) ;
//   5. la heatmap de congestion s'active depuis la barre d'outils.
//
// PrÃ©requis : `chromium` et `python3` installÃ©s localement.
// Lancement : npm run test:browser
//
// Le test est dÃ©coupÃ© en Ã©tapes indÃ©pendantes Ã©valuÃ©es un% par une : en cas
// d'Ã©chec, le message d'assertion indique l'Ã©tape fautive et son contexte
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
  throw new Error(`DÃ©lai dÃ©passÃ© : ${label}${lastError ? ` (${lastError.message})` : ''}`);
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
  // --- DÃ©marrage : serveur HTTP, cible CDP, socket, navigation --------------
  await waitFor('serveur HTTP prÃªt', async () => {
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

  // Attente active du dÃ©marrage du jeu (plus de sleep arbitraire).
  await waitFor('jeu initialisÃ©', () => evaluate(
    'Boolean(window.__vieTLignes && window.__vieTLignes.getState && document.querySelector("#map") && document.querySelector("#lines"))'
  ));

  // Helper de clic en coordonnÃ©es monde, installÃ© une fois pour toutes les Ã©tapes.
  await evaluate('window.__worldClick = (x, y) => { const canvas = document.querySelector("#map"); const rect = canvas.getBoundingClientRect(); window.__vieTLignes.clickMap({ clientX: rect.left + x * rect.width / canvas.width, clientY: rect.top + y * rect.height / canvas.height }); }; true');

  // --- Ãtape 1 : coquille saine, tableau de bord visible sur Ã©cran large ----
  const shell = await evaluate(`(() => {
    const dashboard = document.querySelector('.dashboard');
    const rect = dashboard.getBoundingClientRect();
    return {
      dashboardVisible: rect.width > 0 && rect.right <= window.innerWidth + 1,
      seedFieldRemoved: document.querySelector('#seedInput') === null,
      cityName: window.__vietLignes.getState().city.name
    };
  })()`);
  assert.equal(shell.dashboardVisible, true, 'le tableau de bord droit doit rester visible sur PC');
  assert.equal(shell.seedFieldRemoved, true, 'le champ seed ne doit plus Ãªtre affichÃ©');
  assert.ok(typeof shell.cityName === 'string' && shell.cityName.length > 0, 'la ville doit avoir un nom initial');

  // --- Ãtape 2 : 50 lignes restent consultables par dÃ©filement interne -----
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
  assert.equal(scroll.scrollable, true, `50 lignes doivent rester consultables par dÃ©filement : ${JSON.stringify(scroll.metrics)}`);

  // --- Ã©tape 3 : crÃ©ation d'une ligne sur les deux premiers arrÃªts -----------
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
  assert.equal(lineCreation.lines, 1, 'la crÃ©ation dâune ligne doit fonctionner');

  // --- Ã©tape 4 : construction d'une route libre -----------------------------
  const roadBuild = await evaluate(`(() => {
    document.querySelector('#buildRoadBtn').click();
    window.__worldClick(120, 100);
    window.__worldClick(250, 180);
    return { built: window.__vieTLignes.getState().city.roads.filter((road) => road.built).length };
  })()`);
  assert.equal(roadBuild.built, 1, 'une route libre doit pouvoir Ãªtre construitÃ©');

  // --- Ã©tape 5 : renommage de la ville sans Ã©crasement ------------------------
  const renamed = await evaluate(`(() => {
    const input = document.querySelector('#cityNameInput');
    input.focus();
    input.value = 'Lyon-sur-Test';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return window.__vieTLignes.getState().city.name;
  })()`);
  assert.equal(renamed, 'Lyon-sur-Test', 'le nom de ville doit Ãªtre modifiable sans Ã©crasement');

  // --- Ã©tape 6 : sauvegarde puis rechargement -------------------------------
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
  assert.equal(reloaded.builtRoads, 1, 'une route libre construite doit Ãªtre sauvegardÃ©e puis rechargÃ©e');
  assert.equal(reloaded.city, 'Lyon-sur-Test', 'le nom de ville doit surviver Ã  la sauvegarde/chargement');

  // --- Ã©tape 7 : suppression d'une route initiale ------------------------------
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
  assert.equal(removal.removeMode, 'true', 'le mode suppression doit pouvoir Ãªtre activÃ©');
  if (removal.clicked) {
    assert.equal(removal.after, removal.initialRoads - 1, 'une route initiale doit pouvoir Ãªtre supprimÃ©e');
  }

  // --- Ã©tape 8 : Ã©chappement HTML, heatmap, budget ----------------------------
  await evaluate(`(() => {
    window.__vieTLignes.getState().logs.unshift('<img src=x onerror=alert(1)>');
    document.querySelector('#toggleHeatmapBtn').click();
    return true;
  })()`);
  await sleep(300); // laisser un cycle de rendu s'exÃ©cuter
  const security = await evaluate(`(() => ({
    escaped: document.querySelector('#log').innerHTML.includes('&lt;img'),
    executableImage: Boolean(document.querySelector('#log img')),
    heatmapPressed: document.querySelector('#toggleHeatmapBtn').getAttribute('aria-pressed'),
    money: document.querySelector('#money').textContent
  }))()`);
  assert.equal(security.escaped, true, 'le journal doit Ã©chapper le HTML issu de l. Ã©tat');
  assert.equal(security.executableImage, false, 'aucune balise img ne doit Ãªtre crÃ©Ã©e depuis l. Ã©tat');
  assert.equal(security.heatmapPressed, 'true', 'la heatmap doit pouvoir Ãªtre activÃ©e depuis la barre d. outils');
  assert.match(security.money, /âêÐ¼/, 'le budget doit Ãªtre affichÃ© en euros');

  // --- Bilan final -------------------------------------------------------------
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
  await Promise.race(stopped, sleep(1000));
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
