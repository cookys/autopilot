#!/usr/bin/env node
'use strict';
/*
 * identifier-scan.js — structured-identifier-token lint (canonical implementation).
 *
 * WHAT IT DOES: detects STRUCTURED identifier tokens only — email addresses, IPv4
 * literals, /home/<user>/ paths, FQDNs, and common API-key shapes. Five fixed regexes,
 * no LLM, no learned model.
 *
 * NEGATIVE SCOPE (the most important line in this file): this scanner has ZERO
 * coverage of UNSTRUCTURED identifiers — bare hostnames, client/company names, tmux
 * pane addresses, endpoint aliases, or any other free-text identifying string that
 * doesn't match one of the five patterns below. Those are invisible to it and are the
 * HUMAN REVIEWER'S job. A clean exit (0) means "no structured token matched" — it
 * NEVER means "this text is safe to publish."
 *
 * The covered set is pinned by hooks/tests/fixtures/identifier-scan/ (one dirty
 * fixture per kind, plus a clean/negative-scope.md that asserts the blind spot on
 * purpose). Those fixtures are the referent for any claim about what this scans —
 * not this comment, not the pattern list below in isolation.
 *
 * WHY THERE IS NO DENY-LIST: an earlier version of this lint (in distill-scan.js)
 * supported an optional ~/.autopilot/distill/identifiers.deny allow-through list of
 * "known" hostnames. A deny-list of known hostnames silently PASSES every name it was
 * never told about, and the run still emits a "clean" label. That label attests that a
 * list was consulted, not that the text is clean — it is attestation, which
 * docs/adr/0001-verification-over-attestation.md forbids, and it is worse than no
 * lint at all because it manufactures false confidence. ~/.autopilot/distill/identifiers.deny
 * has never existed on this machine, so removing it regresses nothing. There is
 * deliberately no allow/deny mechanism here to replace it.
 *
 * See references/knowledge-routing.md for the disclosure policy this scanner
 * mechanises (what may leave the machine vs. what needs human review first).
 *
 * USAGE:
 *   node identifier-scan.js <path> [<path> ...]   scan files/directories
 *   node identifier-scan.js -                     read stdin
 *   node identifier-scan.js                       (no args) read stdin
 *   node identifier-scan.js --json                emit {"findings":[{file,line,kind,match}]}
 *   node identifier-scan.js --help | -h            usage, exit 0
 *
 * A named FILE is scanned regardless of extension (the caller asked for it). A
 * DIRECTORY is walked recursively, skipping node_modules/ and .git/, considering only
 * *.md/*.txt/*.json/*.yml/*.yaml files.
 *
 * EXIT CODES: 0 = no findings. 1 = one or more findings. 2 = usage error (a given
 * path does not exist, or could not be read).
 */
const fs = require('fs');
const path = require('path');

// Ported verbatim from distill-scan.js's runIdentifierLint patterns array — ids
// unchanged (email, ipv4, home_path, fqdn, key_shape). Do not "improve" these; the
// point of this extraction is a faithful move, not a rewrite.
const PATTERNS = [
  { id: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { id: 'ipv4', re: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g },
  { id: 'home_path', re: /\/home\/[A-Za-z0-9._-]+\//g },
  { id: 'fqdn', re: /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|dev|ai|local|internal)\b/gi },
  { id: 'key_shape', re: /\b(?:sk|pk|api)[-_]?[A-Za-z0-9]{16,}\b/g },
];

const SCAN_EXT_RE = /\.(md|txt|json|ya?ml)$/i;

/**
 * Scan a single text blob, returning findings with 1-based line numbers.
 * @param {string} text
 * @param {string} fileLabel — the file path (or "<stdin>") to attach to findings.
 * @returns {Array<{file:string,line:number,kind:string,match:string}>}
 */
function scanText(text, fileLabel) {
  const findings = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text)) !== null) {
      const upto = text.slice(0, m.index);
      const line = upto.split(/\r?\n/).length;
      findings.push({ file: fileLabel, line, kind: p.id, match: m[0] });
      // guard against zero-length matches looping forever (none of the current
      // patterns are zero-length, but this keeps the loop safe if that changes)
      if (m[0].length === 0) p.re.lastIndex += 1;
    }
  }
  // Stable order: by line, then by pattern order (insertion order from PATTERNS).
  findings.sort((a, b) => a.line - b.line || PATTERNS.findIndex(p => p.id === a.kind) - PATTERNS.findIndex(p => p.id === b.kind));
  return findings;
}

function walkDir(dir, out) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    throw Object.assign(new Error(`cannot read directory: ${dir} (${e.message})`), { usageError: true });
  }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walkDir(full, out);
    } else if (e.isFile() && SCAN_EXT_RE.test(e.name)) {
      out.push(full);
    }
  }
}

/**
 * Scan a list of file/directory paths. Directories are walked recursively
 * (node_modules/.git skipped, only md/txt/json/yml/yaml considered). An
 * explicitly named file is scanned regardless of extension.
 * @param {string[]} paths
 * @returns {Array<{file:string,line:number,kind:string,match:string}>}
 */
function scanPaths(paths) {
  const findings = [];
  for (const p of paths) {
    let st;
    try {
      st = fs.statSync(p);
    } catch (e) {
      throw Object.assign(new Error(`path does not exist: ${p}`), { usageError: true });
    }
    if (st.isDirectory()) {
      const files = [];
      walkDir(p, files);
      for (const f of files) {
        let text;
        try {
          text = fs.readFileSync(f, 'utf8');
        } catch (e) {
          throw Object.assign(new Error(`cannot read file: ${f} (${e.message})`), { usageError: true });
        }
        findings.push(...scanText(text, f));
      }
    } else if (st.isFile()) {
      let text;
      try {
        text = fs.readFileSync(p, 'utf8');
      } catch (e) {
        throw Object.assign(new Error(`cannot read file: ${p} (${e.message})`), { usageError: true });
      }
      findings.push(...scanText(text, p));
    } else {
      throw Object.assign(new Error(`not a file or directory: ${p}`), { usageError: true });
    }
  }
  return findings;
}

function printHelp(stream) {
  stream.write([
    'identifier-scan.js — structured identifier token lint (email/ipv4/home_path/fqdn/key_shape).',
    '',
    'Detects STRUCTURED tokens only. ZERO coverage of bare hostnames, client/company names,',
    'tmux pane addresses, or endpoint aliases — those are the human reviewer\'s job. A clean',
    'exit means "no structured token matched", never "this text is safe to publish".',
    '',
    'Usage:',
    '  node identifier-scan.js <path> [<path> ...]   scan files and/or directories',
    '  node identifier-scan.js -                     read stdin',
    '  node identifier-scan.js                       (no paths) read stdin',
    '  node identifier-scan.js --json                emit {"findings":[{file,line,kind,match}]}',
    '  node identifier-scan.js --help | -h           this message, exit 0',
    '',
    'Directories are walked recursively (node_modules/, .git/ skipped; only',
    '*.md/*.txt/*.json/*.yml/*.yaml considered). An explicitly named file is scanned',
    'regardless of extension.',
    '',
    'Exit codes: 0 = no findings, 1 = one or more findings, 2 = usage error',
    '(nonexistent path, unreadable file/directory).',
    '',
  ].join('\n') + '\n');
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (e) {
    return '';
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp(process.stdout);
    process.exit(0);
  }
  const asJson = args.includes('--json');
  const paths = args.filter(a => a !== '--json');

  let findings;
  try {
    if (paths.length === 0 || (paths.length === 1 && paths[0] === '-')) {
      const text = readStdin();
      findings = scanText(text, '<stdin>');
    } else {
      findings = scanPaths(paths);
    }
  } catch (e) {
    process.stderr.write(`identifier-scan: ${e.message}\n`);
    process.exit(2);
  }

  if (asJson) {
    process.stdout.write(JSON.stringify({ findings }, null, 2) + '\n');
  } else {
    if (!findings.length) {
      process.stdout.write('clean: no structured identifier tokens matched\n');
      process.stdout.write('(negative scope: bare hostnames, client/company names, tmux pane addresses,\n');
      process.stdout.write(' and endpoint aliases are NOT covered by this scanner — human review still\n');
      process.stdout.write(' required before treating this text as safe to publish.)\n');
    } else {
      for (const f of findings) {
        process.stdout.write(`  ${f.file}:${f.line}  ${f.kind}: ${f.match}\n`);
      }
    }
  }
  process.exit(findings.length ? 1 : 0);
}

module.exports = { scanText, scanPaths, PATTERNS };
