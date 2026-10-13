'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseJsonc, profilesFrom, buildArgs, runArgs, escapeHtml, browserUrl, localEndpoint } = require('../src/core');

test('JSONC preserves URLs, escaped quotes and commas inside strings', () => {
  const value = parseJsonc('\uFEFF{ // a comment\n "url": "https://localhost:7001/a/*b*/", "text": "x,} \\"y\\"", /* comment */ "items": [1,2,], }');
  assert.deepEqual(value, { url: 'https://localhost:7001/a/*b*/', text: 'x,} "y"', items: [1, 2] });
});
test('invalid launch settings are surfaced', () => {
  assert.throws(() => parseJsonc('{/* unfinished'));
  assert.throws(() => profilesFrom('{broken}'));
});
test('only dotnet-compatible Project profiles are offered', () => {
  assert.deepEqual(profilesFrom('{"profiles":{"https":{"commandName":"Project","applicationUrl":"https://localhost:7001","launchBrowser":true},"IIS Express":{"commandName":"IISExpress"},"Docker":{"commandName":"Docker"}}}'), [
    { name: 'https', url: 'https://localhost:7001', launchBrowser: true, launchUrl: '', workingDirectory: '' }
  ]);
});
test('web profiles preserve launch routes and reject unsafe URL schemes', () => {
  assert.equal(browserUrl({url:'https://localhost:7001;http://localhost:5001',launchUrl:'swagger/index.html'}), 'https://localhost:7001/swagger/index.html');
  assert.equal(browserUrl({url:'http://0.0.0.0:5000',launchUrl:'/health'}), 'http://localhost:5000/health');
  assert.equal(browserUrl({url:'http://*:5000',launchUrl:'health'}), 'http://localhost:5000/health');
  assert.equal(browserUrl({url:'http://localhost:5000',launchUrl:'javascript:alert(1)'}), undefined);
  assert.equal(browserUrl({url:'file:///tmp/test'}), undefined);
  assert.equal(browserUrl({url:'https://user:pass@localhost:5000'}), undefined);
});
test('automatic readiness checks are restricted to local endpoints', () => {
  assert.deepEqual(localEndpoint({url:'https://localhost:7001;http://localhost:5000'}), {host:'localhost',port:7001});
  assert.deepEqual(localEndpoint({url:'http://[::1]:5050'}), {host:'::1',port:5050});
  assert.equal(localEndpoint({url:'https://example.com'}), undefined);
  assert.equal(localEndpoint({url:''}), undefined);
});
test('watch forwards configuration, framework and profile without shell interpolation', () => {
  assert.deepEqual(runArgs('C:/app space/App.csproj','Debug','https','net10.0',true), ['watch','--project','C:/app space/App.csproj','--non-interactive','run','--configuration','Debug','--launch-profile','https','--framework','net10.0']);
});
test('restore and test use the selected target and configuration', () => {
  assert.deepEqual(buildArgs('restore','/app.slnx','Release'), ['restore','/app.slnx','--nologo','-p:Configuration=Release']);
  assert.deepEqual(buildArgs('test','/tests.csproj','Debug'), ['test','/tests.csproj','--configuration','Debug','--nologo']);
});
test('paths and profile names stay separate arguments, including shell characters', () => {
  assert.deepEqual(runArgs('C:\\My App & Stuff\\App.csproj', 'Debug', 'https & test', 'net8.0'), ['run', '--project', 'C:\\My App & Stuff\\App.csproj', '--configuration', 'Debug', '--launch-profile', 'https & test', '--framework', 'net8.0']);
  assert.deepEqual(runArgs('/src/app.csproj', 'Release', ''), ['run', '--project', '/src/app.csproj', '--configuration', 'Release', '--no-launch-profile']);
});
test('rebuild and analysis force execution and preserve configuration', () => {
  assert.deepEqual(buildArgs('rebuild', '/app.slnx', 'Release'), ['build', '/app.slnx', '--configuration', 'Release', '--nologo', '-t:Rebuild']);
  assert.ok(buildArgs('analyze', '/app.sln', 'Debug').includes('-p:RunAnalyzersDuringBuild=true'));
  assert.equal(buildArgs('clean', '/app.csproj', 'Debug')[0], 'clean');
  assert.throws(() => buildArgs('unexpected', '', 'Debug'));
});
test('project names cannot inject webview markup', () => {
  assert.equal(escapeHtml('<img a="x">&\''), '&lt;img a=&quot;x&quot;&gt;&amp;&#39;');
});
