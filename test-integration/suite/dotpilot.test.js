'use strict';
// Pruebas de integración de DotPilot: corren en un VS Code real, con un proyecto ASP.NET real.
// Cada prueba deja la ejecución detenida (ensureStopped) para no contaminar la siguiente.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const vscode = require('vscode');
const { step, PORT_HTTP, PORT_ALT, PORT_NODE, PORT_PHP, PORT_PY, waitFor, portOpen, httpGet, getController, pickByIndex } = require('./helpers');

const fixtureDir = process.env.DOTPILOT_FIXTURE_DIR;
const hasCSharp = () => !!vscode.extensions.getExtension('ms-dotnettools.csharp');
const home = `http://127.0.0.1:${PORT_HTTP}/`;

const tests = [
  {
    name: 'activación: detecta el proyecto y sus perfiles',
    fn: async () => {
      const controller = await getController();
      await waitFor(() => controller.projects.length === 1, { message: 'que se detecte el proyecto' });
      assert.ok(controller.project.fsPath.endsWith('WebSample.csproj'), controller.project.fsPath);
      assert.deepEqual(controller.profiles.map(p => p.name), ['http', 'alt']);
      assert.equal(controller.profile, 'http');
      // Detectar proyectos de todos los tipos no debe sentirse: la búsqueda completa tiene un presupuesto.
      const started = Date.now();
      await controller.refresh();
      const elapsed = Date.now() - started;
      console.log(`[dotpilot] búsqueda de proyectos: ${elapsed} ms`);
      assert.ok(elapsed < 3000, `la búsqueda tardó ${elapsed} ms`);
    }
  },
  {
    name: 'compilar: genera WebSample.dll',
    fn: async () => {
      const controller = await getController();
      // La extensión de C# puede estar escribiendo en obj/ justo ahora: se reintenta.
      for (const folder of ['bin', 'obj']) fs.rmSync(path.join(fixtureDir, folder), { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
      await vscode.commands.executeCommand('dotpilot.build');
      assert.equal(controller.resultError, false, controller.result);
      assert.ok(fs.existsSync(path.join(fixtureDir, 'bin', 'Debug', 'net8.0', 'WebSample.dll')), 'no se generó WebSample.dll');
    }
  },
  {
    name: 'ejecutar sin depurar: responde por HTTP y Detener libera el puerto',
    fn: async () => {
      const controller = await getController();
      assert.equal(await portOpen(PORT_HTTP), false, 'el puerto 5187 ya estaba ocupado antes de la prueba');
      await vscode.commands.executeCommand('dotpilot.run');
      await waitFor(() => portOpen(PORT_HTTP), { timeout: 90000, message: 'que la aplicación escuche en 5187' });
      const response = await httpGet(home);
      assert.equal(response.status, 200);
      assert.equal(response.body, 'dotpilot-v1');
      assert.equal(controller.active(), true);
      await vscode.commands.executeCommand('dotpilot.stop');
      await waitFor(async () => !(await portOpen(PORT_HTTP)), { timeout: 30000, message: 'que se libere el puerto' });
      assert.equal(controller.active(), false);
    }
  },
  {
    name: 'perfil: cambiar a "alt" ejecuta en otro puerto y se puede volver a "http"',
    fn: async () => {
      const controller = await getController();
      await pickByIndex('dotpilot.selectProfile', 1);
      assert.equal(controller.profile, 'alt');
      await vscode.commands.executeCommand('dotpilot.run');
      await waitFor(() => portOpen(PORT_ALT), { timeout: 90000, message: 'que la aplicación escuche en 5188' });
      assert.equal(await portOpen(PORT_HTTP), false, 'el perfil alt no debía abrir 5187');
      await vscode.commands.executeCommand('dotpilot.stop');
      await waitFor(async () => !(await portOpen(PORT_ALT)), { timeout: 30000, message: 'que se libere 5188' });
      await pickByIndex('dotpilot.selectProfile', 0);
      assert.equal(controller.profile, 'http');
    }
  },
  {
    name: 'reiniciar: vuelve a levantar la aplicación en el mismo modo',
    fn: async () => {
      const controller = await getController();
      await vscode.commands.executeCommand('dotpilot.run');
      await waitFor(() => portOpen(PORT_HTTP), { timeout: 90000, message: 'el primer arranque' });
      await vscode.commands.executeCommand('dotpilot.restart');
      await waitFor(async () => (await portOpen(PORT_HTTP)) && controller.active(), { timeout: 90000, message: 'el arranque tras reiniciar' });
      assert.equal(controller.lastMode, 'run');
      assert.equal((await httpGet(home)).body, 'dotpilot-v1');
    }
  },
  {
    name: 'API complementaria: se inicia antes que el proyecto, ambos responden y Detener libera los dos',
    timeout: 240000,
    fn: async () => {
      const controller = await getController();
      const PORT_API = 5191;
      assert.equal(await portOpen(PORT_API), false, 'el puerto 5191 ya estaba ocupado antes de la prueba');
      // La API vive fuera del espacio de trabajo, como en un caso real con dos soluciones.
      const api = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dotpilot-api-'));
      fs.mkdirSync(path.join(api, 'Properties'));
      fs.writeFileSync(path.join(api, 'ApiSample.csproj'), fs.readFileSync(path.join(fixtureDir, 'WebSample.csproj'), 'utf8'));
      fs.writeFileSync(path.join(api, 'Program.cs'), ['var app = WebApplication.CreateBuilder(args).Build();', 'app.MapGet("/", () => "dotpilot-api");', 'app.Run();'].join(String.fromCharCode(10)));
      fs.writeFileSync(path.join(api, 'Properties', 'launchSettings.json'), JSON.stringify({ profiles: { http: { commandName: 'Project', launchBrowser: false, applicationUrl: `http://localhost:${PORT_API}` } } }));
      try {
        await controller.saveCompanions([{ project: path.join(api, 'ApiSample.csproj'), profile: 'http' }]);
        await vscode.commands.executeCommand('dotpilot.run');
        await waitFor(() => portOpen(PORT_API), { timeout: 120000, message: 'que la API escuche en 5191' });
        await waitFor(() => portOpen(PORT_HTTP), { timeout: 120000, message: 'que el proyecto escuche en 5187' });
        assert.equal((await httpGet(`http://127.0.0.1:${PORT_API}/`)).body, 'dotpilot-api');
        assert.equal((await httpGet(home)).body, 'dotpilot-v1');
        assert.equal(controller.companions.length, 1);
        await vscode.commands.executeCommand('dotpilot.stop');
        await waitFor(async () => !(await portOpen(PORT_API)) && !(await portOpen(PORT_HTTP)), { timeout: 30000, message: 'que se liberen 5191 y 5187' });
        assert.equal(controller.active(), false);
        assert.equal(controller.companions.length, 0);
      } finally {
        await controller.saveCompanions([]);
        fs.rmSync(api, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
      }
    }
  },
  {
    name: 'API complementaria con depuración: la API corre sin depurador y Detener libera los dos',
    skip: () => (hasCSharp() ? false : 'falta la extensión C# (ms-dotnettools.csharp)'),
    timeout: 240000,
    fn: async () => {
      const controller = await getController();
      const PORT_API = 5191;
      assert.equal(await portOpen(PORT_API), false, 'el puerto 5191 ya estaba ocupado antes de la prueba');
      // La API vive fuera del espacio de trabajo, como en un caso real con dos soluciones.
      const api = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dotpilot-api-'));
      fs.mkdirSync(path.join(api, 'Properties'));
      fs.writeFileSync(path.join(api, 'ApiSample.csproj'), fs.readFileSync(path.join(fixtureDir, 'WebSample.csproj'), 'utf8'));
      fs.writeFileSync(path.join(api, 'Program.cs'), ['var app = WebApplication.CreateBuilder(args).Build();', 'app.MapGet("/", () => "dotpilot-api");', 'app.Run();'].join(String.fromCharCode(10)));
      fs.writeFileSync(path.join(api, 'Properties', 'launchSettings.json'), JSON.stringify({ profiles: { http: { commandName: 'Project', launchBrowser: false, applicationUrl: `http://localhost:${PORT_API}` } } }));
      try {
        await controller.saveCompanions([{ project: path.join(api, 'ApiSample.csproj'), profile: 'http' }]);
        await vscode.commands.executeCommand('dotpilot.debug');
        await waitFor(() => controller.session, { timeout: 120000, message: 'que inicie la sesión de depuración' });
        await waitFor(() => portOpen(PORT_API), { timeout: 120000, message: 'que la API escuche en 5191' });
        await waitFor(() => portOpen(PORT_HTTP), { timeout: 120000, message: 'que el proyecto escuche en 5187' });
        assert.equal((await httpGet(`http://127.0.0.1:${PORT_API}/`)).body, 'dotpilot-api');
        assert.equal((await httpGet(home)).body, 'dotpilot-v1');
        assert.equal(controller.companions.length, 1);
        await vscode.commands.executeCommand('dotpilot.stop');
        await waitFor(async () => !(await portOpen(PORT_API)) && !(await portOpen(PORT_HTTP)), { timeout: 30000, message: 'que se liberen 5191 y 5187' });
        assert.equal(controller.active(), false);
        assert.equal(controller.companions.length, 0);
        assert.equal(controller.session, undefined);
      } finally {
        await controller.saveCompanions([]);
        fs.rmSync(api, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
      }
    }
  },
  {
    name: 'depurar: sesión coreclr, pausar congela la app, continuar la reanuda y Detener termina',
    skip: () => (hasCSharp() ? false : 'falta la extensión C# (ms-dotnettools.csharp)'),
    timeout: 240000,
    fn: async () => {
      const controller = await getController();
      step('ejecutar dotpilot.debug');
      await vscode.commands.executeCommand('dotpilot.debug');
      step('comando debug devolvió el control');
      await waitFor(() => controller.session, { timeout: 120000, message: 'que inicie la sesión de depuración' });
      step('sesión iniciada: ' + controller.session.type);
      assert.equal(controller.session.type, 'coreclr');
      await waitFor(() => portOpen(PORT_HTTP), { timeout: 90000, message: 'que la aplicación escuche en 5187' });
      step('la app responde');
      assert.equal((await httpGet(home)).body, 'dotpilot-v1');

      // En apps con varios hilos DotPilot abre el selector "Hilo que quieres pausar"; se elige el primero.
      step('pausar (responde el selector de hilo)');
      await pickByIndex('dotpilot.pause', 0);
      await waitFor(() => controller.paused === true, { timeout: 30000, message: 'que el depurador quede en pausa' });
      step('en pausa');
      await assert.rejects(httpGet(home, 2000), 'con la app pausada la solicitud debía agotar el tiempo');

      step('continuar');
      await vscode.commands.executeCommand('dotpilot.continue');
      await waitFor(() => controller.paused === false, { timeout: 30000, message: 'que se reanude' });
      await waitFor(async () => (await httpGet(home, 3000)).status === 200, { timeout: 30000, message: 'que la app vuelva a responder' });

      step('detener');
      await vscode.commands.executeCommand('dotpilot.stop');
      await waitFor(() => !controller.session, { timeout: 30000, message: 'que termine la sesión' });
      await waitFor(async () => !(await portOpen(PORT_HTTP)), { timeout: 30000, message: 'que se libere el puerto' });
    }
  },
  {
    name: 'Hot Reload (watch): un cambio de código se aplica sin reiniciar',
    timeout: 240000,
    fn: async () => {
      const controller = await getController();
      const program = path.join(fixtureDir, 'Program.cs');
      const original = fs.readFileSync(program, 'utf8');
      try {
        await vscode.commands.executeCommand('dotpilot.watch');
        await waitFor(() => portOpen(PORT_HTTP), { timeout: 120000, message: 'que dotnet watch escuche en 5187' });
        assert.equal((await httpGet(home)).body, 'dotpilot-v1');
        fs.writeFileSync(program, original.replace('dotpilot-v1', 'dotpilot-v2'));
        await waitFor(async () => (await httpGet(home, 3000)).body === 'dotpilot-v2',
          { timeout: 90000, interval: 1000, message: 'que el cambio se aplique en caliente' });
        assert.equal(controller.active(), true);
      } finally {
        fs.writeFileSync(program, original);
      }
    }
  },
  {
    name: 'proyectos que no son .NET: detecta Node.js, PHP y Python junto al proyecto .NET',
    fn: async () => {
      const controller = await getController();
      await waitFor(() => controller.apps.length === 3, { message: 'que se detecten los proyectos Node.js, PHP y Python' });
      const byKind = Object.fromEntries(controller.apps.map(app => [app.kind, app]));
      assert.equal(byKind.node.framework, 'Node.js');
      assert.deepEqual(byKind.node.profiles.map(p => p.name), ['dev']);
      assert.equal(byKind.php.framework, 'PHP');
      assert.equal(byKind.python.framework, 'Python');
      assert.deepEqual(byKind.python.profiles[0].args, ['main.py']);
      assert.deepEqual(byKind.php.profiles[0].args, ['-S', 'localhost:8000', '-t', '.']);
      // El proyecto .NET sigue siendo el seleccionado y conserva sus perfiles.
      assert.ok(controller.project.fsPath.endsWith('WebSample.csproj'));
      assert.equal(controller.app, undefined);
    }
  },
  {
    name: 'Node.js: ejecuta, detecta la URL real, abre el navegador, reinicia y detiene',
    timeout: 120000,
    fn: async () => {
      const controller = await getController();
      assert.equal(await portOpen(PORT_NODE), false, 'el puerto 5189 ya estaba ocupado antes de la prueba');
      const opened = [];
      const original = controller.openBrowser;
      controller.openBrowser = async function () { opened.push(this.listeningUrl); this.browserOpened = true; };
      const settings = vscode.workspace.getConfiguration('dotpilot');
      await settings.update('openBrowser', true, vscode.ConfigurationTarget.Workspace);
      try {
        await pickByIndex('dotpilot.selectProject', 1);
        assert.equal(controller.app?.kind, 'node');
        assert.equal(controller.profile, 'dev');
        step('ejecutar');
        await vscode.commands.executeCommand('dotpilot.run');
        await waitFor(() => portOpen(PORT_NODE), { timeout: 30000, message: 'que el servidor Node.js escuche en 5189' });
        await waitFor(() => controller.listeningUrl, { message: 'que DotPilot lea la URL de la salida' });
        assert.equal(controller.listeningUrl, `http://localhost:${PORT_NODE}/`);
        assert.equal((await httpGet(`http://127.0.0.1:${PORT_NODE}/`)).body, 'dotpilot-node');
        assert.deepEqual(opened, [`http://localhost:${PORT_NODE}/`]);
        assert.equal(controller.active(), true);
        assert.equal(controller.resultError, false, controller.result);

        step('reiniciar');
        await vscode.commands.executeCommand('dotpilot.restart');
        await waitFor(async () => (await portOpen(PORT_NODE)) && controller.active() && controller.listeningUrl, { timeout: 30000, message: 'el arranque tras reiniciar' });
        assert.equal(opened.length, 2);

        step('detener');
        await vscode.commands.executeCommand('dotpilot.stop');
        await waitFor(async () => !(await portOpen(PORT_NODE)), { timeout: 30000, message: 'que se libere el puerto 5189' });
        assert.equal(controller.active(), false);
        assert.equal(controller.listeningUrl, undefined);
      } finally {
        controller.openBrowser = original;
        await settings.update('openBrowser', undefined, vscode.ConfigurationTarget.Workspace);
        await pickByIndex('dotpilot.selectProject', 0);
      }
      assert.ok(controller.project.fsPath.endsWith('WebSample.csproj'));
    }
  },
  {
    name: 'Node.js: las acciones de .NET se rechazan con un mensaje claro',
    fn: async () => {
      const controller = await getController();
      try {
        await pickByIndex('dotpilot.selectProject', 1);
        assert.equal(controller.app?.kind, 'node');
        await vscode.commands.executeCommand('dotpilot.build');
        assert.equal(controller.resultError, true);
        assert.match(controller.result, /.NET/);
        assert.equal(controller.active(), false);
      } finally {
        await pickByIndex('dotpilot.selectProject', 0);
      }
    }
  },
  {
    name: 'PHP: php -S sirve la carpeta, DotPilot lee la URL y Detener libera el puerto',
    timeout: 120000,
    skip: async () => {
      try { cp.execFileSync('php', ['-v'], { stdio: 'ignore', shell: process.platform === 'win32' }); } catch { return 'php no está en el PATH'; }
      return (await portOpen(PORT_PHP)) ? 'el puerto 8000 está ocupado' : false;
    },
    fn: async () => {
      const controller = await getController();
      try {
        await pickByIndex('dotpilot.selectProject', 2);
        assert.equal(controller.app?.kind, 'php');
        await vscode.commands.executeCommand('dotpilot.run');
        const phpOpen = async () => (await portOpen(PORT_PHP, '127.0.0.1')) || (await portOpen(PORT_PHP, '::1'));
        await waitFor(() => phpOpen(), { timeout: 30000, message: 'que php -S escuche en 8000' });
        await waitFor(() => controller.listeningUrl, { message: 'que DotPilot lea la URL de PHP' });
        assert.equal(controller.listeningUrl, 'http://localhost:8000');
        assert.equal((await httpGet('http://127.0.0.1:8000/').catch(() => httpGet('http://[::1]:8000/'))).body, 'dotpilot-php');
        await vscode.commands.executeCommand('dotpilot.stop');
        await waitFor(async () => !(await phpOpen()), { timeout: 30000, message: 'que se libere el puerto 8000' });
      } finally {
        await pickByIndex('dotpilot.selectProject', 0);
      }
    }
  },
  {
    name: 'Python: ejecuta main.py sin búfer, DotPilot lee la URL y Detener libera el puerto',
    timeout: 120000,
    skip: () => {
      try { cp.execFileSync('python', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }); } catch { return 'python no está en el PATH'; }
      return false;
    },
    fn: async () => {
      const controller = await getController();
      assert.equal(await portOpen(PORT_PY), false, 'el puerto 5190 ya estaba ocupado antes de la prueba');
      try {
        await pickByIndex('dotpilot.selectProject', 3);
        assert.equal(controller.app?.kind, 'python');
        assert.equal(controller.profile, 'main.py');
        await vscode.commands.executeCommand('dotpilot.run');
        await waitFor(() => portOpen(PORT_PY), { timeout: 30000, message: 'que Python escuche en 5190' });
        await waitFor(() => controller.listeningUrl, { message: 'que DotPilot lea la URL sin esperar al búfer de Python' });
        assert.equal(controller.listeningUrl, `http://127.0.0.1:${PORT_PY}/`);
        assert.equal((await httpGet(`http://127.0.0.1:${PORT_PY}/`)).body, 'dotpilot-python');
        await vscode.commands.executeCommand('dotpilot.stop');
        await waitFor(async () => !(await portOpen(PORT_PY)), { timeout: 30000, message: 'que se libere el puerto 5190' });
        assert.equal(controller.active(), false);
      } finally {
        await pickByIndex('dotpilot.selectProject', 0);
      }
    }
  },
  {
    name: 'asistentes de IA: DotPilot registra sus herramientas en VS Code (Copilot) y responden',
    skip: () => (vscode.lm ? false : 'esta versión de VS Code no tiene vscode.lm (se agregó en la 1.90)'),
    fn: async () => {
      const controller = await getController();
      const names = vscode.lm.tools.map(tool => tool.name).filter(name => name.startsWith('dotpilot_'));
      assert.equal(names.length, 13, names.join(', '));
      const result = await vscode.lm.invokeTool('dotpilot_get_status', { input: {}, toolInvocationToken: undefined });
      const status = JSON.parse(result.content.map(part => part.value).join(''));
      assert.equal(status.ok, true);
      assert.equal(status.state, 'idle');
      assert.equal(status.projectType, '.NET');
      assert.equal(controller.active(), false);
    }
  },
  {
    name: 'asistentes de IA: un cliente MCP real maneja Node.js por el puente local',
    timeout: 120000,
    fn: async () => {
      const controller = await getController();
      const config = vscode.workspace.getConfiguration('dotpilot');
      await config.update('assistantsEnabled', true, vscode.ConfigurationTarget.Global);
      await config.update('assistantsPermission', 'allow', vscode.ConfigurationTarget.Global);
      let child;
      try {
        await waitFor(() => controller.bridge && controller.bridge.port, { message: 'que el puente local se inicie' });
        const home = process.env.DOTPILOT_HOME;
        const script = path.join(home, 'mcp', 'mcp-server.js');
        assert.ok(fs.existsSync(script), 'DotPilot debía copiar el servidor MCP a una ruta estable');
        assert.ok(fs.existsSync(path.join(home, 'mcp', 'agent-tools.js')));

        child = cp.spawn(process.execPath, [script], {
          cwd: path.dirname(fixtureDir), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'inherit']
        });
        const waiting = new Map();
        let buffer = '', counter = 1;
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', chunk => {
          buffer += chunk;
          let index;
          while ((index = buffer.indexOf('\n')) >= 0) {
            const message = JSON.parse(buffer.slice(0, index));
            buffer = buffer.slice(index + 1);
            waiting.get(message.id)?.(message);
          }
        });
        const rpc = (method, params) => new Promise(resolve => {
          const id = counter++;
          waiting.set(id, resolve);
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        });
        const tool = async (name, args = {}) => {
          const response = await rpc('tools/call', { name, arguments: args });
          return { isError: !!response.result.isError, data: JSON.parse(response.result.content[0].text) };
        };

        step('initialize + tools/list');
        const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba-mcp', version: '1' } });
        assert.equal(init.result.serverInfo.name, 'dotpilot');
        assert.equal((await rpc('tools/list')).result.tools.length, 13);

        step('list_projects');
        const listed = await tool('dotpilot_list_projects');
        assert.equal(listed.isError, false);
        const ids = listed.data.projects.map(project => project.id);
        assert.ok(ids.includes('WebSample/WebSample.csproj'), ids.join(', '));
        assert.ok(ids.includes('NodeSample/package.json'), ids.join(', '));

        step('select_project + run');
        assert.equal((await tool('dotpilot_select_project', { project: 'NodeSample/package.json' })).data.projectType, 'Node.js');
        const run = await tool('dotpilot_run', { wait_seconds: 30 });
        assert.equal(run.isError, false, JSON.stringify(run.data));
        assert.equal(run.data.state, 'running');
        assert.equal(run.data.url, `http://localhost:${PORT_NODE}/`);
        assert.equal((await httpGet(`http://127.0.0.1:${PORT_NODE}/`)).body, 'dotpilot-node');

        step('get_output');
        const output = await tool('dotpilot_get_output', { lines: 20 });
        assert.match(output.data.lines.join('\n'), /Local:\s+http:\/\/localhost:5189\//);
        assert.doesNotMatch(output.data.lines.join('\n'), /\u001b/);

        step('acciones .NET rechazadas en Node');
        const debug = await tool('dotpilot_debug');
        assert.equal(debug.isError, true);
        assert.match(debug.data.error, /only available for \.NET/);

        step('stop');
        const stopped = await tool('dotpilot_stop');
        assert.equal(stopped.data.state, 'idle');
        await waitFor(async () => !(await portOpen(PORT_NODE)), { timeout: 30000, message: 'que se libere el puerto 5189' });

        step('select_project vuelve a .NET');
        assert.equal((await tool('dotpilot_select_project', { project: 'WebSample.csproj' })).data.projectType, '.NET');
      } finally {
        child?.stdin.end();
        await config.update('assistantsEnabled', undefined, vscode.ConfigurationTarget.Global);
        await config.update('assistantsPermission', undefined, vscode.ConfigurationTarget.Global);
        await waitFor(() => !controller.bridge, { timeout: 10000, message: 'que el puente se cierre' }).catch(() => {});
      }
      assert.ok(controller.project.fsPath.endsWith('WebSample.csproj'));
      assert.deepEqual(fs.readdirSync(path.join(process.env.DOTPILOT_HOME, 'bridges')), []);
    }
  },
  {
    name: 'idioma: un solo juego de comandos y menús, y el idioma de DotPilot cambia el panel sin tocar los comandos',
    fn: async () => {
      const controller = await getController();
      const commands = await vscode.commands.getCommands(true);
      for (const id of ['dotpilot.run', 'dotpilot.stop', 'dotpilot.browserChrome', 'dotpilot.connectAssistants']) assert.ok(commands.includes(id), id);
      assert.deepEqual(commands.filter(id => /^dotpilot\..+\.(es|en)$/.test(id)), [], 'no hay copias de comandos por idioma');
      const config = vscode.workspace.getConfiguration('dotpilot');
      try {
        for (const language of ['en', 'es']) {
          await config.update('language', language, vscode.ConfigurationTarget.Global);
          await waitFor(() => controller.language() === language, { timeout: 10000, message: `el idioma ${language}` });
          assert.equal(controller.t('Detener'), language === 'es' ? 'Detener' : 'Stop');
        }
        await vscode.commands.executeCommand('dotpilot.browserChrome');
        assert.equal(controller.browser(), 'chrome');
        await vscode.commands.executeCommand('dotpilot.browserDefault');
        assert.equal(controller.browser(), 'edge');
      } finally {
        await config.update('language', undefined, vscode.ConfigurationTarget.Global);
      }
    }
  },
  {
    name: 'navegador: cambiar la elección con la app abierta reabre la ventana vinculada en el navegador elegido',
    timeout: 120000,
    skip: () => {
      const browsers = require(path.join(vscode.extensions.getExtension('camiloruizx.dotpilot').extensionPath, 'src', 'browsers.js'));
      return browsers.find('chrome') && browsers.find('edge') ? false : 'hacen falta Chrome y Edge instalados';
    },
    fn: async () => {
      const controller = await getController();
      assert.equal(await portOpen(PORT_NODE), false, 'el puerto 5189 ya estaba ocupado antes de la prueba');
      const settings = vscode.workspace.getConfiguration('dotpilot');
      await settings.update('openBrowser', true, vscode.ConfigurationTarget.Workspace);
      const sessionType = () => controller.browserRun?.session?.configuration?.type;
      try {
        await pickByIndex('dotpilot.selectProject', 1);
        await vscode.commands.executeCommand('dotpilot.browserEdge');
        await vscode.commands.executeCommand('dotpilot.run');
        await waitFor(() => sessionType() === 'pwa-msedge', { timeout: 40000, message: 'que se abra la ventana vinculada de Edge' });
        const first = controller.browserRun.session.id;

        step('cambiar a Chrome con la app en ejecución');
        await vscode.commands.executeCommand('dotpilot.browserChrome');
        await waitFor(() => sessionType() === 'pwa-chrome' && controller.browserRun.session.id !== first, { timeout: 40000, message: 'que se reabra en Chrome' });
        assert.equal(controller.active(), true, 'la aplicación debe seguir en ejecución');
        assert.equal(await portOpen(PORT_NODE), true);

        await vscode.commands.executeCommand('dotpilot.stop');
        await waitFor(async () => !(await portOpen(PORT_NODE)) && !controller.browserRun, { timeout: 30000, message: 'que se libere el puerto y se cierre el navegador' });
      } finally {
        await vscode.commands.executeCommand('dotpilot.browserDefault').catch(() => {});
        await settings.update('openBrowser', undefined, vscode.ConfigurationTarget.Workspace);
        await pickByIndex('dotpilot.selectProject', 0);
      }
    }
  },
  {
    name: '.NET: Ejecutar deja la salida completa disponible (URL, registro y excepciones en ejecución)',
    timeout: 150000,
    fn: async () => {
      const controller = await getController();
      assert.equal(await portOpen(PORT_HTTP), false, 'el puerto 5187 ya estaba ocupado antes de la prueba');
      await vscode.commands.executeCommand('dotpilot.run');
      await waitFor(() => portOpen(PORT_HTTP), { timeout: 90000, message: 'que la aplicación escuche en 5187' });
      await waitFor(() => controller.listeningUrl, { timeout: 30000, message: 'que DotPilot lea la URL de la salida de Kestrel' });
      assert.match(controller.listeningUrl, /^http:\/\/(localhost|127\.0\.0\.1):5187\/?$/);
      const text = () => controller.recentOutput.join('\n');
      await waitFor(() => /Now listening on/.test(text()), { timeout: 20000, message: 'la línea "Now listening on" en la salida' });

      step('provocar una excepción en ejecución');
      const response = await httpGet(`http://127.0.0.1:${PORT_HTTP}/boom`, 10000).catch(error => ({ error }));
      assert.equal(response.status, 500, JSON.stringify(response.error?.message));
      await waitFor(() => /InvalidOperationException/.test(text()) && /dotpilot-boom/.test(text()), { timeout: 20000, message: 'la excepción en la salida' });

      step('lo mismo, como lo ve un asistente');
      const output = await controller.agentApi().call('dotpilot_get_output', { lines: 300 }, { client: 'prueba', confirmed: true });
      assert.equal(output.ok, true);
      assert.equal(output.source, 'app');
      assert.match(output.lines.join('\n'), /dotpilot-boom/);
      assert.doesNotMatch(output.lines.join('\n'), /\u001b/, 'sin códigos de color');
      const status = await controller.agentApi().call('dotpilot_get_status', {}, { client: 'prueba', confirmed: true });
      assert.equal(status.state, 'running');
      assert.match(status.url, /5187/);

      await vscode.commands.executeCommand('dotpilot.stop');
      await waitFor(async () => !(await portOpen(PORT_HTTP)), { timeout: 30000, message: 'que se libere el puerto' });
      assert.equal(controller.listeningUrl, undefined);
    }
  },
  {
    name: '.NET: un error de compilación al ejecutar llega al panel Problemas y a la salida',
    timeout: 150000,
    skip: () => (hasCSharp() ? 'se prueba en el conjunto sin-csharp, donde solo el problem matcher puede producir el diagnóstico' : false),
    fn: async () => {
      const controller = await getController();
      const program = path.join(fixtureDir, 'Program.cs');
      const original = fs.readFileSync(program, 'utf8');
      try {
        fs.writeFileSync(program, original.replace('app.Run();', 'int mal = "no es un entero";\napp.Run();'));
        await vscode.commands.executeCommand('dotpilot.run');
        await waitFor(() => /CS0029/.test(controller.recentOutput.join('\n')), { timeout: 120000, message: 'el error CS0029 en la salida' });
        await waitFor(() => controller.resultError === true && !controller.active(), { timeout: 30000, message: 'que la ejecución termine con error' });
        const problems = await controller.agentApi().call('dotpilot_get_problems', {}, { client: 'prueba', confirmed: true });
        assert.ok(problems.problems.some(item => /CS0029/.test(String(item.code)) || /CS0029/.test(item.message)), JSON.stringify(problems));
      } finally {
        fs.writeFileSync(program, original);
      }
    }
  }
,
  {
    name: 'PHP: un sitio de Laragon ofrece Apache como primer perfil y php -S sigue disponible',
    skip: () => (process.platform === 'win32' ? false : 'Laragon solo existe en Windows'),
    fn: async () => {
      const controller = await getController();
      // Instalación de Laragon de mentira: solo lo que DotPilot lee (no se inicia nada).
      const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dotpilot-laragon-'));
      const apache = path.join(root, 'bin', 'apache', 'httpd-2.4.0-test');
      for (const dir of [path.join(apache, 'bin'), path.join(apache, 'conf'), path.join(root, 'usr'), path.join(root, 'etc', 'apache2', 'sites-enabled')]) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(path.join(root, 'laragon.exe'), '');
      fs.writeFileSync(path.join(apache, 'bin', 'httpd.exe'), '');
      fs.writeFileSync(path.join(apache, 'conf', 'httpd.conf'), 'Listen 80\nErrorLog "logs/error_log"\n');
      fs.writeFileSync(path.join(root, 'usr', 'laragon.ini'), `[apache]\nDocumentRoot=${path.dirname(fixtureDir)}\n`);
      const config = vscode.workspace.getConfiguration('dotpilot');
      try {
        await config.update('laragonPath', root, vscode.ConfigurationTarget.Workspace);
        await controller.refresh();
        const php = controller.apps.find(app => app.kind === 'php');
        assert.deepEqual(php.profiles.map(profile => profile.name), ['apache', 'php -S']);
        const profile = php.profiles[0];
        assert.equal(profile.label, 'Apache (Laragon)');
        assert.equal(profile.url, 'http://localhost/PhpSample/');
        assert.equal(profile.command, 'powershell');
        assert.equal(JSON.parse(profile.env.DOTPILOT_HTTPD_ARGS)[0], '-f');
        assert.ok(fs.existsSync(profile.args.at(-1)), 'el script laragon.ps1 debe existir en la extensión');
        // Sin Laragon configurado el perfil desaparece: php -S queda como único perfil.
        await config.update('laragonPath', undefined, vscode.ConfigurationTarget.Workspace);
        await controller.refresh();
        const plain = controller.apps.find(app => app.kind === 'php');
        const names = plain.profiles.map(item => item.name);
        assert.ok(names.includes('php -S'), names.join(', '));
      } finally {
        await config.update('laragonPath', undefined, vscode.ConfigurationTarget.Workspace);
        fs.rmSync(root, { recursive: true, force: true });
        await controller.refresh();
      }
    }
  },
  {
    name: 'empaquetar VSIX: detecta la extensión de VS Code, ejecuta su script y deja el resultado en el panel',
    timeout: 120000,
    fn: async () => {
      const controller = await getController();
      const dir = path.join(path.dirname(fixtureDir), 'VsixSample');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'vsix-sample', version: '1.0.0', engines: { vscode: '^1.85.0' }, scripts: { package: 'node pack.js' } }));
      fs.writeFileSync(path.join(dir, 'pack.js'), "require('node:fs').writeFileSync('vsix-sample-1.0.0.vsix', 'x'); console.log('DONE  Packaged: vsix-sample-1.0.0.vsix (1 files, 1 KB)');");
      const original = controller.project;
      try {
        await waitFor(async () => { await controller.refresh(); return controller.apps.some(app => app.packaging?.kind === 'vsix'); }, { message: 'que se detecte la extensión de VS Code' });
        const app = controller.apps.find(item => item.packaging?.kind === 'vsix');
        assert.equal(app.framework, 'VS Code Extension');
        await controller.applyProject(app.uri, app);
        await vscode.commands.executeCommand('dotpilot.packageVsix');
        await waitFor(() => fs.existsSync(path.join(dir, 'vsix-sample-1.0.0.vsix')), { timeout: 60000, message: 'que se genere el .vsix' });
        await waitFor(() => !controller.busy, { timeout: 30000, message: 'que termine el empaquetado' });
        assert.equal(controller.resultError, false, controller.result);
        assert.ok(controller.result.endsWith('vsix-sample-1.0.0.vsix'), controller.result);
        // Un proyecto .NET rechaza la acción con un mensaje claro.
        await controller.applyProject(original, undefined);
        await vscode.commands.executeCommand('dotpilot.packageVsix');
        assert.equal(controller.resultError, true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
        await controller.refresh();
        if (original && controller.project?.toString() !== original.toString()) await controller.applyProject(original, undefined);
      }
    }
  },
];

module.exports = tests;
