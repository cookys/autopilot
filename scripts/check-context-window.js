#!/usr/bin/env node
// check-context-window.js — pre-dispatch context-window gate.
//
// Answers ONE question before a hetero dispatch spends anything: does the input
// we are about to feed this engine fit inside that engine's context window?
//
// Why this exists (measured, not assumed): a read-only scan of 1231 headless
// `codex_exec` dispatch sessions (~/.codex/sessions, 90 days) found 788.0M total
// tokens of which 98.4% is input. 53 sessions (4.3%) hit a context wall and
// triggered compaction — those 53 burned 322.9M tokens = 41.0% of the entire
// corpus. 52 of the 53 were `gpt-5.3-codex-spark`, whose observed
// `model_context_window` is 121600. The cost driver is oversized input fed to a
// small-window engine, not output volume and not review-loop round count.
//
// Design posture:
//   - The estimator rounds UP. Under-estimating tokens would defeat the gate.
//   - An UNKNOWN window is NOT silently treated as a pass, but it also must not
//     make a new engine undispatchable: it is reported as its own verdict and
//     the caller decides (`--strict` turns it into a block).
//   - The built-in window table is a FALLBACK seeded from observed runtime
//     telemetry, never from vendor claims. Windows drift (the same model name
//     was observed with two different windows), so an explicit --window or a
//     recorded capability-state observation always wins.

'use strict';

const fs = require('fs');
const path = require('path');

// Bytes-per-token divisor. 3.5 is the repo's existing blended estimate for
// mixed-language codebases (skills/dev-flow/SKILL.md § Context Health Check).
// Smaller divisor => larger token estimate => the gate trips EARLIER, which is
// the safe direction. Override with --divisor for a calibrated corpus.
const DEFAULT_DIVISOR = 3.5;

// Fraction of the window we allow the input to occupy. The engine still needs
// room for its own reasoning, tool output and the response; filling the window
// with input is exactly what triggers compaction.
const DEFAULT_RATIO = 0.7;

// Observed context windows, harvested from real runs on this machine:
//   codex  — event_msg.token_count.info.model_context_window
//   grok   — sessions/*/signals.json .contextWindowTokens
// Where a model was observed with MORE than one window, the MINIMUM is recorded:
// over-stating a window would let oversized input through, which is the failure
// mode this gate exists to prevent.
const OBSERVED_WINDOWS = {
  // --- codex ---
  'gpt-5.3-codex-spark': 121600, // n=306 (258400 also seen n=2 → min wins)
  'gpt-5.4-mini': 258400, // n=1
  'gpt-5.5': 258400, // n=892
  'gpt-5.6-luna': 258400, // n=2
  'gpt-5.6-sol': 258400, // n=200 (353400 also seen n=51 → min wins)
  'gpt-5.6-terra': 258400, // n=5
  // --- grok ---
  'grok-4.5': 500000, // n=305
  'grok-build': 512000, // n=5
  'grok-composer-2.5-fast': 200000, // n=33 (512000 also seen n=26 → min wins)
};

function printStderr(s) {
  process.stderr.write(s + '\n');
}

function printUsage() {
  printStderr('usage: check-context-window.js --model <id> [--file <path>]... [--bytes <n>]...');
  printStderr('       check-context-window.js --help');
}

function printHelp() {
  process.stdout.write(`check-context-window.js — pre-dispatch context-window gate.

Estimates the token cost of the input a dispatch is about to send and compares it
against the target engine's context window. Blocks fail-closed when the input
would not fit, so an oversized dispatch becomes a decision rather than a silent
41%-of-all-tokens cost sink.

Usage:
  check-context-window.js --model <id> [--file <path>]... [--bytes <n>]... [options]

Input (repeatable, additive — all sources are summed):
  --file <path>     A file whose byte length counts toward the input estimate
                    (prompt file, diff file, skill pack, ...). Missing file is a
                    usage error, not a silent zero.
  --bytes <n>       Raw byte count to add, when the caller already knows a size
                    and does not want a second stat().

Options:
  --model <id>      Target model id. Required. Matched against the observed
                    window table after normalization (lowercase, effort suffix
                    like " (High)" stripped).
  --window <n>      Explicit context window in tokens. Highest precedence —
                    use it when the caller knows better than the table.
  --capability-state <path>
                    engine-capability-state.js store to consult for a recorded
                    context_window observation. Consulted only when --window is
                    absent. A store that does not carry the dimension yet is a
                    clean miss, not an error.
  --ratio <r>       Fraction of the window the input may occupy.
                    Default ${DEFAULT_RATIO}.
  --divisor <d>     Bytes per token. Default ${DEFAULT_DIVISOR} (repo blended
                    estimate). Smaller = more conservative.
  --strict          Treat UNKNOWN_WINDOW as a block instead of a pass.
  --json            Emit the verdict object (default; flag kept for symmetry
                    with sibling scripts).
  --quiet           Suppress the human-readable stderr line.
  --help            Show this help.

Verdicts:
  OK              Input fits within ratio x window.
  OVER_BUDGET     Input exceeds the threshold. Split the work or pick a
                  larger-window engine.
  UNKNOWN_WINDOW  No window could be resolved for this model.

Exit codes:
  0  dispatch may proceed (OK, or UNKNOWN_WINDOW without --strict)
  1  blocked (OVER_BUDGET, or UNKNOWN_WINDOW with --strict)
  2  usage error

Output schema (stdout, stable):
  { model, model_normalized, window, window_source, input_bytes,
    estimated_tokens, divisor, ratio, threshold_tokens, headroom_tokens,
    verdict, blocked, reason }
`);
}

// "Gemini 3.5 Flash (High)" -> "gemini 3.5 flash"; "GPT-5.5" -> "gpt-5.5".
// The effort suffix is dispatch metadata, not part of the model identity, and
// the window belongs to the model.
function normalizeModel(model) {
  return String(model)
    .replace(/\([^)]*\)/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function resolveFromTable(normalized) {
  if (Object.prototype.hasOwnProperty.call(OBSERVED_WINDOWS, normalized)) {
    return OBSERVED_WINDOWS[normalized];
  }
  // Also try the table keys normalized the same way, so a table key with
  // different casing still matches.
  for (const key of Object.keys(OBSERVED_WINDOWS)) {
    if (normalizeModel(key) === normalized) return OBSERVED_WINDOWS[key];
  }
  return null;
}

// Consult a capability-state store for a recorded context_window observation.
// Returns null on ANY miss (no store, unreadable, dimension absent, malformed
// row). A capability store that predates the context_window dimension is the
// normal case, not an error — resolution simply falls through to the table.
function resolveFromCapabilityState(storePath, normalized) {
  let raw;
  try {
    raw = fs.readFileSync(storePath, 'utf8');
  } catch {
    return null;
  }
  let best = null;
  let bestAt = '';
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row || typeof row !== 'object') continue;
    if (!row.model || normalizeModel(row.model) !== normalized) continue;
    const cw = row.capability && row.capability.context_window;
    if (!cw || typeof cw !== 'object') continue;
    const tokens = cw.total_tokens;
    // `unknown` must never clobber a valid signal — mirrors the merge
    // discipline in engine-capability-state.js.
    if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) continue;
    const at = typeof row.observed_at === 'string' ? row.observed_at : '';
    if (best === null || at >= bestAt) {
      best = tokens;
      bestAt = at;
    }
  }
  return best;
}

function fail(msg) {
  printStderr('check-context-window: ' + msg);
  printUsage();
  process.exit(2);
}

function main(argv) {
  const opts = {
    model: null,
    files: [],
    bytes: 0,
    window: null,
    capabilityState: null,
    ratio: DEFAULT_RATIO,
    divisor: DEFAULT_DIVISOR,
    strict: false,
    quiet: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${a} requires a value`);
      return v;
    };
    switch (a) {
      case '--help':
      case '-h':
        printHelp();
        return 0;
      case '--model':
        opts.model = next();
        break;
      case '--file':
        opts.files.push(next());
        break;
      case '--bytes': {
        const n = Number(next());
        if (!Number.isFinite(n) || n < 0) fail('--bytes must be a non-negative number');
        opts.bytes += n;
        break;
      }
      case '--window': {
        const n = Number(next());
        if (!Number.isFinite(n) || n <= 0) fail('--window must be a positive number');
        opts.window = n;
        break;
      }
      case '--capability-state':
        opts.capabilityState = next();
        break;
      case '--ratio': {
        const n = Number(next());
        if (!Number.isFinite(n) || n <= 0 || n > 1) fail('--ratio must be in (0, 1]');
        opts.ratio = n;
        break;
      }
      case '--divisor': {
        const n = Number(next());
        if (!Number.isFinite(n) || n <= 0) fail('--divisor must be a positive number');
        opts.divisor = n;
        break;
      }
      case '--strict':
        opts.strict = true;
        break;
      case '--json':
        break;
      case '--quiet':
        opts.quiet = true;
        break;
      default:
        fail(`unknown argument: ${a}`);
    }
  }

  if (!opts.model) fail('--model is required');

  let inputBytes = opts.bytes;
  for (const f of opts.files) {
    let st;
    try {
      st = fs.statSync(f);
    } catch {
      // A missing input file is a usage error: silently counting it as zero
      // would under-estimate the budget, which is the unsafe direction.
      fail(`--file not readable: ${f}`);
    }
    inputBytes += st.size;
  }

  const normalized = normalizeModel(opts.model);

  let window = null;
  let windowSource = 'unknown';
  if (opts.window !== null) {
    window = opts.window;
    windowSource = 'explicit';
  } else if (opts.capabilityState) {
    const observed = resolveFromCapabilityState(opts.capabilityState, normalized);
    if (observed !== null) {
      window = observed;
      windowSource = 'capability-state';
    }
  }
  if (window === null) {
    const fromTable = resolveFromTable(normalized);
    if (fromTable !== null) {
      window = fromTable;
      windowSource = 'observed-default-table';
    }
  }

  const estimatedTokens = Math.ceil(inputBytes / opts.divisor);

  let verdict;
  let reason;
  let thresholdTokens = null;
  let headroomTokens = null;

  if (window === null) {
    verdict = 'UNKNOWN_WINDOW';
    // Reason strings stay free of double quotes: they are embedded verbatim into
    // shell-assembled JSON by the dispatch rails, and not every rail's
    // die_precondition escapes its message (dispatch-hetero.sh does,
    // dispatch-review.sh historically did not).
    reason =
      `no context window known for model '${opts.model}'; ` +
      'pass --window, record a context_window capability observation, or add the model to the observed table';
  } else {
    thresholdTokens = Math.floor(window * opts.ratio);
    headroomTokens = thresholdTokens - estimatedTokens;
    if (estimatedTokens > thresholdTokens) {
      verdict = 'OVER_BUDGET';
      reason =
        `estimated ${estimatedTokens} input tokens exceeds ${thresholdTokens} ` +
        `(${opts.ratio} x ${window} window for '${opts.model}'); ` +
        'split the unit or dispatch to a larger-window engine';
    } else {
      verdict = 'OK';
      reason = `estimated ${estimatedTokens} input tokens fits within ${thresholdTokens}`;
    }
  }

  const blocked = verdict === 'OVER_BUDGET' || (verdict === 'UNKNOWN_WINDOW' && opts.strict);

  const out = {
    model: opts.model,
    model_normalized: normalized,
    window,
    window_source: windowSource,
    input_bytes: inputBytes,
    estimated_tokens: estimatedTokens,
    divisor: opts.divisor,
    ratio: opts.ratio,
    threshold_tokens: thresholdTokens,
    headroom_tokens: headroomTokens,
    verdict,
    blocked,
    reason,
  };

  process.stdout.write(JSON.stringify(out) + '\n');
  if (!opts.quiet && verdict !== 'OK') {
    printStderr(`check-context-window: ${verdict} — ${reason}`);
  }
  return blocked ? 1 : 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { normalizeModel, OBSERVED_WINDOWS, DEFAULT_DIVISOR, DEFAULT_RATIO };
