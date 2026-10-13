# Verificación de DotPilot

## Versión 0.9.0 — primera versión pública (2026-10-12)

**Qué cambió:** el producto usa el id `camiloruizx.dotpilot` y el prefijo `dotpilot.*` en comandos, ajustes, vistas, menús, claves de contexto, tipo de tarea y marcador de depuración.

**Qué se verificó**

- 85 pruebas automáticas aprobadas. Una prueba exige que ningún archivo distribuido (`src/`, `package.json`, textos `nls`) conserve un identificador anterior y que todo comando, vista, submenú y ajuste empiece por `dotpilot.`; otra cubre el análisis de las líneas de error de MSBuild.
- Integración en VS Code 1.141.0 real: **19 aprobadas y 1 omitida** con C# (la omitida solo corre sin C#); en el conjunto sin C#, **18 aprobadas y 1 omitida**. Cubre .NET, Node.js, PHP, Python, asistentes de IA, idioma, navegador y Laragon.

**Versión mínima de VS Code (1.85.2)**

- Se descargó VS Code 1.85.2 y se corrió el conjunto sin C#: **17 aprobadas, 2 omitidas** (depuración, que necesita C#, y las herramientas de Copilot, porque `vscode.lm` no existe en esa versión). 0 fallas.
- La corrida encontró un problema real: el *problem matcher* no se aplica a la salida de una terminal propia en 1.85, así que los errores de `dotnet run` no llegaban al panel Problemas. DotPilot ahora interpreta él mismo las líneas de error de MSBuild y publica los diagnósticos, igual en todas las versiones (también en 1.141, donde la prueba lo comprobó sin ninguna otra extensión).
- La depuración con C# no se ejercitó en 1.85.

**Asistentes reales distintos de Claude Code (Codex CLI 0.149, Gemini CLI 0.46, Copilot CLI 1.0)**

- **Codex:** sesión completa verificada (`npm run test:assistant:codex`, modelo `gpt-5.5`, 36 s): lista, selecciona, ejecuta Node.js y .NET, lee URL y salida y detiene; en VS Code se vieron abrirse y cerrarse los puertos 5189 y 5187. `codex mcp list` con el `config.toml` generado por DotPilot muestra el servidor. Codex expone las herramientas como diferidas: el primer intento falló porque la instrucción le prohibía usar su buscador de herramientas; con el buscador permitido funciona.
- **Gemini CLI:** lee el `.gemini/settings.json` generado (como configuración de sistema) y `gemini mcp list` informa «Connected». **La sesión con modelo no se pudo hacer**: el CLI responde que el cliente ya no es compatible con el nivel de Gemini Code Assist para particulares de esta cuenta. Es una limitación de la cuenta, no de DotPilot.
- **Copilot CLI:** lee el `.mcp.json` generado como servidor del espacio de trabajo (`copilot mcp list`). **La sesión con modelo no se pudo hacer**: no hay sesión iniciada y no se inyectó ningún token.
- Una nota de método: los CLIs de npm se lanzan con `node` y su script de entrada, sin `cmd.exe`, porque el entrecomillado de `cmd` rompía los argumentos TOML y JSON.

**Con un asistente real (Claude Code)**

- `npm run test:assistant` lanza un VS Code aislado con el puente activo y una sesión **real de Claude Code 2.1.285** (CLI en modo no interactivo, modelo `haiku`, 11 turnos, ≈ 0,06 USD por corrida) que maneja DotPilot solo por MCP: lista los proyectos, selecciona y ejecuta NodeSample, lee la URL y su salida, lo detiene, y repite con el proyecto .NET leyendo la línea «Now listening on» de Kestrel. Se verificó además **desde dentro de VS Code** que los puertos 5189 y 5187 se abrieron y se cerraron, y que no quedó nada en ejecución.
- Se hicieron cuatro corridas: tres con `--mcp-config` (en la primera el asistente cumplió, pero una comprobación mía era demasiado estricta y falló; la corregí) y una con `--project-config`, que **no** pasa `--mcp-config`: Claude Code lee el `.mcp.json` generado por DotPilot (el mismo archivo que escribe «Conectar asistentes de IA» para Claude Code), con `enableAllProjectMcpServers`.
- Claude Code usó su cargador de herramientas diferidas (`ToolSearch`) para obtener los esquemas MCP antes de llamarlas, y las 13 herramientas se anuncian y funcionan con nombres `mcp__dotpilot__dotpilot_*`.

**.NET con el ejecutor propio (Ejecutar y Hot Reload)**

- En VS Code real, con el proyecto ASP.NET de prueba: la URL se lee de «Now listening on», el registro y una excepción provocada (`/boom`) aparecen en la salida y en `dotpilot_get_output` sin códigos de color, `dotpilot_get_status` informa `running` con la URL, y Detener libera el puerto. Ejecutar, perfiles, reiniciar y Hot Reload siguen pasando.
- Un error de compilación al ejecutar llega al panel Problemas **por el problem matcher** (se verificó en el conjunto sin C#, donde ninguna otra extensión produce diagnósticos) y a la salida (`CS0029`).
- Una ruta con espacios, `&` y `%` se ejecuta bien sin intérprete (prueba unitaria con Node); solo los `.cmd` (npm, yarn, pnpm) pasan por `cmd.exe` y rechazan caracteres peligrosos.
- Detener espera a la salida real del proceso: antes la prueba de salida fallaba de forma intermitente al comprobar `exited` justo después de `stop()`.

**División de extension.js**

- 64 métodos movidos tal cual a seis módulos (`src/controller/`) por un script, sin reescribir su lógica; `extension.js` queda en 381 líneas. Las 84 pruebas unitarias, las 19 de integración (más 1 omitida) y la prueba con Claude Code real pasan igual que antes.
- La división dejó un fallo que solo apareció al ejecutar en VS Code real: la ruta a `assets/laragon.ps1` se calculaba con `__dirname` y había que subir un nivel más. Lo detectó el escenario de integración de Laragon y se corrigió. Se comprobó que todos los `require` relativos de los módulos resuelven.
- Sin analizador estático: la comprobación de identificadores no definidos se apoya en las pruebas, no en un linter.

**Apache y Laragon**

- Con el Apache **real** de una instalación de Laragon (httpd 2.4.68 y PHP 8.3.33 como módulo), sobre una copia temporal de su `httpd.conf` en el puerto 8089: el script lo inicia en ≈ 1,7 s, `/info.php` responde 200 con el módulo de Apache de PHP 8.3.33, se anuncia la URL, se avisa que MySQL no responde y **Detener deja 0 procesos `httpd`** y el puerto cerrado.
- Detección sobre una instalación real de Laragon, solo lectura: los sitios con virtual host automático dan `http://<sitio>.test/`; un sitio sin virtual host da `http://localhost/<carpeta>/` con la carpeta codificada; una subcarpeta usa la ruta bajo el virtual host del sitio.
- 11 pruebas propias (lectura de la instalación, virtual hosts sin SSL, `hosts`, orden de perfiles, y el script real de PowerShell con `node.exe` en lugar de `httpd`: arranque, registro en vivo, reutilización, fallo al arrancar, aviso de MySQL con tildes, y cierre de Apache huérfano) y un escenario de integración con una instalación falsa de Laragon.
- Las pruebas con el Apache real encontraron cuatro fallos del script que las pruebas unitarias no veían y que se corrigieron: Windows PowerShell 5.1 no desenrolla el arreglo JSON de argumentos; `Start-Process` lo lanzaba fuera del árbol de procesos y `Detener` lo dejaba vivo; Apache heredaba las tuberías de DotPilot; y si no abría el puerto a tiempo el script terminaba dejándolo huérfano.

**Qué NO se verificó**

- **Un sitio de Laragon completo de punta a punta en VS Code real**: no se ejecutó un sitio con base de datos y el puerto 80. Sí se verificó cada pieza por separado y con el Apache real en el puerto 8089.
- XAMPP y WAMP, nginx de Laragon, HTTPS (el virtual host en 443 se ignora) y MySQL gestionado por DotPilot no están cubiertos.
- Dos copias de Laragon o un Apache en un puerto distinto de 80 se leen de `httpd.conf`, pero solo se probó el puerto 80 y el 8089.
- Las variables de `terminal.integrated.env.*` que ahora se aplican a la aplicación no se probaron en VS Code real; antes las heredaba la tarea de proceso.
- Hot Reload con cambios que exigen reinicio («rude edits») y la salida de `dotnet watch` en sesiones largas; solo se probó un cambio simple.
- Proyectos .NET con varios `launchSettings` de perfil Executable/IIS (siguen sin soporte).
- Instalar 0.9.0 sobre una 0.8.0 instalada en tu VS Code: es el caso con las dos extensiones a la vez. Se espera el aviso de desinstalar la anterior y, mientras ambas existan, un registro duplicado de las herramientas `dotpilot_*` (la segunda en activarse lo registra en el log y continúa); no se ejecutó.
- La migración de ajustes de otros ámbitos (carpeta de un espacio multi-raíz) no se traslada.
- Lo que VS Code guarda por id de extensión (proyecto, perfil, navegador elegidos por proyecto, estado del panel) no se puede copiar entre extensiones y se vuelve a pedir.

## Versión 0.8.0 — asistentes de IA (2026-10-12)

**Qué se verificó**

- 69 pruebas automáticas aprobadas (44 de 0.7.0 + 25 de esta versión): definición de herramientas y validación de entradas; que `package.json` coincida con esa definición; puente (token, origen de navegador, Host ajeno, JSON inválido, herramienta desconocida, archivo de descubrimiento); descubrimiento de la ventana correcta y limpieza de procesos muertos; servidor MCP real por stdio (initialize, tools/list, tools/call, error sin DotPilot); mezcla de `.mcp.json`, `settings.json` y `config.toml` sin pisar lo existente; y permisos (preguntar, permitir sesión, permitir siempre, confirmación del chat, espacio no confiable); y del pulido: ráfagas de actualización (una búsqueda más una repetición), `index.php` en árboles tipo CMS, límite de 300 carpetas, cierre del puente mientras arranca, argumentos que no se pueden escapar y servidores muy habladores.
- Integración en VS Code 1.141.0 real (Windows, C# 2.160.4): **16 de 16**, con los 12 escenarios anteriores sin cambios; se añadieron el del idioma de los menús y el del cambio de navegador con la aplicación abierta (Edge → Chrome reales). La búsqueda completa de proyectos de los cuatro tipos tardó ≈ 90–110 ms en el espacio de prueba (la prueba exige menos de 3 s). Los dos nuevos: las 13 herramientas aparecen en `vscode.lm.tools` y `vscode.lm.invokeTool` responde; y un cliente MCP real (el servidor copiado a la carpeta estable) selecciona el proyecto Node.js, lo ejecuta, recibe la URL real, lee la salida sin códigos de color, ve rechazada una acción .NET, lo detiene y deja el puerto libre. Al desactivar el ajuste el puente se cierra y su archivo de descubrimiento desaparece.

**Qué NO se verificó**

- **Sesiones con modelo:** verificadas con Claude Code y Codex, en modo no interactivo. Gemini y Copilot CLI solo hasta la lectura de la configuración y la conexión (ver arriba). Tampoco se probó ningún asistente **interactivo dentro de VS Code**: la aprobación manual del servidor del proyecto en Claude Code y la recarga de herramientas tras «Conectar asistentes de IA» siguen sin comprobarse; la prueba usa `enableAllProjectMcpServers` y un modelo pequeño.
- Los formatos generados se comprobaron con cada CLI: `.mcp.json` (Claude Code y Copilot CLI lo cargan), `config.toml` (Codex) y `.gemini/settings.json` (Gemini conecta). Los identificadores de extensión usados para detectar a los asistentes siguen su documentación pública y no se comprobaron en VS Code con cada extensión.
- La ventana de permiso en VS Code (botones Permitir / Permitir en esta sesión / Rechazar) se probó con una simulación, no con clics reales. Las pruebas de integración usaron `assistantsPermission = allow`.
- Copilot: solo se comprobó el registro de las herramientas y su invocación sin chat; la confirmación en el chat la gestiona VS Code.
- Varias ventanas de VS Code, Linux y macOS, WSL y escritorios remotos.

**Eficiencia: qué se midió y qué no**

- Medido: la búsqueda en el espacio de prueba (≈ 100 ms) y el recorrido de 350 carpetas simuladas en memoria (menos de 2 s, con tope de 300).
- No medido: tiempo de activación, uso de memoria y CPU en un VS Code con un repositorio grande real. Por diseño, el puente de asistentes, el ejecutor y la API para agentes se cargan solo al usarse; con el ajuste de asistentes apagado no hay puerto ni archivo.

**Idioma de los menús y navegador (corrección posterior)**

- Los menús nativos de VS Code toman su idioma del manifiesto: siguen el idioma de pantalla de VS Code, no el ajuste de DotPilot. Se probó una solución con copias de cada menú y comando por idioma y se descartó por frágil (duplicaba el manifiesto de 28 a 50 KB y exigía mantener sincronizados 58 alias). Queda un solo juego de `package.nls`.
- Para que la diferencia no sorprenda, si el idioma de DotPilot difiere del de VS Code se avisa una sola vez (por combinación de idiomas) y se ofrece abrir «Configurar idioma de pantalla». Una prueba cubre la decisión y otra verifica que no existan comandos ni menús por idioma y que el manifiesto no crezca por encima de 45 KB.
- **No se comprobó visualmente** el aviso ni el menú desplegado en VS Code.
- Navegador: se probó con Edge y Chrome reales el cambio con la aplicación abierta. La apertura directa del navegador elegido con la aplicación detenida se probó con un lanzador simulado; no se abrió una ventana real en esa ruta.

**Límites a tener en cuenta**

- Con VS Code en inglés y DotPilot en español, los menús y la paleta quedan en inglés; el panel y los mensajes salen en español. Es la limitación conocida de las extensiones de VS Code.

- La depuración (`dotpilot_debug`) escribe en la Consola de depuración de VS Code, que la API no permite leer; con ejecutar o Hot Reload sí hay salida disponible.
- El servidor MCP necesita `node` en el PATH y la ventana de VS Code con la carpeta abierta.
- `.mcp.json` contiene una ruta absoluta de tu equipo.

## Versión 0.7.0 — varios tipos de proyecto (2026-10-12)

**Qué se verificó**

- 44 pruebas automáticas aprobadas (25 anteriores + 19 nuevas): detección de Node.js, PHP/Laravel, Python y Docker con un sistema de archivos falso; lectura de `compose.yaml`; extracción de URL de la salida con colores; escape de argumentos; y un ejecutor con procesos reales de Node (URL única, detención del árbol de procesos, comando de limpieza una sola vez, ejecutable inexistente).
- Integración en VS Code 1.141.0 real (Windows, C# 2.160.4): **12 de 12**. Los 7 escenarios .NET de la versión anterior siguen aprobados sin cambios, y se añadieron cinco con un espacio de trabajo de varios proyectos (.NET + Node.js + PHP + Python): detección conjunta; Node.js ejecutar → URL leída de la salida (con colores ANSI dentro de la URL) → apertura del navegador solicitada una vez → reiniciar → detener y liberar el puerto; rechazo de acciones .NET con mensaje claro; PHP con `php -S` real, URL leída y puerto liberado al detener; Python 3.14 real ejecutando un script con `print` sin `flush` (DotPilot inicia Python sin búfer), URL leída y puerto liberado.
- El HTML real del panel se renderizó en Edge sin ventana con un puente de mensajes de prueba, en modo .NET, Node.js y Docker (≈330 px). Se corrigió un espaciado que apareció en esas capturas.
- El VSIX contiene 22 archivos (dos módulos nuevos: `detect.js`, `runner.js`), sin pruebas ni respaldos. Sin dependencias de ejecución nuevas.

**Qué NO se verificó**

- Django, FastAPI y Flask **no se ejecutaron**: solo se ejecutó de verdad un script de Python simple; los perfiles de esos frameworks se probaron únicamente a nivel de detección. Docker Compose tampoco se ejecutó: se probó la lectura de `compose.yaml` y que el comando de limpieza corra una vez, con comandos de prueba, sin iniciar el servicio de Docker.
- Laravel, Vite, Angular, Next.js y demás servidores reales no se iniciaron; sus mensajes de arranque se probaron con ejemplos escritos a mano.
- Linux y macOS: la rama POSIX (grupo de procesos separado y `SIGTERM`) tiene el mismo código pero no se ejecutó. WSL, SSH remoto y contenedores de desarrollo tampoco.
- Edge/Chrome enlazados con proyectos que no son .NET: la apertura se probó sustituyendo `openBrowser`; el enlace de cierre usa el mismo código de las versiones 0.4–0.6.
- Depuración, Hot Reload y compilación siguen siendo solo de .NET.

**Hallazgos a tener en cuenta**

- Python guarda `print()` en un búfer cuando la salida no es una terminal; por eso DotPilot define `PYTHONUNBUFFERED=1` al iniciar Python. Otras herramientas también se comportan distinto sin terminal real (sin TTY): los atajos interactivos de Vite («press h») no aparecen. La entrada del teclado sí se reenvía al proceso.
- Docker: detener ejecuta `docker compose down`, que elimina los contenedores y la red del proyecto (no los volúmenes).
- Un `package.json` solo cuenta como proyecto si tiene un script `dev`, `start`, `serve` o `develop`.

## Pruebas de integración en VS Code real (2026-10-12)

Se agregó una suite que corre en VS Code 1.141.0, con un proyecto ASP.NET real y un perfil aislado (`test-integration/`, `npm run test:integration`). Siete escenarios por conjunto: activación, compilar, ejecutar y detener, cambiar de perfil, reiniciar, depurar (pausar, continuar, detener) y Hot Reload.

| Conjunto | C# | C# Dev Kit | Resultado |
|---|---|---|---|
| `csharp` | 2.160.4 | — | 7 de 7 |
| `devkit-stable` | 2.160.4 | 3.40.210 (activo) | 7 de 7 |
| `devkit-prerelease` | 11.2.14 | 11.3.30 (activo) | 7 de 7 |
| `sin-csharp` | — | — | 6 de 6; depuración omitida por diseño |

Las 25 pruebas unitarias siguen aprobadas. No cambió el código de la extensión.

Alcance: sin pruebas de Edge/Chrome enlazados, WSL/remoto, otros sistemas operativos, inicio de sesión de Dev Kit ni varios proyectos (ver `test-integration/README.md`). Hallazgo: *Pausar* abre un selector de hilo en aplicaciones con varios hilos.

## Versión 0.6.1 — orden de la barra del editor (2026-10-12)

El menú azul de DotPilot pasa a mostrarse antes de «Ejecutar sin depurar». Solo se renumeraron los grupos `navigation@N` de `editor/title`; los comandos, condiciones `when` e íconos no cambian.

25 pruebas automáticas aprobadas; la que verifica la barra se actualizó al orden nuevo y ahora comprueba también el grupo del menú. Se regeneró el VSIX y se comparó con el anterior: mismos 20 archivos, solo difieren `package.json`, `README.md` y `CHANGELOG.md`, y no contiene los respaldos de rollback.

No se comprobó el resultado visual dentro de VS Code: el orden efectivo frente a íconos de otras extensiones lo decide VS Code según el número de grupo.

## Versión 0.6.0

25 pruebas automáticas aprobadas. Las nuevas verifican selección persistente por proyecto, retorno al navegador del espacio de trabajo, cambio aplicado al siguiente arranque, eventos de Chrome con la pestaña antes que la sesión principal, carga diferida del panel, ausencia de actualizaciones a paneles ocultos y eliminación de estados/contextos repetidos.

En VS Code aislado, con una aplicación ASP.NET real, se probaron los comandos de selección de Chrome y Edge y sus sesiones reales (`pwa-chrome` y `pwa-msedge`). En ambos casos se comprobó la respuesta HTTP, que cambiar la elección no cambia la ventana activa, y que cerrar la pestaña mediante su depurador detiene .NET y libera el puerto. También se verificaron el selector del panel, mostrar/ocultar y la ausencia de controles inferiores cuando están deshabilitados.

El HTML real se probó en Edge sin ventana con un puente de mensajes de prueba: selector de navegador, español/inglés, conservación de traducciones al omitirlas en estados posteriores, ajustes, teclado, pestaña recordada y anchos 220/320/480 px. Se inspeccionó la captura del selector junto al perfil. No se simuló un clic sobre el menú nativo de VS Code; sus comandos y condiciones de selección están en el manifiesto.

El ícono pasó de 1.184.672 a 6.882 bytes. El VSIX pasó de aproximadamente 947 KiB a 49 KiB (alrededor de 95 % menos). No se añadieron dependencias de ejecución. Se verificó la reducción de trabajo mediante pruebas de carga y mensajes; no se atribuye un tiempo fijo de activación ni una cifra de memoria, ya que no se hicieron mediciones comparativas de esos valores.

## Versión 0.5.0

21 pruebas automáticas aprobadas: se mantienen las de ejecución y se añaden detección de idioma/región, sustitución de parámetros, cobertura de traducciones del manifiesto y del panel, menú superior agrupado y validación de mensajes de ajustes.

En una ventana aislada de VS Code se verificaron los cinco ajustes del panel, su persistencia real, el rechazo de claves y valores no permitidos, compilación y ejecución/detención .NET con mensajes en inglés, cambio a español sin reemplazar el HTML y reapertura de Ajustes tras ocultar el panel. La prueba detectó y permitió corregir el ámbito de guardado para los ajustes de ventana.

Se renderizó el HTML real del panel en Edge sin ventana, con un puente de mensajes de prueba. Se comprobaron español/inglés sin recargar, opciones seleccionadas, persistencia de pestaña al recargar, navegación por teclado, envío de Compilar, etiqueta Continuar en pausa y anchos 220/320/480 px sin desbordamiento horizontal. Se revisaron capturas del panel y los ajustes. Los textos nativos de menús se validaron mediante los catálogos oficiales de localización; no se inspeccionó visualmente el menú desplegado dentro de VS Code.

Las salidas del SDK, mensajes del navegador y otras extensiones conservan su propio idioma. No se volvieron a ejecutar todos los escenarios de navegador de 0.4.0: el cambio de esta versión afecta a presentación, traducciones y configuración; las pruebas de lógica de su ciclo de vida siguen aprobadas.

## Versiones anteriores

La versión 0.4.0 añade un navegador vinculado a la ejecución, Mostrar/Ocultar panel según la visibilidad y el publicador local `camiloruizx`. Se revisaron la sintaxis, 17 pruebas automáticas y el contenido del instalador. No se ha publicado en Marketplace.

Validada el 12 de octubre de 2026 en Windows con VS Code, SDK .NET 10.0.401 y extensión C# 2.160.4. Se usaron ventanas aisladas y proyectos temporales.

## Pruebas automáticas

17 pruebas aprobadas: las 10 de JSONC, perfiles, URLs, puertos, argumentos y escape, más siete de ciclo de vida: apertura concurrente sin duplicados, cierre de la pestaña principal, aislamiento de sesiones ajenas o antiguas, detención durante apertura, recuperación tras fallo del navegador, ocultación idempotente del panel y cancelación durante el cierre previo al arranque.

## Integración de la versión 0.4.0

En una ventana aislada de VS Code, con Edge y una aplicación ASP.NET real:

- Mostrar, ocultar, ocultar de nuevo y volver a mostrar el panel mediante sus comandos reales.
- Ejecutar, Hot Reload y depurar: cerrar la pestaña vinculada detiene el servidor y deja de responder el puerto HTTP.
- Abrir navegador repetidamente mantiene una sola sesión vinculada.
- Reiniciar sustituye la sesión del navegador; un evento antiguo no detiene la ejecución nueva.
- Detener termina tanto la aplicación como el navegador vinculado.

Los cierres se solicitaron al depurador de la pestaña, que cierra el destino real de Edge; no se simularon clics sobre la X del navegador. Se verificaron los eventos de VS Code y las respuestas del servidor. No se probó Chrome, el cierre manual con el ratón ni el menú visual en todos los diseños. Una primera prueba con `window.close()` no fue fiable por las restricciones del navegador y se sustituyó por el cierre del destino desde su depurador.

## Solución ASP.NET real

En la versión 0.2.0 se probaron tres proyectos —aplicación ASP.NET, biblioteca y proyecto xUnit— y dos soluciones en la misma carpeta:

- Detección de proyectos y persistencia de la solución seleccionada.
- Restaurar, compilar, recompilar, analizar, ejecutar pruebas y limpiar la solución.
- Prueba xUnit válida y detección de una prueba deliberadamente fallida.
- HTTP y HTTPS: respuestas reales del servidor y variables del perfil aplicadas.
- Solicitud de apertura de la URL con `launchUrl: "health"` en ambos protocolos.
- Hot Reload: cambiar la biblioteca referenciada actualiza la respuesta HTTP.
- Depuración HTTPS: breakpoint, paso por encima, continuación, reinicio con una sesión nueva y detención.

El certificado HTTPS se generó para la prueba, sin instalarlo ni cambiar la confianza del sistema. El cliente de prueba permitió ese certificado autofirmado. La prueba de navegador interceptó la solicitud de apertura: comprobó el momento y URL, sin abrir una ventana externa ni validar visualmente el navegador.

## Límites

También se verificaron cinco casos de ciclo de vida: cancelar una consulta MSBuild, cancelar una compilación sin dejar el control ocupado ni mostrar un falso error, rechazar una ejecución simultánea sin liberar el bloqueo anterior, impedir el inicio con perfiles malformados y actualizar el panel sin sustituir su HTML.

No se validó visualmente el panel en todos los temas, tamaños o lectores de pantalla. No se probaron proyectos F#/VB, aplicaciones de escritorio, todos los escenarios con varios frameworks ni hosts Linux/macOS/remotos. El análisis ejecuta los analizadores del proyecto; no certifica ausencia de problemas en el código del usuario.

