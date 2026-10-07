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

let socket;
let nextId = 1;
const pending = new Map();
const consoleErrors = [];

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function waitFor(fetcher, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { return await fetcher(); } catch { await sleep(100); }
  }
  throw new Error('Délai dépassé pendant le démarrage navigateur');
}
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

try {
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    if (!response.ok) throw new Error('serveur HTTP indisponible');
    return response;
  });
  const page = await waitFor(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const target = pages.find(item => item.type === 'page');
    if (!target) throw new Error('page CDP absente');
    return target;
  });
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails?.text || 'exception navigateur');
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') consoleErrors.push(message.params.entry.text);
      if (message.id && pending.has(message.id)) {
        const request = pending.get(message.id); pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
      }
    });
  });
  await cdp('Runtime.enable');
  await cdp('Log.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 900, deviceScaleFactor: 1, mobile: false
  });
  await cdp('Page.navigate', { url });
  await sleep(1000);

  const result = await cdp('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(() => {
      const initial = window.__vieTLignes?.getState();
      if (!initial) throw new Error('état global absent');
      const dashboard = document.querySelector('.dashboard');
      const dashboardRect = dashboard.getBoundingClientRect();
      const desktopDashboardVisible = dashboardRect.width > 0 && dashboardRect.right <= window.innerWidth + 1;
      document.querySelector('#newLineBtn').click();
      const canvas = document.querySelector('#map');
      const rect = canvas.getBoundingClientRect();
      const scaleX = rect.width / canvas.width;
      const scaleY = rect.height / canvas.height;
      for (const stop of initial.city.stops.slice(0, 2)) {
        window.__vieTLignes.clickMap({ clientX: rect.left + stop.x * scaleX, clientY: rect.top + stop.y * scaleY });
      }
      document.querySelector('#finishLineBtn').click();
      const created = window.__vieTLignes.getState().lines.length;
      const worldClick = (x, y) => window.__vieTLignes.clickMap({
        clientX: rect.left + x * rect.width / canvas.width,
        clientY: rect.top + y * rect.height / canvas.height
      });
      document.querySelector('#buildRoadBtn').click();
      worldClick(120, 100);
      worldClick(250, 180);
      const builtRoads = window.__vieTLignes.getState().city.roads.filter(road => road.built).length;
      const cityNameInput = document.querySelector('#cityNameInput');
      cityNameInput.focus();
      cityNameInput.value = 'Lyon-sur-Test';
      cityNameInput.dispatchEvent(new Event('input', { bubbles: true }));
      const renamed = window.__vieTLignes.getState().city.name;
      const seedFieldRemoved = document.querySelector('#seedInput') === null;
      document.querySelector('#saveBtn').click();
      document.querySelector('#loadBtn').click();
      const loaded = window.__vieTLignes.getState().lines.length;
      const loadedRoad = window.__vieTLignes.getState().city.roads.find(road => road.built);
      const loadedBuiltRoads = window.__vieTLignes.getState().city.roads.filter(road => road.built).length;
      const initialRoad = window.__vieTLignes.getState().city.roads.find(road => !road.built && road.a && road.b);
      const initialRoadCount = window.__vieTLignes.getState().city.roads.filter(road => !road.built && road.a && road.b).length;
      document.querySelector('#removeRoadBtn').click();
      const removeMode = document.querySelector('#removeRoadBtn').getAttribute('aria-pressed');
      if (initialRoad) {
        const a = window.__vieTLignes.getState().city.stops.find(stop => stop.id === initialRoad.a);
        const b = window.__vieTLignes.getState().city.stops.find(stop => stop.id === initialRoad.b);
        worldClick((a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      const initialRoadsAfterRemove = window.__vieTLignes.getState().city.roads.filter(road => !road.built && road.a && road.b).length;
      const payload = '<img src=x onerror=alert(1)>';
      window.__vieTLignes.getState().logs.unshift(payload);
      document.querySelector('#toggleHeatmapBtn').click();
      return {
        created, loaded, builtRoads, loadedBuiltRoads, removeMode, renamed, seedFieldRemoved,
        desktopDashboardVisible,
        initialRoadCount, initialRoadsAfterRemove,
        escaped: document.querySelector('#log').innerHTML.includes('&lt;img'),
        executableImage: Boolean(document.querySelector('#log img')),
        money: document.querySelector('#money').textContent
      };
    })()`
  });
  const value = result.result?.value;
  assert.equal(consoleErrors.length, 0, `erreurs navigateur : ${consoleErrors.join('; ')}`);
  assert.equal(value.created, 1, 'la création d’une ligne doit fonctionner');
  assert.equal(value.loaded, 1, 'le chargement valide doit conserver la ligne');
  assert.equal(value.builtRoads, 1, 'une route libre doit pouvoir être construite');
  assert.equal(value.loadedBuiltRoads, 1, 'une route libre doit être sauvegardée');
  assert.equal(value.removeMode, 'true', 'le mode suppression doit pouvoir être activé');
  assert.equal(value.renamed, 'Lyon-sur-Test', 'le nom de ville doit être modifiable sans écrasement');
  assert.equal(value.seedFieldRemoved, true, 'le seed ne doit plus être affiché');
  assert.equal(value.desktopDashboardVisible, true, 'le tableau de bord droit doit rester visible sur PC');
  assert.equal(value.initialRoadsAfterRemove, value.initialRoadCount - 1, 'une route initiale doit pouvoir être supprimée');
  assert.equal(value.escaped, true, 'le journal doit échapper le HTML');
  assert.equal(value.executableImage, false, 'aucune balise img ne doit être créée');
  assert.match(value.money, /€/);
  console.log(JSON.stringify({ ok: true, ...value }));
} finally {
  socket?.close();
  const stopped = new Promise(resolve => browser.once('exit', resolve));
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
