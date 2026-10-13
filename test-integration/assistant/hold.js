'use strict';
// Punto de entrada para la prueba con un asistente REAL (ver ../real-assistant.js).
// Corre dentro de VS Code: activa el puente de DotPilot, avisa que está listo y se queda esperando mientras
// un asistente externo maneja la extensión. Mientras tanto anota, desde dentro, qué pasó con los puertos.
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { getController, waitFor, portOpen, sleep, PORT_HTTP, PORT_NODE } = require('../suite/helpers');

async function run() {
  const hold = process.env.DOTPILOT_HOLD;
  const controller = await getController();
  const config = vscode.workspace.getConfiguration('dotpilot');
  // 'allow': en esta ventana de prueba nadie puede pulsar «Permitir».
  await config.update('assistantsEnabled', true, vscode.ConfigurationTarget.Global);
  await config.update('assistantsPermission', 'allow', vscode.ConfigurationTarget.Global);
  await waitFor(() => controller.bridge && controller.bridge.port, { timeout: 30000, message: 'que el puente local se inicie' });
  await waitFor(() => controller.projects.length >= 1 && controller.apps.length >= 1, { timeout: 30000, message: 'que se detecten los proyectos' });

  const observations = [];
  let last = '';
  const sample = async () => {
    const entry = {
      net: await portOpen(PORT_HTTP), node: await portOpen(PORT_NODE), active: controller.active(),
      mode: controller.lastMode, url: controller.listeningUrl || null,
      project: controller.project ? path.basename(controller.project.fsPath) : null, outputLines: controller.recentOutput.length
    };
    const key = JSON.stringify({ ...entry, outputLines: undefined });
    if (key !== last) { last = key; observations.push({ at: new Date().toISOString().slice(11, 23), ...entry }); }
  };

  if (process.env.DOTPILOT_WRITE_MCP_JSON) {
    // Mismo archivo que escribe «Conectar asistentes de IA» para Claude Code (configuración del proyecto).
    const { mergeJsonConfig } = require(path.join(vscode.extensions.getExtension('camiloruizx.dotpilot').extensionPath, 'src', 'assistants.js'));
    const script = controller.agentApi().installServer();
    const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
    fs.writeFileSync(path.join(root, '.mcp.json'), mergeJsonConfig('', script));
  }
  if (process.env.DOTPILOT_WRITE_CONFIGS) {
    // Los archivos de configuración de cada asistente, generados con el mismo código que «Conectar asistentes de IA».
    const assistants = require(path.join(vscode.extensions.getExtension('camiloruizx.dotpilot').extensionPath, 'src', 'assistants.js'));
    const script = controller.agentApi().installServer();
    const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
    fs.mkdirSync(path.join(root, '.gemini'), { recursive: true });
    fs.mkdirSync(path.join(hold, 'codex'), { recursive: true });
    fs.writeFileSync(path.join(root, '.mcp.json'), assistants.mergeJsonConfig('', script));
    fs.writeFileSync(path.join(root, '.gemini', 'settings.json'), assistants.mergeJsonConfig('', script));
    fs.writeFileSync(path.join(hold, 'codex', 'config.toml'), assistants.mergeTomlConfig('', script));
  }
  fs.writeFileSync(path.join(hold, 'ready.json'), JSON.stringify({ port: controller.bridge.port, home: process.env.DOTPILOT_HOME }));
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline && !fs.existsSync(path.join(hold, 'done'))) {
    await sample();
    await sleep(200);
  }
  await sample();
  fs.writeFileSync(path.join(hold, 'observations.json'), JSON.stringify({
    observations, finalActive: controller.active(), bridgeCalls: controller.agent?.session ? [...controller.agent.session] : []
  }, null, 2));
  await config.update('assistantsEnabled', undefined, vscode.ConfigurationTarget.Global);
  await config.update('assistantsPermission', undefined, vscode.ConfigurationTarget.Global);
}

module.exports = { run };
