'use strict';
// Prueba con un asistente REAL: lanza un VS Code aislado con DotPilot y el puente activo, y le pide a Claude Code
// (el CLI instalado en esta máquina, en modo no interactivo) que maneje la extensión solo por MCP.
//
//   node test-integration/real-assistant.js                    # configuración pasada con --mcp-config
//   node test-integration/real-assistant.js --project-config   # el .mcp.json que escribe «Conectar asistentes de IA»
//
// Variables: DOTPILOT_VSCODE (Code.exe), DOTPILOT_CLAUDE (ruta del CLI), DOTPILOT_ASSISTANT_MODEL (predeterminado: haiku),
//            DOTPILOT_ASSISTANT_BUDGET (USD máximos para la sesión del asistente, predeterminado 1.5).
// Requisitos: sesión iniciada en Claude Code; el consumo de la sesión corre por tu cuenta. No toca tu perfil de
// VS Code ni tu configuración de Claude: usa una carpeta temporal y --strict-mcp-config.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { runTests } = require('@vscode/test-electron');

const root = path.resolve(__dirname, '..');
for (const key of Object.keys(process.env)) {
  // Variables de la sesión que nos lanza: romperían el VS Code hijo o conectarían al asistente con esta ventana.
  if (key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('VSCODE_') || /^CLAUDECODE$|^CLAUDE_CODE_(ENTRYPOINT|SSE_PORT|IDE.*)$/.test(key)) delete process.env[key];
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function findCode() {
  if (process.env.DOTPILOT_VSCODE) return process.env.DOTPILOT_VSCODE;
  return [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
    'C:\\Program Files\\Microsoft VS Code\\Code.exe', '/usr/share/code/code', '/Applications/Visual Studio Code.app/Contents/MacOS/Electron'
  ].find(candidate => candidate && fs.existsSync(candidate));
}

const PROMPT = [
  'Usa ÚNICAMENTE las herramientas del servidor MCP "dotpilot" (nombres dotpilot_*). No uses Bash ni otras herramientas.',
  'Haz esto en orden y numera tus respuestas:',
  '1. Lista los proyectos e indica cuántos hay y de qué tipo.',
  '2. Selecciona el proyecto Node.js "NodeSample" y ejecútalo.',
  '3. Dime la URL en la que escucha y cita la línea de su salida donde aparece.',
  '4. Detenlo y confirma que el estado quedó en idle.',
  '5. Selecciona el proyecto .NET "WebSample.csproj" y ejecútalo.',
  '6. Lee su salida y dime si Kestrel arrancó (cita la línea "Now listening on"). Luego detenlo y confirma idle.',
  'Termina con una línea que diga "RESULTADO: OK" si todo funcionó o "RESULTADO: FALLÓ" con el motivo.'
].join('\n');

async function main() {
  // --project-config: sin --mcp-config; Claude Code lee el .mcp.json que escribe «Conectar asistentes de IA».
  const projectConfig = process.argv.includes('--project-config');
  const code = findCode();
  if (!code) throw new Error('No encontré VS Code. Define DOTPILOT_VSCODE.');
  const claude = process.env.DOTPILOT_CLAUDE || 'claude';

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dotpilot-real-'));
  const workspace = path.join(work, 'workspace');
  const userData = path.join(work, 'user-data');
  const extensions = path.join(work, 'extensions');
  const hold = path.join(work, 'hold');
  const home = path.join(work, 'dotpilot-home');
  for (const dir of [extensions, hold, path.join(userData, 'User'), path.join(workspace, '.vscode')]) fs.mkdirSync(dir, { recursive: true });
  for (const name of ['WebSample', 'NodeSample', 'PhpSample', 'PythonSample']) {
    fs.cpSync(path.join(__dirname, 'fixtures', name), path.join(workspace, name), { recursive: true });
  }
  fs.writeFileSync(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({ 'dotpilot.openBrowser': false }, null, 2));
  fs.writeFileSync(path.join(userData, 'User', 'settings.json'), JSON.stringify({
    'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false, 'extensions.ignoreRecommendations': true,
    'workbench.startupEditor': 'none', 'window.restoreWindows': 'none', 'security.workspace.trust.enabled': false
  }, null, 2));

  console.log(`Carpeta de trabajo: ${work}`);
  console.log('Iniciando VS Code aislado con DotPilot…');
  const editor = runTests({
    vscodeExecutablePath: code,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, 'assistant', 'hold.js'),
    launchArgs: [workspace, `--user-data-dir=${userData}`, `--extensions-dir=${extensions}`, '--disable-gpu'],
    extensionTestsEnv: { DOTPILOT_HOME: home, DOTPILOT_HOLD: hold, ...(projectConfig ? { DOTPILOT_WRITE_MCP_JSON: '1' } : {}) }
  }).catch(error => ({ error }));

  const readyFile = path.join(hold, 'ready.json');
  const waitUntil = Date.now() + 120000;
  while (!fs.existsSync(readyFile) && Date.now() < waitUntil) await sleep(250);
  if (!fs.existsSync(readyFile)) throw new Error('DotPilot no activó el puente en 2 minutos.');
  console.log('Puente listo. Lanzando Claude Code (modo no interactivo)…\n');

  const mcpConfig = path.join(work, 'mcp.json');
  fs.writeFileSync(mcpConfig, JSON.stringify({
    mcpServers: { dotpilot: { command: 'node', args: [path.join(home, 'mcp', 'mcp-server.js')], env: { DOTPILOT_HOME: home } } }
  }, null, 2));
  const args = [
    '-p', PROMPT,
    ...(projectConfig ? ['--settings', JSON.stringify({ enableAllProjectMcpServers: true })] : ['--mcp-config', mcpConfig, '--strict-mcp-config']),
    '--allowedTools', 'mcp__dotpilot',
    '--disallowedTools', 'Bash', 'Write', 'Edit', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task',
    '--model', process.env.DOTPILOT_ASSISTANT_MODEL || 'haiku', '--max-turns', '40',
    '--max-budget-usd', process.env.DOTPILOT_ASSISTANT_BUDGET || '1.5',
    '--output-format', 'stream-json', '--verbose', '--no-session-persistence'
  ];
  const events = [];
  let stderr = '';
  const started = Date.now();
  const assistant = await new Promise(resolve => {
    const child = spawn(claude, args, { cwd: workspace, env: { ...process.env, DOTPILOT_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        try { events.push(JSON.parse(line)); } catch { /* línea no JSON */ }
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => resolve({ error }));
    child.on('close', code => resolve({ code }));
    setTimeout(() => { child.kill(); resolve({ timeout: true }); }, 8 * 60 * 1000);
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(0);

  fs.writeFileSync(path.join(hold, 'done'), '');
  const editorResult = await editor;
  let observations = { observations: [] };
  try { observations = JSON.parse(fs.readFileSync(path.join(hold, 'observations.json'), 'utf8')); } catch { /* sin observaciones */ }

  // ---- Qué hizo el asistente ----
  const calls = [];
  const results = new Map();
  let finalText = '', summary;
  for (const event of events) {
    for (const part of event.message?.content || []) {
      if (event.type === 'assistant' && part.type === 'tool_use') calls.push({ id: part.id, name: part.name.replace(/^mcp__dotpilot__/, ''), input: part.input });
      if (event.type === 'user' && part.type === 'tool_result') {
        const text = Array.isArray(part.content) ? part.content.map(item => item.text || '').join('') : String(part.content || '');
        results.set(part.tool_use_id, { isError: !!part.is_error, text });
      }
      if (event.type === 'assistant' && part.type === 'text') finalText = part.text;
    }
    if (event.type === 'result') summary = event;
  }
  const trace = calls.map(call => ({ ...call, result: results.get(call.id) }));
  // ToolSearch es el cargador de herramientas diferidas del propio Claude Code, no una herramienta de otro servidor.
  const names = trace.map(item => item.name).filter(name => name !== 'ToolSearch');
  const count = name => names.filter(item => item === name).length;
  const sawPort = key => observations.observations.some(item => item[key]);
  const lastObs = observations.observations.at(-1);

  const checks = [
    ['el asistente solo usó herramientas de DotPilot', names.length > 0 && names.every(name => name.startsWith('dotpilot_'))],
    ['listó los proyectos', count('dotpilot_list_projects') >= 1],
    ['seleccionó dos proyectos', count('dotpilot_select_project') >= 2],
    ['ejecutó dos veces', count('dotpilot_run') >= 2],
    ['leyó la salida', count('dotpilot_get_output') >= 1],
    ['detuvo dos veces', count('dotpilot_stop') >= 2],
    ['ninguna llamada devolvió error', trace.every(item => item.result && !item.result.isError)],
    ['la salida de .NET que leyó contiene la línea de Kestrel', trace.some(item => item.name === 'dotpilot_get_output' && /Now listening on/.test(item.result?.text || ''))],
    ['el puerto de Node.js (5189) estuvo abierto en VS Code', sawPort('node')],
    ['el puerto de .NET (5187) estuvo abierto en VS Code', sawPort('net')],
    ['al final no queda nada en ejecución', !!lastObs && !lastObs.node && !lastObs.net && !lastObs.active],
    ['la respuesta final dice RESULTADO: OK', /RESULTADO:\s*OK/i.test(finalText)]
  ];

  const report = { when: new Date().toISOString(), claude: summary?.model || null, version: events.find(e => e.type === 'system')?.claude_code_version || null, seconds: Number(seconds), assistant, editor: editorResult?.error ? String(editorResult.error.message) : 'ok', cost: summary?.total_cost_usd ?? null, turns: summary?.num_turns ?? null, checks: Object.fromEntries(checks), trace, finalText, observations: observations.observations, stderr: stderr.slice(-2000) };
  const out = path.join(__dirname, '.results');
  fs.mkdirSync(out, { recursive: true });
  const reportFile = path.join(out, projectConfig ? 'real-assistant-project-config.json' : 'real-assistant.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

  console.log('── Llamadas del asistente ──');
  for (const item of trace) console.log(`  ${item.result?.isError ? 'ERROR' : 'ok   '}  ${item.name}${Object.keys(item.input || {}).length ? ' ' + JSON.stringify(item.input) : ''}`);
  console.log('\n── Respuesta final del asistente ──\n' + finalText.split('\n').map(line => '  ' + line).join('\n'));
  console.log(`\n── Comprobaciones (${seconds} s, ${summary?.num_turns ?? '?'} turnos, USD ${summary?.total_cost_usd ?? '?'}) ──`);
  for (const [name, ok] of checks) console.log(`  ${ok ? 'OK   ' : 'FALLA'}  ${name}`);
  if (assistant.error || assistant.timeout) console.log(`\nEl asistente no terminó bien: ${assistant.error?.message || 'tiempo agotado'}`);
  if (stderr.trim()) console.log('\nstderr del asistente (últimas líneas):\n' + stderr.trim().split('\n').slice(-5).join('\n'));
  console.log(`\nInforme completo: ${reportFile}`);

  try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 6, retryDelay: 500 }); } catch { console.log(`Aviso: no se pudo borrar ${work}.`); }
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}

main().catch(error => { console.error(error); process.exit(1); });
