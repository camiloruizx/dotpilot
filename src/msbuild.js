'use strict';
// Errores y advertencias de MSBuild / compiladores .NET en la salida de `dotnet run`, convertidos en diagnósticos del
// panel Problemas. VS Code no aplica los problem matchers a la salida de una terminal propia en todas las versiones
// (en la 1.85 no lo hace), así que DotPilot los interpreta él mismo y funciona igual en cualquiera.
const path = require('node:path');

// C:\app\Program.cs(12,5): error CS0029: Cannot implicitly convert ... [C:\app\App.csproj]
// 1>C:\app\Program.cs(12,5,12,9): warning CS8600: ...
const LINE = /^\s*(?:\d+>)?(.+?)\((\d+),(\d+)(?:,\d+,\d+)?\):\s+(error|warning)\s+([A-Za-z]+\d+):\s+(.*?)(?:\s+\[[^\]]+\])?\s*$/;

function parseLine(line) {
  const match = LINE.exec(String(line));
  if (!match) return undefined;
  return { file: match[1].trim(), line: Number(match[2]), column: Number(match[3]), severity: match[4], code: match[5], message: match[6] };
}

class DiagnosticFeed {
  constructor(vscode, collection, cwd = '') {
    this.vscode = vscode;
    this.collection = collection;
    this.cwd = cwd;
    this.files = new Map();
    this.seen = new Set();
  }

  clear(cwd = this.cwd) {
    this.cwd = cwd;
    this.files.clear();
    this.seen.clear();
    this.collection.clear();
  }

  // Devuelve true si la línea era un error o advertencia.
  addLine(text) {
    const parsed = parseLine(text);
    if (!parsed) return false;
    const file = path.isAbsolute(parsed.file) ? parsed.file : path.resolve(this.cwd || '.', parsed.file);
    // dotnet repite los mensajes en el resumen final.
    const key = [file, parsed.line, parsed.column, parsed.code, parsed.message].join('|');
    if (this.seen.has(key)) return true;
    this.seen.add(key);
    const { Diagnostic, DiagnosticSeverity, Range, Uri } = this.vscode;
    const line = Math.max(0, parsed.line - 1), column = Math.max(0, parsed.column - 1);
    const diagnostic = new Diagnostic(new Range(line, column, line, column + 1), parsed.message,
      parsed.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning);
    diagnostic.source = 'dotnet';
    diagnostic.code = parsed.code;
    const uri = Uri.file(file);
    const list = [...(this.files.get(uri.toString()) || []), diagnostic];
    this.files.set(uri.toString(), list);
    this.collection.set(uri, list);
    return true;
  }
}

module.exports = { parseLine, DiagnosticFeed };
