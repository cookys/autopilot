#!/usr/bin/env node
'use strict';
// safe-inspect: keys/structure only; every scalar value is masked, even with an innocuous key.
// Usage: node scripts/safe-inspect.js docker <container> | env | file <path>
// No shell, dependencies, raw child output or input-bearing error messages. See docs/guide/safe-inspect.md.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

function mask(value) {
  const text = String(value);
  return `***len=${text.length} sha8=${createHash('sha256').update(text).digest('hex').slice(0, 8)}`;
}
function maskObject(value, envList = false) {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (envList && typeof item === 'string') {
        const split = item.indexOf('=');
        if (split >= 0) return `${item.slice(0, split + 1)}${mask(item.slice(split + 1))}`;
      }
      return maskObject(item);
    });
  }
  if (value !== null && typeof value === 'object') {
    // fromEntries also preserves keys such as __proto__ as ordinary own properties.
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskObject(item, key === 'Env')]));
  }
  return mask(value);
}
function literal(value) {
  const text = value.trim();
  if (text.startsWith('"')) {
    // JSON/C/.env double-quoted strings share the common escapes. A failed parse stays opaque.
    const m = /^("(?:\\.|[^"\\])*")/.exec(text);
    if (m) { try { return JSON.parse(m[1]); } catch { return m[1].slice(1, -1); } }
  }
  const single = /^'((?:\\.|[^'\\])*)'/.exec(text);
  if (single) return single[1].replace(/\\(['\\])/g, '$1');
  return text.replace(/\s+(?:#|\/\/).*$/, '');
}
function maskFile(text) {
  try { return `${JSON.stringify(maskObject(JSON.parse(text)), null, 2)}\n`; }
  catch { /* Not JSON: parse known line shapes, mask every other non-empty line in full. */ }
  return text.split(/\r?\n/).map((line) => {
    if (!line.trim()) return '';
    if (/^\s*(?:<\?php|\?>)\s*$/.test(line)) return line.trim();
    let m = /^(\s*)define\(\s*(['"])([A-Za-z_]\w*)\2\s*,\s*(.*?)\s*\);(?:\s*\/\/.*)?\s*$/.exec(line);
    if (m) return `${m[1]}define(${m[2]}${m[3]}${m[2]}, ${JSON.stringify(mask(literal(m[4])))});`;
    m = /^(\s*)(\$[A-Za-z_]\w*)\s*=\s*(.*?);(?:\s*\/\/.*)?\s*$/.exec(line);
    if (m) return `${m[1]}${m[2]} = ${JSON.stringify(mask(literal(m[3])))};`;
    m = /^(\s*#\s*define\s+)([A-Za-z_]\w*)(?:\s+(.*))?$/.exec(line);
    if (m) return `${m[1]}${m[2]}${m[3] === undefined ? '' : ` "${mask(literal(m[3]))}"`}`;
    m = /^(\s*(?:export\s+)?)([A-Za-z_][\w.-]*)(\s*=\s*)(.*)$/.exec(line);
    if (m) return `${m[1]}${m[2]}${m[3]}${mask(literal(m[4]))}`;
    m = /^(\s*(?:-\s+)?)([A-Za-z_][\w.-]*|"[^"\\]*"|'[^'\\]*')(\s*:\s*)(.*)$/.exec(line);
    if (m) {
      // YAML nested mappings and block indicators are structure; block body lines are masked below.
      const value = m[4].trim();
      return `${m[1]}${m[2]}${m[3]}${value === '' || /^[|>][-+]?\d?$/.test(value) ? value : mask(literal(value))}`;
    }
    m = /^(\s*-\s+)(.*)$/.exec(line);
    if (m) return `${m[1]}${mask(literal(m[2]))}`;
    // Comments, unknown syntax and multiline continuations may also contain secrets. Never echo them.
    return `${/^\s*/.exec(line)[0]}${mask(line.trim())}`;
  }).join('\n');
}
function main(args) {
  try {
    if (args.length === 1 && args[0] === 'env') {
      process.stdout.write(`${JSON.stringify(maskObject(process.env), null, 2)}\n`);
    } else if (args.length === 2 && args[0] === 'file') {
      process.stdout.write(maskFile(fs.readFileSync(args[1], 'utf8')));
    } else if (args.length === 2 && args[0] === 'docker') {
      const r = spawnSync('docker', ['inspect', '--', args[1]], {
        encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (r.error || r.status !== 0) throw new Error('inspect failed');
      const value = JSON.parse(r.stdout);
      process.stdout.write(`${JSON.stringify(maskObject(value), null, 2)}\n`);
    } else {
      process.stderr.write('Usage: node scripts/safe-inspect.js docker <container> | env | file <path>\n');
      return 2;
    }
    return 0;
  } catch {
    // OS, child and parse errors can quote the input (including a credential). Keep diagnostics fixed.
    process.stderr.write('safe-inspect: unable to inspect input safely\n');
    return 1;
  }
}
if (require.main === module) process.exitCode = main(process.argv.slice(2));
