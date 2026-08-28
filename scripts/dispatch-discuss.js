#!/usr/bin/env node
'use strict';

// dispatch-discuss.js — the discuss consumer (plan
// docs/plans/2026-08-28-consult-discuss-qualification.md, D9). The minimal
// executable consumer of the "discuss" qualification seat: the smallest
// thing that is genuinely a discussion voice, not a second consult.
//
// THIS SCRIPT IS THE EXECUTABLE DECISION POINT (finding [6]). Switch
// resolution (discuss_dispatch, from the resolved review-loop config) and
// dispatch invocation both live HERE. skills/think-tank/SKILL.md carries
// exactly one step that invokes this wrapper UNCONDITIONALLY and uses
// whatever it returns — it must not re-implement the guard, because prose in
// a SKILL.md is not control flow a shell test can drive.
//
// Contract:
//   - discuss_dispatch: off (or the resolver itself denies the seat, e.g.
//     the D7 switch-on qualification gate) => exit non-zero BEFORE any
//     transport process is spawned. Never a silent no-op, never a
//     fabricated contribution.
//   - Input: a STATELESS round bundle (--bundle-file), the same shape the
//     brain exam's round bundles already use (evals/discuss-eval-
//     generator.js): { round_id, question, transcript, artifacts, axes,
//     taken_axes }. Multi-turn-ness lives in the bundle; the rail itself is
//     stateless.
//   - Transport: scripts/dispatch-author.sh (raw-prompt rail), NOT
//     dispatch-review.sh — the review transport wraps a verdict protocol a
//     discuss contribution must never carry (2026-07-02 l6/N2 incident).
//   - Output: ONE positional contribution, the CLOSED production schema:
//     { round_id, axis_id, claim_vector, position, risk_tags, anchors }.
//     `axis_id` + `claim_vector` are the NORMATIVE, structured contribution;
//     `position` is display prose, never itself the graded/validated object
//     beyond being a string with no verdict token in it.
//   - Single-contribution semantics: one dispatch call produces exactly one
//     contribution. This is a single evidence draw, not a chat loop — no
//     bounded multi-round production hook exists here or anywhere else.
//   - Advisory only: this rail can never emit or imply a qc convergence
//     verdict (SHIP-AS-IS and siblings, checked in round_id AND position).
//   - Fail-closed: a non-zero rail exit, empty capture, timeout, or a
//     response that fails the closed-schema validation is ALL "no
//     contribution" — this script exits non-zero, invents nothing, and the
//     caller (think-tank) proceeds without the external contribution.
//
// Usage:
//   scripts/dispatch-discuss.js --bundle-file <path>
//       [--repo-root <dir>] [--timeout <duration>]
//       [--dispatch-author-bin <path>] [--resolve-review-loop-bin <path>]
//
// Test seams (explicit override, same family as --bin elsewhere in this
// repo — no PATH-shadowing magic):
//   AUTOPILOT_DISPATCH_AUTHOR_BIN / --dispatch-author-bin
//       overrides the scripts/dispatch-author.sh path.
//   AUTOPILOT_RESOLVE_REVIEW_LOOP_BIN / --resolve-review-loop-bin
//       overrides the scripts/resolve-review-loop.sh path.
//   AUTOPILOT_DISCUSS_TIMEOUT overrides the default --timeout (5m).
//
// Output: on success (exit 0), the closed-schema contribution JSON on
// stdout, nothing else. On failure, a single-line diagnostic on stderr and
// no stdout.
//
// Exit codes:
//   0 = contribution emitted
//   2 = usage error / malformed --bundle-file / discuss_dispatch is off /
//       resolver reported a usage-level (exit 2) config problem
//   3 = the resolver denied the seat (exit 3 — e.g. the D7 switch-on
//       qualification gate, or an empty seat tuple); the resolver's own
//       stderr is surfaced verbatim, never reinvented here
//   4 = rail failure: dispatch-author.sh spawn/exit failure, empty output,
//       timeout, or the engine's response failed closed-schema validation
//       (protocol_violation-equivalent) — all fail-closed the same way

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SELF_DIR = __dirname;
const { extractJsonObject } = require(path.join(SELF_DIR, 'lib', 'extract-json-object.js'));

// Closed production schema (docs/plans/2026-08-28-consult-discuss-
// qualification.md D9). These three constants deliberately duplicate the
// same-valued constants in evals/discuss-capability-evidence-corpus.json
// rather than requiring that file: the schema is a SHARED CONTRACT the
// production rail and the exam both must honor, but the exam corpus/broker/
// provider stay exam-only (plan D2) and production code must not depend
// backward into eval assets.
const RESPONSE_KEYS = ['round_id', 'axis_id', 'claim_vector', 'position', 'risk_tags', 'anchors'].sort();
const RISK_TAGS = new Set(['critical', 'important', 'minor']);
const VERDICT_TOKENS = ['ship-it', 'no-ship', 'go/no-go', 'verdict:', 'qc@depth-0', 'ship-as-is', 'fix-then-ship'];

function usageError(message) {
  process.stderr.write(`dispatch-discuss: ${message}\n`);
  process.exit(2);
}

function railFailure(message) {
  process.stderr.write(`dispatch-discuss: ${message}\n`);
  process.exit(4);
}

function parseArgs(argv) {
  const opts = {
    bundleFile: '',
    repoRoot: '',
    timeout: process.env.AUTOPILOT_DISCUSS_TIMEOUT || '5m',
    dispatchAuthorBin: process.env.AUTOPILOT_DISPATCH_AUTHOR_BIN || path.join(SELF_DIR, 'dispatch-author.sh'),
    resolveReviewLoopBin: process.env.AUTOPILOT_RESOLVE_REVIEW_LOOP_BIN || path.join(SELF_DIR, 'resolve-review-loop.sh'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--bundle-file':
        opts.bundleFile = argv[++i] || '';
        break;
      case '--repo-root':
        opts.repoRoot = argv[++i] || '';
        break;
      case '--timeout':
        opts.timeout = argv[++i] || '';
        break;
      case '--dispatch-author-bin':
        opts.dispatchAuthorBin = argv[++i] || '';
        break;
      case '--resolve-review-loop-bin':
        opts.resolveReviewLoopBin = argv[++i] || '';
        break;
      case '-h':
      case '--help':
        process.stdout.write([
          'Usage: scripts/dispatch-discuss.js --bundle-file <path>',
          '           [--repo-root <dir>] [--timeout <duration>]',
          '           [--dispatch-author-bin <path>] [--resolve-review-loop-bin <path>]',
          '',
          'Exit: 0 contribution emitted / 2 usage or switch-off / 3 resolver denied seat',
          '      / 4 rail failure (fail-closed; no contribution)',
        ].join('\n') + '\n');
        process.exit(0);
        break; // eslint-disable-line no-unreachable
      default:
        usageError(`unknown arg: ${arg}`);
    }
  }
  return opts;
}

function readBundle(bundleFile) {
  if (!bundleFile) usageError('--bundle-file is required');
  let raw;
  try {
    raw = fs.readFileSync(bundleFile, 'utf8');
  } catch (e) {
    usageError(`cannot read --bundle-file ${bundleFile}: ${e.message}`);
  }
  let bundle;
  try {
    bundle = JSON.parse(raw);
  } catch (e) {
    usageError(`--bundle-file is not valid JSON: ${e.message}`);
  }
  return bundle;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

// Validates the STATELESS round bundle shape (finding: the bundle carries
// the declared axis set, each axis's claim-token vector, and the
// already-taken axes, so every downstream check is a set operation, not an
// inference). Malformed => usage error (exit 2), never a silent default.
function validateBundle(bundle) {
  if (bundle === null || typeof bundle !== 'object' || Array.isArray(bundle)) {
    usageError('bundle must be a JSON object');
  }
  if (!isNonEmptyString(bundle.round_id)) usageError('bundle.round_id must be a non-empty string');
  if (typeof bundle.question !== 'string') usageError('bundle.question must be a string');

  if (!Array.isArray(bundle.transcript)) usageError('bundle.transcript must be an array');
  bundle.transcript.forEach((turn, idx) => {
    if (turn === null || typeof turn !== 'object' || Array.isArray(turn)) {
      usageError(`bundle.transcript[${idx}] must be an object`);
    }
    if (typeof turn.role !== 'string' || turn.role === '') usageError(`bundle.transcript[${idx}].role must be a non-empty string`);
    if (typeof turn.position !== 'string') usageError(`bundle.transcript[${idx}].position must be a string`);
    if (!Array.isArray(turn.risk_tags)) usageError(`bundle.transcript[${idx}].risk_tags must be an array`);
    if (!Array.isArray(turn.anchors)) usageError(`bundle.transcript[${idx}].anchors must be an array`);
  });

  if (!Array.isArray(bundle.artifacts)) usageError('bundle.artifacts must be an array');
  const artifactIds = new Set();
  bundle.artifacts.forEach((a, idx) => {
    if (a === null || typeof a !== 'object' || Array.isArray(a) || !isNonEmptyString(a.id)) {
      usageError(`bundle.artifacts[${idx}] must be an object with a non-empty string id`);
    }
    artifactIds.add(a.id);
  });

  if (!Array.isArray(bundle.axes) || bundle.axes.length === 0) usageError('bundle.axes must be a non-empty array');
  const axisIds = new Set();
  bundle.axes.forEach((a, idx) => {
    if (a === null || typeof a !== 'object' || Array.isArray(a) || !isNonEmptyString(a.id)) {
      usageError(`bundle.axes[${idx}] must be an object with a non-empty string id`);
    }
    if (axisIds.has(a.id)) usageError(`bundle.axes has a duplicate axis id: ${a.id}`);
    axisIds.add(a.id);
    if (!Array.isArray(a.claim_vector) || a.claim_vector.length === 0 || !a.claim_vector.every((t) => isNonEmptyString(t))) {
      usageError(`bundle.axes[${idx}].claim_vector must be a non-empty array of non-empty strings`);
    }
  });

  if (!Array.isArray(bundle.taken_axes)) usageError('bundle.taken_axes must be an array');
  bundle.taken_axes.forEach((a) => {
    if (!isNonEmptyString(a) || !axisIds.has(a)) usageError(`bundle.taken_axes references an undeclared axis: ${JSON.stringify(a)}`);
  });

  return { artifactIds, axisIds, axisVector: new Map(bundle.axes.map((a) => [a.id, new Set(a.claim_vector)])) };
}

function runNode(bin, args, opts) {
  return spawnSync(bin, args, Object.assign({ encoding: 'utf8' }, opts || {}));
}

// Resolves discuss_dispatch + the discuss seat tuple. Fail-closed at every
// branch: a resolver usage error is exit 2, a resolver denial (D7's
// switch-on qualification gate, an empty seat tuple, or any other exit-3
// admission refusal) is exit 3 surfaced verbatim — this script invents no
// message of its own for that branch (plan D9: "the script surfaces that
// message rather than inventing its own").
function resolveDiscussSeat(opts) {
  const env = Object.assign({}, process.env);
  const spawnOpts = { encoding: 'utf8' };
  if (opts.repoRoot) {
    spawnOpts.cwd = opts.repoRoot;
    env.REVIEW_LOOP_CONFIG_OVERRIDE = path.join(opts.repoRoot, '.claude', 'review-loop-config.md');
  }
  spawnOpts.env = env;

  const result = spawnSync('bash', [opts.resolveReviewLoopBin], spawnOpts);
  if (result.error) {
    process.stderr.write(`dispatch-discuss: failed to invoke resolve-review-loop.sh: ${result.error.message}\n`);
    process.exit(3);
  }
  const stderrText = (result.stderr || '').trim();
  if (result.status !== 0) {
    if (stderrText) process.stderr.write(`${stderrText}\n`);
    process.exit(result.status === 2 ? 2 : 3);
  }

  let resolved;
  try {
    resolved = JSON.parse(result.stdout);
  } catch (e) {
    process.stderr.write(`dispatch-discuss: resolve-review-loop.sh emitted non-JSON output: ${e.message}\n`);
    process.exit(3);
  }

  return resolved;
}

function buildPromptFile(bundle) {
  const promptLines = [
    'You are one external, decorrelated voice contributing to a single round of a',
    'multi-role internal debate. You are being asked for ONE positional',
    'contribution to this round — not a conversation, not a revision of a prior',
    'turn of your own (you have never spoken in this debate before this call).',
    '',
    'This is advisory input only. You are NOT a reviewer, you never issue a',
    'ship/no-ship verdict of any kind, and your output is never treated as a',
    'convergence decision.',
    '',
    `Question under debate: ${bundle.question}`,
    '',
    'Prior transcript (read-only; you cannot revise these turns):',
    JSON.stringify(bundle.transcript, null, 2),
    '',
    'Artifacts available to cite as anchors (cite only ids from this list):',
    JSON.stringify(bundle.artifacts.map((a) => ({ id: a.id, kind: a.kind, text: a.text })), null, 2),
    '',
    'Declared debate axes and, for each, the claim tokens available to that axis',
    '(your claim_vector must draw from exactly the axis you select):',
    JSON.stringify(bundle.axes, null, 2),
    '',
    `Axes already taken by another role in this transcript (you must NOT select`,
    `one of these): ${JSON.stringify(bundle.taken_axes)}`,
    '',
    'Respond with EXACTLY ONE JSON object and nothing else — no prose before or',
    'after it, no markdown code fence. The object must have exactly these keys:',
    '  round_id   — echo this exact string back: ' + JSON.stringify(bundle.round_id),
    '  axis_id    — exactly one axis id, from the declared axes above, that is',
    '               NOT in the already-taken list',
    '  claim_vector — a non-empty array of claim-token strings, drawn only from',
    '               the claim_vector of the axis you selected',
    '  position   — a short prose statement of your position (display only)',
    '  risk_tags  — a non-empty array using only: critical, important, minor',
    '  anchors    — an array of artifact ids from the list above that support',
    '               your position (may be empty)',
    '',
    'Never include a ship/no-ship verdict token, in any field, in any form.',
  ];
  const promptPath = path.join(os.tmpdir(), `dispatch-discuss-prompt-${crypto.randomBytes(6).toString('hex')}.txt`);
  fs.writeFileSync(promptPath, promptLines.join('\n'), 'utf8');
  return promptPath;
}

function timeoutToMs(timeout) {
  const m = /^(\d+)(s|m|h)?$/.exec(String(timeout || '').trim());
  if (!m) return 5 * 60 * 1000;
  const n = parseInt(m[1], 10);
  const unit = m[2] || 's';
  const mult = unit === 'h' ? 3600000 : unit === 'm' ? 60000 : 1000;
  return n * mult;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const bundle = readBundle(opts.bundleFile);
  const { artifactIds, axisIds, axisVector } = validateBundle(bundle);

  const resolved = resolveDiscussSeat(opts);

  const discussDispatch = resolved.discuss_dispatch;
  if (discussDispatch !== 'on') {
    process.stderr.write('dispatch-discuss: discuss_dispatch is off — refusing before any transport spawn\n');
    process.exit(2);
  }

  const engine = resolved.discuss_engine;
  const runner = resolved.discuss_runner;
  const effort = resolved.discuss_effort;
  const endpoint = resolved.discuss_endpoint;
  if (!isNonEmptyString(engine) || !isNonEmptyString(runner)) {
    process.stderr.write('dispatch-discuss: discuss_dispatch is on but discuss_engine/discuss_runner is empty — resolver should have refused this; refusing here too\n');
    process.exit(3);
  }

  const promptPath = buildPromptFile(bundle);
  const argv = ['--runner', runner, '--model', engine, '--prompt-file', promptPath, '--timeout', opts.timeout];
  if (isNonEmptyString(effort)) argv.push('--effort', effort);
  if (isNonEmptyString(endpoint)) argv.push('--endpoint', endpoint);

  let authorResult;
  try {
    authorResult = spawnSync('bash', [opts.dispatchAuthorBin].concat(argv), {
      encoding: 'utf8',
      timeout: timeoutToMs(opts.timeout) + 15000,
    });
  } finally {
    fs.unlinkSync(promptPath);
  }

  if (authorResult.error) {
    railFailure(`dispatch-author.sh could not be invoked: ${authorResult.error.message}`);
  }
  if (authorResult.signal) {
    railFailure(`dispatch-author.sh was killed by signal ${authorResult.signal} (timeout or external kill) — no contribution`);
  }

  let authorJson;
  try {
    authorJson = JSON.parse(authorResult.stdout);
  } catch (e) {
    railFailure(`dispatch-author.sh emitted non-JSON stdout (exit ${authorResult.status}): ${(authorResult.stderr || '').trim() || e.message}`);
  }

  if (authorJson.status !== 'authored' || authorResult.status !== 0) {
    railFailure(`dispatch-author.sh did not author a response: status=${authorJson.status} exit=${authorResult.status} error=${authorJson.error || ''}`);
  }

  const rawLogPath = authorJson.raw_log;
  if (!isNonEmptyString(rawLogPath)) {
    railFailure('dispatch-author.sh reported status=authored but no raw_log path');
  }
  let rawText;
  try {
    rawText = fs.readFileSync(rawLogPath, 'utf8');
  } catch (e) {
    railFailure(`could not read raw_log ${rawLogPath}: ${e.message}`);
  }

  const extracted = extractJsonObject(rawText);
  if (!extracted) {
    railFailure('engine response did not contain a recoverable JSON object');
  }
  let contribution;
  try {
    contribution = JSON.parse(extracted);
  } catch (e) {
    railFailure(`engine response JSON failed to parse: ${e.message}`);
  }

  const validationError = validateContribution(contribution, bundle, { artifactIds, axisIds, axisVector });
  if (validationError) {
    railFailure(`engine response failed closed-schema validation: ${validationError}`);
  }

  process.stdout.write(JSON.stringify(contribution) + '\n');
  process.exit(0);
}

// Closed-schema validation of the production contribution — mirrors the
// exam grader's validateSchema (evals/discuss-eval-grader.js) but reads its
// oracle facts from the BUNDLE (production has no corpus), never from the
// candidate's own answer (evidence-discipline §3: no shadow oracle).
function validateContribution(response, bundle, ctx) {
  if (response === null || typeof response !== 'object' || Array.isArray(response)) {
    return 'response is not a JSON object';
  }
  const keys = Object.keys(response).slice().sort();
  const extra = keys.filter((k) => RESPONSE_KEYS.indexOf(k) === -1);
  if (extra.length > 0) return `unknown key(s): ${extra.join(',')}`;
  const missing = RESPONSE_KEYS.filter((k) => keys.indexOf(k) === -1);
  if (missing.length > 0) return `missing key(s): ${missing.join(',')}`;

  if (typeof response.round_id !== 'string' || response.round_id === '') return 'round_id must be a non-empty string';
  if (response.round_id !== bundle.round_id) return `round_id must echo the bundle's round_id (expected ${bundle.round_id})`;
  const roundIdLower = response.round_id.toLowerCase();
  const roundIdVerdictHit = VERDICT_TOKENS.find((t) => roundIdLower.includes(t));
  if (roundIdVerdictHit) return `verdict token present in round_id: ${roundIdVerdictHit}`;

  if (typeof response.position !== 'string') return 'position must be a string';
  const positionLower = response.position.toLowerCase();
  const verdictHit = VERDICT_TOKENS.find((t) => positionLower.includes(t));
  if (verdictHit) return `verdict token present in position: ${verdictHit}`;

  if (!Array.isArray(response.risk_tags) || response.risk_tags.length === 0) return 'risk_tags must be a non-empty array';
  const badRiskTag = response.risk_tags.find((t) => !RISK_TAGS.has(t));
  if (badRiskTag !== undefined) return `wrong risk vocabulary: ${badRiskTag}`;

  if (!Array.isArray(response.claim_vector) || response.claim_vector.length === 0) return 'claim_vector must be a non-empty array';
  if (!response.claim_vector.every((t) => typeof t === 'string')) return 'claim_vector must be an array of strings';

  if (!Array.isArray(response.anchors)) return 'anchors must be an array';
  if (!response.anchors.every((a) => typeof a === 'string')) return 'anchors must be an array of strings';
  const unresolved = response.anchors.find((a) => !ctx.artifactIds.has(a));
  if (unresolved) return `unresolvable anchor: ${unresolved}`;

  if (typeof response.axis_id !== 'string' || response.axis_id === '') return 'axis_id must be exactly one string';
  if (!ctx.axisIds.has(response.axis_id)) return 'axis_id must be a declared axis';
  const takenAxes = new Set(bundle.taken_axes || []);
  if (takenAxes.has(response.axis_id)) return `axis_id already taken in transcript: ${response.axis_id}`;

  const selectedVector = ctx.axisVector.get(response.axis_id);
  const hasOwnToken = response.claim_vector.some((t) => selectedVector.has(t));
  if (!hasOwnToken) return 'claim_vector carries no token from the selected axis';

  for (const [axisId, vector] of ctx.axisVector.entries()) {
    if (axisId === response.axis_id) continue;
    if (!takenAxes.has(axisId)) continue;
    if (response.claim_vector.some((t) => vector.has(t))) {
      return `claim_vector carries a token exclusive to already-taken axis ${axisId}`;
    }
  }

  return null;
}

main();
