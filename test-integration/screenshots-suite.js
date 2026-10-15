'use strict';
// Parte de screenshots.js que corre DENTRO de VS Code: prepara cada escena y espera a que el lanzador
// (que habla con la ventana por el protocolo de depuración remota) tome la captura.
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { getController, waitFor, portOpen, sleep } = require('./suite/helpers');

const dir = process.env.DOTPILOT_SHOTS_DIR;
const workspace = process.env.DOTPILOT_SHOTS_WORKSPACE;
const at = (...parts) => path.join(workspace, ...parts);

// Avisa al lanzador y espera su `.done`: la captura se toma mientras esta escena está en pantalla.
async function scene(name) {
  await sleep(900);
  fs.writeFileSync(path.join(dir, `${name}.ready`), '');
  await waitFor(() => fs.existsSync(path.join(dir, `${name}.done`)), { timeout: 60000, message: `la captura "${name}"` });
}

async function showPanel(controller) {
  await vscode.commands.executeCommand('workbench.view.extension.dotpilot');
  await waitFor(() => controller.webviewReady && controller.view?.visible, { timeout: 30000, message: 'que el panel esté visible' });
  controller.lastViewState = undefined;
  controller.render();
}

async function run() {
  const controller = await getController();
  await sleep(2500);
  const same = (left, right) => path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();
  const find = file => controller.projects.find(uri => same(uri.fsPath, at(...file.split('/'))));
  await waitFor(() => controller.projects.length >= 2 && controller.apps.length >= 2, { timeout: 60000, message: 'que se detecten los proyectos' });
  await vscode.commands.executeCommand('workbench.action.closePanel');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  // Con un editor abierto aparece la barra de acciones del editor.
  const document = await vscode.workspace.openTextDocument(at('Shop.Web', 'Program.cs'));
  await vscode.window.showTextDocument(document, { preview: false });

  // 1) Proyecto .NET con su API complementaria, en reposo.
  const web = find('Shop.Web/Shop.Web.csproj');
  const api = find('Shop.Api/Shop.Api.csproj');
  await controller.applyProject(web, undefined);
  await controller.applyProfile('http');
  await controller.saveCompanions([{ project: api.fsPath, profile: 'http' }]);
  controller.selectedFramework = 'net8.0';
  await showPanel(controller);
  await scene('panel-dotnet');
  await scene('toolbar-idle');
  await scene('toolbar-menu');

  // 2) Depurando: la API corre sin depurador y la barra de acciones muestra Pausar y Detener.
  if (vscode.extensions.getExtension('ms-dotnettools.csharp')) {
    await vscode.commands.executeCommand('dotpilot.debug');
    await waitFor(async () => controller.session && await portOpen(5291) && await portOpen(5290), { timeout: 150000, message: 'que la API y el sitio estén en marcha' });
  } else {
    await vscode.commands.executeCommand('dotpilot.run');
    await waitFor(async () => await portOpen(5291) && await portOpen(5290), { timeout: 150000, message: 'que la API y el sitio estén en marcha' });
  }
  await scene('toolbar-running');
  await vscode.commands.executeCommand('dotpilot.stop');
  await waitFor(() => !controller.active() && !controller.busy, { timeout: 30000, message: 'que termine la ejecución' });

  // 3) Node.js (React + Vite) en ejecución.
  const node = controller.apps.find(app => app.kind === 'node');
  await controller.applyProject(node.uri, node);
  await sleep(1500);
  await controller.invoke('run');
  await waitFor(async () => await portOpen(5173) && controller.listeningUrl, { timeout: 60000, message: `que el servidor Node.js escuche (${controller.result || 'sin mensaje'})` });
  await showPanel(controller);
  await scene('panel-node');
  await vscode.commands.executeCommand('dotpilot.stop');
  await waitFor(() => !controller.active() && !controller.busy, { timeout: 30000, message: 'que termine la ejecución' });

  // 4) PHP servido por el Apache de Laragon.
  const php = controller.apps.find(app => app.kind === 'php');
  await controller.applyProject(php.uri, php);
  await controller.applyProfile(php.profiles[0].name);
  await showPanel(controller);
  await scene('panel-apache');

  // 5) Ajustes.
  await controller.showSettings();
  await sleep(600);
  await scene('panel-settings');
  fs.writeFileSync(path.join(dir, 'end.ready'), '');
}

module.exports = { run };
