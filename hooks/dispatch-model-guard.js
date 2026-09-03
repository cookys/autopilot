#!/usr/bin/env node
/**
 * dispatch-model-guard — PreToolUse/Task|Agent [default-on since v2.35.15; opt-in before]
 * Intercepts subagent dispatch and returns permissionDecision: "ask" when the
 * dispatch would land on a guarded expensive engine (default: fable) or when
 * model is omitted (would silently inherit the session model).
 *
 * Headless (`claude -p`) behavior — verified 2026-09-04 on CC 2.1.259, both with and
 * without --dangerously-skip-permissions: an "ask" from a PreToolUse hook does NOT wedge
 * the run; CC turns it into an immediate is_error tool_result carrying
 * permissionDecisionReason, so the model sees why and can re-dispatch with `model:`.
 * No headless downgrade to "deny" is needed (BACKLOG entry closed on that evidence).
 * Signal, if ever needed: CLAUDE_CODE_ENTRYPOINT is `sdk-cli` under -p vs `cli`
 * interactive (observed, undocumented).
 *
 * Fail-open on unreadable payloads / internal errors (spend control, not a
 * security boundary). Config: DISPATCH_GUARD_CONFIG_OVERRIDE or
 * <cwd>/.claude/dispatch-guard-config.md (see project-config-template/).
 */

'use strict';

const fs = require('fs');
const path = require('path');
// default-on since v2.35.15 (was opt-in). Opt out: AUTOPILOT_DISPATCH_MODEL_GUARD_MODE=off
// (or `- mode: off` in .claude/dispatch-guard-config.md). The 2026-09-04 cuda quota digest:
// subagents inherited the session's [1m] Fable model because nothing asked.
if (process.env.AUTOPILOT_DISPATCH_MODEL_GUARD_MODE === 'off') process.exit(0);

const DEFAULTS = {
  guarded_models: ['fable'],
  on_missing_model: 'ask',
  mode: 'ask',
};

function parseConfigText(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*-\s*([A-Za-z0-9_]+)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2];
  }
  return out;
}

function loadConfig(cwd) {
  const candidates = [];
  if (process.env.DISPATCH_GUARD_CONFIG_OVERRIDE) {
    candidates.push(process.env.DISPATCH_GUARD_CONFIG_OVERRIDE);
  }
  if (cwd) {
    candidates.push(path.join(cwd, '.claude', 'dispatch-guard-config.md'));
  }

  let raw = null;
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        raw = fs.readFileSync(p, 'utf8');
        break;
      }
    } catch {
      // try next candidate
    }
  }

  const parsed = raw ? parseConfigText(raw) : {};

  // guarded_models: comma-separated tokens; empty/garbage → default
  let guarded = DEFAULTS.guarded_models;
  if (Object.prototype.hasOwnProperty.call(parsed, 'guarded_models')) {
    const tokens = String(parsed.guarded_models || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    guarded = tokens.length ? tokens : DEFAULTS.guarded_models;
  }

  // on_missing_model: ask | allow; garbage → ask (fail-closed)
  let onMissing = DEFAULTS.on_missing_model;
  if (Object.prototype.hasOwnProperty.call(parsed, 'on_missing_model')) {
    const v = String(parsed.on_missing_model || '').trim().toLowerCase();
    onMissing = (v === 'ask' || v === 'allow') ? v : 'ask';
  }

  // mode: ask | warn | off; garbage → ask (fail-closed)
  let mode = DEFAULTS.mode;
  if (Object.prototype.hasOwnProperty.call(parsed, 'mode')) {
    const v = String(parsed.mode || '').trim().toLowerCase();
    mode = (v === 'ask' || v === 'warn' || v === 'off') ? v : 'ask';
  }

  return { guarded_models: guarded, on_missing_model: onMissing, mode };
}

function emitAsk(reason) {
  const payload = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(payload) + '\n');
  process.exit(0);
}

function handleGuard(reason, mode) {
  if (mode === 'warn') {
    process.stderr.write(reason + '\n');
    process.exit(0);
  }
  // mode === 'ask' (default path)
  emitAsk(reason);
}

try {
  let input;
  try {
    // Read fd 0 directly — opening the '/dev/stdin' PATH throws ENXIO in the
    // Bun-spawned hook environment (verified 2.1.186), but fd 0 carries the payload.
    // Same fallback chain as branch-protection.js. #6305.
    let raw;
    try {
      raw = fs.readFileSync(0, 'utf8');
    } catch {
      raw = fs.readFileSync('/dev/stdin', 'utf8');
    }
    input = JSON.parse(raw);
    if (!input || typeof input !== 'object') {
      throw new Error('payload is not an object');
    }
  } catch {
    process.stderr.write(
      'dispatch-model-guard: unreadable payload — allowing (fail-open)\n'
    );
    process.exit(0);
  }

  const toolName = String(input.tool_name || '');
  if (toolName !== 'Agent' && toolName !== 'Task') {
    process.exit(0);
  }

  const cwd = input.cwd || process.cwd();
  const config = loadConfig(cwd);

  if (config.mode === 'off') {
    process.exit(0);
  }

  const toolInput = input.tool_input || {};
  const modelRaw = String(toolInput.model || '').trim();
  const model = modelRaw.toLowerCase();

  if (model) {
    const hit = config.guarded_models.some((token) => model.includes(token));
    if (hit) {
      handleGuard(
        `dispatch-model-guard: model '${modelRaw}' is a guarded expensive engine — approve, or re-dispatch with a cheaper model per scripts/resolve-dispatch.sh`,
        config.mode
      );
    }
    process.exit(0);
  }

  // model empty
  if (config.on_missing_model === 'allow') {
    process.exit(0);
  }

  handleGuard(
    'dispatch-model-guard: no model specified — the subagent would inherit the session model (possibly a guarded engine); re-dispatch with an explicit model: (see scripts/resolve-dispatch.sh) or approve',
    config.mode
  );
} catch (e) {
  process.stderr.write(
    `dispatch-model-guard: unexpected error — allowing (fail-open): ${e.message}\n`
  );
  process.exit(0);
}
