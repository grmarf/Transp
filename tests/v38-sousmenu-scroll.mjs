// V38 — Scroll des sous-menus du menu en cascade sur smartphone.
// Demande joueur : « sur smartphone, rend possible le scroll dans les sous
// menus. Impossible actuellement de voir ce qui est masqué à l'ouverture. »
// Le panneau mobile (.map-menu, fixé en bas d'écran) n'avait ni hauteur
// maximale ni défilement : une page plus haute que l'écran (police système
// agrandie, écran court, paysage) masquait ses boutons sans recours.
//
// Ce test charge le jeu en viewport mobile réel (Chromium CDP) et vérifie :
//   1. pour CHAQUE page de la cascade, sur 3 viewports (portrait large,
//      portrait étroit, paysage court), tous les boutons visibles sont
//      intégralement dans l'écran et réellement tapables (elementFromPoint) ;
//   2. le panneau est scrollable (overflow-y: auto, présent partout ≤ 959px) ;
//   3. une page plus haute que l'écran défile réellement (scrollTop).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const port = 19100 + (process.pid % 1000);
const debugPort = port + 1;
const url = `http://127.0.0.1:${port}/`;
const profile = await mkdtemp(join(tmpdir(), 'transp-v38-'));

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

// Navigation : les boutons de goto existent dans les pages cachées aussi —
// un .click() programmatique suffit (bindTap écoute aussi « click »).
const gotoLevel = (level) => `(() => {
  const menu = document.getElementById("mapMenu");
  if (!menu) return "ABSENT";
  const page = menu.querySelector(".map-menu-page:not([hidden])");
  if (page && page.dataset.level === ${JSON.stringify(level)}) return "OK";
  if (${JSON.stringify(level)} === "std") {
    const back = page ? page.querySelector(".btn-map-back") : null;
    if (back) back.click();
    else return "NOBACK";
  } else {
    const btn = [...menu.querySelectorAll("button")].find((b) => b.__menuGoto === ${JSON.stringify(level)});
    if (!btn) return "NOBTN";
    btn.click();
  }
  return "OK";
})()`;

// Diagnostic géométrique de la page visible (compact pour l'annotation CI).
const PAGE_DIAG = `(() => {
  const menu = document.getElementById("mapMenu");
  const page = menu ? menu.querySelector(".map-menu-page:not([hidden])") : null;
  if (!menu || !page) return JSON.stringify({ err: "panneau ou page absents" });
  const s = getComputedStyle(menu);
  const mr = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const buttons = [...page.querySelectorAll("button")].map((b) => {
    const r = b.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const top = (r.width > 0 && r.height > 0) ? document.elementFromPoint(cx, cy) : null;
    const inVp = r.left >= -0.5 && r.right <= vw + 0.5 && r.top >= -0.5 && r.bottom <= vh + 0.5;
    const hitOk = !!(top && (top === b || b.contains(top)));
    return { label: b.textContent.trim().slice(0, 14), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(","), inVp, hitOk, hit: top ? top.tagName : "-" };
  });
  return JSON.stringify({
    level: page.dataset.level,
    vp: vw + "x" + vh,
    menu: [Math.round(mr.x), Math.round(mr.y), Math.round(mr.width), Math.round(mr.height)].join(","),
    overflowY: s.overflowY,
    delta: menu.scrollHeight - menu.clientHeight,
    buttons
  });
})()`;

const LEVELS = ["std", "voirie", "voirie-types", "voirie-types-2", "voirie-edits",
  "voirie-history", "urbanisme", "urbanisme-zones", "urbanisme-zones-2",
  "ligne", "ligne-modes", "arrets"];
const VIEWPORTS = [
  { name: 'portrait-412x915', width: 412, height: 915, dsf: 2 },
  { name: 'etroit-360x740', width: 360, height: 740, dsf: 2 },
  { name: 'paysage-740x360', width: 740, height: 360, dsf: 2 }
];

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
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxPoints: 2 });
  await cdp('Emulation.setDeviceMetricsOverride', { width: VIEWPORTS[0].width, height: VIEWPORTS[0].height, deviceScaleFactor: VIEWPORTS[0].dsf, mobile: true });
  await cdp('Page.navigate', { url });
  await waitFor('jeu initialisé', () => evaluate('Boolean(window.__vieTLignes && window.__vieTLignes.getState && document.querySelector("#map"))'));
  await sleep(500);

  // ---- 1+2. chaque page × chaque viewport : tout visible et tapable ----
  for (const vp of VIEWPORTS) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dsf, mobile: true });
    await sleep(400); // media queries + reflow
    for (const level of LEVELS) {
      const nav = await evaluate(gotoLevel(level));
      assert.equal(nav, 'OK', vp.name + ' : navigation vers ' + level + ' impossible (' + nav + ')');
      await waitFor('page ' + level + ' visible', () => evaluate(`Boolean(document.querySelector('.map-menu-page[data-level="${level}"]:not([hidden])'))`));
      await sleep(80);
      const diag = JSON.parse(await evaluate(PAGE_DIAG));
      assert.equal(diag.overflowY, 'auto', vp.name + ' ' + level + ' : panneau non scrollable (overflow-y=' + diag.overflowY + ')');
      for (const b of diag.buttons) {
        assert.ok(b.inVp, vp.name + ' ' + level + ' : bouton « ' + b.label + ' » hors écran rect=' + b.rect + ' vp=' + diag.vp + ' panneau=' + diag.menu);
        assert.ok(b.hitOk, vp.name + ' ' + level + ' : bouton « ' + b.label + ' » recouvert par ' + b.hit + ' rect=' + b.rect);
      }
    }
  }

  // ---- 3. une page plus haute que l'écran défile réellement -------------
  await evaluate(`(() => {
    const menu = document.getElementById("mapMenu");
    const page = menu.querySelector(".map-menu-page:not([hidden])");
    for (let i = 0; i < 90; i++) { const b = document.createElement("button"); b.type = "button"; b.className = "btn"; b.dataset.filler = "1"; b.textContent = "remplissage " + i; page.appendChild(b); }
    return "OK";
  })()`);
  await sleep(150);
  const scrollDiag = JSON.parse(await evaluate(PAGE_DIAG));
  assert.ok(scrollDiag.delta > 0, 'page gonflée non scrollable (scrollHeight-clientHeight=' + scrollDiag.delta + ')');
  await evaluate('document.getElementById("mapMenu").scrollTop = 400;');
  await sleep(80);
  const afterScroll = await evaluate('document.getElementById("mapMenu").scrollTop');
  assert.ok(afterScroll > 300, 'scrollTop n\'a pas bougé (' + afterScroll + ') — panneau non défilant');
  // nettoyage : le remplissage ne doit survivre à aucun autre test
  await evaluate('(() => { const menu = document.getElementById("mapMenu"); menu.scrollTop = 0; [...menu.querySelectorAll("button[data-filler]")].forEach((b) => b.remove()); return "ok"; })()');

  assert.equal(consoleErrors.length, 0, 'erreurs navigateur : ' + consoleErrors.join(' ; ').slice(0, 200));
  console.log(JSON.stringify({ ok: true, suite: 'v38-sousmenu-scroll' }));
} finally {
  socket?.close();
  if (browser.exitCode === null) { browser.kill('SIGTERM'); await sleep(500); }
  if (browser.exitCode === null) browser.kill('SIGKILL');
  server.kill('SIGTERM');
  try { await rm(profile, { recursive: true, force: true }); } catch (error) {}
}
