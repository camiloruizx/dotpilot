'use strict';
// Funciones de lectura de archivos sobre la API de VS Code (vscode.workspace.fs), con las firmas que esperan
// detect.js y laragon.js. Los errores de lectura devuelven valores vacíos: la detección nunca debe lanzar.
function createIo(vscode) {
  const uri = file => vscode.Uri.file(file);
  const entries = async (dir, type) => {
    try {
      return (await vscode.workspace.fs.readDirectory(uri(dir))).filter(([, kind]) => kind & type).map(([name]) => name);
    } catch { return []; }
  };
  const api = {
    async read(file) {
      try { return Buffer.from(await vscode.workspace.fs.readFile(uri(file))).toString('utf8'); } catch { return ''; }
    },
    async exists(file) {
      try { await vscode.workspace.fs.stat(uri(file)); return true; } catch { return false; }
    },
    listDirectories: dir => entries(dir, vscode.FileType.Directory),
    listFiles: dir => entries(dir, vscode.FileType.File)
  };
  api.readFile = api.read;
  return api;
}

module.exports = { createIo };
