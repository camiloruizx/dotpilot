'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const createPackaging = require('../src/controller/packaging');

class Cancelled extends Error {}

// `output` es lo que "imprime" el comando; `code` su código de salida.
function setup({ packaging, output = '', code = 0, quickPick } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotpilot-packaging-'));
  const shown = [], commands = [], plans = [];
  const vscode = {
    workspace: { saveAll: async () => true },
    window: {
      showQuickPick: async items => (quickPick ? quickPick(items) : items[0]),
      showInformationMessage: async (...args) => { shown.push(args); return undefined; },
      setStatusBarMessage: () => {}
    },
    commands: { executeCommand: async (...args) => commands.push(args) },
    env: { openExternal: async () => true, clipboard: { writeText: async () => {} } },
    Uri: { file: file => ({ fsPath: file }), parse: url => ({ toString: () => url }) }
  };
  const methods = createPackaging({ vscode, path, fs: fs.promises, os, CancelledOperation: Cancelled });
  const state = new Map();
  const self = Object.assign({
    context: { workspaceState: { get: (key, fallback) => (state.has(key) ? state.get(key) : fallback), update: async (key, value) => { state.set(key, value); } } },
    project: { toString: () => 'file:///project' }, app: { dir, packaging }, generation: 1, result: '', resultError: false,
    t: (message, ...values) => message.replace(/\{(\d+)\}/g, (_, i) => values[i]),
    ensureProject: async () => true, render() {}, terminalEnv: () => ({}), output: { appendLine() {} },
    appTerminal(spec, generation, companion) {
      plans.push(spec);
      return { spec, companion };
    },
    async executeTask(label, args, target, running, terminal, secondary) {
      assert.equal(secondary, true, 'packaging runs as a secondary task');
      setTimeout(() => {
        terminal.companion.collect(typeof output === 'function' ? output() : output);
        terminal.companion.onExit(code);
      }, 5);
    }
  }, methods);
  return { self, dir, shown, commands, plans, state, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('a VSIX is built with the project package script and the generated file is announced', async t => {
  const holder = {};
  const h = setup({ packaging: { kind: 'vsix', script: 'package', manager: 'npm' }, output: () => `\u001b[32m DONE \u001b[0m Packaged: ${holder.relative} (38 files, 98 KB)\n` });
  t.after(h.cleanup);
  holder.file = path.join(path.dirname(h.dir), `dotpilot-test-${path.basename(h.dir)}.vsix`);
  holder.relative = path.join('..', path.basename(holder.file));
  fs.writeFileSync(holder.file, 'x');
  t.after(() => fs.rmSync(holder.file, { force: true }));
  await h.self.packageProject('packageVsix');
  assert.deepEqual([h.plans[0].command, h.plans[0].args, h.plans[0].cwd], ['npm', ['run', 'package'], h.dir]);
  assert.equal(h.self.result, `Paquete generado: ${holder.file}`);
  assert.deepEqual(h.shown[0].slice(1), ['Mostrar en carpeta', 'Instalar en VS Code']);
});

test('without a package script vsce runs through npx and an unreadable result is still reported', async t => {
  const h = setup({ packaging: { kind: 'vsix', script: '', manager: 'npm' }, output: 'nothing useful' }); t.after(h.cleanup);
  await h.self.packageProject('packageVsix');
  assert.deepEqual([h.plans[0].command, h.plans[0].args], ['npx', ['--yes', '@vscode/vsce', 'package', '--allow-missing-repository']]);
  assert.match(h.self.result, /no pudo leer su ubicación/);
  assert.deepEqual(h.shown[0].slice(1), []);
});

test('a failing package reports the exit code; EAS failures add the sign-in and install hints', async t => {
  const failing = setup({ packaging: { kind: 'vsix', script: 'package', manager: 'npm' }, code: 1 }); t.after(failing.cleanup);
  await assert.rejects(() => failing.self.packageProject('packageVsix'), /terminó con errores \(código 1\)/);
  const eas = setup({ packaging: { kind: 'apk', easProfile: 'preview', local: false }, code: 1, output: 'An Expo user account is required to proceed.' }); t.after(eas.cleanup);
  await assert.rejects(() => eas.self.packageProject('packageApk'), /eas login/);
  const missing = setup({ packaging: { kind: 'apk', easProfile: 'preview', local: false }, code: 127 }); t.after(missing.cleanup);
  await assert.rejects(() => missing.self.packageProject('packageApk'), /npm i -g eas-cli/);
});

test('an APK is built with the EAS profile and its artifact link is offered', async t => {
  const h = setup({ packaging: { kind: 'apk', easProfile: 'preview', local: false }, output: 'Build finished\nAndroid build: https://expo.dev/artifacts/eas/abc123.apk\n' });
  t.after(h.cleanup);
  await h.self.packageProject('packageApk');
  assert.deepEqual(h.plans[0].args, ['build', '--platform', 'android', '--profile', 'preview', '--non-interactive']);
  assert.match(h.plans[0].command, /^eas(\.cmd)?$/);
  assert.equal(h.self.result, 'APK generado: https://expo.dev/artifacts/eas/abc123.apk');
  assert.deepEqual(h.shown[0].slice(1), ['Abrir descarga', 'Copiar enlace']);
});

test('with both modes available the choice is asked, remembered and local builds use gradlew', async t => {
  const h = setup({ packaging: { kind: 'apk', easProfile: 'preview', local: true }, quickPick: items => items.find(item => item.value === 'local') });
  t.after(h.cleanup);
  const apk = path.join(h.dir, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  fs.mkdirSync(path.dirname(apk), { recursive: true });
  fs.writeFileSync(apk, 'x');
  await h.self.packageProject('packageApk');
  assert.equal(h.plans[0].args[0], 'assembleRelease');
  assert.ok(path.basename(h.plans[0].command).startsWith('gradlew'));
  assert.equal(h.plans[0].cwd, path.join(h.dir, 'android'));
  assert.equal(h.self.result, `Paquete generado: ${apk}`);
  assert.equal(h.state.get('apkMode:file:///project'), 'local');
});

test('a project that cannot be packaged, or an APK with no profile and no android folder, is refused clearly', async t => {
  const h = setup({ packaging: { kind: 'apk', easProfile: '', local: false } }); t.after(h.cleanup);
  await assert.rejects(() => h.self.packageProject('packageApk'), /android.buildType/);
  await assert.rejects(() => h.self.packageProject('packageVsix'), /no se puede empaquetar/);
  h.self.app = { dir: h.dir };
  await assert.rejects(() => h.self.packageProject('packageApk'), /no se puede empaquetar/);
});
