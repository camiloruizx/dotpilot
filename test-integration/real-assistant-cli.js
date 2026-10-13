'use strict';
// Prueba con asistentes REALES distintos de Claude Code: Codex, Gemini CLI y GitHub Copilot CLI.
// Lanza un VS Code aislado con DotPilot y el puente activo, y le pide al CLI elegido que maneje la extensión solo
// por MCP. La evidencia principal sale de VS Code (puertos que se abrieron y cerraron) y de la salida del asistente.
//
//   node test-integration/real-assistant-cli.js codex
//   node test-integration/real-assistant-cli.js gemini
//   node test-integration/real-assistant-cli.js copilot
//
// Requisitos: el CLI instalado y con sesión iniciada. El consumo corre por tu cuenta. No toca tu perfil de VS Code
// ni tu configuración de los asistentes (carpetas temporales, variables de entorno y opciones de línea de comandos).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { runTests } = require('@vscode/test-electron');

const root = path.resolve(__dirname, '..');
for (const key of Object.keys(process.env)) {
  if (key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('VSCODE_') || /^CLAUDECODE$|^CLAUDE_CODE_(ENTRYPOINT|SSE_PORT|IDE.*)$/.test(key)) delete process.env[key];
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const which = name => process.env['DOTPILOT_' + name.toUpperCase()] || name;

function findCode() {
  if (process.env.DOTPILOT_VSCODE) return process.env.DOTPILOT_VSCODE;
  return [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'), 'C:\\Program Files\\Microsoft VS Code\\Code.exe',
    '/usr/share/code/code', '/Applications/Visual Studio Code.app/Contents/MacOS/Electron'].find(candidate => candidate && fs.existsSync(candidate));
}

const PROMPT = [
  'Use ONLY the tools of the MCP server named "dotpilot" (tool names dotpilot_*). Do not use shell commands, file tools or tools of other servers.',
  'If the dotpilot tools are not listed directly, they are deferred: use your tool search / discovery facility to load them first.',
  'Do this in order and number your answers:',
  '1. List the projects and say how many there are and of which types.',
  '2. Select the Node.js project "NodeSample" and run it.',
  '3. Tell me the URL it listens on and quote the output line where it appears.',
  '4. Stop it and confirm the state is idle.',
  '5. Select the .NET project "WebSample.csproj" and run it.',
  '6. Read its output and tell me whether Kestrel started (quote the "Now listening on" line). Then stop it and confirm idle.',
  'Finish with one line saying "RESULT: OK" if everything worked or "RESULT: FAILED" with the reason.'
].join('\n');

// Cada asistente: cómo se le pasa la configuración MCP y cómo se invoca en modo no interactivo.
const ASSISTANTS = {
  codex: {
    label: 'Codex CLI',
    build: ({ home, script, workspace }) => ({
      command: which('codex'),
      // El modelo predeterminado de la cuenta puede no estar permitido en Codex con ChatGPT: se fija uno disponible.
      args: ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-m', process.env.DOTPILOT_ASSISTANT_MODEL || 'gpt-5.5', '-C', workspace,
        '-c', 'mcp_servers.dotpilot.command="node"',
        '-c', `mcp_servers.dotpilot.args=[${JSON.stringify(script)}]`,
        '-c', `mcp_servers.dotpilot.env={ DOTPILOT_HOME = ${JSON.stringify(home)} }`,
        '-c', 'approval_policy="never"', PROMPT],
      env: { DOTPILOT_HOME: home }
    })
  },
  gemini: {
    label: 'Gemini CLI',
    build: ({ home, workspace }) => ({
      command: which('gemini'),
      // El archivo generado por DotPilot (.gemini/settings.json) se carga como configuración del sistema: el CLI
      // ignora la del proyecto en carpetas no confiables, y esta carpeta es temporal.
      args: ['-p', PROMPT, '--approval-mode', 'yolo', '--allowed-mcp-server-names', 'dotpilot', '-o', 'stream-json'],
      env: { DOTPILOT_HOME: home, GEMINI_CLI_SYSTEM_SETTINGS_PATH: path.join(workspace, '.gemini', 'settings.json') }
    })
  },
  copilot: {
    label: 'GitHub Copilot CLI',
    build: ({ home, script }) => ({
      command: which('copilot'),
      args: ['-p', PROMPT, '--allow-all-tools', '--no-ask-user', '--log-level', 'none',
        '--additional-mcp-config', JSON.stringify({ mcpServers: { dotpilot: { type: 'local', command: 'node', args: [script], env: { DOTPILOT_HOME: home }, tools: ['*'] } } })],
      env: { DOTPILOT_HOME: home }
    })
  }
};

// En Windows los CLIs de npm son .cmd que llaman a un script de Node. Se localiza ese script y se ejecuta con node
// directamente: sin cmd.exe los argumentos (tablas TOML, JSON) llegan exactos.
function resolveCli(command) {
  if (process.platform !== 'win32') return { command, prefix: [] };
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const shim = path.join(dir, command + '.cmd');
    if (!fs.existsSync(shim)) continue;
    const text = fs.readFileSync(shim, 'utf8');
    // El script va entre "%dp0%\… y .js" (sin expresiones regulares: la barra invertida es el separador).
    const end = text.indexOf('.js"');
    const start = end < 0 ? -1 : text.lastIndexOf('"%dp0%', end);
    if (start >= 0 && end > start) {
      const relative = text.slice(start + '"%dp0%'.length, end + 3).split(String.fromCharCode(92)).filter(Boolean);
      return { command: process.execPath, prefix: [path.join(dir, ...relative)] };
    }
  }
  return { command, prefix: [] };
}

function run(command, args, options) {
  return new Promise(resolve => {
    const cli = resolveCli(command);
    const child = spawn(cli.command, [...cli.prefix, ...args], options);
    let stdout = '', stderr = '';
    child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => { stdout += chunk; });
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.on('error', error => resolve({ error, stdout, stderr }));
    child.on('close', code => resolve({ code, stdout, stderr }));
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ya terminó */ } resolve({ timeout: true, stdout, stderr }); }, options.timeout || 8 * 60 * 1000);
    child.on('close', () => clearTimeout(timer));
  });
}

async function main() {
  const name = process.argv[2];
  const assistant = ASSISTANTS[name];
  if (!assistant) { console.error('Uso: node test-integration/real-assistant-cli.js <codex|gemini|copilot>'); process.exit(2); }
  const code = findCode();
  if (!code) throw new Error('No encontré VS Code. Define DOTPILOT_VSCODE.');

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dotpilot-real-'));
  const workspace = path.join(work, 'workspace');
  const userData = path.join(work, 'user-data');
  const hold = path.join(work, 'hold');
  const home = path.join(work, 'dotpilot-home');
  for (const dir of [path.join(work, 'extensions'), hold, path.join(userData, 'User'), path.join(workspace, '.vscode')]) fs.mkdirSync(dir, { recursive: true });
  for (const sample of ['WebSample', 'NodeSample', 'PhpSample', 'PythonSample']) fs.cpSync(path.join(__dirname, 'fixtures', sample), path.join(workspace, sample), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({ 'dotpilot.openBrowser': false }, null, 2));
  fs.writeFileSync(path.join(userData, 'User', 'settings.json'), JSON.stringify({
    'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false, 'extensions.ignoreRecommendations': true,
    'workbench.startupEditor': 'none', 'window.restoreWindows': 'none', 'security.workspace.trust.enabled': false
  }, null, 2));

  console.log(`${assistant.label} · carpeta de trabajo: ${work}`);
  const editor = runTests({
    vscodeExecutablePath: code, extensionDevelopmentPath: root, extensionTestsPath: path.join(__dirname, 'assistant', 'hold.js'),
    launchArgs: [workspace, `--user-data-dir=${userData}`, `--extensions-dir=${path.join(work, 'extensions')}`, '--disable-gpu'],
    extensionTestsEnv: { DOTPILOT_HOME: home, DOTPILOT_HOLD: hold, DOTPILOT_WRITE_CONFIGS: '1' }
  }).catch(error => ({ error }));

  const readyFile = path.join(hold, 'ready.json');
  const deadline = Date.now() + 120000;
  while (!fs.existsSync(readyFile) && Date.now() < deadline) await sleep(250);
  if (!fs.existsSync(readyFile)) throw new Error('DotPilot no activó el puente en 2 minutos.');
  const script = path.join(home, 'mcp', 'mcp-server.js');

  const checks = [];
  const note = (label, ok, detail) => { checks.push([label, !!ok, detail]); };

  // Verificación previa de formato: ¿el CLI entiende el archivo que genera DotPilot?
  if (name === 'codex') {
    const listing = await run(which('codex'), ['mcp', 'list'], { env: { ...process.env, CODEX_HOME: path.join(hold, 'codex') }, cwd: workspace, timeout: 60000 });
    note('Codex lee el config.toml que genera DotPilot (codex mcp list)', /dotpilot/.test(listing.stdout) && !listing.error, listing.stdout.trim().split('\n').slice(0, 4).join(' | ') + (listing.stderr ? ' ' + listing.stderr.slice(0, 160) : ''));
  }

  const spec = assistant.build({ home, script, workspace });
  console.log(`Puente listo. Lanzando ${assistant.label} (modo no interactivo)…`);
  const started = Date.now();
  const result = await run(spec.command, spec.args, { cwd: workspace, env: { ...process.env, ...spec.env }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 8 * 60 * 1000 });
  const seconds = Math.round((Date.now() - started) / 1000);

  fs.writeFileSync(path.join(hold, 'done'), '');
  const editorResult = await editor;
  let observations = [];
  try { observations = JSON.parse(fs.readFileSync(path.join(hold, 'observations.json'), 'utf8')).observations; } catch { /* sin observaciones */ }
  const saw = key => observations.some(item => item[key]);
  const last = observations.at(-1);
  const output = result.stdout + '\n' + result.stderr;
  const mentions = tool => (output.match(new RegExp(tool, 'g')) || []).length;

  note('el asistente terminó sin error ni tiempo agotado', !result.error && !result.timeout && result.code === 0, result.error ? String(result.error.message) : result.timeout ? 'tiempo agotado' : 'código ' + result.code);
  note('invocó herramientas de DotPilot', mentions('dotpilot_') >= 4, mentions('dotpilot_') + ' menciones de dotpilot_*');
  note('ejecutó y detuvo (run ≥ 2, stop ≥ 2 en su salida)', mentions('dotpilot_run') >= 2 && mentions('dotpilot_stop') >= 2, `run ${mentions('dotpilot_run')}, stop ${mentions('dotpilot_stop')}`);
  note('el puerto de Node.js (5189) estuvo abierto en VS Code', saw('node'));
  note('el puerto de .NET (5187) estuvo abierto en VS Code', saw('net'));
  note('al final no queda nada en ejecución', last && !last.node && !last.net && !last.active);
  note('la respuesta incluye la URL de Node.js y la línea de Kestrel', /5189/.test(output) && /Now listening on/.test(output));
  note('la respuesta final dice RESULT: OK', /RESULT:\s*OK/i.test(output));

  const out = path.join(__dirname, '.results');
  fs.mkdirSync(out, { recursive: true });
  const report = { when: new Date().toISOString(), assistant: assistant.label, seconds, exit: result.code ?? null, timeout: !!result.timeout, editor: editorResult?.error ? String(editorResult.error.message) : 'ok', checks, observations, stdoutTail: result.stdout.slice(-6000), stderrTail: result.stderr.slice(-2000) };
  fs.writeFileSync(path.join(out, `real-assistant-${name}.json`), JSON.stringify(report, null, 2));

  console.log(`\n── Comprobaciones (${seconds} s) ──`);
  for (const [label, ok, detail] of checks) console.log(`  ${ok ? 'OK   ' : 'FALLA'}  ${label}${!ok && detail ? '  — ' + detail : ''}`);
  if (checks.some(([, ok]) => !ok)) {
    console.log('\n── Fin de la salida del asistente ──');
    console.log(result.stdout.trim().split('\n').slice(-12).join('\n'));
    if (result.stderr.trim()) console.log('\n── stderr ──\n' + result.stderr.trim().split('\n').slice(-8).join('\n'));
  }
  console.log(`\nInforme completo: ${path.join(out, `real-assistant-${name}.json`)}`);
  try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 6, retryDelay: 500 }); } catch { console.log(`Aviso: no se pudo borrar ${work}.`); }
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}

main().catch(error => { console.error(error); process.exit(1); });
