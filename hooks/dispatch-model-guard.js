#!/usr/bin/env node
/**
 * dispatch-model-guard — PreToolUse/Task|Agent [default-on since v2.35.15; opt-in before]
 * Intercepts subagent dispatch. Default mode `remind` (v2.36.9; was `ask`): when the
 * dispatch would land on a guarded expensive engine (default: fable) it returns
 * permissionDecision: "deny" whose reason REMINDS the dispatching agent and hands the
 * decision back to it — re-dispatch with a cheaper model, or keep the engine and mark the
 * Engine header `(intentional: <why>)`, which the guard then allows silently. No human
 * dialog either way (owner ruling 2026-09-06: the ask dialog blocked the session; the
 * agent should judge). Worker-level default (2026-11, was "deny" in v2.36.2): when `model`
 * is omitted the dispatch is ALLOWED and rewritten via `hookSpecificOutput.updatedInput`
 * to model "sonnet" (every other tool_input field verbatim), with one advisory line
 * 預設 worker 等級 sonnet (stderr + additionalContext) — a subagent that does not name a
 * model runs at worker level; local or non-Claude seats inherit their main model instead. `mode: ask`
 * opts back into the interactive dialog for guarded engines.
 * An opus/fable dispatch (any alias the cost-line normaliser recognises, see
 * isOpusFableModel) is allowed only when the brief's first 8 lines carry a non-empty
 * `Model-Reason: <why>` line; otherwise it is denied naming the line to add, and the
 * Model-Reason line also acknowledges the guarded-engine check (like `(intentional: …)` —
 * which alone no longer suffices for opus/fable). Every opus/fable dispatch that reaches
 * that gate appends one JSONL line {ts, session, lane, model, reason|null, allowed} to
 * ${AUTOPILOT_STATE_DIR:-$HOME/.local/state/autopilot}/brain-tier-dispatch.jsonl
 * (fail-open on write; read by scripts/brain-tier-report.js for the PM's daily report).
 * Guards expensive engines during implementation dispatches (default: fable,opus via guarded_models_implementing).
 * Enforces self-declared engine headers on prompt line 1 matching the dispatch model (default: on via require_engine_header).
 * Requires a Cost line in the first 6 lines when the effective model is fable or opus
 * (default: on via require_cost_line). An `(intentional: …)` Engine header does not skip it.
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
const os = require('os');
const path = require('path');
const {
  BRIEF_HEADER_TEMPLATE,
  LANE_RE,
  hasBriefLane,
  briefSizeFromHead,
  hasValidUsedBy,
  hasStagesHeader,
  stagesLineForSize,
  headerDenialSuffix,
  missingCostLine,
  costLineFor,
  isOpusFableModel,
} = require('./lib/brief-header-template.js');
const { BRIEF_HEAD_WINDOW, headLines, findHeadMatch } = require('./lib/brief-head.js');
const { gateHint } = require('./lib/gate-hint.js');
const { isPmConsole, pmConsoleStatus } = require('./_shared/pm-console.js');
const { resolvePmGate, findTaskId } = require('../scripts/lib/fleet-task-ref.js');
const { resolveFleetSeat } = require('./_shared/fleet-seat.js');
const { ensurePrivateDir } = require('../scripts/lib/runtime-paths.js');
const { stateDir } = require('../scripts/lib/state-dir.js');
const { SEEN_AT_FRESH_MS } = require('../scripts/lib/pace-reading.js');
// default-on since v2.35.15 (was opt-in). Opt out: AUTOPILOT_DISPATCH_MODEL_GUARD_MODE=off
// (or `- mode: off` in .claude/dispatch-guard-config.md). Set AUTOPILOT_DISPATCH_MODEL_GUARD_MODE=warn
// to downgrade overloaded-Claude mechanical blocks to warnings. The 2026-09-04 cuda quota digest:
// subagents inherited the session's [1m] Fable model because nothing asked.
if (process.env.AUTOPILOT_DISPATCH_MODEL_GUARD_MODE === 'off') process.exit(0);

// BL-0017 (c): a brief that sets an l5/l6 marker AND names a non-strict dispatch rail burns foreman
// budget on a refusal. Advisory only (never blocks); the line is the same one session-mode.js prints
// (hooks/tests/blocked-dispatch-guidance.test.sh pins them equal).
const MASK_LINE = 'To run a non-strict dispatch in this session, prefix that one command with: AUTOPILOT_SESSION_MODE_DIR=$(mktemp -d)';
function mainSeatIsNonClaude(env = process.env) {
  if (['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']
    .some(key => env[key] && !/claude|sonnet|opus|haiku|fable/i.test(env[key]))) return true;
  if (!env.ANTHROPIC_BASE_URL) return false;
  try {
    const host = new URL(env.ANTHROPIC_BASE_URL).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '::1') return true;
    const parts = host.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a, b] = parts;
    return a === 127 || a === 10 || (a === 192 && b === 168)
      || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
  } catch {
    return false;
  }
}
const SETS_MANAGED_MARKER_RE = /session-mode(?:\.js)?\s+set\s+--level\s+l[56]\b/;
// Rails the l5/l6 marker refuses unless strict: dispatch-author (and dispatch-consult /
// dispatch-plan-review, which ride it). `--strict-contract` on the same line marks a strict call.
const NON_STRICT_RAIL_RE = /^(?!.*--strict-contract).*\bdispatch-(?:author|consult|plan-review)(?:\.sh|\.js)?\b/m;
// BL-0141: warn only when a marker line comes BEFORE a non-strict rail line (the marker refuses the
// rail only once it is set). A brief that dispatches first and sets the marker after is the advised fix.
function markerPrecedesNonStrictRail(prompt) {
  const markerAt = new RegExp(SETS_MANAGED_MARKER_RE.source, 'g');
  const railAt = new RegExp(NON_STRICT_RAIL_RE.source, 'gm');
  const firstMarker = markerAt.exec(prompt);
  if (!firstMarker) return false;
  let rail;
  while ((rail = railAt.exec(prompt)) !== null) {
    // The match starts at the line start (and greedily runs to the last dispatch token on it), so
    // locate the dispatch token itself; a same-line "marker ... dispatch" must still count.
    const tokenAt = rail.index + rail[0].lastIndexOf('dispatch-');
    if (tokenAt > firstMarker.index) return true;
  }
  return false;
}
function briefLintWarning(prompt) {
  if (!markerPrecedesNonStrictRail(prompt)) return '';
  return 'dispatch-model-guard: this brief sets an l5/l6 session-mode marker AND runs a non-strict dispatch '
    + '(dispatch-author/consult/plan-review) - the marker refuses it with precondition_failed and the foreman burns '
    + 'budget on the refusal. Set the marker AFTER those dispatches, or mask it for that command. ' + MASK_LINE;
}

const DEFAULTS = {
  guarded_models: ['fable'],
  guarded_models_implementing: ['fable', 'opus'],
  require_engine_header: 'on',
  require_cost_line: 'on',
  brief_size_used_by: 'warn', // D8b: warn by default; deny only after the PM flips it
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

  // require_engine_header: on | off; garbage → on (fail-closed)
  let requireEngineHeader = DEFAULTS.require_engine_header;
  if (Object.prototype.hasOwnProperty.call(parsed, 'require_engine_header')) {
    const v = String(parsed.require_engine_header || '').trim().toLowerCase();
    requireEngineHeader = (v === 'on' || v === 'off') ? v : 'on';
  }

  // require_cost_line: on | off; garbage → on (fail-closed), same as require_engine_header
  let requireCostLine = DEFAULTS.require_cost_line;
  if (Object.prototype.hasOwnProperty.call(parsed, 'require_cost_line')) {
    const v = String(parsed.require_cost_line || '').trim().toLowerCase();
    requireCostLine = (v === 'on' || v === 'off') ? v : 'on';
  }

  // brief_size_used_by: warn | deny; default warn (deny only after the PM flips it)
  let briefSizeUsedBy = DEFAULTS.brief_size_used_by;
  if (Object.prototype.hasOwnProperty.call(parsed, 'brief_size_used_by')) {
    const v = String(parsed.brief_size_used_by || '').trim().toLowerCase();
    briefSizeUsedBy = (v === 'warn' || v === 'deny') ? v : 'warn';
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
    require_engine_header: requireEngineHeader,
    require_cost_line: requireCostLine,
    brief_size_used_by: briefSizeUsedBy,
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

function handleGuard(reason, mode, { acknowledged = false, onAllow = null } = {}) {
  if (mode === 'warn') {
    process.stderr.write(reason + '\n');
    process.stdout.write(`${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: reason,
      },
    })}\n`);
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
    if (typeof onAllow === 'function') onAllow();
    process.exit(0);
  }
  emitDeny(
    reason
    + '. Your call: re-dispatch with a cheaper model (scripts/resolve-dispatch.sh --role <role>), '
    + 'or keep this engine and mark line 1 "Engine: <model> (intentional: <why>)" to proceed without a dialog',
  );
}

function parseFrontmatterModel(markdown) {
  const m = String(markdown || '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return '';
  const modelLine = m[1].match(/^\s*model\s*:\s*(.+?)\s*$/m);
  if (!modelLine) return '';
  let val = modelLine[1].trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1).trim();
  } else {
    val = val.replace(/\s+#.*$/, '').trim();
  }
  return val;
}

function resolveAgentFrontmatterModel(subagentType, cwd) {
  const rawType = String(subagentType || '').trim();
  if (!rawType) return '';
  const agentName = rawType.includes(':') ? rawType.split(':').pop().trim() : rawType;
  if (!agentName || /[\\/]/.test(agentName) || agentName === '.' || agentName === '..') {
    return '';
  }
  const candidates = [];
  if (cwd) {
    candidates.push(path.join(cwd, 'agents', `${agentName}.md`));
    candidates.push(path.join(cwd, '.claude', 'agents', `${agentName}.md`));
  }
  const pluginRoot = path.resolve(__dirname, '..');
  candidates.push(path.join(pluginRoot, 'agents', `${agentName}.md`));

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const model = parseFrontmatterModel(fs.readFileSync(filePath, 'utf8'));
        if (model) return model;
      }
    } catch {
      // try next candidate
    }
  }
  return '';
}

function engineTokenFromPrompt(prompt) {
  let firstLine = null;
  for (const line of String(prompt || '').split('\n')) {
    if (line.trim().length > 0) {
      firstLine = line;
      break;
    }
  }
  if (firstLine === null) return '';
  const m = firstLine.match(/^Engine:\s*(\S+)/);
  return m ? m[1] : '';
}

let pmSeatWarned = false;

function warnIfPmSeatUndetermined(input) {
  if (pmSeatWarned) return;
  if (String((input && input.tool_name) || '') !== 'Agent') return;
  const status = pmConsoleStatus(input);
  if (status.undetermined) {
    pmSeatWarned = true;
    process.stderr.write('pm-console: cannot determine PM seat (no console.json mode, no fleet address)\n');
  }
}

const PM_READ_ONLY_SUBAGENT_TYPES = Object.freeze(new Set(['Explore', 'Plan', 'web-fetch', 'claude-code-guide']));

function checkPmFleetTask(input, toolInput, prompt) {
  warnIfPmSeatUndetermined(input);
  const subagentType = String(toolInput.subagent_type || '').trim();
  if (PM_READ_ONLY_SUBAGENT_TYPES.has(subagentType)) return;
  const hasEngine = Boolean(engineTokenFromPrompt(prompt))
    || Boolean(findHeadMatch(prompt, /^Engine:\s*\S/));
  if (!hasEngine) return;

  const head = headLines(prompt, BRIEF_HEAD_WINDOW).join('\n');
  const res = resolvePmGate({
    repoRoot: (input && input.cwd) || process.cwd(),
    text: head,
  });
  if (!res.allowed) {
    emitDeny(
      res.reason
      + gateHint('先開或挑一個 open 的 fleet 任務，把 Fleet-Task: <id> 放進 brief 前 10 行再派工', 'hooks/README.md')
    );
  }
  if (res.note) {
    process.stderr.write(`dispatch-model-guard: ${res.note}\n`);
  }
}

const MECHANICAL_ROLES = new Set([
  'mechanical', 'inventory', 'format', 'formatting',
  'log', 'logs', 'log-reading', 'stats', 'statistics',
  'docs', 'doc', 'test-run', 'lint',
]);
const MECHANICAL_READONLY_ROLES = new Set([
  'log', 'logs', 'log-reading', 'stats', 'statistics', 'inventory',
]);

// Never break a normal Agent call: any throw inside the reroute check allows.
function checkMechanicalReroute(input, toolInput, prompt) {
  try { mechanicalReroute(input, toolInput, prompt); } catch { /* fail-open */ }
}


function mechanicalReroute(input, toolInput, prompt) {
  const modeRaw = String(process.env.AUTOPILOT_MECHANICAL_REROUTE || 'shadow').trim().toLowerCase();
  const mode = (modeRaw === 'off' || modeRaw === 'shadow' || modeRaw === 'enforce') ? modeRaw : 'shadow';
  if (mode === 'off') return;

  const envSeat = String(process.env.AUTOPILOT_SEAT_ROLE || '').trim().toLowerCase();
  let seat = '';
  let seatSource = '';
  if (envSeat === 'pm' || envSeat === 'lead') {
    seat = envSeat;
    seatSource = 'env';
  } else if (isPmConsole(input)) {
    seat = 'pm';
    seatSource = 'console';
  } else {
    const fleetSeat = resolveFleetSeat(input);
    if (fleetSeat && fleetSeat !== 'other') {
      seat = fleetSeat;
      seatSource = 'fleet';
    }
  }
  if (!seat) return;

  const subagentType = String(toolInput.subagent_type || '').trim();
  const model = String(toolInput.model || '').trim().toLowerCase();
  const typeMatch = subagentType === '' || subagentType === 'general-purpose' || subagentType === 'Explore';
  const modelMatch = model === 'haiku' || model === 'sonnet';
  if (!typeMatch && !modelMatch) return;

  const head = headLines(prompt, 6);
  const fields = head.flatMap((line) => line.split('|').map((f) => f.trim()));
  let matchedRole = '';
  for (const field of fields) {
    const m = field.match(/^Role:\s*([A-Za-z][\w-]*)/i);
    if (m) {
      const candidate = m[1].toLowerCase();
      if (MECHANICAL_ROLES.has(candidate)) {
        matchedRole = candidate;
      }
      break;
    }
  }
  if (!matchedRole) return;

  const engineField = fields.find((f) => /^Engine:/i.test(f)) || '';
  const intentional = /\(intentional:\s*[^)]+\)/i.test(engineField);

  if (mode === 'shadow') {
    const entry = {
      ts: new Date().toISOString(),
      seat,
      seat_source: seatSource,
      subagent_type: subagentType,
      model,
      role: matchedRole,
    };
    const laneField = fields.find((f) => /^Lane:\s*\S/i.test(f));
    if (laneField) entry.Lane = laneField.replace(/^Lane:\s*/i, '').trim().slice(0, 120);
    const taskId = findTaskId(head.join('\n'));
    if (taskId) entry['Fleet-Task'] = taskId;
    if (intentional) entry.intentional = true;

    try {
      const ensured = ensurePrivateDir(stateDir(process.env));
      if (ensured.ok) {
        fs.appendFileSync(path.join(ensured.path, 'mechanical-reroute-shadow.jsonl'), JSON.stringify(entry) + '\n', { mode: 0o600 });
      }
    } catch {
      // fail-open on shadow log write errors
    }
    return;
  }

  if (intentional) return;

  const isReadOnly = MECHANICAL_READONLY_ROLES.has(matchedRole);
  const cmd = 'scripts/dispatch-hetero.sh --runner local --branch <branch> --prompt-file <file>（備援：--runner grok）'
    + (isReadOnly ? '；此為唯讀類工作，brief 內寫明「不得修改檔案，結果寫在回覆」，並用拋棄式分支' : '');
  emitDeny(
    `PM / Lead 席位機械性工作轉派阻擋：偵測到 ${seat} 席位以 Claude subagent 執行機械性任務（Role: ${matchedRole}）。請改用低成本引擎派工：${cmd}；若確有必要使用 Claude subagent，請在 brief 的 Engine: 行加上 (intentional: <原因>)。`
    + gateHint('用 scripts/dispatch-hetero.sh 改派低成本引擎；非用 Claude 不可時在 Engine: 行加 (intentional: <原因>)', 'hooks/README.md')
  );
}

const OVERLOADED_MECHANICAL_ROLES = new Set([...MECHANICAL_ROLES, 'implementer']);

function checkOverloadedClaudeMechanical(toolInput, prompt, advisories) {
  const model = String(toolInput.model || '').trim().toLowerCase();
  const isClaudeModel = model === '' || model === 'haiku' || model === 'sonnet' || model === 'opus' || model === 'fable' || model.startsWith('claude-');
  if (!isClaudeModel) return;

  const head = headLines(prompt, 6);
  const fields = head.flatMap((line) => line.split('|').map((f) => f.trim()));
  let matchedRole = '';
  for (const field of fields) {
    const m = field.match(/^Role:\s*([A-Za-z][\w-]*)/i);
    if (m) {
      const candidate = m[1].toLowerCase();
      if (OVERLOADED_MECHANICAL_ROLES.has(candidate)) {
        matchedRole = candidate;
      }
      break;
    }
  }
  if (!matchedRole) return;

  const pacePath = process.env.AUTOPILOT_PACE_FILE || path.join(os.homedir(), 'projects', 'capacity', 'out', 'pace.v1.json');
  let pace;
  try {
    pace = JSON.parse(fs.readFileSync(pacePath, 'utf8'));
  } catch {
    return;
  }
  if (!pace || typeof pace !== 'object' || !Array.isArray(pace.rows) || pace.stale === true) return;
  if (typeof pace.generated_at === 'string' && pace.generated_at.trim() !== '') {
    const genMs = Date.parse(pace.generated_at.trim());
    if (!Number.isFinite(genMs) || (Date.now() - genMs) > SEEN_AT_FRESH_MS) return;
  }

  const claudeOverloaded = pace.rows.some((r) => (
    r && r.class === 'claude' && (
      (typeof r.used_pct === 'number' && Number.isFinite(r.used_pct) && r.used_pct >= 85)
      || (typeof r.status === 'string' && /^ALERT_/i.test(r.status))
    )
  ));
  if (!claudeOverloaded) return;

function privateLanes(env = process.env) {
  const raw = env.AUTOPILOT_DISPATCH_MODEL_GUARD_PRIVATE_LANES === undefined
    ? '308'
    : String(env.AUTOPILOT_DISPATCH_MODEL_GUARD_PRIVATE_LANES);
  return new Set(
    raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
}

  const lane = laneFromBrief(prompt);
  const isPrivateLane = lane !== null && privateLanes().has(lane.toLowerCase());

  let msg;
  if (isPrivateLane) {
    msg = `dispatch-model-guard: Claude pool is overloaded; mechanical subagent (Role: ${matchedRole}) on private lane (${lane}) is Claude-only. Wait for Claude pool capacity to recover or switch to another Claude model/pool (set AUTOPILOT_DISPATCH_MODEL_GUARD_MODE=warn to warn only).`
      + gateHint(`等待 Claude 池容量回來，或改用另一個 Claude 模型/池；此 lane（${lane}）僅限 Claude。要降級為警示才設 AUTOPILOT_DISPATCH_MODEL_GUARD_MODE=warn`, 'hooks/README.md');
  } else {
    const heteroReservePct = (typeof pace.hetero_reserve_pct === 'number' && Number.isFinite(pace.hetero_reserve_pct))
      ? pace.hetero_reserve_pct
      : 50;
    const agyReserveCeiling = 100 - heteroReservePct;

    const overCeilingPools = new Set(
      pace.rows
        .filter((r) => {
          if (!r || typeof r.used_pct !== 'number' || !Number.isFinite(r.used_pct) || typeof r.pool !== 'string') return false;
          const ceiling = r.pool.toLowerCase() === 'agy' ? agyReserveCeiling : 85;
          return r.used_pct >= ceiling;
        })
        .map((r) => r.pool.toLowerCase())
    );
    const targets = Array.isArray(pace.burn_more?.targets_in_order)
      ? pace.burn_more.targets_in_order.filter((t) => typeof t === 'string' && t.trim() !== '').map((t) => t.trim())
      : [];
    const suggested = targets.find((t) => !overCeilingPools.has(t.toLowerCase())) || targets[0] || 'agy';

    msg = `dispatch-model-guard: Claude pool is overloaded; mechanical subagent (Role: ${matchedRole}) must not land on Claude. Use ${suggested} instead (set AUTOPILOT_DISPATCH_MODEL_GUARD_MODE=warn to warn only).`
      + gateHint(`改派 ${suggested} 引擎；要降級為警示才設 AUTOPILOT_DISPATCH_MODEL_GUARD_MODE=warn`, 'hooks/README.md');
  }
  if (process.env.AUTOPILOT_DISPATCH_MODEL_GUARD_MODE === 'warn') {
    advisories.push(msg);
    return;
  }
  emitDeny(msg);
}

// Fable/opus only. Intentional does not skip this. Exits on deny.
// Model present: after the engine-header check, before the guarded-engine allow.
// Model absent: not called — the effective model is the sonnet worker default, which
// never triggers a fable/opus cost line.
function denyIfMissingCostLine(config, prompt, modelForCost) {
  if (config.require_cost_line !== 'on') return;
  if (!missingCostLine(prompt, modelForCost)) return;
  const line = costLineFor(modelForCost);
  handleDeny(
    'dispatch-model-guard: require_cost_line: add this line within the first 6 lines: ' + line
    + gateHint('在 brief 前 6 行補上這行 Cost line 再派工', 'hooks/README.md'),
    config.mode,
  );
}

function handleDeny(reason, mode) {
  if (mode === 'warn') {
    process.stderr.write(reason + '\n');
    process.stdout.write(`${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: reason,
      },
    })}\n`);
    process.exit(0);
  }
  // denial on fail-closed header check (mode !== 'warn')
  emitDeny(reason);
}

// ── opus/fable justification + brain-tier dispatch ledger (2026-11 worker-level default) ──

// The Model-Reason line: "Model-Reason:" + at least one non-whitespace character, within the
// brief's first 8 lines (headLines normalises CRLF like every other head read).
function modelReasonFromBrief(prompt) {
  for (const line of headLines(prompt, 8)) {
    const m = /^Model-Reason:[ \t]*(\S.*)$/.exec(line);
    if (m) return m[1].trim();
  }
  return null;
}

// The Lane: slug the same way subagent-budget reads it: first matching line in the first 5.
function laneFromBrief(prompt) {
  for (const line of headLines(prompt, 5)) {
    const m = LANE_RE.exec(line);
    if (m) return m[1];
  }
  return null;
}

// One JSONL line per opus/fable dispatch that reaches the Model-Reason gate. `allowed` is the
// gate's decision: a warn-mode dispatch proceeds (true) in both outcomes; remind denies without
// a reason (false); ask leaves it pending (false). Spend measurement, not a gate: any write
// error fails open.
function recordBrainTierDispatch(input, prompt, modelRaw, reason, allowed) {
  try {
    const dir = process.env.AUTOPILOT_STATE_DIR
      || path.join(os.homedir(), '.local', 'state', 'autopilot');
    fs.mkdirSync(dir, { recursive: true });
    const session = String(input.session_id || process.env.CLAUDE_CODE_SESSION_ID || '').trim() || null;
    const entry = {
      ts: new Date().toISOString(),
      session,
      lane: laneFromBrief(prompt),
      model: modelRaw,
      reason,
      allowed: !!allowed,
    };
    fs.appendFileSync(path.join(dir, 'brain-tier-dispatch.jsonl'), JSON.stringify(entry) + '\n');
  } catch {
    // fail-open on ledger write errors
  }
}

// Autopilot dispatch briefs (Lane: present in the first 5 lines) must carry
// `Size: XS|S|M|L|XL` and `Used-by: user|e2e|n/a <reason>` in the head lines,
// gated behind `brief_size_used_by: warn|deny` (default `warn`).
// PreToolUse hooks cannot rewrite tool_input.prompt; when `Stages:` is absent
// and `Size:` is present, do not deny — emit the computed `Stages: <list>` line
// in the allow-path additionalContext so the dispatcher can paste it.
function checkBriefSizeUsedByStages(config, prompt, advisories) {
  if (!hasBriefLane(prompt)) return;
  const size = briefSizeFromHead(prompt);
  const usedByOk = hasValidUsedBy(prompt);
  const missing = [];
  if (!size) missing.push('Size: XS|S|M|L|XL');
  if (!usedByOk) missing.push('Used-by: user|e2e|n/a <reason>');
  if (missing.length > 0) {
    const reason = 'dispatch-model-guard: brief_size_used_by: autopilot brief (Lane: present) is missing '
      + missing.join(' and ') + '.\n' + BRIEF_HEADER_TEMPLATE
      + gateHint('照模板在 brief 頭部補上缺的 Size / Used-by 行再派工', 'hooks/README.md');
    if (config.brief_size_used_by === 'deny') {
      handleDeny(reason, config.mode);
    } else {
      advisories.push(reason);
    }
  }
  if (size && !hasStagesHeader(prompt)) {
    const stagesLine = stagesLineForSize(size);
    if (stagesLine) {
      advisories.push(
        `dispatch-model-guard: Stages: absent for Size: ${size} — paste into brief header:\n${stagesLine}`,
      );
    }
  }
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
  const advisories = [];
  const briefWarning = briefLintWarning(typeof toolInput.prompt === 'string' ? toolInput.prompt : '');
  if (briefWarning) advisories.push(briefWarning);
  // Advisory exit: the dispatch proceeds; warnings/hints ride additionalContext (and stderr).
  const exitAllow = () => {
    if (advisories.length > 0) {
      const msg = advisories.join('\n');
      process.stderr.write(msg + '\n');
      process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg } })}\n`);
    }
    process.exit(0);
  };
  const explicitModelRaw = String(toolInput.model || '').trim();
  const agentModelRaw = !explicitModelRaw
    ? resolveAgentFrontmatterModel(toolInput.subagent_type, cwd)
    : '';
  const modelRaw = explicitModelRaw || agentModelRaw;
  const model = modelRaw.toLowerCase();

  // model empty: the worker-level default decides outright — allow on sonnet via
  // updatedInput. The header check has nothing to match against and does not run
  // (a header check on an empty model would deny before the default could take
  // effect, making the default dead behaviour).
  if (!model) {
    const promptAbsent = typeof toolInput.prompt === 'string' ? toolInput.prompt : '';
    // No model to run: the effective model is the sonnet default, so the fable/opus
    // Cost line does not apply (the sonnet line is advisory only). The brief checks
    // that need no model still run, exactly as on the old allow path.
    checkPmFleetTask(input, toolInput, promptAbsent);
    checkMechanicalReroute(input, toolInput, promptAbsent);
    checkOverloadedClaudeMechanical(toolInput, promptAbsent, advisories);
    checkBriefSizeUsedByStages(config, promptAbsent, advisories);
    // One advisory line for the default; it rides the same stderr + additionalContext
    // channel as every other advisory of this hook.
    if (mainSeatIsNonClaude()) {
      advisories.push('預設 worker 等級 inherit（主席是本地／非 Claude 模型）');
      exitAllow();
    }
    advisories.push('預設 worker 等級 sonnet');
    const msg = advisories.join('\n');
    process.stderr.write(msg + '\n');
    process.stdout.write(`${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { ...toolInput, model: 'sonnet' },
        additionalContext: msg,
      },
    })}\n`);
    process.exit(0);
  }

  if (mainSeatIsNonClaude() && (/^(sonnet|opus|haiku)$/.test(model) || /^claude-/.test(model))) {
    advisories.push(`本地模型席指定了 Claude 模型 ${modelRaw}，會用 Claude 額度`);
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
        `dispatch-model-guard: prompt line 1 must be "Engine: <model>…" matching model: ${modelRaw} (got: ${got})`
        + headerDenialSuffix(promptRaw, modelRaw, { engineBy: 'self', laneBy: 'other' })
        + gateHint('brief 第 1 行改成與 model: 一致的 "Engine: <model>"', 'hooks/README.md'),
        config.mode
      );
    }
  }

  // Cost line, after the header check and before the guarded-engine allow.
  // `(intentional: …)` does not skip it: handleGuard's allow path is below.
  denyIfMissingCostLine(config, promptRaw, modelRaw);

  // PM Console hard block: Engine dispatches require an open Fleet-Task, except read-only types.
  checkPmFleetTask(input, toolInput, promptRaw);

  // Mechanical subagent reroute on PM / lead seats.
  checkMechanicalReroute(input, toolInput, promptRaw);
  checkOverloadedClaudeMechanical(toolInput, promptRaw, advisories);

  // Size / Used-by / Stages check for autopilot briefs (Lane: present).
  checkBriefSizeUsedByStages(config, promptRaw, advisories);

  // Model-Reason gate (2026-11): opus/fable must be justified per dispatch and are
  // counted. The non-empty "Model-Reason: <why>" line within the brief's first 8 lines
  // is the justification; it also acknowledges the guarded-engine check below (the
  // (intentional: …) Engine header alone no longer suffices for opus/fable). Every
  // opus/fable dispatch reaching this gate appends one JSONL ledger line first, so the
  // report counts denied attempts (reason null) as well as allowed ones.
  let brainReason = null;
  if (isOpusFableModel(modelRaw)) {
    brainReason = modelReasonFromBrief(promptRaw);
    recordBrainTierDispatch(input, promptRaw, modelRaw, brainReason,
      brainReason !== null ? config.mode !== 'ask' : config.mode === 'warn');
    if (brainReason === null) {
      handleDeny(
        `dispatch-model-guard: model '${modelRaw}' (opus/fable) requires its justification — add a non-empty `
        + '"Model-Reason: <why>" line within the first 8 lines of the brief and re-dispatch'
        + gateHint('在 brief 前 8 行補一行 "Model-Reason: <why>" 再重新派工', 'hooks/README.md'),
        config.mode,
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
      && (INTENTIONAL_RE.test(firstLine) || brainReason !== null);
    handleGuard(
      `dispatch-model-guard: model '${modelRaw}' is a guarded expensive engine`
      + gateHint('改派便宜引擎（scripts/resolve-dispatch.sh --role <role>），或保留此引擎並在 Engine: 行加 (intentional: <why>)', 'hooks/README.md'),
      config.mode,
      { acknowledged, onAllow: exitAllow },
    );
  }
  exitAllow();
} catch (e) {
  process.stderr.write(
    `dispatch-model-guard: unexpected error — allowing (fail-open): ${e.message}\n`
  );
  process.exit(0);
}
