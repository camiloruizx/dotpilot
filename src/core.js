'use strict';

// Strip JSONC comments and trailing commas without modifying quoted URLs/strings.
function parseJsonc(input) {
  const chars = input.replace(/^\uFEFF/, '').split('');
  let quoted = false;
  for (let i = 0; i < chars.length; i++) {
    if (quoted) {
      if (chars[i] === '\\') i++;
      else if (chars[i] === '"') quoted = false;
    } else if (chars[i] === '"') quoted = true;
    else if (chars[i] === '/' && chars[i + 1] === '/') {
      while (i < chars.length && chars[i] !== '\n') chars[i++] = ' ';
    } else if (chars[i] === '/' && chars[i + 1] === '*') {
      chars[i++] = ' '; chars[i++] = ' ';
      while (i < chars.length && !(chars[i] === '*' && chars[i + 1] === '/')) {
        if (chars[i] !== '\n') chars[i] = ' ';
        i++;
      }
      if (i >= chars.length) throw new Error('Comentario sin cerrar');
      chars[i] = ' '; chars[i + 1] = ' '; i++;
    }
  }
  quoted = false;
  for (let i = 0; i < chars.length; i++) {
    if (quoted) {
      if (chars[i] === '\\') i++;
      else if (chars[i] === '"') quoted = false;
    } else if (chars[i] === '"') quoted = true;
    else if (chars[i] === ',') {
      let j = i + 1;
      while (/\s/.test(chars[j] || '') && j < chars.length) j++;
      if (chars[j] === '}' || chars[j] === ']') chars[i] = ' ';
    }
  }
  return JSON.parse(chars.join(''));
}

function profilesFrom(text) {
  return Object.entries(parseJsonc(text).profiles || {})
    .filter(([, value]) => value && value.commandName === 'Project')
    .map(([name, value]) => ({ name, url: value.applicationUrl || '', launchBrowser: value.launchBrowser === true, launchUrl: value.launchUrl || '', workingDirectory: value.workingDirectory || '' }));
}

function buildArgs(action, target, configuration) {
  const common = [target, '--configuration', configuration, '--nologo'];
  switch (action) {
    case 'build': return ['build', ...common];
    case 'rebuild': return ['build', ...common, '-t:Rebuild'];
    case 'clean': return ['clean', ...common];
    case 'analyze': return ['build', ...common, '-t:Rebuild', '-p:RunAnalyzers=true', '-p:RunAnalyzersDuringBuild=true'];
    case 'restore': return ['restore', target, '--nologo', `-p:Configuration=${configuration}`];
    case 'test': return ['test', ...common];
    default: throw new Error('Acción de compilación desconocida');
  }
}

function runArgs(project, configuration, profile, framework, watch = false) {
  const args = ['run', '--project', project, '--configuration', configuration];
  args.push(...(profile ? ['--launch-profile', profile] : ['--no-launch-profile']));
  if (framework) args.push('--framework', framework);
  return watch ? ['watch', '--project', project, '--non-interactive', ...args.filter((_, index) => index !== 1 && index !== 2)] : args;
}

function browserUrl(profile, listeningUrl) {
  if (!profile) return undefined;
  const base = listeningUrl || String(profile.url).split(';').find(Boolean);
  if (!base) return undefined;
  try {
    const parsed = new URL(base.replace('://*:', '://localhost:').replace('://+:', '://localhost:'));
    if (parsed.hostname === '0.0.0.0' || parsed.hostname === '[::]') parsed.hostname = 'localhost';
    const url = new URL(profile.launchUrl || '', parsed);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : undefined;
  } catch { return undefined; }
}

function localEndpoint(profile) {
  try {
    const raw = String(profile?.url || '').split(';').find(Boolean);
    const url = new URL(raw.replace('://*:', '://localhost:').replace('://+:', '://localhost:'));
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    if (!['localhost', '127.0.0.1', '[::1]', '0.0.0.0', '[::]'].includes(url.hostname)) return undefined;
    return { host: ['[::1]', '[::]'].includes(url.hostname) ? '::1' : url.hostname === '0.0.0.0' ? '127.0.0.1' : url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)) };
  } catch { return undefined; }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { parseJsonc, profilesFrom, buildArgs, runArgs, escapeHtml, browserUrl, localEndpoint };
