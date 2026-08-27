'use strict';

// runner-binary.js — the ONE owner of the runner-token -> version-binary relation,
// plus the fail-closed derivation of a `--runner-version` identity token from that
// binary's `--version` output.
//
// WHY THIS EXISTS (2026-08-27 incident, second instance of one root cause):
// `scripts/qualification-sweep.sh` derived the version binary by NAME from the runner
// token, special-casing only `cc-shim` -> `claude`. For `runner: cursor` the real binary
// is `cursor-agent`; plain `cursor` is the Cursor IDE launcher, which answers
// `--version` with
//     Error: No Cursor IDE installation found. Use 'cursor agent' or 'agent' to run the agent.
// on STDERR. The sweep folded stderr in with `2>&1` and only stripped characters, so that
// sentence became the identity token and was passed to a real, paid administration:
//     --runner-version Error:-No-Cursor-IDE-installation-found.-Use-cursor-agent-or-agent-...
// `runner_version` is part of the deployment identity that decides whether qualification
// evidence still applies later (skills/engine-onboarding/SKILL.md Stage 4), so the row
// looked authoritative and could never match anything.
//
// The same wrong assumption had already been fixed once in `scripts/probe-engine-capability.sh`
// (v2.34.42). It recurred because the mapping had no owner — every call site carried its
// own copy. This module is that owner; `src/readiness/probe.js` consumes it too.
//
// TWO INDEPENDENT LAYERS, both required:
//   1. The MAP. Fail closed on an unknown runner — no name-derived fallthrough. That
//      fallthrough IS the bug class: it turns "runner I have never heard of" into
//      "run whatever binary happens to share its name".
//   2. FAIL CLOSED ON AN UNUSABLE VERSION. A `--version` that errors, is empty, or does
//      not look like a version must ABORT the seat (uncharged, receipt retained, same
//      posture as a probe miss) — never be sanitized into an identity token. A refused
//      seat costs nothing; a bogus row costs a full paid administration plus a
//      permanently misleading record. So every ambiguous case refuses.
//
// Node built-ins only (Node >= 20.10).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// The canonical runner -> version-binary map. Every runner the repo supports appears
// here explicitly, INCLUDING the identity entries: an explicit `codex: 'codex'` is a
// recorded fact ("checked; the binary really is named after the runner"), whereas a
// fallthrough is an assumption. That difference is the whole point of this file.
//
// Verified per runner against how each is actually invoked elsewhere in the tree —
// `scripts/dispatch-hetero.sh`'s *_BIN defaults, `scripts/dispatch-review.sh`'s runner
// rails, and `scripts/probe-engine-capability.sh`'s presence branches.
const RUNNER_VERSION_BINARY = Object.freeze({
  codex: 'codex',                    // dispatch-hetero.sh CODEX_BIN="codex"
  agy: 'agy',                        // dispatch-hetero.sh AGY_BIN="agy"
  grok: 'grok',                      // dispatch-hetero.sh GROK_BIN="grok"
  qoderclicn: 'qoderclicn',          // dispatch-hetero.sh QODER_BIN="qoderclicn"
  pi: 'pi',                          // dispatch-hetero.sh PI_BIN="pi"
  cursor: 'cursor-agent',            // dispatch-hetero.sh CURSOR_BIN="cursor-agent" — NOT `cursor`
  kimi: 'kimi',                      // dispatch-review.sh: PATH `kimi`, else ~/.kimi-code/bin/kimi
  'cc-shim': 'claude',               // a Claude Code CLI pointed at an arbitrary endpoint
  'claude-native': 'claude',         // the local Claude Code CLI on its own ambient auth
  'anthropic-compatible': 'claude',  // not a binary runner (direct HTTP); see the note below
});

// `kimi` is routinely NOT on bare PATH. dispatch-review.sh resolves it as PATH, then
// ~/.kimi-code/bin/kimi. This module MIRRORS that order rather than refusing on a PATH
// miss, for the reason probe-engine-capability.sh gives for its own kimi branch: a probe
// that resolves the binary differently from the dispatcher reports on a different tool
// than the one dispatch actually runs. Ownership of the general fallback CHAIN stays with
// the dispatchers (they also honor an explicit --bin, which this module has no input for);
// what lives here is only the version-probe mirror of it.
const RUNNER_BINARY_FALLBACK_PATHS = Object.freeze({
  kimi: ['.kimi-code/bin/kimi'],
});

// `anthropic-compatible` drives dispatch-anthropic-review.js over HTTP; there is no
// runner binary at all. The map keeps `claude` for it only to preserve the historical
// src/readiness/probe.js behavior byte-for-byte. It is NOT a sweep-viable runner
// (dispatch-hetero.sh accepts codex|agy|grok|cc-shim|pi|qoderclicn|cursor only), so the
// sweep never reaches it. Flagged here rather than silently "fixed": changing it would
// change probe.js's recorded readiness semantics, which is out of scope for this fix.

// WHAT COUNTS AS A VERSION — a POSITIVE grammar, not "contains digits somewhere".
//
// A bare `/\d+\.\d+/` anywhere-in-line is too loose (hetero review, codex/gpt-5.6-sol,
// 2026-08-27): a short diagnostic like `Cannot start: requires Node 18.0` carries a
// `digit.digit` and would have been minted into a paid identity. So the line must contain
// a token that IS a version, and it must appear at the FRONT of the line where every real
// banner puts it.
//
// A version TOKEN: optional `v`, then dotted numerics (>= major.minor), then an optional
// build/pre-release suffix. Observed real outputs, all satisfied:
//   2026.08.25-3e8eec8 (cursor-agent) | 2.0.44 (claude) | 0.31.0 (codex-cli) |
//   0.0.34 (grok) | v22.14.0 (node)
const VERSION_TOKEN_SHAPE = /^v?\d+\.\d+(?:\.\d+)*(?:[-+.][0-9A-Za-z][0-9A-Za-z.+-]*)?$/;

// The version token must be one of the first N whitespace tokens. Every real banner puts
// it first or second: `2026.08.25-3e8eec8` (1), `codex-cli 0.31.0` (2), `Version: 1.2.3`
// (2 — the colon attaches to the label). Two, not three: at three, `Requires Node 18.0`
// is accepted and becomes the token `Requires-Node-18.0` — a short requirement diagnostic
// minted into a paid identity, which is the exact failure class this module exists to
// stop. (Found by the first-pass QC panel, codex/gpt-5.6-sol, 2026-08-27; the original
// fixture missed it because `Cannot start: requires Node 18.0` is refused for a different
// reason — its version token sits fifth.)
const VERSION_TOKEN_MAX_POSITION = 2;

// Position alone is not enough: `Node 18.0 required` puts a version token second. A
// version banner states an identity; these words only appear when a line is instead
// stating a REQUIREMENT or a FAILURE. Anywhere in the line refuses.
const DIAGNOSTIC_WORDS = /\b(requires?|required|requiring|needs?|needed|unsupported|unable|cannot|can't|could\s?not|missing|not\s+installed|install|upgrade|update|please|failed|failure|invalid|denied|expired|unknown\s+option|must)\b/i;

// A version banner is a label, not a sentence. Six whitespace tokens is already generous
// for `2.0.44 (Claude Code)` (3) or `codex-cli 0.31.0` (2).
const MAX_VERSION_LINE_TOKENS = 6;

// Pre-sanitization length cap. Every real version banner observed is far under this; the
// cursor error that caused the incident was 78 characters.
const MAX_VERSION_LINE_LENGTH = 64;

// Refusal markers: a line that ANNOUNCES itself as an error is never a version, even if
// it happens to carry a numeric-looking substring (a file:line, a URL, a stack frame).
const ERROR_PREFIX = /^(error|fatal|usage|panic|exception|traceback|warning|command not found|no such file)\b/i;

// A URL or a filesystem-ish path in the line means a diagnostic, never a version banner.
const DIAGNOSTIC_MARKER = /:\/\/|\bat\s+\/|^\s*at\s/i;

// Punctuation a banner may wrap a token in, stripped before matching the token shape.
const TOKEN_TRIM = /^[([{'"`,;]+|[)\]}'"`,;]+$/g;

// Any C0/C1 control byte surviving VT stripping. A version banner has none.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;

const VERSION_PROBE_TIMEOUT_MS = 20000;

/**
 * Remove ANSI/VT colouring and any remaining control bytes.
 *
 * util.stripVTControlCharacters is a Node built-in (>= 20.10, the repo floor). The
 * belt-and-braces control-byte pass covers sequences it does not model — the point is
 * that NOTHING non-printable can reach validation or the token, because a token carrying
 * `31m`/`0m` escape parameters is a deployment identity that changes with the caller's TTY.
 */
function stripVersionControlChars(raw) {
  let out = String(raw);
  try {
    out = require('util').stripVTControlCharacters(out);
  } catch { /* fall through to the raw control strip below */ }
  // eslint-disable-next-line no-control-regex
  return out.replace(/\u001B\[[0-9;?]*[ -\/]*[@-~]/g, '');
}

/**
 * The version binary for a runner token, or null when the runner is unknown.
 * Returning null (never the runner token) is what makes the caller fail closed.
 */
function versionBinaryFor(runner) {
  if (typeof runner !== 'string' || runner === '') return null;
  return Object.prototype.hasOwnProperty.call(RUNNER_VERSION_BINARY, runner)
    ? RUNNER_VERSION_BINARY[runner]
    : null;
}

/** Every runner token this map knows, sorted — for usage text and tests. */
function knownRunners() {
  return Object.keys(RUNNER_VERSION_BINARY).sort();
}

/** Absolute path of `binary` on PATH (or a runner's well-known fallback), else null. */
function resolveBinaryPath(binary, runner) {
  if (binary.includes(path.sep)) {
    try {
      fs.accessSync(binary, fs.constants.X_OK);
      return path.resolve(binary);
    } catch { return null; }
  }
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, binary);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* keep scanning */ }
  }
  const home = process.env.HOME || '';
  for (const rel of (RUNNER_BINARY_FALLBACK_PATHS[runner] || [])) {
    if (!home) break;
    const candidate = path.join(home, rel);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* next */ }
  }
  return null;
}

/**
 * Reduce a validated version line to the identity-token charset. Runs ONLY after
 * validation — sanitizing first is exactly how an error sentence became a token.
 */
function sanitizeVersionToken(line) {
  return stripVersionControlChars(String(line))
    .replace(/[^A-Za-z0-9._:-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

/**
 * Does this stdout line look like a version? Conservative on purpose — every `false`
 * costs a refused (free) seat, every wrong `true` costs a paid, permanently wrong row.
 * Returns null when acceptable, or a reason string when it must be refused.
 */
function versionLineRefusalReason(line) {
  // Strip ANSI/VT colouring FIRST. A colour-wrapped line otherwise dodges the anchored
  // error check (the escape sequence precedes the word "Error") and, worse, would mint a
  // token carrying `31m` / `0m` escape parameters — an unstable deployment identity that
  // changes with the caller's TTY. (hetero review, codex/gpt-5.6-sol, 2026-08-27.)
  const stripped = stripVersionControlChars(String(line == null ? '' : line)).trim();
  if (stripped === '') return 'version_empty';
  // Anything still non-printable after stripping is not something to mint an identity from.
  // eslint-disable-next-line no-control-regex
  if (CONTROL_CHARS.test(stripped)) return 'version_control_characters';
  // Self-announced errors and diagnostics are checked BEFORE the length cap so the
  // refusal reason names what the line actually is. The incident string trips both.
  if (ERROR_PREFIX.test(stripped)) return 'version_looks_like_an_error';
  if (DIAGNOSTIC_MARKER.test(stripped)) return 'version_looks_like_a_diagnostic';
  if (DIAGNOSTIC_WORDS.test(stripped)) return 'version_states_a_requirement_or_failure';
  if (stripped.length > MAX_VERSION_LINE_LENGTH) {
    return `version_too_long_${stripped.length}_over_${MAX_VERSION_LINE_LENGTH}`;
  }
  const tokens = stripped.split(/\s+/).filter(Boolean);
  if (tokens.length > MAX_VERSION_LINE_TOKENS) return 'version_line_is_a_sentence';
  const found = tokens
    .slice(0, VERSION_TOKEN_MAX_POSITION)
    .some((t) => VERSION_TOKEN_SHAPE.test(t.replace(TOKEN_TRIM, '')));
  if (!found) return 'version_not_version_shaped';
  if (sanitizeVersionToken(stripped) === '') return 'version_token_empty_after_sanitize';
  return null;
}

/**
 * Resolve a runner's identity version token, failing closed at every step.
 *
 * -> { ok: true,  runner, binary, binary_path, version_line, token }
 * -> { ok: false, runner, binary, binary_path, version_line, reason, stderr }
 *
 * `spawn` is injectable so tests can drive the guard without a real binary.
 */
function resolveRunnerVersion(runner, options = {}) {
  const spawn = options.spawn || spawnSync;
  const binary = versionBinaryFor(runner);
  if (binary === null) {
    // Fail closed: an unknown runner does NOT fall through to its own name.
    return { ok: false, runner, binary: null, binary_path: null, version_line: '', reason: 'unknown_runner', stderr: '' };
  }
  const binaryPath = resolveBinaryPath(binary, runner);
  if (binaryPath === null) {
    return { ok: false, runner, binary, binary_path: null, version_line: '', reason: 'missing_binary', stderr: '' };
  }
  const run = spawn(binaryPath, ['--version'], {
    encoding: 'utf8',
    timeout: VERSION_PROBE_TIMEOUT_MS,
    // stdout and stderr stay SEPARATE. Folding them (`2>&1`) is half the original bug:
    // it let a stderr diagnostic be read as the version.
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stderr = String(run.stderr || '').trim().slice(0, 400);
  if (run.error) {
    const code = run.error.code === 'ETIMEDOUT' ? 'version_probe_timeout' : 'version_probe_failed';
    return { ok: false, runner, binary, binary_path: binaryPath, version_line: '', reason: code, stderr };
  }
  if (run.status !== 0) {
    return {
      ok: false, runner, binary, binary_path: binaryPath, version_line: '',
      reason: `version_probe_exit_${run.status === null ? 'signal' : run.status}`, stderr,
    };
  }
  // STDOUT ONLY, first non-empty line.
  const line = String(run.stdout || '').split('\n').map((s) => s.trim()).find((s) => s !== '') || '';
  const refusal = versionLineRefusalReason(line);
  if (refusal !== null) {
    return { ok: false, runner, binary, binary_path: binaryPath, version_line: line, reason: refusal, stderr };
  }
  return { ok: true, runner, binary, binary_path: binaryPath, version_line: line, token: sanitizeVersionToken(line) };
}

/**
 * Reduce a value to something safe to interpolate into a one-line JSON string field and
 * to read back with a single `read -r` in shell: no control characters (so no newline can
 * forge an extra field or an extra shell line), no `"` or `\` (so no JSON escape can be
 * forged). Used for the probe receipt's `bin` / `bin_version`, which now carry real CLI
 * output rather than a sanitized-to-death token.
 */
function receiptSafe(value) {
  return stripVersionControlChars(String(value == null ? '' : value))
    .replace(/["\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  RUNNER_VERSION_BINARY,
  receiptSafe,
  MAX_VERSION_LINE_LENGTH,
  versionBinaryFor,
  knownRunners,
  resolveBinaryPath,
  stripVersionControlChars,
  sanitizeVersionToken,
  versionLineRefusalReason,
  resolveRunnerVersion,
};

// --- CLI -------------------------------------------------------------------
// Shell callers (qualification-sweep.sh) use these subcommands so the map has exactly
// one owner across both languages.
//
//   binary  --runner <r>            -> stdout: version binary name.  exit 0 | 2 usage | 3 unknown runner
//   version --runner <r> [--json]   -> stdout: identity token.       exit 0 | 2 usage | 3 REFUSED
//
// Exit 3 is the fail-closed refusal; the reason goes to stderr (or to the --json object).
if (require.main === module) {
  const argv = process.argv.slice(2);
  const usage = 'usage: runner-binary.js <binary|version> --runner <runner> [--json]\n'
    + `       runners: ${knownRunners().join(' ')}\n`;
  const sub = argv[0];
  let runner = '';
  let asJson = false;
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--runner') { runner = argv[i + 1] || ''; i += 1; } else if (argv[i] === '--json') { asJson = true; } else {
      process.stderr.write(`unknown argument: ${argv[i]}\n${usage}`);
      process.exit(2);
    }
  }
  if ((sub !== 'binary' && sub !== 'version') || runner === '') {
    process.stderr.write(usage);
    process.exit(2);
  }
  if (sub === 'binary') {
    const binary = versionBinaryFor(runner);
    if (binary === null) {
      process.stderr.write(`unknown runner: ${runner} (no version-binary mapping; refusing to guess)\n`);
      process.exit(3);
    }
    process.stdout.write(`${binary}\n`);
    process.exit(0);
  }
  const result = resolveRunnerVersion(runner);
  if (asJson) process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) {
    if (!asJson) {
      process.stderr.write(`REFUSED runner=${runner} binary=${result.binary || 'n/a'} reason=${result.reason}`
        + `${result.version_line ? ` line=${JSON.stringify(result.version_line)}` : ''}`
        + `${result.stderr ? ` stderr=${JSON.stringify(result.stderr)}` : ''}\n`);
    }
    process.exit(3);
  }
  if (!asJson) process.stdout.write(`${result.token}\n`);
  process.exit(0);
}
