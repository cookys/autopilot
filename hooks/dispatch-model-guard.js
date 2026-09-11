#!/usr/bin/env node
/**
 * dispatch-model-guard — PreToolUse/Task|Agent [default-on since v2.35.15; opt-in before]
 * Intercepts subagent dispatch. Default mode `remind` (v2.36.9; was `ask`): when the
 * dispatch would land on a guarded expensive engine (default: fable) it returns
 * permissionDecision: "deny" whose reason REMINDS the dispatching agent and hands the
 * decision back to it — re-dispatch with a cheaper model, or keep the engine and mark the
 * Engine header `(intentional: <why>)`, which the guard then allows silently. No human
 * dialog either way (owner ruling 2026-09-06: the ask dialog blocked the session; the
 * agent should judge). "deny" (v2.36.2; was "ask") when model is omitted (would silently
 * inherit the session model) — the reason tells the agent to re-dispatch with model:.
 * `mode: ask` opts back into the interactive dialog.
 * Guards expensive engines during implementation dispatches (default: fable,opus via guarded_models_implementing).
 * Enforces self-declared engine headers on prompt line 1 matching the dispatch model (default: on via require_engine_header).
 *
 * Headless (`claude -p`) behavior — verified 2026-09-04 on CC 2.1.259, both with and
 * without --dangerously-skip-permissions: an "ask" from a PreToolUse hook does NOT wedge
 * the run; CC turns it into an immediate is_error tool_result carrying
 * permissionDecisionReason, so the model sees why and can re-dispatch with `model:`
 * (reviewer repro: the model may retry the same denied call ~4 times first, so an
 * omitted model: still costs a few turns — a refusal, not a wedge).
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
  guarded_models_implementing: ['fable', 'opus'],
  on_missing_model: 'deny', // v2.36.2: was 'ask' — see the comment at the missing-model branch
  require_engine_header: 'on',
  mode: 'remind', // v2.36.9: was 'ask' — remind the agent, never open a dialog
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

  // guarded_models_implementing: comma-separated tokens; empty/garbage → default
  let guardedImplementing = DEFAULTS.guarded_models_implementing;
  if (Object.prototype.hasOwnProperty.call(parsed, 'guarded_models_implementing')) {
    const tokens = String(parsed.guarded_models_implementing || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    guardedImplementing = tokens.length ? tokens : DEFAULTS.guarded_models_implementing;
  }

  // on_missing_model: deny | ask | allow; garbage → deny (fail-closed)
  let onMissing = DEFAULTS.on_missing_model;
  if (Object.prototype.hasOwnProperty.call(parsed, 'on_missing_model')) {
    const v = String(parsed.on_missing_model || '').trim().toLowerCase();
    onMissing = (v === 'deny' || v === 'ask' || v === 'allow') ? v : 'deny';
  }

  // require_engine_header: on | off; garbage → on (fail-closed)
  let requireEngineHeader = DEFAULTS.require_engine_header;
  if (Object.prototype.hasOwnProperty.call(parsed, 'require_engine_header')) {
    const v = String(parsed.require_engine_header || '').trim().toLowerCase();
    requireEngineHeader = (v === 'on' || v === 'off') ? v : 'on';
  }

  // mode: remind | ask | warn | off; garbage → remind (fail-closed, no dialog)
  let mode = DEFAULTS.mode;
  if (Object.prototype.hasOwnProperty.call(parsed, 'mode')) {
    const v = String(parsed.mode || '').trim().toLowerCase();
    mode = (v === 'remind' || v === 'ask' || v === 'warn' || v === 'off') ? v : 'remind';
  }

  return {
    guarded_models: guarded,
    guarded_models_implementing: guardedImplementing,
    on_missing_model: onMissing,
    require_engine_header: requireEngineHeader,
    mode,
  };
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

function emitDeny(reason) {
  const payload = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(payload) + '\n');
  process.exit(0);
}

// The agent acknowledges an expensive dispatch by marking the Engine header, e.g.
// `Engine: fable (intentional: plan-mode critique needs the strongest reader)`.
const INTENTIONAL_RE = /\(intentional\b[^)]*\)/i;

function handleGuard(reason, mode, { acknowledged = false } = {}) {
  if (mode === 'warn') {
    process.stderr.write(reason + '\n');
    process.exit(0);
  }
  if (mode === 'ask') {
    emitAsk(reason);
  }
  // mode === 'remind' (default since v2.36.9): the decision belongs to the dispatching
  // agent, not to a human dialog. An acknowledged dispatch proceeds silently (stderr
  // note only); an unacknowledged one is denied with the reminder and the two legal
  // re-dispatches spelled out.
  if (acknowledged) {
    process.stderr.write(reason + ' — acknowledged as intentional, allowing\n');
    process.exit(0);
  }
  emitDeny(
    reason
    + '. Your call: re-dispatch with a cheaper model (scripts/resolve-dispatch.sh --role <role>), '
    + 'or keep this engine and mark line 1 "Engine: <model> (intentional: <why>)" to proceed without a dialog',
  );
}

function handleDeny(reason, mode) {
  if (mode === 'warn') {
    process.stderr.write(reason + '\n');
    process.exit(0);
  }
  // denial on fail-closed header check (mode !== 'warn')
  emitDeny(reason);
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

  // model empty: on_missing_model policy decides outright — the header check
  // has nothing to match against and must not run (on_missing_model: allow
  // would otherwise be dead config, since the header check ran first and
  // denied before allow could take effect).
  if (!model) {
    if (config.on_missing_model === 'allow') {
      process.exit(0);
    }
    // v2.36.2: default is DENY, not ask. A missing model: is never a judgment for the
    // user — the only correct next action is the model's own re-dispatch with model:
    // set, and an interactive "ask" turned that into a permission dialog the owner had
    // to click through (2026-09-05 dogfood: depth-0 spawned a reviewer without model:,
    // the owner had to intervene). A deny carries the same reason back to the model
    // and it re-dispatches on its own. `on_missing_model: ask` keeps the old dialog.
    const reason = 'dispatch-model-guard: no model specified — the subagent would inherit the session model '
      + '(possibly a guarded engine); re-dispatch NOW with an explicit model: (scripts/resolve-dispatch.sh '
      + '--role <role>) and an "Engine: <model>" first prompt line';
    // on_missing_model: ask is the explicit opt-in to the dialog, so it asks even under
    // the default remind mode (warn stays advisory).
    if (config.on_missing_model === 'ask') handleGuard(reason, config.mode === 'remind' ? 'ask' : config.mode);
    else handleDeny(reason, config.mode);
    process.exit(0);
  }

  const promptRaw = typeof toolInput.prompt === 'string' ? toolInput.prompt : '';
  let firstLine = null;
  for (const line of promptRaw.split('\n')) {
    if (line.trim().length > 0) {
      firstLine = line;
      break;
    }
  }

  // require_engine_header check (model present)
  if (config.require_engine_header === 'on') {

    let headerMatch = false;
    if (firstLine !== null) {
      const m = firstLine.match(/^Engine:\s*(\S+)/);
      if (m) {
        const token = m[1].toLowerCase();
        if (token === model || token.startsWith(model + '@')) {
          headerMatch = true;
        }
      }
    }

    if (!headerMatch) {
      const got = firstLine !== null ? firstLine : '(none)';
      handleDeny(
        `dispatch-model-guard: prompt line 1 must be "Engine: <model>…" matching model: ${modelRaw} (got: ${got})`,
        config.mode
      );
    }
  }

  // guarded models check
  const isPlan = toolInput.mode === 'plan';
  const effectiveGuarded = isPlan
    ? config.guarded_models
    : Array.from(new Set([...config.guarded_models, ...config.guarded_models_implementing]));

  const hit = effectiveGuarded.some((token) => model.includes(token));
  if (hit) {
    const acknowledged = firstLine !== null
      && /^Engine:/.test(firstLine)
      && INTENTIONAL_RE.test(firstLine);
    handleGuard(
      `dispatch-model-guard: model '${modelRaw}' is a guarded expensive engine`,
      config.mode,
      { acknowledged },
    );
  }
  process.exit(0);
} catch (e) {
  process.stderr.write(
    `dispatch-model-guard: unexpected error — allowing (fail-open): ${e.message}\n`
  );
  process.exit(0);
}
