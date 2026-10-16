'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the current version is consistent everywhere and has a changelog section and English release notes', () => {
  const { version } = require('../package.json');
  const v = escape(version);
  assert.match(read('CHANGELOG.md'), new RegExp(`^## ${v}\\r?$`, 'm'), 'CHANGELOG.md has a section for the version');
  assert.equal(require('../package-lock.json').version, version, 'package-lock.json');
  assert.match(read('src/mcp-server.js'), new RegExp(`DOTPILOT_VERSION \\|\\| '${v}'`), 'the MCP server fallback version');
  assert.match(read('docs/GUIA.md'), new RegExp(`dotpilot-${v}\\.vsix`), 'the install steps name the current VSIX');
  const notes = read(`release-notes/${version}.md`);
  assert.ok(notes.trim().length > 0, 'release notes are not empty');
  assert.doesNotMatch(notes, /[áéíóúñ¿¡«»]/i, 'release notes are English only');
});

test('the Release workflow runs on version tags, checks the notes and publishes only with a token', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.match(workflow, /tags: \['v\*'\]/);
  for (const needle of ['release-notes/', 'CHANGELOG.md', 'npm run test:ci', 'vsce package', 'gh release', 'VSCE_PAT', 'continue-on-error: true']) {
    assert.ok(workflow.includes(needle), needle);
  }
  assert.ok(!workflow.includes('\t'), 'no tabs in YAML');
  const ignored = read('.vscodeignore').split(/\r?\n/).map(line => line.trim());
  assert.ok(ignored.includes('release-notes/**') && ignored.includes('.github/**'), 'neither ships in the VSIX');
});
