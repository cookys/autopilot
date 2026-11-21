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
const path = require('path');
const {
  BRIEF_HEADER_TEMPLATE,
  hasBriefLane,
  briefSizeFromHead,
  hasValidUsedBy,
  hasStagesHeader,
  stagesLineForSize,
  headerDenialSuffix,
  missingCostLine,
  costLineFor,
} = require('./lib/brief-header-template.js');
const { BRIEF_HEAD_WINDOW, headLines, findHeadMatch } = require('./lib/brief-head.js');
const { isPmConsole } = require('./_shared/pm-console.js');
const { findTaskId, checkTaskOpen } = require('../scripts/lib/fleet-task-ref.js');
const { ownerAddress, whoamiSession } = require('../scripts/lib/fleet-task.js');
const { userRuntimeBase, ensurePrivateDir } = require('../scripts/lib/runtime-paths.js');
// default-on since v2.35.15 (was opt-in). Opt out: AUTOPILOT_DISPATCH_MODEL_GUARD_MODE=off
// (or `- mode: off` in .claude/dispatch-guard-config.md). The 2026-09-04 cuda quota digest:
// subagents inherited the session's [1m] Fable model because nothing asked.
if (process.env.AUTOPILOT_DISPATCH_MODEL_GUARD_MODE === 'off') process.exit(0);

// BL-0017 (c): a brief that sets an l5/l6 marker AND names a non-strict dispatch rail burns foreman
// budget on a refusal. Advisory only (never blocks); the line is the same one session-mode.js prints
// (hooks/tests/blocked-dispatch-guidance.test.sh pins them equal).
const MASK_LINE = 'To run a non-strict dispatch in this session, prefix that one command with: AUTOPILOT_SESSION_MODE_DIR=$(mktemp -d)';
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
  on_missing_model: 'deny', // v2.36.2: was 'ask' — see the comment at the missing-model branch
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
    on_missing_model: onMissing,
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

function checkPmFleetTask(input, toolInput, prompt) {
  if (!isPmConsole(input)) return;
  const subagentType = String(toolInput.subagent_type || '').trim();
  if (subagentType === 'Explore' || subagentType === 'Plan') return;
  const hasEngine = Boolean(engineTokenFromPrompt(prompt))
    || Boolean(findHeadMatch(prompt, /^Engine:\s*\S/));
  if (!hasEngine) return;

  const head = headLines(prompt, BRIEF_HEAD_WINDOW).join('\n');
  const taskId = findTaskId(head);
  if (!taskId) {
    emitDeny(
      'PM Console 派工硬阻擋：此 subagent brief 帶有 Engine: 標頭，但前 10 行缺少 Fleet-Task: <26-char id> 綁定。請先開啟或挑選對應的 fleet 任務（使用 fleet task show <id> 確認狀態為 open），並將「Fleet-Task: <id>」加入 brief 前 10 行後再重新派工。'
    );
  }

  const probe = checkTaskOpen(taskId);
  if (probe.state === 'open') return;
  if (probe.state === 'unavailable') {
    process.stderr.write(`dispatch-model-guard: fleet task ${taskId} check unavailable — allowing (fail-open)\n`);
    return;
  }
  if (probe.state === 'not_found') {
    emitDeny(
      `PM Console 派工硬阻擋：brief 中的 Fleet-Task: ${taskId} 找不到對應任務（not_found）。請先開啟或挑選有效的 open 任務（使用 fleet task show ${taskId} 確認），並將「Fleet-Task: <id>」加入 brief 前 10 行後再重新派工。`
    );
  }
  emitDeny(
    `PM Console 派工硬阻擋：brief 中的 Fleet-Task: ${taskId} 已結束（closed: done/failed/cancelled）。請開啟或挑選進行中的 open 任務（使用 fleet task show ${taskId} 確認），並將新的「Fleet-Task: <id>」加入 brief 前 10 行後再重新派工。`
  );
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

function seatFromFleetAddress(addr) {
  if (!addr || typeof addr !== 'string') return '';
  const member = addr.split('/').pop().replace(/@.*$/, '');
  if (member === 'pm--claude') return 'pm';
  if (member.endsWith('-lead--claude') || member === 'hangar--claude') return 'lead';
  return '';
}

function resolveFleetSeat(input) {
  if (process.env.FLEET_ADDRESS) {
    const addr = ownerAddress();
    if (addr) return seatFromFleetAddress(addr);
  }
  const sessionId = String(process.env.CLAUDE_CODE_SESSION_ID || (input && input.session_id) || '').trim();
  if (!sessionId) return '';

  let cacheFile = null;
  let cache = {};
  try {
    const base = userRuntimeBase(process.env);
    const ensured = base.startsWith('/tmp/') ? { ok: false } : ensurePrivateDir(base);
    if (ensured.ok) {
      cacheFile = path.join(ensured.path, 'mechanical-reroute-seat-cache.json');
      if (fs.existsSync(cacheFile)) {
        const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          cache = parsed;
          if (Object.prototype.hasOwnProperty.call(cache, sessionId)) {
            const cached = cache[sessionId];
            return cached === 'pm' || cached === 'lead' ? cached : '';
          }
        }
      }
    }
  } catch {
    // fail-open on cache read
  }

  let seat = '';
  try {
    const res = whoamiSession(sessionId, { timeoutMs: 1500 });
    if (res.ok && res.address) {
      seat = seatFromFleetAddress(res.address);
    }
  } catch {
    seat = '';
  }

  if (cacheFile) {
    try {
      cache[sessionId] = seat || 'none';
      fs.writeFileSync(cacheFile, JSON.stringify(cache));
    } catch {
      // fail-open on cache write
    }
  }
  return seat;
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
    if (fleetSeat) {
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
      const base = userRuntimeBase(process.env);
      // tmpfs only: the helper falls back to /tmp/autopilot-<uid> when XDG_RUNTIME_DIR is unusable; skip then.
      const ensured = base.startsWith('/tmp/') ? { ok: false } : ensurePrivateDir(base);
      if (ensured.ok) {
        fs.appendFileSync(path.join(ensured.path, 'mechanical-reroute-shadow.jsonl'), JSON.stringify(entry) + '\n');
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
  );
}

// Fable/opus only. Intentional does not skip this. Exits on deny.
// Model present: after the engine-header check, before the guarded-engine allow.
// Model absent: before the on_missing_model allow / ask / deny paths, with the
// Engine token as the effective model.
function denyIfMissingCostLine(config, prompt, modelForCost) {
  if (config.require_cost_line !== 'on') return;
  if (!missingCostLine(prompt, modelForCost)) return;
  const line = costLineFor(modelForCost);
  handleDeny(
    'dispatch-model-guard: require_cost_line: add this line within the first 6 lines: ' + line,
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
      + missing.join(' and ') + '.\n' + BRIEF_HEADER_TEMPLATE;
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
  const modelRaw = String(toolInput.model || '').trim();
  const model = modelRaw.toLowerCase();

  // model empty: on_missing_model policy decides outright — the header check
  // has nothing to match against and must not run (on_missing_model: allow
  // would otherwise be dead config, since the header check ran first and
  // denied before allow could take effect).
  if (!model) {
    // Cost line before allow / ask / deny. denyIfMissingCostLine exits on deny,
    // so ask cannot turn a missing fable/opus Cost line into a dialog, and the
    // default deny names the exact line.
    const promptAbsent = typeof toolInput.prompt === 'string' ? toolInput.prompt : '';
    const engineTok = engineTokenFromPrompt(promptAbsent);
    denyIfMissingCostLine(config, promptAbsent, engineTok);
    if (config.on_missing_model === 'allow') {
      checkPmFleetTask(input, toolInput, promptAbsent);
      checkMechanicalReroute(input, toolInput, promptAbsent);
      checkBriefSizeUsedByStages(config, promptAbsent, advisories);
      exitAllow();
    }
    // v2.36.2: default is DENY, not ask. A missing model: is never a judgment for the
    // user — the only correct next action is the model's own re-dispatch with model:
    // set, and an interactive "ask" turned that into a permission dialog the owner had
    // to click through (2026-09-05 dogfood: depth-0 spawned a reviewer without model:,
    // the owner had to intervene). A deny carries the same reason back to the model
    // and it re-dispatches on its own. `on_missing_model: ask` keeps the old dialog.
    const reason = 'dispatch-model-guard: no model specified — the subagent would inherit the session model '
      + '(possibly a guarded engine); re-dispatch NOW with an explicit model: (scripts/resolve-dispatch.sh '
      + '--role <role>) and an "Engine: <model>" first prompt line'
      + headerDenialSuffix(promptAbsent, '', { engineBy: 'self', laneBy: 'other' });
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
        `dispatch-model-guard: prompt line 1 must be "Engine: <model>…" matching model: ${modelRaw} (got: ${got})`
        + headerDenialSuffix(promptRaw, modelRaw, { engineBy: 'self', laneBy: 'other' }),
        config.mode
      );
    }
  }

  // Cost line, after the header check and before the guarded-engine allow.
  // `(intentional: …)` does not skip it: handleGuard's allow path is below.
  denyIfMissingCostLine(config, promptRaw, modelRaw);

  // PM Console hard block: Agent calls with Engine: (non-Explore/Plan) require an open Fleet-Task in head 10 lines.
  checkPmFleetTask(input, toolInput, promptRaw);

  // Mechanical subagent reroute on PM / lead seats.
  checkMechanicalReroute(input, toolInput, promptRaw);

  // Size / Used-by / Stages check for autopilot briefs (Lane: present).
  checkBriefSizeUsedByStages(config, promptRaw, advisories);

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
