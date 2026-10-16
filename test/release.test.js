'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { notesFor } = require('../scripts/release-notes');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the current version is consistent everywhere and has a changelog section', () => {
  const { version } = require('../package.json');
  const v = escape(version);
  assert.match(read('CHANGELOG.md'), new RegExp(`^## ${v}\\r?$`, 'm'), 'CHANGELOG.md has a section for the version');
  assert.equal(require('../package-lock.json').version, version, 'package-lock.json');
  assert.match(read('src/mcp-server.js'), new RegExp(`DOTPILOT_VERSION \\|\\| '${v}'`), 'the MCP server fallback version');
  assert.match(read('docs/GUIA.md'), new RegExp(`dotpilot-${v}\\.vsix`), 'the install steps name the current VSIX');
});

test('the release notes are the changelog section of the version, bilingual, without bold or code marks', () => {
  const { version } = require('../package.json');
  const notes = read(`release-notes/${version}.md`).replace(/\r\n/g, '\n');
  assert.equal(notes, notesFor(read('CHANGELOG.md'), version), `run "npm run release-notes" to refresh release-notes/${version}.md`);
  assert.ok(!notes.includes('**') && !notes.includes('`'), 'plain text, like the published Releases');
  const bullets = notes.split('\n').filter(line => line.startsWith('- '));
  assert.ok(bullets.length > 0 && bullets.every(line => line.includes(' / ')), 'every bullet carries English / Spanish');
});

test('notesFor takes only the requested section and rejects a missing or empty one', () => {
  const changelog = '# Changes\r\n\r\n## 2.0.0\r\n\r\n- Uses **bold** and `code`. / Usa **negrita** y `código`.\r\n\r\n## 1.0.0\r\n\r\n- Old. / Viejo.\r\n\r\n## 0.9.0\r\n';
  assert.equal(notesFor(changelog, '2.0.0'), '- Uses bold and code. / Usa negrita y código.\n');
  assert.equal(notesFor(changelog, '1.0.0'), '- Old. / Viejo.\n');
  assert.throws(() => notesFor(changelog, '0.9.0'), /empty/);
  assert.throws(() => notesFor(changelog, '3.0.0'), /no section/);
});

test('the Release workflow runs on version tags, checks the notes and publishes only with a token', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.match(workflow, /tags: \['v\*'\]/);
  for (const needle of ['release-notes/', 'CHANGELOG.md', 'scripts/release-notes.js', '--check', 'npm run test:ci', 'vsce package', 'gh release', 'VSCE_PAT', 'continue-on-error: true']) {
    assert.ok(workflow.includes(needle), needle);
  }
  assert.ok(!workflow.includes('\t'), 'no tabs in YAML');
  const ignored = read('.vscodeignore').split(/\r?\n/).map(line => line.trim());
  assert.ok(['release-notes/**', 'scripts/**', '.github/**'].every(entry => ignored.includes(entry)), 'none of these ship in the VSIX');
});
