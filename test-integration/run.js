'use strict';
// Lanzador de las pruebas de integración de DotPilot.
//
//   node test-integration/run.js [conjunto]
//
// Conjuntos (qué extensiones de Microsoft acompañan a DotPilot en el VS Code de prueba):
//   csharp             C# (ms-dotnettools.csharp) con su depurador.            [predeterminado]
//   devkit-stable      C# + C# Dev Kit estable, copiados de tu VS Code.
//   devkit-prerelease  C# + C# Dev Kit en pre-release, instalados del Marketplace (requiere red).
//   sin-csharp         Sin ninguna extensión de Microsoft: comprueba que Ejecutar y Hot Reload funcionan.
//
// Variables: DOTPILOT_VSCODE (ruta de Code.exe), DOTPILOT_KEEP=1 (conserva la carpeta temporal),
//            DOTPILOT_REINSTALL=1 (vuelve a preparar las extensiones del conjunto),
//            DOTPILOT_ONLY=texto (ejecuta solo las pruebas cuyo nombre lo contiene).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { runTests, downloadAndUnzipVSCode } = require('@vscode/test-electron');

const root = path.resolve(__dirname, '..');
const SETS = {
  'csharp': { local: ['ms-dotnettools.vscode-dotnet-runtime', 'ms-dotnettools.csharp'] },
  'devkit-stable': { local: ['ms-dotnettools.vscode-dotnet-runtime', 'ms-dotnettools.csharp', 'ms-dotnettools.csdevkit'] },
  'devkit-prerelease': { preRelease: ['ms-dotnettools.csharp', 'ms-dotnettools.csdevkit'] },
  'sin-csharp': { local: [] }
};

// Estas variables las pone el VS Code desde el que se lanza este script y rompen un VS Code hijo.
for (const key of Object.keys(process.env)) {
  if (key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('VSCODE_')) delete process.env[key];
}

function findLocalExtension(id) {
  const base = path.join(os.homedir(), '.vscode', 'extensions');
  const prefix = `${id.toLowerCase()}-`;
  const match = fs.readdirSync(base).filter(name => name.toLowerCase().startsWith(prefix)).sort().pop();
  return match ? path.join(base, match) : undefined;
}

async function resolveVSCode() {
  if (process.env.DOTPILOT_VSCODE) return process.env.DOTPILOT_VSCODE;
  const known = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
    'C:\\Program Files\\Microsoft VS Code\\Code.exe',
    '/usr/share/code/code', '/Applications/Visual Studio Code.app/Contents/MacOS/Electron'
  ];
  return known.find(candidate => candidate && fs.existsSync(candidate)) || downloadAndUnzipVSCode('stable');
}

function cliPathFor(codeExecutable) {
  const dir = path.dirname(codeExecutable);
  if (process.platform === 'win32') return path.join(dir, 'bin', 'code.cmd');
  if (process.platform === 'darwin') return path.join(dir, '..', 'Resources', 'app', 'bin', 'code');
  return path.join(dir, 'bin', 'code');
}

function prepareExtensions(setName, set, extDir, code) {
  const marker = path.join(extDir, '.dotpilot-ready');
  if (fs.existsSync(marker) && !process.env.DOTPILOT_REINSTALL) return;
  fs.rmSync(extDir, { recursive: true, force: true });
  fs.mkdirSync(extDir, { recursive: true });
  for (const id of set.local || []) {
    const source = findLocalExtension(id);
    if (!source) throw new Error(`No encontré ${id} en tu VS Code. Instálala o usa otro conjunto.`);
    console.log(`  copiando ${path.basename(source)}`);
    fs.cpSync(source, path.join(extDir, path.basename(source)), { recursive: true });
  }
  if (set.preRelease?.length) {
    const cli = cliPathFor(code);
    if (!fs.existsSync(cli)) throw new Error(`No encontré el CLI de VS Code en ${cli}.`);
    for (const id of set.preRelease) {
      console.log(`  instalando ${id} (pre-release) desde el Marketplace…`);
      const args = ['--extensions-dir', extDir, '--install-extension', id, '--pre-release', '--force'];
      const result = process.platform === 'win32'
        ? cp.spawnSync(`"${cli}"`, args.map(arg => `"${arg}"`), { encoding: 'utf8', stdio: 'inherit', shell: true })
        : cp.spawnSync(cli, args, { encoding: 'utf8', stdio: 'inherit' });
      if (result.error) throw new Error(`No se pudo ejecutar el CLI de VS Code: ${result.error.message}`);
      if (result.status !== 0) throw new Error(`No se pudo instalar ${id} (código ${result.status}).`);
    }
  }
  fs.writeFileSync(marker, new Date().toISOString());
}

function printReport(setName, data) {
  const { meta, results } = data;
  console.log(`\n── Resultado · conjunto "${setName}" ──`);
  console.log(`VS Code ${meta.vscode} · DotPilot ${meta.dotpilot} · C# ${meta.csharp ?? 'no instalada'} · Dev Kit ${meta.csdevkit ?? 'no instalado'}${meta.csdevkit ? (meta.csdevkitActive ? ' (activo)' : ' (no activo)') : ''}`);
  for (const r of results) {
    const mark = { pass: 'OK   ', fail: 'FALLA', skip: 'OMITE' }[r.status];
    console.log(`  ${mark}  ${r.name}  (${(r.ms / 1000).toFixed(1)} s)${r.note ? `  — ${r.note}` : ''}`);
    if (r.error) console.log(r.error.split('\n').slice(0, 6).map(line => '           ' + line).join('\n'));
    if (r.steps?.length) console.log(['           pasos:', ...r.steps.map(line => '             ' + line)].join('\n'));
    if (r.state) console.log('           estado: ' + JSON.stringify(r.state));
  }
  const count = status => results.filter(r => r.status === status).length;
  console.log(`\n${count('pass')} pasaron · ${count('fail')} fallaron · ${count('skip')} omitidas\n`);
}

async function main() {
  const setName = process.argv[2] || process.env.DOTPILOT_SET || 'csharp';
  const set = SETS[setName];
  if (!set) { console.error(`Conjunto desconocido "${setName}". Opciones: ${Object.keys(SETS).join(', ')}`); process.exit(2); }

  const code = await resolveVSCode();
  console.log(`Conjunto: ${setName}\nVS Code:  ${code}`);
  const cache = path.join(os.tmpdir(), 'dotpilot-it-cache', setName);
  const extDir = path.join(cache, 'extensions');
  prepareExtensions(setName, set, extDir, code);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dotpilot-it-'));
  // El espacio de trabajo reúne varios proyectos (.NET, Node.js, PHP y Python), como una solución real.
  const workspace = path.join(work, 'workspace');
  const fixture = path.join(workspace, 'WebSample');
  const userData = path.join(work, 'user-data');
  const results = path.join(work, 'results.json');
  for (const name of ['WebSample', 'NodeSample', 'PhpSample', 'PythonSample']) {
    fs.cpSync(path.join(__dirname, 'fixtures', name), path.join(workspace, name), { recursive: true });
  }
  // Las pruebas no deben abrir ventanas de navegador; la que verifica la apertura la activa por su cuenta.
  fs.mkdirSync(path.join(workspace, '.vscode'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({ 'dotpilot.openBrowser': false }, null, 2));
  fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'User', 'settings.json'), JSON.stringify({
    'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false,
    'extensions.ignoreRecommendations': true, 'workbench.startupEditor': 'none', 'window.restoreWindows': 'none',
    'security.workspace.trust.enabled': false
  }, null, 2));

  let exitCode = 0;
  try {
    await runTests({
      vscodeExecutablePath: code,
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(__dirname, 'suite', 'index.js'),
      launchArgs: [workspace, `--user-data-dir=${userData}`, `--extensions-dir=${extDir}`, '--disable-gpu'],
      extensionTestsEnv: { DOTPILOT_HOME: path.join(work, 'dotpilot-home'), DOTPILOT_RESULTS: results, DOTPILOT_FIXTURE_DIR: fixture, DOTPILOT_SET: setName, DOTPILOT_ONLY: process.env.DOTPILOT_ONLY || '' }
    });
  } catch (error) {
    exitCode = 1;
    console.error(`\nLa ejecución terminó con error: ${error.message}`);
  }
  if (fs.existsSync(results)) {
    const data = JSON.parse(fs.readFileSync(results, 'utf8'));
    printReport(setName, data);
    if (data.results.some(r => r.status === 'fail')) exitCode = 1;
    const out = path.join(__dirname, '.results');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, `${setName}.json`), JSON.stringify(data, null, 2));
  } else {
    console.error('No se generó el archivo de resultados: VS Code no llegó a ejecutar las pruebas.');
    exitCode = 1;
  }
  if (!process.env.DOTPILOT_KEEP) {
    // La limpieza es de cortesía: un servidor de compilación de .NET puede conservar archivos abiertos un momento.
    try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 6, retryDelay: 500 }); }
    catch (error) { console.warn(`Aviso: no se pudo borrar ${work} (${error.code}). Puedes eliminarla manualmente.`); }
  }
  else console.log(`Carpeta temporal conservada: ${work}`);
  process.exit(exitCode);
}

main().catch(error => { console.error(error); process.exit(1); });
