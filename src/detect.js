'use strict';
// Detección de proyectos que no son .NET (Node.js, PHP/Laravel, Python, Docker Compose).
// No depende de VS Code: recibe funciones `read` y `exists`, así que se prueba con archivos falsos.
const path = require('node:path');

// Archivos que delatan un proyecto. Se usan para buscar y para activar la extensión.
// index.php no es un marcador de búsqueda: hay miles en WordPress y similares. Se comprueba solo en las
// raíces del espacio de trabajo y junto a un composer.json (ver addPhpEntries).
const MARKERS = ['package.json', 'artisan', 'manage.py', 'composer.json', 'requirements.txt', 'pyproject.toml',
  'compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
const PHP_ENTRIES = ['index.php', 'public/index.php', 'web/index.php'];
const MAX_DIRS = 300;
const CONCURRENCY = 12;
const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
const RUN_SCRIPTS = ['dev', 'start', 'serve', 'develop'];
const SAFE_NAME = /^[\w][\w:.-]*$/;
// Puertos que casi nunca son una página web: no se abren en el navegador.
const NON_HTTP_PORTS = new Set([1433, 1521, 2181, 3306, 5432, 5672, 6379, 9092, 11211, 27017]);
const TOOL_PORTS = [
  [/\bvite\b/, 5173], [/\bng\s+serve\b/, 4200], [/\bnext\b/, 3000], [/\bnuxt/, 3000], [/\breact-scripts\b/, 3000],
  [/\bvue-cli-service\b/, 8080], [/\bastro\b/, 4321], [/\bnest\b/, 3000], [/\bwebpack(?:-dev-server|\s+serve)\b/, 8080]
];
const DEPENDENCY_PORTS = [
  ['next', 3000], ['nuxt', 3000], ['@angular/cli', 4200], ['@angular/core', 4200], ['react-scripts', 3000],
  ['@vue/cli-service', 8080], ['astro', 4321], ['@nestjs/core', 3000], ['vite', 5173]
];

const localUrl = port => `http://localhost:${port}`;

function safeJson(text) {
  try { return JSON.parse(String(text).replace(/^﻿/, '')); } catch { return undefined; }
}

function scriptPort(text) {
  const explicit = /(?:--port[=\s]+|\s-p\s+|\bPORT=)(\d{2,5})\b/.exec(text);
  return explicit ? Number(explicit[1]) : undefined;
}

function nodeFramework(dependencies) {
  const has = name => Object.hasOwn(dependencies, name);
  const ui = [];
  if (has('next')) ui.push('Next.js');
  else if (has('nuxt')) ui.push('Nuxt');
  else if (has('@angular/core')) ui.push('Angular');
  else if (has('astro')) ui.push('Astro');
  else if (has('svelte') || has('@sveltejs/kit')) ui.push('Svelte');
  else if (has('vue')) ui.push('Vue');
  else if (has('react')) ui.push('React');
  else if (has('@nestjs/core')) ui.push('NestJS');
  else if (has('express') || has('fastify') || has('koa')) ui.push('Node');
  if (has('vite') && !ui.includes('Next.js') && !ui.includes('Nuxt')) ui.push('Vite');
  return ui.length ? ui.join(' + ') : 'Node.js';
}

function packageManager(manifest, names) {
  const declared = /^(npm|pnpm|yarn|bun)@/.exec(String(manifest.packageManager || ''));
  if (declared) return declared[1];
  if (names.has('pnpm-lock.yaml')) return 'pnpm';
  if (names.has('yarn.lock')) return 'yarn';
  if (names.has('bun.lockb') || names.has('bun.lock')) return 'bun';
  return 'npm';
}

async function detectNode(dir, names, { read, exists }) {
  const manifest = safeJson(await read(path.join(dir, 'package.json')));
  if (!manifest || typeof manifest !== 'object') return undefined;
  const scripts = manifest.scripts && typeof manifest.scripts === 'object' ? manifest.scripts : {};
  const dependencies = { ...(manifest.devDependencies || {}), ...(manifest.dependencies || {}) };
  const found = RUN_SCRIPTS.filter(name => typeof scripts[name] === 'string' && SAFE_NAME.test(name));
  if (!found.length) return undefined;
  const lockfiles = new Set();
  for (const name of ['pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock']) if (await exists(path.join(dir, name))) lockfiles.add(name);
  const manager = packageManager(manifest, lockfiles);
  let configPort;
  for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.mts']) {
    if (!(await exists(path.join(dir, name)))) continue;
    const match = /\bport\s*:\s*(\d{2,5})\b/.exec(await read(path.join(dir, name)));
    if (match) { configPort = Number(match[1]); break; }
  }
  let envPort;
  if (await exists(path.join(dir, '.env'))) {
    const match = /^\s*PORT\s*=\s*["']?(\d{2,5})/m.exec(await read(path.join(dir, '.env')));
    if (match) envPort = Number(match[1]);
  }
  const laravelAssets = names.has('artisan') && Object.hasOwn(dependencies, 'laravel-vite-plugin');
  const framework = laravelAssets ? 'Vite (assets)' : nodeFramework(dependencies);
  const profiles = found.map(script => {
    const text = scripts[script];
    let port = scriptPort(text) ?? configPort ?? envPort;
    if (!port) port = TOOL_PORTS.find(([pattern]) => pattern.test(text))?.[1];
    if (!port) port = DEPENDENCY_PORTS.find(([name]) => Object.hasOwn(dependencies, name))?.[1];
    return {
      name: script, tool: 'node', command: manager, args: ['run', script], url: port ? localUrl(port) : '',
      launchBrowser: !laravelAssets, launchUrl: '', detectUrl: true
    };
  });
  return { kind: 'node', framework, name: typeof manifest.name === 'string' ? manifest.name : '', dir, marker: path.join(dir, 'package.json'), profiles };
}

async function pythonCommand(dir, { exists }, platform) {
  for (const folder of ['.venv', 'venv', 'env']) {
    for (const relative of ['Scripts/python.exe', 'bin/python']) {
      const candidate = path.join(dir, folder, ...relative.split('/'));
      if (await exists(candidate)) return candidate;
    }
  }
  return platform === 'win32' ? 'python' : 'python3';
}

async function detectPython(dir, names, io, platform) {
  const { read, exists } = io;
  let requirements = '';
  for (const name of ['requirements.txt', 'pyproject.toml']) if (names.has(name)) requirements += '\n' + await read(path.join(dir, name));
  const wants = word => new RegExp(`(^|[\\s"'\\[,=<>~!])${word}\\b`, 'im').test(requirements);
  const python = await pythonCommand(dir, io, platform);
  const profiles = [];
  let framework;
  if (names.has('manage.py')) {
    framework = 'Django';
    profiles.push({ name: 'runserver', tool: 'python', command: python, args: ['manage.py', 'runserver'], url: localUrl(8000), launchBrowser: true, launchUrl: '', detectUrl: true });
  }
  if (wants('fastapi') || wants('uvicorn')) {
    let module = 'main';
    for (const [file, name] of [['main.py', 'main'], ['app.py', 'app'], [path.join('app', 'main.py'), 'app.main'], [path.join('src', 'main.py'), 'src.main'], [path.join('api', 'main.py'), 'api.main']]) {
      if (await exists(path.join(dir, file))) { module = name; break; }
    }
    framework ||= 'FastAPI';
    profiles.push({ name: 'uvicorn', tool: 'python', command: python, args: ['-m', 'uvicorn', `${module}:app`, '--reload'], url: localUrl(8000), launchBrowser: true, launchUrl: '', detectUrl: true });
  }
  if (wants('flask')) {
    framework ||= 'Flask';
    const discoverable = await exists(path.join(dir, 'app.py')) || await exists(path.join(dir, 'wsgi.py'));
    let entry;
    if (!discoverable) for (const name of ['main', 'application', 'server']) if (await exists(path.join(dir, `${name}.py`))) { entry = name; break; }
    const args = ['-m', 'flask', ...(entry ? ['--app', entry] : []), 'run', '--debug'];
    if (discoverable || entry) profiles.push({ name: 'flask', tool: 'python', command: python, args, url: localUrl(5000), launchBrowser: true, launchUrl: '', detectUrl: true });
  }
  if (!profiles.length) {
    let script;
    for (const name of ['main.py', 'app.py']) if (await exists(path.join(dir, name))) { script = name; break; }
    // Un script suelto solo cuenta si el proyecto declara dependencias de Python.
    if (script && requirements.trim()) {
      framework = 'Python';
      profiles.push({ name: script, tool: 'python', command: python, args: [script], url: '', launchBrowser: false, launchUrl: '', detectUrl: true });
    }
  }
  if (!profiles.length) return undefined;
  const marker = ['manage.py', 'requirements.txt', 'pyproject.toml'].find(name => names.has(name));
  return { kind: 'python', framework, name: '', dir, marker: path.join(dir, marker), profiles };
}

async function detectPhp(dir, names, { exists }) {
  if (names.has('artisan')) {
    return { kind: 'php', framework: 'Laravel', name: '', dir, marker: path.join(dir, 'artisan'), profiles: [
      { name: 'serve', tool: 'php', command: 'php', args: ['artisan', 'serve'], url: 'http://127.0.0.1:8000', launchBrowser: true, launchUrl: '', detectUrl: true }
    ] };
  }
  let root;
  if (names.has('index.php')) root = '.';
  else if (names.has('public/index.php')) root = 'public';
  else if (names.has('web/index.php')) root = 'web';
  if (!root) return undefined;
  const marker = path.join(dir, names.has('composer.json') ? 'composer.json' : root === '.' ? 'index.php' : path.join(root, 'index.php'));
  if (!(await exists(marker))) return undefined;
  return { kind: 'php', framework: 'PHP', name: '', dir, marker, profiles: [
    { name: 'php -S', tool: 'php', command: 'php', args: ['-S', 'localhost:8000', '-t', root], url: localUrl(8000), launchBrowser: true, launchUrl: '', detectUrl: true }
  ] };
}

// Lectura mínima de compose.yaml: nombres de servicio y puertos publicados. No evalúa YAML completo.
function parseCompose(text) {
  const services = [];
  let inServices = false, serviceIndent = -1, current, inPorts = false, portsIndent = -1;
  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const line = raw.replace(/\s+#.*$/, '');
    const indent = line.length - line.trimStart().length;
    const body = line.trim();
    if (indent === 0) { inServices = /^services:\s*$/.test(body); serviceIndent = -1; current = undefined; inPorts = false; continue; }
    if (!inServices) continue;
    if (serviceIndent < 0) serviceIndent = indent;
    if (indent === serviceIndent) {
      const match = /^["']?([\w.-]+)["']?:\s*$/.exec(body);
      current = match ? { name: match[1], ports: [] } : undefined;
      if (current) services.push(current);
      inPorts = false;
      continue;
    }
    if (!current) continue;
    const inline = /^ports:\s*\[(.*)\]\s*$/.exec(body);
    if (inline) { for (const entry of inline[1].split(',')) addPort(current, entry); inPorts = false; continue; }
    if (/^ports:\s*$/.test(body)) { inPorts = true; portsIndent = indent; continue; }
    if (inPorts && (indent > portsIndent || (indent === portsIndent && body.startsWith('-')))) {
      const published = /(?:^-\s*)?published:\s*["']?(\d+)/.exec(body);
      if (published) current.ports.push(Number(published[1]));
      else if (body.startsWith('-') && !/^-\s*[A-Za-z_]\w*\s*:/.test(body)) addPort(current, body.slice(1));
    } else inPorts = false;
  }
  return services;
}

function addPort(service, entry) {
  const text = String(entry).trim().replace(/^["']|["']$/g, '').replace(/\/(?:tcp|udp)$/i, '');
  const parts = text.split(':');
  const host = parts.length === 2 ? parts[0] : parts.length === 3 ? parts[1] : '';
  if (/^\d+$/.test(host)) service.ports.push(Number(host));
}

function primaryPort(services) {
  for (const service of services) {
    const port = service.ports.find(value => !NON_HTTP_PORTS.has(value));
    if (port) return port;
  }
  return undefined;
}

async function detectDocker(dir, names, { read }) {
  const file = COMPOSE_FILES.find(name => names.has(name));
  if (!file) return undefined;
  const services = parseCompose(await read(path.join(dir, file)));
  const stop = { command: 'docker', args: ['compose', '-f', file, 'down'] };
  const url = port => (port ? localUrl(port) : '');
  const profiles = [{
    name: '*', label: 'Todos los servicios', tool: 'docker', command: 'docker', args: ['compose', '-f', file, 'up'], stop,
    url: url(primaryPort(services)), launchBrowser: !!primaryPort(services), launchUrl: '', detectUrl: false
  }];
  for (const service of services) {
    if (!SAFE_NAME.test(service.name)) continue;
    const port = primaryPort([service]);
    profiles.push({
      name: service.name, tool: 'docker', command: 'docker', args: ['compose', '-f', file, 'up', service.name], stop,
      url: url(port), launchBrowser: !!port, launchUrl: '', detectUrl: false
    });
  }
  return { kind: 'docker', framework: 'Docker Compose', name: '', dir, marker: path.join(dir, file), profiles };
}

// Añade index.php (y public/, web/) a las carpetas que lo justifican: raíces del espacio de trabajo,
// carpetas con composer.json y, si la raíz no es un sitio PHP, sus subcarpetas directas.
// `files` es el Map de carpeta -> Set de nombres; `list(dir)` devuelve los nombres de subcarpetas.
const SKIP_FOLDERS = new Set(['node_modules', 'vendor', 'bin', 'obj', 'dist', 'build', 'out', 'tmp', 'temp']);
async function addPhpEntries(files, roots, exists, list = async () => []) {
  const entriesOf = async dir => {
    const found = [];
    for (const entry of PHP_ENTRIES) if (await exists(path.join(dir, ...entry.split('/')))) found.push(entry);
    return found;
  };
  const add = (dir, entries) => {
    if (!entries.length) return;
    if (!files.has(dir)) files.set(dir, new Set());
    for (const entry of entries) files.get(dir).add(entry);
  };
  const candidates = new Set();
  for (const [dir, names] of files) if (names.has('composer.json')) candidates.add(dir);
  await Promise.all(roots.map(async root => {
    const own = await entriesOf(root);
    if (own.length) { add(root, own); return; }
    candidates.add(root);
    // Una raíz sin sitio PHP: se miran sus subcarpetas directas (un proyecto por carpeta).
    const children = (await list(root)).filter(name => !name.startsWith('.') && !SKIP_FOLDERS.has(name)).slice(0, 200);
    await Promise.all(children.map(async name => { const dir = path.join(root, name); add(dir, await entriesOf(dir)); }));
  }));
  await Promise.all([...candidates].map(async dir => add(dir, await entriesOf(dir))));
  return files;
}

async function detectDirectory(dir, names, io, platform) {
  const found = await Promise.all([
    names.has('package.json') ? detectNode(dir, names, io) : undefined,
    detectPhp(dir, names, io),
    names.has('manage.py') || names.has('requirements.txt') || names.has('pyproject.toml') ? detectPython(dir, names, io, platform) : undefined,
    detectDocker(dir, names, io)
  ]);
  return found.filter(Boolean);
}

// `files` es un Map de carpeta -> Set de nombres de marcadores presentes en ella.
// Se revisan como máximo MAX_DIRS carpetas (las menos profundas primero) y de a CONCURRENCY a la vez.
async function detectWorkspace(files, io, platform = process.platform, limit = MAX_DIRS) {
  const depth = dir => dir.split(/[\\/]/).length;
  const dirs = [...files].sort((a, b) => depth(a[0]) - depth(b[0]) || a[0].localeCompare(b[0])).slice(0, limit);
  const apps = [];
  for (let index = 0; index < dirs.length; index += CONCURRENCY) {
    const batch = await Promise.all(dirs.slice(index, index + CONCURRENCY).map(([dir, names]) => detectDirectory(dir, names, io, platform)));
    for (const list of batch) apps.push(...list);
  }
  const order = { php: 0, python: 1, node: 2, docker: 3 };
  return apps.sort((a, b) => a.dir.localeCompare(b.dir) || order[a.kind] - order[b.kind]);
}

module.exports = { MARKERS, MAX_DIRS, addPhpEntries, detectWorkspace, parseCompose, scriptPort };
