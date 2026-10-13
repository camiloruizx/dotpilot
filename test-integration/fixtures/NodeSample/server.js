// Servidor mínimo de la prueba: anuncia su URL con colores, como Vite y otros servidores de desarrollo.
const http = require('node:http');
const port = Number(process.env.PORT || 5189);
http.createServer((request, response) => response.end('dotpilot-node')).listen(port, '127.0.0.1', () => {
  console.log(`\u001b[32m  ➜  Local:\u001b[0m   http://localhost:\u001b[1m${port}\u001b[22m/`);
});
