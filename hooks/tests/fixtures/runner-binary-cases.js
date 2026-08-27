'use strict';

// Version-line acceptance/refusal cases for scripts/lib/runner-binary.js.
//
// Kept as a fixture module (not inline in the .test.sh) because several cases carry raw
// ANSI escape bytes, which do not survive being typed into a shell heredoc intact.
//
// Each case: [label, versionLine, expected]  where expected is "accept" or "refuse".
// Real observed outputs are marked REAL; everything else is a hostile or borderline shape.
const ESC = String.fromCharCode(27);

module.exports = [
  // --- REAL outputs observed on this machine (2026-08-27). All must be accepted.
  ['REAL cursor-agent', '2026.08.25-3e8eec8', 'accept'],
  ['REAL claude', '2.0.44 (Claude Code)', 'accept'],
  ['REAL codex', 'codex-cli 0.31.0', 'accept'],
  ['REAL grok', '0.0.34', 'accept'],
  ['REAL node', 'v22.14.0', 'accept'],

  // --- Plausible banners that must NOT be false-refused.
  ['labelled banner', 'Version: 1.2.3', 'accept'],
  ['prerelease suffix', 'mytool 1.2.3-rc.1', 'accept'],
  ['build metadata', '1.2.3+build.7', 'accept'],
  ['four-part version', 'agy 1.0.1.4', 'accept'],

  // --- THE REGRESSION. The exact string that became a paid --runner-version token.
  ['INCIDENT cursor IDE launcher error',
    "Error: No Cursor IDE installation found. Use 'cursor agent' or 'agent' to run the agent.",
    'refuse'],

  // --- Other garbage that must never be minted into an identity.
  ['empty', '', 'refuse'],
  ['whitespace only', '   ', 'refuse'],
  ['bare word', 'unknown', 'refuse'],
  ['no numeric version', 'my-cool-tool', 'refuse'],
  ['single integer only', 'tool 7', 'refuse'],
  ['error prefix, short', 'Error: boom', 'refuse'],
  ['diagnostic carrying a version', 'Cannot start: requires Node 18.0', 'refuse'],

  // SHORT requirement diagnostics — the hole the first-pass QC panel (codex/gpt-5.6-sol,
  // 2026-08-27) found. These have a real version token in the first two or three words, so
  // position and shape alone accept them; `Requires Node 18.0` became `Requires-Node-18.0`.
  // The `Cannot start:` case above hid this: it is refused because its version sits fifth.
  ['SHORT requirement, version third', 'Requires Node 18.0', 'refuse'],
  ['SHORT requirement, version second', 'Node 18.0 required', 'refuse'],
  ['requirement with a tail', 'requires Node 18.0 or newer', 'refuse'],
  ['failure stating a version', 'failed to load runtime 2.1', 'refuse'],
  ['install instruction', 'install cursor-agent 1.2.3', 'refuse'],
  ['stack frame', 'at /home/x/y.js:12:3', 'refuse'],
  ['url with a version-shaped path', 'see https://example.com/1.2 for help', 'refuse'],
  ['usage banner', 'Usage: tool [options] 1.2', 'refuse'],
  ['command not found', 'command not found: cursor 1.0', 'refuse'],
  ['long sentence under the token cap', 'the installed release identifier is 1.2.3 today ok', 'refuse'],

  // --- ANSI colouring: a coloured REAL version still accepts and yields a CLEAN token;
  //     a coloured ERROR must not slip past the anchored error check.
  [`ansi-wrapped version`, `${ESC}[31m1.2.3${ESC}[0m`, 'accept'],
  [`ansi-wrapped error`, `${ESC}[31mError: boom 1.2${ESC}[0m`, 'refuse'],
  ['bare control byte', `1.2.3${ESC}x`, 'refuse'],
];
