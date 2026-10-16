'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function harness(settings = {}) {
  const events = new Set(), starts = [], stops = [], removed = [], made = [], commands = [], imports = [], saved = new Map();
  const api = {
    window: { createOutputChannel: () => ({appendLine(){}}) },
    workspace: {
      getConfiguration: () => ({get:(key,fallback) => key === 'browser' ? 'edge' : key in settings ? settings[key] : fallback}),
      getWorkspaceFolder: () => undefined
      ,asRelativePath: uri => uri.fsPath
    },
    env: {asExternalUri:async uri=>uri,openExternal:async()=>true},
    Uri: {parse:url=>({toString:()=>url})},
    commands: {executeCommand:async(...args)=>commands.push(args)},
    debug: {
      onDidTerminateDebugSession: fn => {events.add(fn);return {dispose:()=>events.delete(fn)};},
      startDebugging: async(folder,config) => {
        const session = {id:'browser-'+starts.length,configuration:config}; starts.push(session);
        c.browserStarted(session); return true;
      },
      stopDebugging: async session => {stops.push(session); c.browserTerminated(session); for(const fn of [...events]) fn(session);}
    }
  };
  const file=path.join(__dirname,'../src/extension.js');
  const localRequire=createRequire(file);
  const sandbox={module:{exports:{}},require:name=>{imports.push(name);return name==='vscode'?api:name==='node:fs/promises'?{
    mkdtemp:async()=>path.join(require('node:os').tmpdir(),'dotpilot-browser-test'),
    mkdir:async directory=>made.push(directory),
    rm:async directory=>removed.push(directory)
  }:localRequire(name);},setTimeout,clearTimeout,Buffer};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),sandbox,{filename:file});
  const c=new sandbox.module.exports.Controller({subscriptions:[],globalStorageUri:{fsPath:path.join(__dirname,'storage')},workspaceState:{get:(key,fallback)=>saved.has(key)?saved.get(key):fallback,update:async(key,value)=>{if(value===undefined)saved.delete(key);else saved.set(key,value);}}});
  const render=c.render.bind(c);
  c.render=()=>{};
  c.project={fsPath:path.join(__dirname,'App.csproj')};
  c.profiles=[{name:'http',url:'http://localhost:5000'}]; c.profile='http';
  c.runTask={};
  const actions=[]; c.invoke=async action=>actions.push(action);
  return {c,api,starts,stops,removed,made,actions,commands,render,imports};
}

test('concurrent browser requests share a single owned session and a temporary profile',async()=>{
  const {c,starts,stops,removed}=harness({browserProfile:'temporary'});
  await Promise.all([c.openBrowser(),c.openBrowser()]);
  assert.equal(starts.length,1);
  assert.match(starts[0].configuration.userDataDir,/dotpilot-browser-/);
  await Promise.all([c.closeBrowser(),c.closeBrowser()]);
  assert.equal(stops.length,1); assert.equal(c.browserRun,undefined); assert.ok(removed.length);
});

test('the persistent profile keeps its folder between runs, so saved sessions and extensions survive',async()=>{
  const {c,starts,stops,removed,made}=harness({browserProfile:'persistent'});
  await c.openBrowser();
  const profile=starts[0].configuration.userDataDir;
  assert.equal(profile,path.join(__dirname,'storage','browser-profile','edge'));
  assert.deepEqual(made,[profile]);
  assert.deepEqual(starts[0].configuration.runtimeArgs,['--hide-crash-restore-bubble']);
  await c.closeBrowser();
  assert.equal(stops.length,1); assert.deepEqual(removed,[],'the persistent profile is never deleted');
});

test('the profile is temporary by default and deleted on close',async()=>{
  const {c,starts,removed,made}=harness();
  await c.openBrowser();
  assert.match(starts[0].configuration.userDataDir,/dotpilot-browser-/);
  assert.deepEqual(starts[0].configuration.runtimeArgs,[]);
  assert.deepEqual(made,[]);
  await c.closeBrowser();
  assert.ok(removed.length);
});

test('closing the tracked page stops its backend even when the root remains open',async()=>{
  const {c,actions}=harness(); await c.openBrowser();
  const root=c.browserRun.session;
  const page={id:'page',parentSession:root,configuration:{__browserTargetType:'page'}};
  c.browserStarted(page);
  c.browserStarted({id:'other-page',parentSession:root,configuration:{__browserTargetType:'page'}});
  assert.equal(c.browserRun.session,root);
  c.browserTerminated({id:'other-page'}); assert.equal(actions.length,0);
  c.browserTerminated(page); assert.deepEqual(actions,['stop']);
  await c.closeBrowser();
});

test('old or unrelated session events cannot stop a new execution',async()=>{
  const {c,actions}=harness(); await c.openBrowser();
  c.browserTerminated({id:'unrelated'}); assert.equal(actions.length,0);
  const old=c.browserRun.session; await c.closeBrowser(); c.generation++;
  await c.openBrowser(); c.browserTerminated(old); assert.equal(actions.length,0);
  await c.closeBrowser(); assert.equal(actions.length,0);
});

test('Stop during browser startup closes the late session without stopping a newer generation',async()=>{
  const {c,api,starts,stops,actions}=harness();
  let finish;
  const start=api.debug.startDebugging;
  api.debug.startDebugging=async(...args)=>{await start(...args);await new Promise(r=>finish=r);return true;};
  const opening=c.openBrowser();
  while(!finish) await new Promise(r=>setTimeout(r,0));
  const closing=c.closeBrowser(); c.generation++; finish();
  await Promise.all([opening,closing]);
  assert.equal(starts.length,1); assert.equal(stops.length,1);
  assert.equal(c.browserRun,undefined); assert.equal(actions.length,0);
});

test('failed browser launch allows retry and preserves backend execution',async()=>{
  const {c,api,actions,removed}=harness({browserProfile:'temporary'}); api.debug.startDebugging=async()=>false;
  await assert.rejects(()=>c.openBrowser(),/Could not open/);
  assert.equal(c.browserRun,undefined); assert.equal(c.browserOpened,false);
  assert.ok(c.active()); assert.equal(actions.length,0); assert.ok(removed.length);
});

test('Stop while a previous browser is closing cancels the queued launch',async()=>{
  const {c}=harness(); c.runTask=undefined;
  let finish;
  c.closeBrowser=()=>new Promise(resolve=>finish=resolve);
  c.ensureProject=()=>{throw new Error('Cancelled launch must not advance');};
  const launching=c.launch('run'); c.generation++; finish();
  await launching; assert.ok(!c.active());
});

test('browser selection persists independently for each project and can inherit workspace defaults',async()=>{
  const {c}=harness(); const a={fsPath:'A.csproj',toString:()=> 'file:///A.csproj'}, b={fsPath:'B.csproj',toString:()=> 'file:///B.csproj'};
  c.project=a; await c.chooseBrowser('chrome'); assert.equal(c.browser(),'chrome');
  c.project=b; assert.equal(c.browser(),'edge'); await c.chooseBrowser('external');
  c.project=a; assert.equal(c.browser(),'chrome');await c.chooseBrowser('default');assert.equal(c.browser(),'edge');
  c.project=b;assert.equal(c.browser(),'external');await assert.rejects(()=>c.chooseBrowser('unknown'),/Invalid/);
});

test('changing the browser while the app runs reopens the linked window in the chosen browser',async()=>{
  const {c,starts,stops,actions}=harness();c.runningBrowser='edge';
  await c.openBrowser();assert.equal(starts[0].configuration.type,'pwa-msedge');
  await c.chooseBrowser('chrome');
  while(starts.length<2)await new Promise(r=>setTimeout(r,5));
  assert.equal(starts[1].configuration.type,'pwa-chrome');assert.equal(stops.length,1);
  assert.equal(c.runningBrowser,'chrome');assert.deepEqual(actions,[],'the app must keep running');
  await c.closeBrowser();
});

test('changing the browser with no browser open only updates the next one',async()=>{
  const {c,starts}=harness();c.runningBrowser='edge';
  await c.chooseBrowser('chrome');
  assert.equal(starts.length,0);assert.equal(c.runningBrowser,'chrome');
  await c.openBrowser();assert.equal(starts[0].configuration.type,'pwa-chrome');await c.closeBrowser();
});

test('without a running app the chosen browser is launched directly, not the system default',async()=>{
  const {c,api}=harness();c.runTask=undefined;const launched=[],external=[];
  api.env.openExternal=async uri=>{external.push(uri.toString());return true;};
  c.launchInBrowser=(browser,url)=>{launched.push([browser,url]);return browser==='chrome';};
  await c.chooseBrowser('chrome');await c.openBrowser();
  assert.deepEqual(launched,[['chrome','http://localhost:5000/']]);assert.deepEqual(external,[]);
  // Si el navegador elegido no está instalado se usa el predeterminado en vez de fallar.
  await c.chooseBrowser('edge');c.browserOpened=false;await c.openBrowser();
  assert.deepEqual(launched.at(-1),['edge','http://localhost:5000/']);assert.deepEqual(external,['http://localhost:5000/']);
  // El navegador del sistema siempre pasa por el editor.
  await c.chooseBrowser('external');c.browserOpened=false;launched.length=0;await c.openBrowser();
  assert.equal(launched.length,0);assert.equal(external.length,2);
});


test('page-before-root browser events retain ownership and tab close tracking',async()=>{
  const {c,actions}=harness();c.browserRun={token:'owned',generation:c.generation,launched:true};
  const root={id:'root',configuration:{__dotpilotBrowser:'owned'}};
  const page={id:'page',parentSession:root,configuration:{__browserTargetType:'page'}};
  c.browserStarted(page);c.browserStarted(root);
  assert.equal(c.browserRun.session,root);assert.equal(c.browserRun.pageSession,page);
  c.browserTerminated(page);assert.deepEqual(actions,['stop']);
});

test('hidden panels receive no updates and identical context/state is not resent',async()=>{
  const {c,render,commands,imports}=harness();const messages=[];
  assert.ok(!imports.includes('./view'));assert.equal(c.statusItems.length,0);
  c.view={visible:false,webview:{postMessage:async message=>{messages.push(message);return true;}}};c.webviewReady=true;
  render();const commandCount=commands.length;render();assert.equal(commands.length,commandCount);assert.equal(messages.length,0);
  c.view.visible=true;render();assert.ok(messages[0].translations);assert.equal(messages[0].browser,'Microsoft Edge');
  render();assert.equal(messages.length,1);
  c.result='Changed';render();assert.equal(messages.length,2);assert.equal(messages[1].translations,undefined);
  c.view.visible=false;c.result='Hidden change';render();assert.equal(messages.length,2);
  c.view.visible=true;render();assert.equal(messages[2].result,'Hidden change');
});

test('a burst of refresh requests runs one scan plus at most one repeat',async()=>{
  const {c}=harness();let scans=0;
  c.scan=async()=>{scans++;await new Promise(r=>setTimeout(r,20));};
  await Promise.all([c.refresh(),c.refresh(),c.refresh(),c.refresh(),c.refresh()]);
  assert.equal(scans,2);assert.equal(c.refreshing,undefined);
  await c.refresh();assert.equal(scans,3);
});

const { EventEmitter } = require('node:events');
const apiEntry = { project: path.join(__dirname, 'Api', 'Api.csproj') };
// Ventana de la API simulada: sin pid, así que cerrarla no toca ningún proceso real.
function fakeWindow() { const child = new EventEmitter(); child.exitCode = null; child.signalCode = null; return child; }
function apiHarness() {
  const h = harness(), windows = [];
  h.c.launchOwnedBrowser = (browser, url, directory) => { const child = fakeWindow(); windows.push({ browser, url, directory, child }); return child; };
  return { ...h, windows };
}

test('with the APIs apart, closing the API window stops only the API and creates no debug session',async()=>{
  const {c,starts,windows,actions}=apiHarness();
  await c.openApiBrowser('http://localhost:5100/swagger',apiEntry,()=>false);
  assert.equal(windows.length,1);
  assert.equal(windows[0].browser,'edge');
  assert.equal(windows[0].url,'http://localhost:5100/swagger');
  assert.match(windows[0].directory,/dotpilot-browser-/);
  assert.equal(starts.length,0,'a debug session would show the floating debug toolbar');
  assert.equal(c.browserRun,undefined,'the API window is not the project window');
  windows[0].child.emit('exit',0);
  assert.deepEqual(actions,['stopApi']);
  assert.equal(c.apiBrowserRun,undefined);
});

test('Stop API closes its window without stopping the API a second time',async()=>{
  const {c,windows,removed,actions}=apiHarness();
  await c.openApiBrowser('http://localhost:5100/swagger',apiEntry,()=>false);
  await Promise.all([c.closeApiBrowser(),c.closeApiBrowser()]);
  assert.equal(c.apiBrowserRun,undefined);
  windows[0].child.emit('exit',0);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(actions,[]);
  assert.ok(removed.length,'the temporary profile is removed');
});

test('a new API window replaces the previous one without stopping the API',async()=>{
  const {c,windows,actions}=apiHarness();
  await c.openApiBrowser('http://localhost:5100/swagger',apiEntry,()=>false);
  await c.openApiBrowser('http://localhost:5100/swagger',apiEntry,()=>false);
  assert.equal(windows.length,2);
  windows[0].child.emit('exit',0);
  assert.deepEqual(actions,[]);
  windows[1].child.emit('exit',0);
  assert.deepEqual(actions,['stopApi']);
});

test('an API window that is cancelled, external, remote or cannot be launched falls back to an independent tab or nothing',async()=>{
  const {c,windows,actions,api,removed}=apiHarness();
  const tabs=[]; c.openCompanionBrowser=async url=>tabs.push(url);
  await c.openApiBrowser('http://localhost:5100/swagger',apiEntry,()=>true);
  assert.equal(windows.length,0); assert.deepEqual(tabs,[]);
  c.browser=()=>'external';
  await c.openApiBrowser('http://localhost:5100/swagger',apiEntry,()=>false);
  assert.equal(windows.length,0); assert.deepEqual(tabs,['http://localhost:5100/swagger']);
  c.browser=()=>'edge'; api.env.remoteName='ssh-remote';
  await c.openApiBrowser('http://localhost:5100/swagger',apiEntry,()=>false);
  assert.equal(windows.length,0); assert.equal(tabs.length,2);
  delete api.env.remoteName;
  c.launchOwnedBrowser=()=>undefined;
  await c.openApiBrowser('http://localhost:5100/swagger',apiEntry,()=>false);
  assert.equal(tabs.length,3); assert.ok(removed.length,'the unused profile is removed');
  assert.equal(c.apiBrowserRun,undefined); assert.deepEqual(actions,[]);
});
