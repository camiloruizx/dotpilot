'use strict';
// Notas del Release de GitHub a partir del CHANGELOG.md: la sección de la versión, sin negritas ni comillas de código
// (así están los Releases publicados: una viñeta por cambio, «inglés / español»).
//
//   node scripts/release-notes.js [versión]           escribe release-notes/<versión>.md (npm run release-notes)
//   node scripts/release-notes.js [versión] --check   falla si ese archivo no coincide con el CHANGELOG
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function notesFor(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(line => line.trim() === `## ${version}`);
  if (start < 0) throw new Error(`CHANGELOG.md has no section "## ${version}"`);
  let end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n').trim();
  if (!body) throw new Error(`The CHANGELOG.md section for ${version} is empty`);
  return body.replace(/\*\*/g, '').replace(/`/g, '') + '\n';
}

function main(argv) {
  const check = argv.includes('--check');
  const version = argv.find(arg => /^\d+\.\d+\.\d+/.test(arg)) || require('../package.json').version;
  const notes = notesFor(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version);
  const file = path.join(root, 'release-notes', `${version}.md`);
  if (check) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : undefined;
    if (current !== notes) {
      console.error(`release-notes/${version}.md ${current === undefined ? 'is missing' : 'is out of date'}: run "npm run release-notes ${version}" and commit it.`);
      return 1;
    }
    console.log(`release-notes/${version}.md matches CHANGELOG.md`);
    return 0;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, notes, 'utf8');
  console.log(`Wrote release-notes/${version}.md`);
  return 0;
}

module.exports = { notesFor };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
