#!/usr/bin/env node
'use strict';
// Role-kit agent file for the kimi arm of dispatch-author (`--role-kit <dir> --runner kimi`). Node built-ins only.
//
// kimi has no --system-prompt and no --tools flag. A role card reaches the model as a custom agent file
// (`--agent-file <agent.md>`): frontmatter (name, description, tools: [...]) followed by the exact bytes of role.md; the
// tool allowlist is the `tools: [...]` line. The layout is the one evals/rolekit/compile-kit.js `--runner kimi` documents
// (hooks/tests/role-kit-kimi.test.sh pins the two byte for byte; compile-kit.js is frozen and is not required here).
// Spike facts (kimi-code 2.3.0, session records only): the card is injected and its hash matches; `[Read, Grep]` gave exactly
// those tools; a custom agent reads neither AGENTS.md nor skills. `tools: []` (a `none` kit) was NOT exercised in that spike
// for this layout (the review rail's lib/kimi-containment.js uses it and audits the wire, but that is another rail).
//
//   node role-kit-kimi.js plan  <kit-dir>              validate; print one JSON line: {agent_file_sha256, role_kit}
//   node role-kit-kimi.js write <kit-dir> <out-file>   validate again, write the agent file (0600), read it back; print its sha256
//   plan/write exit 2 with one `REASON: ...` line on stdout for any refusal (the same shape as role-kit.js).
// A kit with plugin/ is refused (a custom kimi agent cannot read plugin skills: the method must be in role.md).
// role.md is capped at 4096 bytes here (role-kit.js allows 8192 for the Claude arms).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { check } = require('./role-kit.js');

const ROLE_MD_MAX_BYTES_KIMI = 4096;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

class Refusal extends Error {}

function render(kitDir) {
  const k = check(kitDir); // throws role-kit.js's own refusals
  if (k.plugin) throw new Refusal('kimi custom agents cannot read plugin skills: use a kit without plugin/ (the method goes in role.md)');
  const role = fs.readFileSync(path.join(k.root, 'role.md'));
  if (sha256(role) !== k.roleSha) throw new Refusal('role.md changed while it was being read');
  if (role.length > ROLE_MD_MAX_BYTES_KIMI) throw new Refusal(`role.md is ${role.length} bytes, over the ${ROLE_MD_MAX_BYTES_KIMI} byte kimi cap`);
  const name = `rk-${path.basename(path.resolve(kitDir)).replace(/[^A-Za-z0-9_-]/g, '-')}`;
  const tools = k.tools === '' ? [] : k.tools.split(',');
  const head = `---\nname: ${name}\ndescription: ${JSON.stringify('role kit agent (no behaviour of its own)')}\ntools: [${tools.join(', ')}]\n---\n`;
  const bytes = Buffer.concat([Buffer.from(head, 'utf8'), role]);
  const meta = JSON.parse(k.json);
  meta.agent_file_sha256 = sha256(bytes);
  return { bytes, sha: meta.agent_file_sha256, json: JSON.stringify(meta) };
}

function main(argv) {
  const [cmd, kit, out] = argv;
  if (!((cmd === 'plan' && argv.length === 2) || (cmd === 'write' && argv.length === 3))) {
    process.stderr.write('usage: role-kit-kimi.js plan <kit-dir> | write <kit-dir> <out-file>\n');
    return 2;
  }
  try {
    const r = render(kit);
    if (cmd === 'write') {
      fs.writeFileSync(out, r.bytes, { mode: 0o600, flag: 'wx' });
      if (sha256(fs.readFileSync(out)) !== r.sha) throw new Refusal('agent file did not read back intact');
      fs.writeSync(1, `${r.sha}\n`);
    } else {
      fs.writeSync(1, `${r.sha}\n${r.json}\n`);
    }
    return 0;
  } catch (e) {
    const why = e && e.message ? e.message : String(e);
    fs.writeSync(1, `REASON: ${String(why).replace(/\s+/g, ' ')}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { render, ROLE_MD_MAX_BYTES_KIMI };
