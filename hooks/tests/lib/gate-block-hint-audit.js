#!/usr/bin/env node
/**
 * gate-block-hint-audit.js — Fleet-Task 01M803Z0SF3MQG07WYWH3TH25T.
 *
 * Lint for the gate-message contract: every gate block/deny message carries one fix
 * sentence and one doc reference, appended through hooks/lib/gate-hint.js gateHint().
 *
 * Two checks, per <hooks-dir>:
 *   1. Coverage — for each inventoried gate, every block-message site (anchored below)
 *      must be followed, before the next site, by a gateHint() call on the same message.
 *      A stripped hint (or a vanished site) turns the audit red.
 *   2. Doc — every gateHint(fix, doc) call must cite a STATIC doc (a literal string,
 *      not an interpolation), and that doc must resolve against <repo-root>:
 *      a repo-relative path (references/…, docs/…, hooks/README.md, CLAUDE.md) or a
 *      skill name (plugin:name → skills/<name>/SKILL.md).
 *
 * Usage: node gate-block-hint-audit.js <hooks-dir> [repo-root]
 * Exit: 0 green, 1 red (one line per finding), 2 usage/IO error.
 *
 * The INVENTORY below is the contract: when a gate gains or loses a block site, its
 * anchors must move with it — that is deliberate (silent drift of gate messages is
 * exactly what this lint exists to catch).
 */
'use strict';

const fs = require('fs');
const path = require('path');

// [file relative to hooks dir, label, anchor — a RegExp source matched literally (all occurrences)]
const INVENTORY = [
  ['bash-test-timeout-guard.js', 'test command without timeout', 'BLOCKED: 測試或檢查指令必須加上 timeout'],
  ['branch-protection.js', 'force-push to protected push target', 'Force push to protected branch'],
  ['branch-protection.js', 'force-push on protected branch', 'Force push on protected branch'],
  ['branch-protection.js', 'direct commit on protected branch', 'Direct commit on protected branch'],
  ['commit-secret-scan.js', 'secrets in staged commit', 'Potential secrets found in staged changes'],
  ['config-protection.js', 'protected config file write', 'is a protected config file'],
  ['exec-boundary.js', 'E1 protected-ref force-push', 'force push to protected ref'],
  ['exec-boundary.js', 'E2 nesting fail-closed', 'because the nested text cannot be judged'],
  ['exec-boundary.js', 'E2 nested recursive rm', 'unquoted heredoc text is refused whatever its target'],
  ['exec-boundary.js', 'E2 recursive rm outside sanctioned roots', 'outside sanctioned roots (cwd, tmp'],
  ['exec-boundary.js', 'E3 destructive SQL', 'raw DROP TABLE/TRUNCATE'],
  ['exec-boundary.js', 'E4 sudo rm', "'root-privileged deletion'"],
  ['large-file-warner.js', 'read over 2MB block', 'Use offset/limit to read specific sections'],
  ['mcp-health.js', 'unhealthy MCP server block', 'is unhealthy'],
  ['lib/ask-guard.js', 'gated seat AskUserQuestion deny', '把問題、選項與建議送給 PM'],
  ['claude-home-read-guard.js', 'real ~/.claude access deny', '依紅線要操作員本人的卡才能讀'],
  ['depth0-delegate-gate.js', 'secret-print block', 'emitDeny(secretReason'],
  ['depth0-delegate-gate.js', 'detach without waiter', 'emitDeny(`bash-launch-guard (${detach.rule}'],
  ['depth0-delegate-gate.js', 'pkill/pgrep self-match', 'emitDeny(`bash-launch-guard (${pk.rule}'],
  ['depth0-delegate-gate.js', 'busy loop', 'emitDeny(\'bash-launch-guard (busy-loop)'],
  ['depth0-delegate-gate.js', 'bare ls', 'emitDeny(`bash-launch-guard (${ls.rule}'],
  ['depth0-delegate-gate.js', 'recursive rm on $VAR target', 'emitDeny(`bash-launch-guard (${rv.rule}'],
  ['depth0-delegate-gate.js', 'subagent rm outside scratchpad', 'emitDeny(`bash-launch-guard (${sr.rule}'],
  ['depth0-delegate-gate.js', 'rm on shared (world-writable) dir', 'emitDeny(`bash-launch-guard (${sh.rule}'],
  ['depth0-delegate-gate.js', 'rm wrapped in -c/heredoc/loop/xargs', 'emitDeny(`bash-launch-guard (${rw.rule}'],
  ['depth0-delegate-gate.js', 'zsh-only syntax', 'emitDeny(`bash-launch-guard (${zs.rule}'],
  ['depth0-delegate-gate.js', 'read burst on guarded model', 'guarded model (family'],
  ['dispatch-model-guard.js', 'guarded expensive engine', 'is a guarded expensive engine'],
  ['dispatch-model-guard.js', 'PM Fleet-Task gate (resolvePmGate reason)', 'res.reason'],
  ['dispatch-model-guard.js', 'mechanical work on Claude (PM/lead seat)', '機械性工作轉派阻擋'],
  ['dispatch-model-guard.js', 'Claude pool overloaded', 'must not land on Claude'],
  ['dispatch-model-guard.js', 'missing cost line', 'add this line within the first 6 lines'],
  ['dispatch-model-guard.js', 'autopilot brief missing Size/Used-by', 'brief_size_used_by: autopilot brief'],
  ['dispatch-model-guard.js', 'missing Engine: header', 'prompt line 1 must be'],
  ['dispatch-model-guard.js', 'opus/fable missing Model-Reason', 'requires its justification'],
  ['fleet-dispatch-class.js', 'invalid explicit class', '的 class 值'],
  ['fleet-dispatch-class.js', 'missing Role: header', '缺少 Role: 標頭'],
  ['fleet-dispatch-class.js', 'unmapped Role:', '不在支援的角色表內'],
  ['fleet-send-work-order-guard.js', 'work-order send', '這則 send 是在派工'],
  ['fleet-send-work-order-guard.js', 'work-order reply', '這則 reply 是在派工'],
  ['fleet-send-work-order-guard.js', 'reply to courier wake', 'reply 不能回 courier'],
  ['fleet-send-work-order-guard.js', 'message asking to read real ~/.claude', '要對方讀真實的 ~/.claude'],
  ['fleet-send-work-order-guard.js', 'dispatch missing Size', '每張派工都要帶 Size'],
  ['fleet-send-work-order-guard.js', 'dispatch M+ missing Plan', '工單 Size M 以上要帶'],
  ['foreman-guard.js', 'close-out reserve directive', 'Close-out reserve:'],
  ['foreman-guard.js', 'own-context T2 ceiling', 'this agent\'s own context is'],
  ['foreman-guard.js', 'polling rule (spin/sleep/watch)', 'function pollRuleReason'],
  ['foreman-guard.js', 'Monitor from subagent', 'function monitorDenyReason'],
  ['foreman-guard.js', 'bash cap exceeded', 'exceeds the ${role} cap'],
  ['subagent-budget.js', 'per-ticket Claude budget exhausted', '的 Claude 預算已用盡'],
  ['subagent-budget.js', 'runaway ceiling (warn mode)', 'runaway ceiling, dispatch denied'],
  ['subagent-budget.js', 'lane/turn ceiling deny', 'subagent-budget: dispatch denied.'],
  ['run-approval-gate.js', 'first-dispatch run approval ask', 'this is the first dispatch of the'],
  ['askpm-remind.js', 'undisposed pm-ask blocks Stop', 'ask_id ${askId} 尚未處置'],
  ['context-land-gate.js', 'handoff landed, relay line', 'handoff 已寫好'],
  ['context-land-gate.js', 'context fired, handoff missing', '已觸發，但 handoff 檔還沒寫'],
  ['native-msg-record.js', 'peer input block', "decision: 'block', reason: '這是同儕輸入"],
  ['orchestrator-edit-gate.js', 'depth-0 inline edit block', "mode === 'block'"],
  ['owner-question-guard.js', 'reply-language block', 'reason: lang.reason'],
  ['owner-question-guard.js', 'owner-question block', 'reason: reason +'],
  ['per-turn-gate.js', 'per-turn verifier block', "reason: text +"],
];

function lineOf(src, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (src[i] === '\n') n++;
  return n;
}

// --- check 1: coverage — every block-message site is followed by gateHint( ---
function coverageFailures(hooksDir, errors) {
  const seen = new Map(); // file -> count of verified sites
  const byFile = new Map(); // file -> [{ label, anchor }]
  for (const [file, label, anchor] of INVENTORY) {
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push({ label, anchor });
  }
  for (const [file, entries] of byFile) {
    const p = path.join(hooksDir, file);
    let src;
    try { src = fs.readFileSync(p, 'utf8'); } catch {
      errors.push(`${file}: gate file missing from ${hooksDir}`);
      continue;
    }
    const siteHits = []; // [{ label, pos, end }]
    const allPositions = [];
    for (const { label, anchor } of entries) {
      const hits = [];
      for (let i = src.indexOf(anchor); i !== -1; i = src.indexOf(anchor, i + 1)) hits.push(i);
      if (hits.length === 0) {
        errors.push(`${file}: block site "${label}" not found — anchor stale or site removed; update the INVENTORY with it`);
        continue;
      }
      for (const pos of hits) {
        siteHits.push({ label, pos, end: pos + anchor.length });
        allPositions.push(pos);
      }
      seen.set(file, (seen.get(file) || 0) + hits.length);
    }
    allPositions.sort((a, b) => a - b);
    for (const { label, pos, end } of siteHits) {
      const nextPos = allPositions.find(q => q > end);
      const lineLimit = src.split('\n').slice(0, lineOf(src, end) + 8).join('\n').length;
      const to = Math.min(nextPos !== undefined ? nextPos : src.length, lineLimit);
      if (!src.slice(end, to).includes('gateHint(')) {
        errors.push(`${file}:${lineOf(src, pos)} block site "${label}" has no gateHint() fix+doc tail`);
      }
    }
  }
  return seen;
}

// --- check 2: docs — every gateHint() call cites a static, resolvable doc ---
function splitTopLevel(span) {
  const args = [];
  let depth = 0, quote = null, start = 0, escaped = false;
  for (let i = 0; i < span.length; i++) {
    const c = span[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { args.push(span.slice(start, i)); start = i + 1; }
  }
  args.push(span.slice(start));
  return args;
}

// Balanced-paren span of a call that starts at the '(' index.
function callArgSpan(src, openIdx) {
  let depth = 0, quote = null, escaped = false;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return src.slice(openIdx + 1, i); }
  }
  return null;
}

function docResolves(doc, root) {
  if (/^[\w-]+:[\w-]+$/.test(doc)) { // skill name, e.g. autopilot:handoff
    return fs.existsSync(path.join(root, 'skills', doc.split(':')[1], 'SKILL.md'));
  }
  if (/^\/|\$|\{/.test(doc)) return false; // absolute / env-var docs are not repo-verifiable
  if (doc.split('/').length === 1) return fs.existsSync(path.join(root, doc)); // CLAUDE.md etc.
  return fs.existsSync(path.join(root, doc)); // references/…, docs/…, hooks/README.md
}

function walkJs(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const st = fs.statSync(p); // follows symlinks (the negative-control tree is symlinked)
    if (st.isDirectory()) walkJs(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
}

function docFailures(hooksDir, root, errors) {
  let checked = 0;
  const files = [];
  walkJs(hooksDir, files);
  for (const p of files) {
    const rel = path.relative(hooksDir, p).split(path.sep).join('/');
    if (rel.startsWith('tests/') || rel === 'lib/gate-hint.js') continue; // lint and helper, not callers
    const src = fs.readFileSync(p, 'utf8');
    for (let i = src.indexOf('gateHint('); i !== -1; i = src.indexOf('gateHint(', i + 1)) {
      if (src.slice(Math.max(0, i - 12), i).includes('function gateHint')) continue; // the definition
      const lineStart = src.lastIndexOf('\n', i) + 1;
      if (/^[/*]/.test(src.slice(lineStart, i).trimStart())) continue; // a comment mentioning the helper
      const open = src.indexOf('(', i + 'gateHint'.length);
      const span = callArgSpan(src, open);
      if (span === null) { errors.push(`${rel}:${lineOf(src, i)} gateHint( call has no balanced arguments`); continue; }
      checked++;
      const args = splitTopLevel(span);
      if (args.length !== 2) {
        errors.push(`${rel}:${lineOf(src, i)} gateHint() takes exactly (fix, doc) — got ${args.length} argument(s)`);
        continue;
      }
      const doc = args[1].trim();
      const m = doc.match(/^(['"`])(.*)\1$/s);
      if (!m) {
        errors.push(`${rel}:${lineOf(src, i)} gateHint() doc must be a static string literal, got: ${doc.slice(0, 60)}`);
        continue;
      }
      const value = m[2];
      if (m[1] === '`' || value.includes('${')) {
        errors.push(`${rel}:${lineOf(src, i)} gateHint() doc must not interpolate — cannot verify a dynamic path`);
        continue;
      }
      if (!docResolves(value, root)) {
        errors.push(`${rel}:${lineOf(src, i)} cited doc does not resolve: ${value}`);
      }
    }
  }
  return checked;
}

function main() {
  const [hooksDir, repoRootArg] = process.argv.slice(2);
  if (!hooksDir) { console.error('usage: gate-block-hint-audit.js <hooks-dir> [repo-root]'); process.exit(2); }
  const hooksAbs = path.resolve(hooksDir);
  if (!fs.existsSync(path.join(hooksAbs, 'hooks.json'))) { console.error(`not a hooks dir (no hooks.json): ${hooksAbs}`); process.exit(2); }
  const root = path.resolve(repoRootArg || path.dirname(hooksAbs));
  const errors = [];
  const sites = coverageFailures(hooksAbs, errors);
  const docs = docFailures(hooksAbs, root, errors);
  if (errors.length) {
    for (const e of errors) console.log(`RED ${e}`);
    console.log(`AUDIT RED (gate-block-hint): ${errors.length} finding(s)`);
    process.exit(1);
  }
  const totalSites = [...sites.values()].reduce((a, b) => a + b, 0);
  console.log(`AUDIT GREEN (gate-block-hint): ${totalSites} gate block sites carry a gateHint() fix+doc tail; ${docs} doc reference(s) all resolve`);
}

main();
