'use strict';
// Genera las capturas de media/screenshots con un VS Code real y proyectos de ejemplo.
//
//   node test-integration/screenshots.js
//
// Requiere haber corrido antes `npm run test:integration` (deja en caché las extensiones de C#) y el SDK de .NET.
// Variables: DOTPILOT_VSCODE (ruta de Code.exe), DOTPILOT_SHOTS_OUT (carpeta de salida), DOTPILOT_KEEP=1.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

const root = path.resolve(__dirname, '..');
const OUT = process.env.DOTPILOT_SHOTS_OUT || path.join(root, 'media', 'screenshots');
const PORT = 9333;
const VIEWPORT = { width: 1280, height: 960 };
const SCALE = 2;
const PANEL_HEIGHT = 860;
const TALL = { width: 1280, height: 1500 };

// Estas variables las pone el VS Code desde el que se lanza este script y rompen un VS Code hijo.
for (const key of Object.keys(process.env)) {
  if (key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('VSCODE_')) delete process.env[key];
}

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

function buildWorkspace(workspace, laragon) {
  const project = (name, port, extra = '') => {
    write(path.join(workspace, name, `${name}.csproj`), '<Project Sdk="Microsoft.NET.Sdk.Web">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n    <Nullable>enable</Nullable>\n    <ImplicitUsings>enable</ImplicitUsings>\n  </PropertyGroup>\n</Project>\n');
    write(path.join(workspace, name, 'Properties', 'launchSettings.json'), JSON.stringify({ profiles: { http: {
      commandName: 'Project', launchBrowser: false, applicationUrl: `http://localhost:${port}`, environmentVariables: { ASPNETCORE_ENVIRONMENT: 'Development' }
    } } }, null, 2));
    write(path.join(workspace, name, 'Program.cs'), extra);
  };
  project('Shop.Api', 5291, ['var builder = WebApplication.CreateBuilder(args);', 'var app = builder.Build();', '', 'app.MapGet("/api/products", () => new[] { "Keyboard", "Mouse" });', '', 'app.Run();', ''].join('\n'));
  project('Shop.Web', 5290, ['var builder = WebApplication.CreateBuilder(args);', 'var app = builder.Build();', '', 'app.MapGet("/", () => "Shop.Web (uses Shop.Api on :5291)");', '', 'app.Run();', ''].join('\n'));
  write(path.join(workspace, 'Shop.Web', 'appsettings.json'), JSON.stringify({ ApiBaseUrl: 'http://localhost:5291' }, null, 2));

  write(path.join(workspace, 'web-client', 'package.json'), JSON.stringify({
    name: 'web-client', private: true, scripts: { dev: 'node server.js' },
    dependencies: { react: '^18.3.0', 'react-dom': '^18.3.0' }, devDependencies: { vite: '^5.4.0' }
  }, null, 2));
  write(path.join(workspace, 'web-client', 'server.js'), [
    "const http = require('node:http');",
    "http.createServer((req, res) => res.end('web-client')).listen(5173, '127.0.0.1', () => {",
    "  console.log('  VITE v5.4.0  ready');",
    "  console.log('  Local:   http://localhost:5173/');",
    '});', ''].join('\n'));

  write(path.join(workspace, 'shop', 'index.php'), '<?php echo "Shop";\n');
  write(path.join(workspace, 'shop', 'composer.json'), JSON.stringify({ name: 'acme/shop' }, null, 2));

  // Laragon de mentira: solo lo que DotPilot lee para ofrecer el perfil Apache (no se inicia nada).
  const apache = path.join(laragon, 'bin', 'apache', 'httpd-2.4.0-test');
  for (const dir of [path.join(apache, 'bin'), path.join(apache, 'conf'), path.join(laragon, 'usr'), path.join(laragon, 'etc', 'apache2', 'sites-enabled')]) fs.mkdirSync(dir, { recursive: true });
  write(path.join(laragon, 'laragon.exe'), '');
  write(path.join(apache, 'bin', 'httpd.exe'), '');
  write(path.join(apache, 'conf', 'httpd.conf'), 'Listen 80\nErrorLog "logs/error_log"\n');
  write(path.join(laragon, 'usr', 'laragon.ini'), `[apache]\nDocumentRoot=${workspace}\n`);

  write(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({ 'dotpilot.openBrowser': false, 'dotpilot.laragonPath': laragon }, null, 2));
}

// Cliente mínimo del protocolo de depuración remota de Chromium.
async function connect(port) {
  let target;
  for (let attempt = 0; attempt < 120 && !target; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find(item => item.type === 'page' && /workbench/.test(item.url));
    } catch { /* VS Code aún no abre el puerto */ }
    if (!target) await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!target) throw new Error('No se pudo conectar a la ventana de VS Code (puerto de depuración remota).');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`)); else entry.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  return { send, evaluate, close: () => socket.close() };
}

const RECT = selector => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`;

async function shoot(cdp, name, rect) {
  const pad = Math.max(0, Math.round(rect.x * 100) / 100);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: pad, y: rect.y, width: rect.width, height: rect.height, scale: 1 } });
  const file = path.join(OUT, `${name}.png`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`  ${name}.png  ${Math.round(rect.width * SCALE)}×${Math.round(rect.height * SCALE)}`);
}

async function titleActions(cdp) {
  const rect = await cdp.evaluate(`(() => {
    const groups = [...document.querySelectorAll('.part.editor .editor-group-container .title .editor-actions')].filter(el => el.getBoundingClientRect().width > 0);
    const el = groups[0]; if (!el) return null;
    const r = el.getBoundingClientRect();
    const items = [...el.querySelectorAll('a.action-label')];
    const own = items.find(item => /dotpilot/i.test((item.getAttribute('aria-label') || '') + (item.title || '')));
    const o = own ? own.getBoundingClientRect() : null;
    const bar = el.closest('.title').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, barTop: bar.y, barHeight: bar.height, own: o && { x: o.x + o.width / 2, y: o.y + o.height / 2 } };
  })()`);
  if (!rect) throw new Error('No se encontró la barra de acciones del editor.');
  return rect;
}

// Aparta el puntero para que no quede ningún resaltado ni descripción emergente en la captura.
async function parkMouse(cdp) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 500 });
  await new Promise(resolve => setTimeout(resolve, 700));
}

const handlers = {
  async 'panel-settings'(cdp) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...TALL, deviceScaleFactor: SCALE, mobile: false });
    await new Promise(resolve => setTimeout(resolve, 900));
    const side = await cdp.evaluate(RECT('.part.sidebar'));
    const activity = await cdp.evaluate(RECT('.part.activitybar'));
    const title = await cdp.evaluate(RECT('.part.titlebar'));
    const top = title ? title.y + title.height : 0;
    await shoot(cdp, 'panel-settings', { x: 0, y: top, width: side.x + side.width + (activity ? 0 : 0), height: 1180 });
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: SCALE, mobile: false });
  },
  async 'panel-dotnet'(cdp, layout) { await shoot(cdp, 'panel-dotnet', layout.panel); },
  async 'panel-node'(cdp, layout) { await shoot(cdp, 'panel-node', layout.panel); },
  async 'panel-apache'(cdp, layout) { await shoot(cdp, 'panel-apache', layout.panel); },
  async 'toolbar-idle'(cdp) {
    await parkMouse(cdp);
    const bar = await titleActions(cdp);
    await shoot(cdp, 'toolbar-idle', { x: bar.x - 8, y: bar.barTop, width: bar.width + 16, height: bar.barHeight });
  },
  async 'toolbar-running'(cdp) {
    await parkMouse(cdp);
    const bar = await titleActions(cdp);
    await shoot(cdp, 'toolbar-running', { x: bar.x - 8, y: bar.barTop, width: bar.width + 16, height: bar.barHeight });
  },
  async 'toolbar-menu'(cdp) {
    await parkMouse(cdp);
    const bar = await titleActions(cdp);
    if (!bar.own) throw new Error('No se encontró el botón de DotPilot en la barra del editor.');
    for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: bar.own.x, y: bar.own.y, button: 'left', clickCount: 1 });
    await new Promise(resolve => setTimeout(resolve, 700));
    const menu = await cdp.evaluate(RECT('.monaco-menu-container .monaco-menu'));
    if (!menu) throw new Error('El menú de DotPilot no se abrió.');
    const left = Math.min(bar.x, menu.x) - 10, right = Math.max(bar.x + bar.width, menu.x + menu.width) + 10;
    await shoot(cdp, 'toolbar-menu', { x: left, y: bar.barTop, width: right - left, height: menu.y + menu.height - bar.barTop + 10 });
    for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  }
};

async function panelRect(cdp) {
  const [activity, side, title] = await Promise.all([RECT('.part.activitybar'), RECT('.part.sidebar'), RECT('.part.titlebar')].map(expression => cdp.evaluate(expression)));
  if (!activity || !side) throw new Error('No se encontró la barra de actividad o la barra lateral.');
  const top = title ? title.y + title.height : 0;
  return { x: 0, y: top, width: side.x + side.width, height: Math.min(PANEL_HEIGHT, VIEWPORT.height - top) };
}

async function main() {
  const cache = path.join(os.tmpdir(), 'dotpilot-it-cache', 'csharp', 'extensions');
  if (!fs.existsSync(cache)) console.warn('Aviso: no hay extensiones en caché (corre npm run test:integration una vez); se continúa sin C#.');
  const code = process.env.DOTPILOT_VSCODE || [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'), 'C:\\Program Files\\Microsoft VS Code\\Code.exe'].find(fs.existsSync);
  if (!code) throw new Error('No se encontró VS Code. Define DOTPILOT_VSCODE con la ruta de Code.exe.');

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dotpilot-shots-'));
  const workspace = path.join(work, 'workspace');
  const laragon = path.join(work, 'laragon');
  const userData = path.join(work, 'user-data');
  const marks = path.join(work, 'marks');
  fs.mkdirSync(marks, { recursive: true });
  buildWorkspace(workspace, laragon);
  write(path.join(userData, 'User', 'settings.json'), JSON.stringify({
    'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false, 'extensions.ignoreRecommendations': true,
    'workbench.startupEditor': 'none', 'window.restoreWindows': 'none', 'security.workspace.trust.enabled': false,
    'workbench.tips.enabled': false, 'workbench.secondarySideBar.defaultVisibility': 'hidden', 'chat.disableAIFeatures': true,
    'window.commandCenter': false, 'workbench.layoutControl.enabled': false, 'editor.minimap.enabled': false,
    'workbench.colorTheme': 'Default Dark Modern', 'dotpilot.assistantsEnabled': true, 'dotpilot.showEditorToolbar': true
  }, null, 2));

  console.log('Generando capturas en', OUT);
  const finished = runTests({
    vscodeExecutablePath: code,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, 'screenshots-suite.js'),
    launchArgs: [workspace, `--user-data-dir=${userData}`, ...(fs.existsSync(cache) ? [`--extensions-dir=${cache}`] : []), '--disable-gpu', `--remote-debugging-port=${PORT}`],
    extensionTestsEnv: { DOTPILOT_HOME: path.join(work, 'dotpilot-home'), DOTPILOT_SHOTS_DIR: marks, DOTPILOT_SHOTS_WORKSPACE: workspace }
  }).catch(error => ({ error }));

  let failure;
  try {
    const cdp = await connect(PORT);
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: SCALE, mobile: false });
    const seen = new Set();
    let over = false;
    finished.then(() => { over = true; });
    while (!over) {
      for (const file of fs.readdirSync(marks).filter(name => name.endsWith('.ready'))) {
        const name = file.slice(0, -'.ready'.length);
        if (seen.has(name)) continue;
        seen.add(name);
        if (name !== 'end') {
          if (!handlers[name]) throw new Error(`Escena desconocida: ${name}`);
          await handlers[name](cdp, { panel: await panelRect(cdp) });
        }
        write(path.join(marks, `${name}.done`), '');
      }
      if (seen.has('end')) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    cdp.close();
  } catch (error) { failure = error; }
  const result = await finished;
  if (!process.env.DOTPILOT_KEEP) { try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 6, retryDelay: 500 }); } catch { /* cortesía */ } }
  else console.log('Carpeta temporal conservada:', work);
  if (failure) throw failure;
  if (result && result.error) throw result.error;
  console.log('Listo.');
}

main().catch(error => { console.error(error); process.exit(1); });
