'use strict';
// Utilidades compartidas por las pruebas que lanzan procesos. No termina en .test.js, así que `node --test` no la ejecuta.
const fs = require('node:fs');

// Borra una carpeta temporal aunque Windows tarde en soltarla: un proceso que acaba de morir puede conservar su
// directorio de trabajo unos segundos (EBUSY/EPERM). Si aun así no se libera, se deja: no es un fallo de la prueba.
function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
  } catch (error) {
    if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code)) throw error;
  }
}

module.exports = { removeDir };
