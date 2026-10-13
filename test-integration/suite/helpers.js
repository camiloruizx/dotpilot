'use strict';
// Utilidades para las pruebas que corren DENTRO del Extension Host de VS Code.
const vscode = require('vscode');
const http = require('node:http');
const net = require('node:net');

const EXT_ID = 'camiloruizx.dotpilot';
const PORT_HTTP = 5187;
const PORT_ALT = 5188;
const PORT_NODE = 5189;
const PORT_PHP = 8000;
const PORT_PY = 5190;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Registro de pasos de la prueba en curso: ayuda a ubicar dónde se atascó una prueba.
const steps = [];
function step(name) { steps.push(`${new Date().toISOString().slice(11, 23)} ${name}`); }

async function waitFor(check, { timeout = 60000, interval = 250, message = 'la condición' } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const value = await check();
      if (value) return value;
    } catch { /* se reintenta hasta agotar el tiempo */ }
    await sleep(interval);
  }
  throw new Error(`Tiempo agotado (${Math.round(timeout / 1000)} s) esperando ${message}`);
}

function portOpen(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const socket = net.connect({ port, host });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

function httpGet(url, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('timeout', () => request.destroy(new Error('La solicitud HTTP agotó el tiempo')));
    request.on('error', reject);
  });
}

// DotPilot devuelve su Controller desde activate(); permite observar el estado real.
async function getController() {
  const extension = vscode.extensions.getExtension(EXT_ID);
  if (!extension) throw new Error(`La extensión ${EXT_ID} no está cargada`);
  return extension.isActive ? extension.exports : extension.activate();
}

async function ensureStopped(controller) {
  if (controller.active() || controller.busy) await vscode.commands.executeCommand('dotpilot.stop');
  await waitFor(() => !controller.active() && !controller.busy, { timeout: 30000, message: 'que termine la ejecución' });
  await waitFor(async () => !(await portOpen(PORT_HTTP)) && !(await portOpen(PORT_ALT)) && !(await portOpen(PORT_NODE)) && !(await portOpen(PORT_PY)),
    { timeout: 30000, message: 'que se liberen los puertos 5187, 5188, 5189 y 5190' });
}

// Maneja un QuickPick abierto por un comando: elige el elemento por posición.
async function pickByIndex(command, index) {
  const finished = vscode.commands.executeCommand(command);
  await sleep(700);
  for (let i = 0; i < index; i++) await vscode.commands.executeCommand('workbench.action.quickOpenSelectNext');
  await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
  await finished;
}

module.exports = { steps, step, EXT_ID, PORT_HTTP, PORT_ALT, PORT_NODE, PORT_PHP, PORT_PY, sleep, waitFor, portOpen, httpGet, getController, ensureStopped, pickByIndex };
