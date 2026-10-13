'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseLine, DiagnosticFeed } = require('../src/msbuild');

test('compiler errors and warnings are recognised in the shapes dotnet prints them', () => {
  assert.deepEqual(parseLine('C:\\app\\Program.cs(12,5): error CS0029: Cannot implicitly convert type \'string\' to \'int\' [C:\\app\\App.csproj]'),
    { file: 'C:\\app\\Program.cs', line: 12, column: 5, severity: 'error', code: 'CS0029', message: "Cannot implicitly convert type 'string' to 'int'" });
  assert.equal(parseLine('1>C:\\app\\Util.cs(3,9,3,14): warning CS8600: Converting null literal.').code, 'CS8600');
  assert.equal(parseLine('/home/u/app/Program.cs(7,1): error CS1002: ; expected').file, '/home/u/app/Program.cs');
  assert.equal(parseLine('C:\\app\\Odd (1)\\File.cs(2,2): error CS1001: Identifier expected').file, 'C:\\app\\Odd (1)\\File.cs');
  assert.equal(parseLine('error MSB1009: Project file does not exist.'), undefined);
  assert.equal(parseLine('info: Microsoft.Hosting.Lifetime[14]'), undefined);
  assert.equal(parseLine('      Now listening on: http://localhost:5187'), undefined);
});

function fakeVscode() {
  const sets = [];
  class Range { constructor(a, b, c, d) { Object.assign(this, { startLine: a, startCharacter: b, endLine: c, endCharacter: d }); } }
  class Diagnostic { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } }
  const api = { Range, Diagnostic, DiagnosticSeverity: { Error: 0, Warning: 1 }, Uri: { file: file => ({ fsPath: file, toString: () => 'file://' + file }) } };
  const collection = { set: (uri, list) => sets.push([uri.fsPath, list.length]), clear: () => { sets.length = 0; } };
  return { api, collection, sets };
}

test('the feed publishes one diagnostic per distinct problem and resets on every run', () => {
  const { api, collection, sets } = fakeVscode();
  const feed = new DiagnosticFeed(api, collection, path.resolve('/work/app'));
  assert.equal(feed.addLine('info: something'), false);
  assert.equal(feed.addLine('/work/app/Program.cs(12,5): error CS0029: Bad [/work/app/App.csproj]'), true);
  // dotnet repite el error en el resumen: no se duplica
  assert.equal(feed.addLine('/work/app/Program.cs(12,5): error CS0029: Bad [/work/app/App.csproj]'), true);
  feed.addLine('/work/app/Program.cs(20,1): warning CS8600: Null');
  feed.addLine('Other.cs(1,1): error CS1002: ; expected');
  assert.deepEqual(sets.at(-1), [path.resolve('/work/app/Other.cs'), 1], 'relative paths resolve against the project folder');
  assert.deepEqual(sets.filter(([file]) => file.endsWith('Program.cs')).at(-1), ['/work/app/Program.cs', 2], 'absolute paths are kept as MSBuild printed them');
  feed.clear();
  assert.equal(sets.length, 0);
  feed.addLine('/work/app/Program.cs(1,1): error CS0001: New run');
  assert.deepEqual(sets, [['/work/app/Program.cs', 1]]);
});
