'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {translate,resolveLanguage,english}=require('../src/i18n');
const {validSetting,sections}=require('../src/settings');
const {panelHtml}=require('../src/view');

test('regional Spanish, English fallback and explicit language override',()=>{
  assert.equal(resolveLanguage('auto','es-MX'),'es');
  assert.equal(resolveLanguage('auto','de'),'en');
  assert.equal(resolveLanguage('en','es'),'en');
  assert.equal(resolveLanguage('es','en'),'es');
  assert.equal(translate('en','{0} completado: {1}','Build','My {0} app'),'Build completed: My {0} app');
  assert.equal(translate('es','Compilar'),'Compilar');
});
test('all manifest localization tokens resolve in both languages',()=>{
  const p=require('../package.json'),en=require('../package.nls.json'),es=require('../package.nls.es.json');
  for(const match of JSON.stringify(p).matchAll(/%([^%]+)%/g)){
    assert.ok(en[match[1]],match[1]);assert.ok(es[match[1]],match[1]);
  }
  assert.deepEqual(Object.keys(en).sort(),Object.keys(es).sort());
  const toolbar=p.contributes.menus['editor/title'];
  assert.deepEqual(toolbar.map(item=>item.command||item.submenu),[
    'dotpilot.run','dotpilot.pause','dotpilot.continue','dotpilot.stop','dotpilot.runApi','dotpilot.stopApi','dotpilot.main'
  ]);
  // Orden visual: menú DotPilot, Ejecutar sin depurar, Pausar/Continuar, Detener y al final el par de la API.
  // Van antes que los iconos de otras extensiones (orden 0 o mayor): VS Code deja 9 sitios en la barra del editor
  // y manda al menú «…» los últimos, así que con orden alto el botón de la API quedaba oculto.
  assert.deepEqual(toolbar.slice(0,4).map(item=>item.group),['navigation@-4','navigation@-3','navigation@-3','navigation@-2']);
  assert.deepEqual(toolbar.slice(4,6).map(item=>item.group),['navigation@-1','navigation@-1']);
  assert.equal(toolbar[6].submenu,'dotpilot.main');
  assert.equal(toolbar[6].group,'navigation@-5');
  assert.deepEqual(toolbar.slice(0,4).map(item=>item.when),[
    'dotpilot.hasProjects && config.dotpilot.showEditorToolbar && !dotpilot.busy && !dotpilot.active',
    'dotpilot.hasProjects && config.dotpilot.showEditorToolbar && dotpilot.debugging && !dotpilot.paused',
    'dotpilot.hasProjects && config.dotpilot.showEditorToolbar && dotpilot.debugging && dotpilot.paused',
    'dotpilot.hasProjects && config.dotpilot.showEditorToolbar && dotpilot.canStop'
  ]);
  assert.deepEqual(toolbar.slice(4,6).map(item=>item.when),[
    'dotpilot.hasProjects && config.dotpilot.showEditorToolbar && dotpilot.apiSeparate && !dotpilot.apiRunning',
    'dotpilot.hasProjects && config.dotpilot.showEditorToolbar && dotpilot.apiRunning'
  ]);
  const commands=new Map(p.contributes.commands.map(command=>[command.command,command]));
  assert.deepEqual(toolbar.slice(0,6).map(item=>commands.get(item.command).icon),['$(play)','$(debug-pause)','$(debug-continue)','$(debug-stop)','$(play)','$(debug-stop)']);
  // La barra flotante de depuración también lleva el segundo par Ejecutar/Detener (API).
  assert.deepEqual(p.contributes.menus['debug/toolBar'].map(item=>item.command),['dotpilot.runApi','dotpilot.stopApi']);
  // Detrás del Detener de VS Code (orden 70) y antes de «Enfocar sesión» (100): primero el par de la aplicación y luego el de la API.
  assert.deepEqual(p.contributes.menus['debug/toolBar'].map(item=>item.group),['navigation@90','navigation@90']);
});
test('menus and commands have one set of translations: no per-language copies, every title is a package.nls token',()=>{
  const p=require('../package.json'),nls={en:require('../package.nls.json'),es:require('../package.nls.es.json')};
  const commands=p.contributes.commands;
  assert.ok(commands.every(command=>!/\.(es|en)$/.test(command.command)),'no language alias commands');
  assert.ok(commands.every(command=>/^%.+%$/.test(command.title)),'command titles come from package.nls');
  const known=new Set([...commands.map(command=>command.command),...p.contributes.submenus.map(item=>item.id)]);
  for(const [id,entries] of Object.entries(p.contributes.menus)){
    assert.ok(!/\.(es|en)$/.test(id),id);
    for(const entry of entries){
      assert.ok(known.has(entry.command||entry.submenu),id+' → '+(entry.command||entry.submenu));
      assert.doesNotMatch(entry.when||'',/language/);
    }
  }
  for(const submenu of p.contributes.submenus){
    assert.ok(/^%.+%$/.test(submenu.label)||submenu.label==='DotPilot',submenu.id);
    assert.ok(p.contributes.menus[submenu.id],'menu for '+submenu.id);
  }
  assert.ok(!commands.some(command=>command.command==='dotpilot.language'));
  assert.deepEqual(Object.keys(nls.en).sort(),Object.keys(nls.es).sort());
  for(const key of p.contributes.keybindings.map(item=>item.command))assert.ok(commands.some(command=>command.command===key),key);
  // El manifiesto no debe crecer por idioma: el tamaño es una alarma barata contra volver a duplicar menús.
  assert.ok(JSON.stringify(p).length<45000,'manifest size '+JSON.stringify(p).length);
});
test('a mismatch between the DotPilot language and the editor language is detected',()=>{
  const {languageMismatch}=require('../src/i18n');
  assert.equal(languageMismatch('es','en'),true);
  assert.equal(languageMismatch('en','es-MX'),true);
  assert.equal(languageMismatch('es','es'),false);
  assert.equal(languageMismatch('es','es-419'),false);
  assert.equal(languageMismatch('en','de'),false);
  assert.equal(languageMismatch('auto','es'),false);
  assert.equal(languageMismatch(undefined,'en'),false);
});
test('translated panel and settings have no missing labels',()=>{
  const html=panelHtml({language:'en'});
  const shared=new Set(['Framework','Hot Reload','Español','English','Microsoft Edge','Google Chrome']);
  for(const match of html.matchAll(/data-i18n="([^"]+)"/g)){
    assert.ok(english[match[1]]||shared.has(match[1]),match[1]);
  }
  assert.match(html,/>Settings<\/span>/);assert.match(panelHtml({language:'es'}),/>Ajustes<\/span>/);
  const controller=fs.readFileSync(path.join(__dirname,'../src/extension.js'),'utf8');
  for(const match of controller.matchAll(/this\.t\('([^']+)'/g))assert.ok(english[match[1]],match[1]);
  const agent=fs.readFileSync(path.join(__dirname,'../src/agent.js'),'utf8');
  for(const match of agent.matchAll(/\bc\.t\('([^']+)'/g))assert.ok(english[match[1]],match[1]);
  for(const tool of require('../src/agent-tools').TOOLS){assert.ok(english[tool.title],tool.title);assert.ok(english[tool.userDescription],tool.userDescription);}
});
test('the panel and the DotPilot menu offer Run all and Stop all, with the same play and stop icons',()=>{
  const html=panelHtml({language:'en'});
  assert.match(html,/data-action="runAll"[\s\S]*Run all/);assert.match(html,/data-action="stopAll"[\s\S]*Stop all/);
  const p=require('../package.json'),commands=new Map(p.contributes.commands.map(c=>[c.command,c]));
  assert.equal(commands.get('dotpilot.runAll').icon,'$(play)');assert.equal(commands.get('dotpilot.stopAll').icon,'$(debug-stop)');
  const menu=p.contributes.menus['dotpilot.main'].map(item=>item.command);
  assert.ok(menu.includes('dotpilot.runAll')&&menu.includes('dotpilot.stopAll')&&menu.includes('dotpilot.openApi'));
  assert.match(html,/data-action="openApi"[\s\S]*Open API/);
});
test('settings protocol accepts only declared keys and exact enum or boolean values',()=>{
  for(const field of sections.flatMap(s=>s.fields))assert.ok(validSetting(field.key,field.default));
  for(const [key,value] of [['dotnetPath','malicious'],['__proto__',true],['browser','firefox'],['showStatusBar','true'],['language',{}],['browser',null]])assert.equal(validSetting(key,value),false);
  assert.ok(validSetting('language','en'));assert.ok(validSetting('language','es'));
});

test('the panel lives in its own Activity Bar container with an icon that ships in the package',()=>{
  const p=require('../package.json');
  const container=p.contributes.viewsContainers.activitybar.find(item=>item.id==='dotpilot');
  assert.ok(container,'activity bar container');
  assert.match(container.id,/^[a-zA-Z0-9_-]+$/,'VS Code only accepts letters, digits, hyphen and underscore');
  assert.ok(fs.existsSync(path.join(__dirname,'..',container.icon)),container.icon);
  const ignored=fs.readFileSync(path.join(__dirname,'..','.vscodeignore'),'utf8').split(String.fromCharCode(10)).map(line=>line.trim()).filter(Boolean);
  assert.ok(!ignored.includes(container.icon)&&!ignored.includes('media/**'),'icon is not ignored');
  assert.deepEqual(p.contributes.views.dotpilot.map(view=>view.id),['dotpilot.panel']);
  assert.equal(p.contributes.views.explorer,undefined);
  // Los menús del título de la vista siguen apuntando al mismo id.
  assert.ok(p.contributes.menus['view/title'].every(item=>item.when==='view == dotpilot.panel'));
});
