'use strict';
// Punto de entrada que VS Code ejecuta (--extensionTestsPath). Sin dependencias: ejecuta las
// pruebas en orden, con tiempo límite, y escribe un JSON con el resultado para el lanzador.
const fs = require('node:fs');
const vscode = require('vscode');
const { getController, ensureStopped, sleep, steps } = require('./helpers');

function withTimeout(promise, ms, name) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`"${name}" superó ${Math.round(ms / 1000)} s`)), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

async function run() {
  const only = (process.env.DOTPILOT_ONLY || '').toLowerCase();
  const tests = require('./dotpilot.test.js').filter(t => !only || t.name.toLowerCase().includes(only));
  const results = [];
  const csharp = vscode.extensions.getExtension('ms-dotnettools.csharp');
  const devkit = vscode.extensions.getExtension('ms-dotnettools.csdevkit');
  const meta = {
    vscode: vscode.version,
    dotpilot: vscode.extensions.getExtension('camiloruizx.dotpilot')?.packageJSON.version,
    csharp: csharp?.packageJSON.version ?? null,
    csdevkit: devkit?.packageJSON.version ?? null,
    csdevkitActive: devkit?.isActive ?? null
  };
  // Da tiempo a que DotPilot detecte el proyecto y a que las demás extensiones terminen de cargar.
  await sleep(3000);
  let controller;
  try { controller = await getController(); } catch { /* la primera prueba informará el error */ }

  let failed = 0;
  for (const test of tests) {
    const started = Date.now();
    steps.length = 0;
    const result = { name: test.name, status: 'pass' };
    try {
      const skipReason = test.skip ? await test.skip() : false;
      if (skipReason) { result.status = 'skip'; result.note = skipReason; }
      else await withTimeout(test.fn(), test.timeout ?? 150000, test.name);
    } catch (error) {
      result.status = 'fail';
      result.error = String(error && error.stack ? error.stack : error);
      result.steps = [...steps];
      if (controller) {
        result.state = {
          active: controller.active(), busy: controller.busy, paused: controller.paused,
          session: controller.session ? controller.session.type : null, lastMode: controller.lastMode,
          result: controller.result, resultError: controller.resultError
        };
      }
      failed++;
    }
    result.ms = Date.now() - started;
    results.push(result);
    try { if (controller) await ensureStopped(controller); } catch (error) { result.cleanup = String(error.message || error); }
  }

  if (process.env.DOTPILOT_RESULTS) {
    fs.writeFileSync(process.env.DOTPILOT_RESULTS, JSON.stringify({ meta, results }, null, 2));
  }
  if (failed) throw new Error(`${failed} prueba(s) de integración fallaron`);
}

module.exports = { run };
