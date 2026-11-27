#!/usr/bin/env node
/**
 * agent-dispatch-shed — PreToolUse, matcher Task|Agent.
 *
 * A native Agent/Task subagent runs on the model the caller passed; nothing on
 * this path switches engines from the brief's `Engine:` header. So instead of
 * rewriting the header (which would stamp `Shed: hit` over a dispatch that
 * still burns the original model), this hook DENIES a mechanical brief
 * (Role: inventory|summary|chores, Size: XS|S) while a fresh capacity
 * burn_more shed signal lists a dispatchable target, with the reason naming
 * the pool alternative (`scripts/dispatch-hetero.sh --runner <target>`). The
 * tool_input is never modified: `model` and the prompt stay exactly as the
 * caller wrote them, so the audit stays truthful.
 *
 * The shed decision itself is computed by `applyShedRouting` from
 * fleet-dispatch-class.js (d11a0ad1c) on a throwaway copy, so both dispatch
 * paths share one implementation and cannot drift. A `Shed: skipped`
 * outcome (Engine-Pin:, existing Shed: line, stale/missing signal,
 * AUTOPILOT_SHED_ROUTE=0, non-mechanical brief) passes silently.
 *
 * Malformed stdin JSON -> exit 0 silently (fail-open).
 */
'use strict';

const fs = require('fs');
const { gateHint } = require('./lib/gate-hint.js');
const { applyShedRouting } = require('./fleet-dispatch-class.js');

const SHED_HIT_LINE_RE = /^Shed: hit engine=(\S+) run_id=(\S+) signal_at=(\S+)\s*$/m;

// RT chair-source axis. AUTOPILOT_CHAIR_FAMILY names the chair's model family;
// unset or `claude` is a Claude chair, anything else (local, a non-Claude model) is not.
function chairIsClaude(env = process.env) {
  const fam = String(env.AUTOPILOT_CHAIR_FAMILY || 'claude').trim().toLowerCase();
  return fam === '' || fam === 'claude';
}

// Model a subagent without an explicit model runs on. The haiku row (mechanical
// XS/S brief) exists only with a Claude chair; any other chair inherits.
function resolveSubagentModel(toolInput, env = process.env) {
  const explicit = toolInput && typeof toolInput.model === 'string' ? toolInput.model.trim() : '';
  if (explicit) return explicit;
  if (!chairIsClaude(env)) return 'inherit';
  const head = String((toolInput && toolInput.prompt) || '').split(/\r?\n/).slice(0, 10).join('\n');
  const role = (head.match(/^Role:\s*([A-Za-z-]+)/m) || [])[1];
  const size = (head.match(/^Size:\s*(\S+)/m) || [])[1];
  if (/^(inventory|summary|chores)$/i.test(role || '') && /^(XS|S)$/i.test(size || '')) return 'haiku';
  return 'inherit';
}

// Non-Claude chair + no explicit model: pin `inherit` so the subagent never lands on a Claude default.
function inheritForNonClaudeChair(toolInput) {
  if (chairIsClaude()) return null;
  if (resolveSubagentModel(toolInput) !== 'inherit' || (typeof toolInput.model === 'string' && toolInput.model.trim())) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { ...toolInput, model: 'inherit' },
    },
  };
}

function isTranscriptWork(prompt) {
  return /^Work-Class:\s*transcript\b/im.test(String(prompt).split(/\r?\n/).slice(0, 10).join('\n'));
}

function preToolDeny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

function decide(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (input.tool_name !== 'Task' && input.tool_name !== 'Agent') return null;

  const toolInput = input.tool_input && typeof input.tool_input === 'object' && !Array.isArray(input.tool_input)
    ? input.tool_input
    : {};
  const prompt = toolInput.prompt;
  if (typeof prompt !== 'string' || !prompt) return null;

  if (isTranscriptWork(prompt) && !chairIsClaude()) {
    return preToolDeny(
      'agent-dispatch-shed：transcript 類工作只能從 Claude 主席派發；目前主席來源 AUTOPILOT_CHAIR_FAMILY='
      + `${process.env.AUTOPILOT_CHAIR_FAMILY} 不是 Claude。請改由 Claude 席派發。`
      + gateHint('改由 Claude 主席派發 transcript 類工作', 'hooks/README.md')
    );
  }

  // Throwaway copy: applyShedRouting rewrites the Engine: header and stamps the
  // Shed: line; we read the outcome back out instead of using the rewrite.
  const routed = applyShedRouting({ task: prompt, size: toolInput.size });
  if (routed === prompt) return inheritForNonClaudeChair(toolInput);

  const hit = routed.match(SHED_HIT_LINE_RE);
  if (!hit) return inheritForNonClaudeChair(toolInput); // skipped outcome (stale, pinned, no target, off) -> pass untouched

  const target = hit[1];
  return preToolDeny(
    `agent-dispatch-shed：這份 brief 是機械單（Role inventory/summary/chores、Size XS/S），capacity 的 burn_more 訊號（run_id=${hit[2]}）現正指定 shed 引擎 ${target}。原生 Agent 子代理不會依 Engine: 標頭換引擎，直接派發不會省到 pool；請改走 bash scripts/dispatch-hetero.sh --runner ${target} 派同工單（或以 Engine-Pin: 標頭明確釘住原引擎後重試）。`
    + gateHint('改走 scripts/dispatch-hetero.sh --runner ' + target + '，或以 Engine-Pin: 釘住原引擎', 'hooks/README.md')
  );
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return fs.readFileSync('/dev/stdin', 'utf8');
  }
}

function main() {
  let input;
  try {
    const raw = readStdin();
    if (!raw || !raw.trim()) return;
    input = JSON.parse(raw);
  } catch {
    return;
  }
  try {
    const out = decide(input);
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  } catch (err) {
    process.stderr.write(`agent-dispatch-shed: fail-open: ${err && err.message}\n`);
  }
}

if (require.main === module) main();

module.exports = { decide, resolveSubagentModel, chairIsClaude };
