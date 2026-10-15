# Pruebas de integración de DotPilot

Corren en un **VS Code real**, con un proyecto ASP.NET real, y manejan DotPilot por sus comandos (`dotpilot.run`, `.debug`, `.watch`, …). Complementan las pruebas unitarias de `npm test`, que validan la lógica sin abrir VS Code.

## Cómo ejecutarlas

```
npm run test:integration                 # conjunto "csharp"
node test-integration/run.js devkit-stable
node test-integration/run.js devkit-prerelease
node test-integration/run.js sin-csharp
```

| Conjunto | Extensiones de Microsoft en el VS Code de prueba | Origen |
|---|---|---|
| `csharp` (predeterminado) | C# (con su depurador) | Copiada de tu VS Code |
| `devkit-stable` | C# + C# Dev Kit estable | Copiadas de tu VS Code |
| `devkit-prerelease` | C# + C# Dev Kit en pre-release | Marketplace (requiere red) |
| `sin-csharp` | Ninguna | — |

## Otra versión de VS Code (por ejemplo la mínima declarada, 1.85)

```
node -e "require('@vscode/test-electron').downloadAndUnzipVSCode({version:'1.85.2',cachePath:'.vscode-test'}).then(console.log)"
DOTPILOT_VSCODE=<ruta impresa> node test-integration/run.js sin-csharp
```

Con el conjunto `sin-csharp` se omiten la depuración (necesita C#) y, en versiones sin `vscode.lm`, las herramientas de Copilot.

## Prueba con asistentes reales de otros fabricantes

```
npm run test:assistant:codex
npm run test:assistant:gemini
npm run test:assistant:copilot
```

Cada CLI debe estar instalado y con sesión iniciada; el consumo corre por tu cuenta. Antes de la sesión se comprueba que el CLI lee el archivo de configuración que genera DotPilot (`codex mcp list`) y, con Gemini y Copilot, el informe indica si la sesión con modelo no pudo hacerse por la cuenta. Los informes quedan en `test-integration/.results/real-assistant-<nombre>.json`.

## Prueba con un asistente real

```
npm run test:assistant                          # Claude Code con --mcp-config
node test-integration/real-assistant.js --project-config   # Claude Code leyendo el .mcp.json que escribe DotPilot
```

Lanza un VS Code aislado con DotPilot y el puente activo (permiso `allow`) y le pide a **Claude Code** (CLI instalado, modo `-p`, modelo `haiku`) que maneje la extensión solo por MCP: listar, seleccionar, ejecutar Node.js y .NET, leer URL y salida, y detener. Comprueba las llamadas del asistente y, por separado, lo que VS Code observó (puertos abiertos y cerrados). Escribe el informe en `test-integration/.results/real-assistant*.json`.

- El consumo de la sesión del asistente corre por tu cuenta de Claude: ≈ 0,06 USD por corrida; hay un tope de `DOTPILOT_ASSISTANT_BUDGET` (1,5 por omisión).
- No toca tu perfil de VS Code ni tu configuración de Claude: usa una carpeta temporal y `--strict-mcp-config` (o su propio `.mcp.json`).
- Variables: `DOTPILOT_CLAUDE` (ruta del CLI), `DOTPILOT_ASSISTANT_MODEL`, `DOTPILOT_VSCODE`.
- Usa los puertos 5187 y 5189.

## Variables opcionales

Variables opcionales:

- `DOTPILOT_VSCODE`: ruta del ejecutable de VS Code (si no, se busca el instalado o se descarga el estable).
- `DOTPILOT_HOME`: la corrida lo apunta a una carpeta temporal para no tocar tu `~/.dotpilot`.
- `DOTPILOT_ONLY=texto`: ejecuta solo las pruebas cuyo nombre contiene ese texto.
- `DOTPILOT_KEEP=1`: conserva la carpeta temporal de la corrida.
- `DOTPILOT_REINSTALL=1`: vuelve a preparar las extensiones del conjunto.

Cada corrida usa un perfil de VS Code **aislado** (datos de usuario y extensiones propios, en la carpeta temporal del sistema); no toca tu VS Code. El proyecto de ejemplo se copia a una carpeta temporal, así que el repo no se ensucia. Los resultados quedan en `test-integration/.results/<conjunto>.json`.

Usa los puertos **5187** y **5188** (.NET), **5189** (Node.js), **5190** (Python) y **8000** (PHP, solo si `php` está en el PATH): deben estar libres.

## Qué verifican

1. **Activación:** detecta el proyecto y sus perfiles (`http`, `alt`).
2. **Compilar:** genera `WebSample.dll`.
3. **Ejecutar sin depurar:** la aplicación responde por HTTP y *Detener* libera el puerto.
4. **Perfil:** cambiar a `alt` (con el selector real) ejecuta en otro puerto y se puede volver a `http`.
5. **Reiniciar:** vuelve a levantar la aplicación en el mismo modo.
6. **Depurar:** sesión `coreclr`; *Pausar* congela la aplicación (la solicitud HTTP agota el tiempo); *Continuar* la reanuda; *Detener* termina la sesión y libera el puerto.
7. **Hot Reload (watch):** un cambio en `Program.cs` se refleja en la respuesta HTTP sin reiniciar.
8. **Varios proyectos:** el espacio de trabajo reúne .NET, Node.js, PHP y Python; DotPilot detecta los cuatro y conserva el proyecto .NET seleccionado.
9. **Node.js:** ejecutar, leer la URL real de la salida (con colores), pedir la apertura del navegador una vez, reiniciar y detener. Las acciones de .NET se rechazan con un mensaje claro.
10. **PHP** (se omite sin `php`) y **Python** (se omite sin `python`): ejecutar, leer la URL y liberar el puerto al detener. El script de Python imprime sin `flush` para comprobar que se inicia sin búfer.
12. **.NET: salida completa:** URL leída de Kestrel, registro y excepción en ejecución visibles para un asistente, y error de compilación en Problemas (este último solo en el conjunto `sin-csharp`).
11. **Asistentes de IA:** las 13 herramientas aparecen en `vscode.lm.tools` y responden; y un cliente MCP real maneja el proyecto Node.js por el puente local (listar, seleccionar, ejecutar, URL, salida, rechazo de acciones .NET, detener).

## Qué NO cubren (todavía)

- Apertura y seguimiento de **Edge/Chrome** (el ejemplo usa `launchBrowser: false`, para no abrir ventanas).
- Perfiles `Executable`, IIS Express o Docker (DotPilot no los soporta).
- **Varios proyectos**, soluciones `.sln` y proyectos de biblioteca.
- **WSL, SSH remoto y Dev Containers**, y sistemas distintos de Windows.
- Flujos de **inicio de sesión o licencia** de C# Dev Kit.
- Depuración con **otra sesión de depuración** abierta al mismo tiempo.

## Hallazgo registrado por estas pruebas

Al **Pausar** una aplicación ASP.NET (que tiene varios hilos), DotPilot abre el selector «Hilo que quieres pausar» y espera una elección. Es el comportamiento actual; la prueba responde ese selector. Una mejora posible es pausar todos los hilos sin preguntar (el depurador ya detiene la aplicación completa).

## Estructura

| Ruta | Contenido |
|---|---|
| `run.js` | Lanzador: prepara el perfil aislado, copia el ejemplo, abre VS Code y reporta |
| `suite/index.js` | Punto de entrada dentro de VS Code: ejecuta las pruebas con tiempo límite |
| `suite/dotpilot.test.js` | Las pruebas |
| `suite/helpers.js` | Esperas, HTTP, puertos, selector de opciones |
| `fixtures/WebSample/` | Aplicación ASP.NET mínima con dos perfiles |
| `fixtures/NodeSample/`, `PhpSample/`, `PythonSample/` | Servidores mínimos de Node.js, PHP y Python |

El `Controller` de DotPilot se obtiene de `extension.exports` (lo devuelve `activate()`), por lo que las pruebas observan el estado real sin cambiar código de producción.
