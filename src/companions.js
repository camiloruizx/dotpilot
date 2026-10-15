'use strict';
// APIs complementarias: proyectos .NET que se inician junto con el proyecto principal (por ejemplo, la API
// que consume una aplicación web). Funciones puras, sin VS Code, para poder probarlas directamente.
const path = require('node:path');
const { parseJsonc } = require('./core');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0', '[::]']);
const URL_IN_TEXT = /https?:\/\/[^\s"'<>,;]+/g;

function localPort(url) {
  try {
    const parsed = new URL(String(url).replace('://*:', '://localhost:').replace('://+:', '://localhost:'));
    if (!LOCAL_HOSTS.has(parsed.hostname)) return undefined;
    return Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  } catch { return undefined; }
}

// Puertos locales que declara una lista de URLs (la propiedad `applicationUrl` separa varias con `;`).
function portsOf(urls) {
  const ports = new Set();
  for (const value of urls) for (const part of String(value || '').split(';')) {
    const port = localPort(part.trim());
    if (port) ports.add(port);
  }
  return ports;
}

// URLs locales (localhost) que aparecen como valores de un appsettings.json. La sección Kestrel y la clave
// `urls` describen dónde escucha el propio proyecto, no una dependencia, así que se omiten.
function localUrls(text) {
  let data;
  try { data = parseJsonc(String(text)); } catch { return []; }
  const found = new Map();
  const visit = (value, key, depth) => {
    if (depth > 12 || /^(kestrel|urls)$/i.test(key || '')) return;
    if (typeof value === 'string') {
      for (const match of value.matchAll(URL_IN_TEXT)) {
        const port = localPort(match[0]);
        if (port && !found.has(port)) found.set(port, { url: match[0], port });
      }
    } else if (Array.isArray(value)) value.forEach(item => visit(item, key, depth + 1));
    else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) visit(item, name, depth + 1);
  };
  visit(data, '', 0);
  return [...found.values()];
}

// ¿Alguno de los candidatos escucha en un puerto que el proyecto principal usa como destino?
// candidates: [{ id, profiles: [{ name, url }] }] → { id, profile, url } o undefined.
function matchCandidate(urls, candidates) {
  for (const target of urls) {
    for (const candidate of candidates) {
      const profile = candidate.profiles.find(p => portsOf([p.url]).has(target.port));
      if (profile) return { id: candidate.id, profile: profile.name, url: target.url };
    }
  }
  return undefined;
}

function isWebProject(text) {
  return /<Project\b[^>]*\bSdk\s*=\s*"Microsoft\.NET\.Sdk\.Web"/i.test(String(text));
}

function companionName(project) {
  return path.basename(String(project), path.extname(String(project)));
}

// Entradas guardadas con forma válida y sin repetir.
function cleanList(value) {
  const seen = new Set(), list = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || typeof item.project !== 'string' || !item.project || seen.has(item.project)) continue;
    seen.add(item.project);
    const entry = { project: item.project, profile: typeof item.profile === 'string' ? item.profile : '' };
    if (typeof item.browse === 'boolean') entry.browse = item.browse;
    if (typeof item.path === 'string') entry.path = item.path;
    list.push(entry);
  }
  return list;
}

// Espera a que la API esté lista: su propia salida anunció la URL, o su puerto responde. Devuelve
// 'ready' | 'exited' | 'cancelled' | 'timeout'.
async function waitForReady({ isOpen, urlSeen, exited, cancelled, timeout = 90000, interval = 500, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now }) {
  const start = now();
  for (;;) {
    if (cancelled()) return 'cancelled';
    if (exited()) return 'exited';
    if (urlSeen()) return 'ready';
    if (isOpen && await isOpen()) return 'ready';
    if (now() - start > timeout) return 'timeout';
    await sleep(interval);
  }
}

module.exports = { localPort, portsOf, localUrls, matchCandidate, isWebProject, companionName, cleanList, waitForReady };
