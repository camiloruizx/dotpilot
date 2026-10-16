# Contributing

Thanks for your interest. DotPilot has no runtime dependencies and a small surface; keeping it that way is a goal.

## Set up

```text
npm ci
npm test                 # unit tests, no VS Code needed (Node 20 or later)
npm run test:integration # real VS Code + real projects (needs the .NET SDK, Node, PHP and Python)
```

Press **F5** in this folder to open an Extension Development Host.

## Where things are

| Path | What lives there |
| --- | --- |
| `src/extension.js` | `Controller` state, run/stop orchestration, `invoke`, `activate` |
| `src/controller/*.js` | The rest of the Controller, by responsibility (projects, managed runs, browser, .NET, assistants, panel) |
| `src/detect.js`, `runner.js`, `laragon.js`, `msbuild.js`, `bridge.js`, `agent*.js`, `assistants.js` | Logic without VS Code, unit-tested directly |
| `src/view.js` | The webview panel (HTML, CSS and script as a template) |
| `assets/laragon.ps1` | Script used by the Apache (Laragon) profile |
| `test/` | Unit tests (`node --test`) |
| `test-integration/` | Tests that drive a real VS Code; `real-assistant*.js` drive real AI assistant CLIs |

## Guidelines

- Add or update tests with every behavior change. Prefer testing the VS Code-free modules; use the integration suite for anything that
  depends on VS Code or on a real process.
- User-visible strings are written in Spanish in the code and translated through `src/locales/en.json` (the localization test checks it).
  Manifest strings go in `package.nls.json` and `package.nls.es.json`.
- Menus and commands use a single translation set; do not add per-language copies.
- Do not add runtime dependencies without discussing it first.
- Keep `VALIDACION.md` honest: say what was verified and what was not.

## Releasing

1. Bump `version` in `package.json` and `package-lock.json` (and the fallback in `src/mcp-server.js` and the VSIX file names in
   `docs/GUIA.md`).
2. Add a `## X.Y.Z` section to `CHANGELOG.md` (one bullet per change, English and Spanish inline separated by " / "), then run
   `npm run release-notes` to write `release-notes/X.Y.Z.md`: the same section without bold or code marks, which becomes the GitHub
   Release description. Commit it; a test and the Release workflow fail if it no longer matches the changelog.
3. Merge to `main`, wait for CI to pass, then tag it: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The **Release** workflow checks that the tag, the version, the changelog and the notes agree, runs the tests, packages the VSIX, creates
the GitHub Release with it and, if the repository has a `VSCE_PAT` secret (an Azure DevOps token with *Marketplace > Manage*),
publishes it to the Marketplace. Without the secret it only warns, and the VSIX is uploaded by hand. If the Release already exists, the
workflow only attaches the VSIX to it.
