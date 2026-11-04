#!/usr/bin/env node
'use strict';
// Role-kit validator for the Claude dispatch rails (`--role-kit <dir>`). Node built-ins only.
//
// A kit dir holds:
//   role.md   the role card, passed to the child as --system-prompt (claude has no --system-prompt-file)
//   tools     ONE line, comma-separated tool allowlist, passed as --tools; the single word `none` means
//             an empty allowlist (--tools ""), the posture the review/author rails already use
//   plugin/   optional Claude plugin dir (skills; its hooks and .mcp.json also run, so a kit is caller-trusted), passed as --plugin-dir
//
// Usage:  node role-kit.js check <kit-dir>
//   ok    -> stdout, one value per line (no value contains a newline):
//              1 kit root (realpath)   2 role.md sha256   3 tools-file sha256
//              4 tools argument        5 plugin realpath or empty
//              6 the dispatch-record JSON object ({"path","role_md_sha256","tools_sha256","tools","plugin"})
//            exit 0
//   fail  -> stdout, one line `REASON: <reason>`, exit 2 (stderr is left to node warnings and is never parsed). The rail refuses before any spawn.
//
// Limits: role.md <= ROLE_MD_MAX_BYTES (8 KiB: the role-kit direction caps a card at ~2 KiB, so this is 4x
// headroom, far below the 128 KiB single-argv limit, and keeps the point of a kit, a small prompt).
// Every symlink anywhere under the kit must resolve inside the kit root (dangling ones are refused too).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROLE_MD_MAX_BYTES = 8192;
const TOOLS_MAX_BYTES = 1024;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

class KitError extends Error {}
const fail = (m) => { throw new KitError(m); };
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function inside(root, p) {
  return p === root || p.startsWith(root + path.sep);
}

function walkSymlinks(root, dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) {
      let real;
      try { real = fs.realpathSync(full); } catch { fail(`dangling symlink in kit: ${path.relative(root, full)}`); }
      if (!inside(root, real)) fail(`symlink escapes the kit dir: ${path.relative(root, full)}`);
    } else if (ent.isDirectory()) {
      walkSymlinks(root, full);
    }
  }
}

function readKitFile(root, name) {
  const p = path.join(root, name);
  let lst;
  try { lst = fs.lstatSync(p); } catch { fail(`${name} missing`); }
  let real = p;
  if (lst.isSymbolicLink()) {
    try { real = fs.realpathSync(p); } catch { fail(`${name} is a dangling symlink`); }
    if (!inside(root, real)) fail(`${name} symlink escapes the kit dir`);
  }
  const st = fs.statSync(real);
  if (!st.isFile()) fail(`${name} is not a regular file`);
  return fs.readFileSync(real);
}

function check(dir) {
  if (typeof dir !== 'string' || dir === '') fail('kit dir not given');
  let root;
  try { root = fs.realpathSync(dir); } catch { fail(`kit dir missing: ${dir}`); }
  if (!fs.statSync(root).isDirectory()) fail(`kit path is not a directory: ${dir}`);
  if (/[\n\r]/.test(root)) fail('kit path contains a newline');

  walkSymlinks(root, root);

  const role = readKitFile(root, 'role.md');
  if (role.length === 0 || role.toString('utf8').trim() === '') fail('role.md is empty');
  if (role.length > ROLE_MD_MAX_BYTES) fail(`role.md is ${role.length} bytes, over the ${ROLE_MD_MAX_BYTES} byte cap`);
  if (role.includes(0)) fail('role.md contains a NUL byte');
  try { new TextDecoder('utf-8', { fatal: true }).decode(role); } catch { fail('role.md is not valid UTF-8'); }

  const toolsRaw = readKitFile(root, 'tools');
  if (toolsRaw.length > TOOLS_MAX_BYTES) fail(`tools file is over the ${TOOLS_MAX_BYTES} byte cap`);
  const lines = toolsRaw.toString('utf8').split(/\r?\n/);
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length === 0) fail('tools line is empty');
  if (lines.length > 1) fail('tools must be a single line');
  const line = lines[0].trim();
  if (line === '') fail('tools line is empty');
  let tools;
  if (line === 'none') {
    tools = '';
  } else {
    const names = line.split(',').map((s) => s.trim());
    for (const n of names) {
      if (n === '') fail('tools line has an empty entry');
      if (!TOOL_NAME.test(n)) fail(`unknown tool name shape: ${JSON.stringify(n).slice(0, 80)}`);
    }
    tools = names.join(',');
  }

  let plugin = '';
  const pdir = path.join(root, 'plugin');
  let plst = null;
  try { plst = fs.lstatSync(pdir); } catch { /* absent is fine */ }
  if (plst) {
    let preal;
    try { preal = fs.realpathSync(pdir); } catch { fail('plugin/ is a dangling symlink'); }
    if (!inside(root, preal)) fail('plugin/ symlink escapes the kit dir');
    if (!fs.statSync(preal).isDirectory()) fail('plugin/ is not a directory');
    plugin = preal;
  }

  const meta = {
    path: root,
    role_md_sha256: sha256(role),
    tools_sha256: sha256(toolsRaw),
    tools,
    plugin: plugin !== '',
  };
  return { root, roleSha: meta.role_md_sha256, toolsSha: meta.tools_sha256, tools, plugin, json: JSON.stringify(meta) };
}

function main(argv) {
  if (argv[0] !== 'check' || argv.length !== 2) {
    process.stderr.write('usage: role-kit.js check <kit-dir>\n');
    return 2;
  }
  let r;
  try {
    r = check(argv[1]);
  } catch (e) {
    // A KitError carries its reason; any other failure (EACCES, EISDIR, ...) is still one refusal line.
    const why = e instanceof KitError ? e.message : `kit unreadable: ${e.code || e.message}`;
    fs.writeSync(1, `REASON: ${String(why).replace(/\s+/g, ' ')}\n`);
    return 2;
  }
  fs.writeSync(1, [r.root, r.roleSha, r.toolsSha, r.tools, r.plugin, r.json].join('\n') + '\n');
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { check, ROLE_MD_MAX_BYTES };
