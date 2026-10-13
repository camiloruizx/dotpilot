'use strict';
// Abre una URL en un navegador concreto (Chrome o Edge) cuando no hay una ejecución con ventana vinculada.
// `vscode.env.openExternal` solo conoce el navegador predeterminado del sistema, de ahí este módulo.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function candidates(browser, platform = process.platform, env = process.env) {
  const chrome = browser === 'chrome';
  if (platform === 'win32') {
    const relative = chrome ? 'Google\\Chrome\\Application\\chrome.exe' : 'Microsoft\\Edge\\Application\\msedge.exe';
    return [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).map(root => path.join(root, relative));
  }
  if (platform === 'darwin') {
    return [chrome ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  }
  return chrome
    ? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']
    : ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge'];
}

function find(browser, { exists = fs.existsSync, platform, env } = {}) {
  return candidates(browser, platform, env).find(file => exists(file));
}

// Devuelve true si se lanzó el navegador; false si no está instalado o la URL no es http(s).
function open(browser, url, { exists, platform, env, launch = spawn } = {}) {
  if (browser !== 'chrome' && browser !== 'edge') return false;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return false;
  const executable = find(browser, { exists, platform, env });
  if (!executable) return false;
  try {
    const child = launch(executable, [parsed.toString()], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on?.('error', () => {});
    child.unref?.();
    return true;
  } catch { return false; }
}

module.exports = { candidates, find, open };
