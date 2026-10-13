'use strict';
// Apache de Laragon para proyectos PHP: detecta la instalación, el virtual host del sitio y arma un perfil que
// arranca (o reutiliza) el Apache de Laragon con su propia configuración. `php -S` no replica virtual hosts,
// .htaccess ni módulos; con Apache sí. No depende de VS Code: recibe funciones de lectura (`io`).
const path = require('node:path');

const win = path.win32;
const HOSTS = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
const norm = value => win.normalize(String(value).replace(/\//g, '\\')).replace(/\\+$/, '').toLowerCase();
const inside = (parent, child) => { const a = norm(parent), b = norm(child); return b === a || b.startsWith(a + '\\'); };
const unquote = value => String(value).trim().replace(/^["']|["']$/g, '');

// Busca la raíz de Laragon: ajuste, carpetas superiores del proyecto y rutas habituales.
async function findInstall(io, projectDir, hints = []) {
  const candidates = [];
  for (const hint of hints) if (hint) candidates.push(String(hint));
  if (projectDir) for (let dir = win.normalize(projectDir); ; ) { candidates.push(dir); const up = win.dirname(dir); if (up === dir) break; dir = up; }
  for (const drive of ['C', 'D', 'E']) candidates.push(`${drive}:\\laragon`);
  const seen = new Set();
  for (const root of candidates) {
    const key = norm(root);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!(await io.exists(win.join(root, 'laragon.exe')))) continue;
    const install = await readInstall(io, root);
    if (install) return install;
  }
  return undefined;
}

async function readInstall(io, root) {
  const apacheBase = win.join(root, 'bin', 'apache');
  const versions = (await io.listDirectories(apacheBase)).filter(name => /^httpd-/i.test(name)).sort().reverse();
  let apache;
  for (const name of versions) {
    const dir = win.join(apacheBase, name);
    const httpd = win.join(dir, 'bin', 'httpd.exe');
    const conf = win.join(dir, 'conf', 'httpd.conf');
    if (await io.exists(httpd) && await io.exists(conf)) { apache = { dir, httpd, conf }; break; }
  }
  if (!apache) return undefined;
  const confText = await io.readFile(apache.conf);
  const port = Number(/^\s*Listen\s+(?:[\d.]+:)?(\d+)\s*$/m.exec(confText)?.[1]) || 80;
  const errorLogDirective = unquote(/^\s*ErrorLog\s+(.+)$/m.exec(confText)?.[1] || 'logs/error_log');
  const errorLog = win.isAbsolute(errorLogDirective) ? win.normalize(errorLogDirective) : win.join(apache.dir, errorLogDirective);
  const ini = await io.readFile(win.join(root, 'usr', 'laragon.ini'));
  const www = unquote(/^\s*DocumentRoot\s*=\s*(.+)$/m.exec(/\[apache\][^\[]*/i.exec(ini)?.[0] || '')?.[1] || win.join(root, 'www'));
  let mysqlPort;
  for (const name of (await io.listDirectories(win.join(root, 'bin', 'mysql'))).sort().reverse()) {
    const text = await io.readFile(win.join(root, 'bin', 'mysql', name, 'my.ini'));
    const found = /^\s*port\s*=\s*(\d+)/m.exec(/\[mysqld\][^\[]*/i.exec(text)?.[0] || '');
    if (found) { mysqlPort = Number(found[1]); break; }
  }
  return { root, httpd: apache.httpd, conf: apache.conf, errorLog, port, www, mysqlPort, sitesDir: win.join(root, 'etc', 'apache2', 'sites-enabled') };
}

// Virtual hosts sin SSL de los archivos de sites-enabled: [{ serverName, aliases, documentRoot }].
async function readVirtualHosts(io, install) {
  const out = [];
  for (const name of (await io.listFiles(install.sitesDir)).filter(file => /\.conf$/i.test(file))) {
    const text = await io.readFile(win.join(install.sitesDir, name));
    for (const block of text.matchAll(/<VirtualHost\s+([^>]+)>([\s\S]*?)<\/VirtualHost>/gi)) {
      if (/:443\b/.test(block[1])) continue;
      const documentRoot = /^\s*DocumentRoot\s+(.+)$/mi.exec(block[2])?.[1];
      const serverName = /^\s*ServerName\s+(\S+)/mi.exec(block[2])?.[1];
      if (!documentRoot || !serverName) continue;
      const aliases = [...block[2].matchAll(/^\s*ServerAlias\s+(.+)$/gmi)].flatMap(item => item[1].trim().split(/\s+/));
      out.push({ serverName, aliases, documentRoot: unquote(documentRoot) });
    }
  }
  return out;
}

// Dirección con la que Apache sirve el proyecto, o undefined si no se puede determinar.
async function siteUrl(io, install, projectDir) {
  const hosts = await io.readFile(HOSTS);
  const resolves = name => new RegExp(`^\\s*127\\.0\\.0\\.1\\s+.*\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'mi').test(hosts);
  const suffix = install.port === 80 ? '' : `:${install.port}`;
  // 1) virtual host cuyo DocumentRoot es el proyecto, o la carpeta que lo contiene (el más específico).
  const candidates = (await readVirtualHosts(io, install))
    .filter(host => inside(host.documentRoot, projectDir))
    .sort((a, b) => norm(b.documentRoot).length - norm(a.documentRoot).length);
  for (const host of candidates) {
    const relative = win.relative(host.documentRoot, projectDir).split('\\').filter(Boolean).join('/');
    if (resolves(host.serverName)) return `http://${host.serverName}${suffix}/${relative ? relative + '/' : ''}`;
  }
  // 2) sin virtual host usable: localhost con la ruta relativa al DocumentRoot de Laragon.
  if (inside(install.www, projectDir)) {
    const relative = win.relative(install.www, projectDir).split('\\').filter(Boolean).map(encodeURIComponent).join('/');
    return `http://localhost${suffix}/${relative ? relative + '/' : ''}`;
  }
  return undefined;
}

// Perfil «Apache (Laragon)». `script` es la ruta de assets/laragon.ps1.
async function profileFor(io, projectDir, { script, hints = [] } = {}) {
  const install = await findInstall(io, projectDir, hints);
  if (!install) return undefined;
  const url = await siteUrl(io, install, projectDir);
  if (!url) return undefined;
  return {
    name: 'apache', label: 'Apache (Laragon)', tool: 'laragon', url, fixedUrl: true, launchBrowser: true, launchUrl: '', detectUrl: true,
    description: url,
    command: 'powershell', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
    env: {
      DOTPILOT_HTTPD: install.httpd, DOTPILOT_HTTPD_ARGS: JSON.stringify(['-f', install.conf]),
      DOTPILOT_ERROR_LOG: install.errorLog, DOTPILOT_PORT: String(install.port), DOTPILOT_MYSQL_PORT: install.mysqlPort ? String(install.mysqlPort) : ''
    }
  };
}

// Antepone el perfil de Apache a los proyectos PHP servibles por Laragon. Solo Windows.
async function addApacheProfiles(apps, io, options = {}, platform = process.platform) {
  if (platform !== 'win32') return apps;
  for (const app of apps) {
    if (app.kind !== 'php') continue;
    try {
      const profile = await profileFor(io, app.dir, options);
      if (profile) app.profiles = [profile, ...app.profiles];
    } catch { /* un Laragon ilegible no debe impedir ejecutar con php -S */ }
  }
  return apps;
}

module.exports = { findInstall, readInstall, readVirtualHosts, siteUrl, profileFor, addApacheProfiles, HOSTS };
