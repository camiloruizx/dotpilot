'use strict';
// Shared schema for the settings UI and message validation. Add new sections
// and fields here without changing the webview message protocol.
const sections = [
  { title: 'General', fields: [
    { key: 'language', scope: 'window', label: 'Idioma', description: 'El panel y los mensajes cambian al instante. Los menús y la paleta de comandos siguen el idioma de VS Code (comando «Configurar idioma de pantalla»).', default: 'auto', options: [['auto','Usar el idioma de VS Code'],['es','Español'],['en','English']] }
  ] },
  { title: 'Apariencia', fields: [
    { key: 'showEditorToolbar', scope: 'window', label: 'Botón de DotPilot en el editor', description: 'Agrupa las acciones bajo el ícono de DotPilot.', default: true },
    { key: 'showStatusBar', label: 'Controles en la barra inferior', description: 'Accesos adicionales junto al estado del editor.', default: false }
  ] },
  { title: 'Ejecución', fields: [
    { key: 'openBrowser', label: 'Abrir navegador automáticamente', description: 'Cuando el perfil lo permite y la aplicación está lista.', default: true },
    { key: 'browser', label: 'Navegador web', description: 'Edge y Chrome detienen la app al cerrar su pestaña. El navegador del sistema requiere detenerla manualmente.', default: 'edge', options: [['edge','Microsoft Edge'],['chrome','Google Chrome'],['external','Predeterminado del sistema']] }
  ] },
  // Solo del usuario ('machine'): un repositorio no puede activarlo ni saltarse el permiso.
  { title: 'Asistentes de IA', fields: [
    { key: 'assistantsEnabled', scope: 'machine', label: 'Permitir que asistentes de IA usen DotPilot', description: 'Abre un puente local, solo en este equipo, para Claude Code, Codex, Gemini y Copilot.', default: false },
    { key: 'assistantsPermission', scope: 'machine', label: 'Permiso para ejecutar acciones', description: 'Preguntar pide confirmación cada vez que un asistente ejecuta, reinicia o compila.', default: 'ask', options: [['ask','Preguntar'],['allow','Permitir siempre']] }
  ] }
];
const fields = sections.flatMap(section => section.fields);
function validSetting(key, value) {
  const field = fields.find(item => item.key === key);
  return !!field && (field.options ? field.options.some(([option]) => option === value) : typeof value === 'boolean');
}
function readSettings(config, windowConfig = config) { return Object.fromEntries(fields.map(field => [field.key, (field.scope === 'window' ? windowConfig : config).get(field.key, field.default)])); }
module.exports = { sections, fields, validSetting, readSettings };
