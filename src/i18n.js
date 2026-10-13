'use strict';
let english;
function englishMessages() { return english ||= require('./locales/en.json'); }

function resolveLanguage(preference = 'auto', editorLanguage = 'en') {
  return preference === 'es' || preference === 'en' ? preference : /^es(?:-|$)/i.test(editorLanguage) ? 'es' : 'en';
}
function translate(language, message, ...values) {
  const text = language === 'es' ? message : englishMessages()[message] || message;
  return text.replace(/\{(\d+)\}/g, (match, index) => values[index] === undefined ? match : String(values[index]));
}
// ¿El idioma elegido en DotPilot difiere del de VS Code? Los menús y la paleta siguen siempre a VS Code.
function languageMismatch(preference, editorLanguage = 'en') {
  return (preference === 'es' || preference === 'en') && resolveLanguage('auto', editorLanguage) !== preference;
}
module.exports = { resolveLanguage, translate, languageMismatch, get english() { return englishMessages(); } };
