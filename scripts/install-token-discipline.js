#!/usr/bin/env node
'use strict';
/**
 * Opt-in installer for the token-discipline marked block.
 *
 * Writes one HTML-comment-delimited block into Codex AGENTS.md (CODEX_HOME, or
 * ~/.codex when unset) and agy GEMINI.md (~/.gemini). The block body is the
 * text between the install-block markers in docs/token-discipline.md, read at
 * run time. Nothing in a default install flow calls this with `install`.
 * This script writes no Codex config.toml values.
 *
 * Usage:
 *   node scripts/install-token-discipline.js install [--harness codex|agy|all] [--dry-run]
 *   node scripts/install-token-discipline.js uninstall [--harness codex|agy|all] [--dry-run]
 *   node scripts/install-token-discipline.js --check [--harness codex|agy|all]
 *
 * --check exits 0 when every selected block matches that marked section, 1 on
 * drift, and 3 when nothing has drifted but at least one target is not installed
 * (drift wins over 3). A config.toml hint does not change that exit code.
 * --dry-run prints what would be written and writes nothing.
 * compact_token_budget is hinted as a bare key, a dotted key
 * (profiles.x.compact_token_budget), or a field inside an inline table.
 * The other three ignored keys are hinted only as top-level keys.
 *
 * Contract: this header.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const BEGIN = '<!-- autopilot:token-discipline begin v1 -->';
const END = '<!-- autopilot:token-discipline end -->';
const INSTALL_BEGIN = '<!-- install-block begin -->';
const INSTALL_END = '<!-- install-block end -->';
const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(REPO_ROOT, 'docs', 'token-discipline.md');
const TOP_LEVEL_HINT_KEYS = new Set([
  'default_subagent_model',
  'default_subagent_reasoning_effort',
  'max_concurrent_threads_per_session',
]);
const DEPRECATED_KEY = 'compact_token_budget';

function usage() {
  process.stdout.write(
    'Usage: node scripts/install-token-discipline.js <install|uninstall|--check> ' +
    '[--harness codex|agy|all] [--dry-run]\n' +
    'Opt-in. Does not run from any default install flow.\n' +
    'Block body: docs/token-discipline.md (no built-in fallback).\n'
  );
}

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  let command = null;
  let harness = 'all';
  let dryRun = false;
  let check = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--check') {
      check = true;
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg === '--harness') {
      harness = argv[i + 1];
      i += 1;
      if (harness !== 'codex' && harness !== 'agy' && harness !== 'all') {
        fail('--harness must be codex|agy|all');
      }
    } else if (arg === 'install' || arg === 'uninstall') {
      if (command) fail(`unexpected extra command: ${arg}`);
      command = arg;
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  if (check && command) fail('--check cannot be combined with install or uninstall');
  if (check) command = 'check';
  if (!command) {
    usage();
    process.exit(2);
  }
  return { command, harness, dryRun };
}

function countOf(text, needle) {
  let count = 0;
  let from = 0;
  while (from <= text.length) {
    const at = text.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
  return count;
}

function readSource() {
  let text;
  try {
    text = fs.readFileSync(SOURCE, 'utf8');
  } catch (error) {
    fail(`cannot read token-discipline source ${SOURCE}: ${error.message}`);
  }
  const beginCount = countOf(text, INSTALL_BEGIN);
  const endCount = countOf(text, INSTALL_END);
  if (beginCount !== 1 || endCount !== 1) {
    fail(
      `token-discipline source ${SOURCE} must contain exactly one ` +
      '"<!-- install-block begin -->" line and one "<!-- install-block end -->" line ' +
      `(found begin ${beginCount}, end ${endCount})`
    );
  }
  const beginAt = text.indexOf(INSTALL_BEGIN);
  const endAt = text.indexOf(INSTALL_END);
  if (endAt < beginAt) {
    fail(`install-block markers in ${SOURCE} are out of order`);
  }
  let start = beginAt + INSTALL_BEGIN.length;
  if (text[start] === '\r') start += 1;
  if (text[start] === '\n') start += 1;
  let body = text.slice(start, endAt);
  if (body.endsWith('\r\n')) body = body.slice(0, -2);
  else if (body.endsWith('\n')) body = body.slice(0, -1);
  if (body.endsWith('\r')) body = body.slice(0, -1);
  body += '\n';
  return `${BEGIN}\n${body}${END}\n`;
}

function targetsFor(harness) {
  const home = os.homedir();
  const codexHome = process.env.CODEX_HOME || path.join(home, '.codex');
  const targets = [];
  if (harness === 'codex' || harness === 'all') {
    targets.push({ harness: 'codex', file: path.join(codexHome, 'AGENTS.md'), codexHome });
  }
  if (harness === 'agy' || harness === 'all') {
    targets.push({
      harness: 'agy',
      file: path.join(home, '.gemini', 'GEMINI.md'),
      codexHome: null,
    });
  }
  return targets;
}

function fileUsesCrlf(text) {
  return text.includes('\r\n') && !text.replace(/\r\n/g, '').includes('\n');
}

function withNewlines(text, crlf) {
  const lf = text.replace(/\r\n/g, '\n');
  return crlf ? lf.replace(/\n/g, '\r\n') : lf;
}

function locateBlock(text) {
  if (countOf(text, BEGIN) > 1 || countOf(text, END) > 1) return { kind: 'drift' };
  const beginAt = text.indexOf(BEGIN);
  const endAt = text.indexOf(END);
  if (beginAt === -1 && endAt === -1) return { kind: 'absent' };
  if (beginAt === -1 || endAt === -1 || endAt < beginAt) return { kind: 'drift' };
  let after = endAt + END.length;
  if (text[after] === '\r') after += 1;
  if (text[after] === '\n') after += 1;
  return {
    kind: 'present',
    before: text.slice(0, beginAt),
    inner: text.slice(beginAt, after),
    after: text.slice(after),
  };
}

function withBlock(existing, block) {
  const found = locateBlock(existing);
  if (found.kind === 'drift') return null;
  const rendered = withNewlines(block, fileUsesCrlf(existing));
  if (found.kind === 'present') return found.before + rendered + found.after;
  if (existing.length === 0) return rendered;
  if (existing.endsWith('\n')) return existing + rendered;
  return existing + (fileUsesCrlf(existing) ? '\r\n' : '\n') + rendered;
}

function withoutBlock(existing) {
  const found = locateBlock(existing);
  if (found.kind === 'absent') return existing;
  if (found.kind === 'drift') return null;
  return found.before + found.after;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function backup(file) {
  if (!fs.existsSync(file)) return null;
  const dest = `${file}.bak-${stamp()}`;
  fs.copyFileSync(file, dest);
  process.stdout.write(`${dest}\n`);
  return dest;
}

function readText(file) {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function installOne(target, block, dryRun) {
  const existing = readText(target.file);
  const next = withBlock(existing === null ? '' : existing, block);
  if (next === null) fail(`marked block in ${target.file} is malformed; refusing to rewrite it`);
  if (dryRun) {
    process.stdout.write(`dry-run: would write ${target.file}\n`);
    process.stdout.write(next);
    return;
  }
  if (existing !== null && existing === next) {
    process.stdout.write(`unchanged ${target.file}\n`);
    return;
  }
  if (existing !== null) backup(target.file);
  writeText(target.file, next);
  process.stdout.write(`wrote ${target.file}\n`);
}

function uninstallOne(target, dryRun) {
  const existing = readText(target.file);
  if (existing === null) {
    process.stdout.write(`${dryRun ? 'dry-run: ' : ''}absent ${target.file}\n`);
    return;
  }
  const next = withoutBlock(existing);
  if (next === null) fail(`marked block in ${target.file} is malformed; refusing to rewrite it`);
  const empty = next === '';
  if (dryRun) {
    process.stdout.write(empty
      ? `dry-run: would delete ${target.file}\n`
      : `dry-run: would write ${target.file}\n${next}`);
    return;
  }
  if (next === existing) {
    process.stdout.write(`unchanged ${target.file}\n`);
    return;
  }
  backup(target.file);
  if (empty) {
    fs.unlinkSync(target.file);
    process.stdout.write(`deleted ${target.file}\n`);
    return;
  }
  writeText(target.file, next);
  process.stdout.write(`wrote ${target.file}\n`);
}

// Drop quoted spans (so a "#" inside a string is not a comment) and a trailing # comment.
// Used only for the inline-table key scan. Bare and dotted keys stay on the raw line.
function lineWithoutQuotesOrTrailingComment(line) {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (quote === '"' && c === '\\') {
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '#') break;
    out += c;
  }
  return out;
}

function hintFindings(toml) {
  let section = '';
  const hits = [];
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const header = line.match(/^\[+([^[\]]+)\]+\s*(?:#.*)?$/);
    if (header) {
      section = header[1].trim();
      continue;
    }
    const key = line.match(/^([A-Za-z0-9_.-]+)\s*=/);
    if (!key) continue;
    const inlineLine = lineWithoutQuotesOrTrailingComment(line);
    const deprecated = key[1] === DEPRECATED_KEY
      || key[1].endsWith(`.${DEPRECATED_KEY}`)
      || new RegExp(`(?:^|[^A-Za-z0-9_-])${DEPRECATED_KEY}\\s*=`).test(inlineLine);
    if (deprecated) {
      hits.push({ key: DEPRECATED_KEY, section });
    } else if (section === '' && TOP_LEVEL_HINT_KEYS.has(key[1])) {
      hits.push({ key: key[1], section: '' });
    }
  }
  return hits;
}

function checkOne(target, block) {
  const existing = readText(target.file);
  let state = 'ok';
  if (existing === null) {
    state = 'missing';
    process.stdout.write(`${target.harness}: not installed (${target.file})\n`);
  } else {
    const found = locateBlock(existing);
    const rendered = withNewlines(block, fileUsesCrlf(existing));
    if (found.kind === 'present' && found.inner === rendered) {
      process.stdout.write(`${target.harness}: consistent (${target.file})\n`);
    } else {
      state = 'drift';
      process.stdout.write(`${target.harness}: drift (${target.file})\n`);
    }
  }
  if (target.codexHome) {
    const configPath = path.join(target.codexHome, 'config.toml');
    if (fs.existsSync(configPath)) {
      const hits = hintFindings(fs.readFileSync(configPath, 'utf8'));
      for (const hit of hits) {
        if (hit.key === DEPRECATED_KEY) {
          const where = hit.section === '' ? 'the top level' : `[${hit.section}]`;
          process.stdout.write(
            `hint: ${hit.key} in ${where} of ${configPath} is deprecated; do not set it\n`
          );
        } else {
          process.stdout.write(
            `hint: ${hit.key} at the top level of ${configPath} is ignored there; ` +
            'the correct location is the [agents] section\n'
          );
        }
      }
    }
  }
  return state;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const block = readSource();
  const targets = targetsFor(args.harness);
  if (args.command === 'check') {
    let drift = false;
    let missing = false;
    for (const target of targets) {
      const state = checkOne(target, block);
      if (state === 'drift') drift = true;
      else if (state === 'missing') missing = true;
    }
    if (drift) process.exit(1);
    if (missing) process.exit(3);
    process.exit(0);
  }
  for (const target of targets) {
    if (args.command === 'install') installOne(target, block, args.dryRun);
    else uninstallOne(target, args.dryRun);
  }
}

main();
