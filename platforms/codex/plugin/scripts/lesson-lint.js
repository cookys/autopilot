#!/usr/bin/env node
/**
 * lesson-lint — lint Claude Code memory files of `type: feedback`.
 *
 * Operator rule: a lesson becomes a script, hook or lint within 14 days, or is deleted.
 * Frontmatter (between `---` lines; fields top-level or under `metadata:`) needs
 *   created:   YYYY-MM-DD (optional time)
 *   mechanism: a path-like token (contains `/` and an extension, e.g. scripts/foo.js)
 *              or a fleet task id (26-char ULID)
 * Only the frontmatter is read; bodies are never printed. MEMORY.md and non-feedback types are skipped.
 *
 * Usage:
 *   node scripts/lesson-lint.js check --dir <memory dir> [--now <ISO>] [--json]
 *     findings: missing_created, missing_mechanism, overdue (created > 14 days ago AND no mechanism).
 *     --json prints {schema:"lesson-lint/1", files, findings:[{file,name,code,created}]}.
 *     Exit 0 clean, 1 findings, 2 usage.
 *   node scripts/lesson-lint.js stop-hook --dir <memory dir>
 *     Stop hook (hook JSON on stdin). Blocks ({"decision":"block","reason":...}) when (a) a feedback file
 *     in --dir was modified after the last real user message of the transcript and lacks a valid
 *     mechanism, or (b) any overdue finding exists. stop_hook_active is NOT a bypass (same as
 *     hooks/owner-question-guard.js), or (c) rule-capture: the last real user message of the turn contains
 *     a marker from RULE_MARKERS (e.g. 以後, 一律, 在給我) and this turn shows no capture: an edit of a
 *     CLAUDE.md / AGENTS.md / skills path, a memory .md write with `mechanism:`, a `*__dispatch` call, a
 *     `ledger.sh ... decision` command, assistant text naming CLAUDE.md or skill, or `[no-rule: <reason>]`.
 *     The block reason prints only the matched marker, never the user message. Several rules blocking
 *     give one block with all reasons. Every matched-marker Stop appends one row to
 *     $AUTOPILOT_RULE_CAPTURE_LOG (default $XDG_STATE_HOME/autopilot/rule-capture.jsonl): schema
 *     rule-capture-log/1, ts, session_id, marker, outcome block|no_rule|pass, pass_by?, no_rule_reason?.
 *     Fail-open: unreadable dir/transcript -> one stderr line, exit 0.
 *
 * Install (PM, own settings; NOT registered in hooks/hooks.json), under Stop:
 *   {"type":"command","command":"node <repo>/scripts/lesson-lint.js stop-hook --dir <memory dir>"}
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const OVERDUE_DAYS = 14;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function parseFrontmatter(text) {
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') return null;
  const fields = {};
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') return fields;
    const m = lines[i].match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const v = m[2].replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!(m[1] in fields) || v) fields[m[1]] = v;
  }
  return null; // unterminated frontmatter
}

function validMechanism(v) {
  if (!v) return false;
  return ULID.test(v) || (v.includes('/') && /\.[A-Za-z0-9]+$/.test(v));
}

function lintDir(dir, nowMs) {
  const files = [];
  const findings = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.md') || f === 'MEMORY.md') continue;
    const full = path.join(dir, f);
    let fm;
    try { fm = parseFrontmatter(fs.readFileSync(full, 'utf8')); } catch { continue; }
    if (!fm || fm.type !== 'feedback') continue;
    files.push(f);
    const name = fm.name || f.replace(/\.md$/, '');
    const created = fm.created || '';
    const createdOk = ISO_DATE.test(created) && Number.isFinite(Date.parse(created));
    const add = (code) => findings.push({ file: f, name, code, created: createdOk ? created : null });
    if (!createdOk) add('missing_created');
    const mech = validMechanism(fm.mechanism);
    if (!mech) add('missing_mechanism');
    if (!mech && createdOk && nowMs - Date.parse(created) > OVERDUE_DAYS * 86400000) add('overdue');
  }
  return { files, findings };
}

function parseArgs(argv) {
  const o = { json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') o.json = true;
    else if (argv[i] === '--dir' || argv[i] === '--now') { o[argv[i].slice(2)] = argv[i + 1]; i += 1; } else return null;
  }
  return o;
}

function cmdCheck(o) {
  const nowMs = o.now ? Date.parse(o.now) : Date.now();
  if (!o.dir || !Number.isFinite(nowMs)) return usage();
  let r;
  try { r = lintDir(o.dir, nowMs); } catch (e) { process.stderr.write(`lesson-lint: ${e.message}\n`); return 2; }
  if (o.json) {
    process.stdout.write(`${JSON.stringify({ schema: 'lesson-lint/1', files: r.files, findings: r.findings })}\n`);
  } else {
    process.stdout.write(`lesson-lint: ${r.files.length} feedback file(s), ${r.findings.length} finding(s)\n`);
    for (const f of r.findings) process.stdout.write(`  ${f.code}  ${f.file}${f.created ? `  (created ${f.created})` : ''}\n`);
  }
  return r.findings.length ? 1 : 0;
}

// Timestamp (ms) of the last real user message (not a pure tool_result entry), or null.
function lastUserTs(transcript) {
  const lines = transcript.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].trim()) continue;
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    const role = e && (e.type || (e.message && e.message.role));
    if (role !== 'user') continue;
    const content = e.message && e.message.content;
    if (Array.isArray(content) && content.length && content.every((b) => b && b.type === 'tool_result')) continue;
    const t = Date.parse(e.timestamp);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

// Closed list of rule-like markers for the rule-capture Stop rule (case-insensitive, first hit in list order).
// Narrowest markers for "X 的再給我 / 交給我 / 在給我": 在給我, 再給我, 交給我 (bare 給我 is too broad);
// 「花錢的在給我吧」 is caught by 在給我.
const RULE_MARKERS = [
  '以後', '之後都', '都要', '一律', '不要再', '別再', '規則', '應該', '每次', '每一次', '永遠', '從現在起', '下次', '記得',
  '在給我', '再給我', '交給我',
  'from now on', 'always', 'never again', 'every time', 'rule',
];
const CAPTURE_REASON = '操作員這句像是規則：PM 的寫進 pm/CLAUDE.md；全機隊的交給 hangar rollout 全域 CLAUDE.md；'
  + '某條 lane 的就 dispatch 給它，改它 repo 的 CLAUDE.md 或 skill；如果不是規則，加 [no-rule: 原因]';
const INJECTED = /^\s*<(?:system-reminder|user-prompt-submit-hook|command-name|command-message|local-command|task-notification)/;

function entryBlocks(e) {
  const c = e && e.message && e.message.content;
  if (typeof c === 'string') return [{ type: 'text', text: c }];
  return Array.isArray(c) ? c.filter(Boolean) : [];
}

// {text, after} for the last real user message (not tool_result-only, not meta/hook-injected), or null.
function lastUserTurn(transcript) {
  const entries = [];
  for (const line of transcript.split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* skip */ }
  }
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (!e || (e.type || (e.message && e.message.role)) !== 'user' || e.isMeta) continue;
    const blocks = entryBlocks(e);
    if (blocks.length && blocks.every((b) => b.type === 'tool_result')) continue;
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n');
    if (!text.trim() || INJECTED.test(text)) continue;
    return { text, after: entries.slice(i + 1) };
  }
  return null;
}

// -> null (no marker) or {marker, outcome: block|no_rule|pass, pass_by?, no_rule_reason?, reason?}.
function ruleCapture(turn) {
  const low = turn.text.toLowerCase();
  const marker = RULE_MARKERS.find((m) => low.includes(m));
  if (!marker) return null;
  const pass = (pass_by) => ({ marker, outcome: 'pass', pass_by });
  let mention = false;
  for (const e of turn.after) {
    if ((e.type || (e.message && e.message.role)) !== 'assistant') continue;
    for (const b of entryBlocks(e)) {
      if (b.type === 'text') {
        const t = b.text || '';
        const nr = t.match(/\[no-rule:\s*([^\]\s][^\]]*)\]/);
        if (nr) return { marker, outcome: 'no_rule', no_rule_reason: nr[1].trim().slice(0, 120) };
        if (/CLAUDE\.md|skill/i.test(t)) mention = true;
      } else if (b.type === 'tool_use') {
        const name = b.name || '';
        const inp = b.input || {};
        const fp = typeof inp.file_path === 'string' ? inp.file_path : '';
        if (/__dispatch$/.test(name)) return pass('dispatch');
        if (/^(Edit|Write|NotebookEdit)$/.test(name)) {
          if (/^(CLAUDE|AGENTS)\.md$/.test(path.basename(fp))) return pass('claude_md');
          if (fp.includes('/skills/')) return pass('skills');
          if (fp.endsWith('.md') && /^\s*mechanism\s*:/m.test(`${inp.content || ''}\n${inp.new_string || ''}`)) return pass('memory_mechanism');
        }
        if (name === 'Bash' && typeof inp.command === 'string' && inp.command.includes('ledger.sh') && inp.command.includes('decision')) return pass('ledger');
      }
    }
  }
  if (mention) return pass('mention');
  return { marker, outcome: 'block', reason: `${CAPTURE_REASON} [${marker}]` };
}

// One JSONL row per Stop where a marker matched. Never the user message. Failure -> one stderr line only.
function logCapture(cap, sessionId) {
  try {
    const file = process.env.AUTOPILOT_RULE_CAPTURE_LOG
      || path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'autopilot', 'rule-capture.jsonl');
    const row = { schema: 'rule-capture-log/1', ts: new Date().toISOString(), session_id: sessionId || null, marker: cap.marker, outcome: cap.outcome };
    if (cap.pass_by) row.pass_by = cap.pass_by;
    if (cap.no_rule_reason) row.no_rule_reason = cap.no_rule_reason;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
  } catch (err) {
    process.stderr.write(`lesson-lint: rule-capture log failed: ${err && err.message}\n`);
  }
}

function cmdStopHook(o) {
  try {
    if (!o.dir) throw new Error('--dir required');
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const r = lintDir(o.dir, Date.now());
    const problems = [];
    const turnStart = typeof input.transcript_path === 'string' && input.transcript_path
      ? lastUserTs(fs.readFileSync(input.transcript_path, 'utf8')) : null;
    const missing = new Set(r.findings.filter((f) => f.code === 'missing_mechanism').map((f) => f.file));
    if (turnStart !== null) {
      for (const f of missing) {
        if (fs.statSync(path.join(o.dir, f)).mtimeMs > turnStart) problems.push(`${f}: 這輪新增或修改的 feedback 教訓沒有 mechanism`);
      }
    }
    for (const f of r.findings) if (f.code === 'overdue') problems.push(`${f.file}: 建立於 ${f.created}，超過 ${OVERDUE_DAYS} 天仍沒有 mechanism`);
    const reasons = [];
    if (problems.length) {
      reasons.push(`教訓必須在 ${OVERDUE_DAYS} 天內變成腳本、hook 或 lint，否則刪除：\n${problems.join('\n')}\n`
        + '請在該檔 frontmatter 加 `mechanism:`（腳本／hook／lint 路徑或 fleet task id），或刪掉這則教訓。');
    }
    if (typeof input.transcript_path === 'string' && input.transcript_path) {
      const turn = lastUserTurn(fs.readFileSync(input.transcript_path, 'utf8'));
      const cap = turn && ruleCapture(turn);
      if (cap) {
        logCapture(cap, input.session_id);
        if (cap.outcome === 'block') reasons.push(cap.reason);
      }
    }
    if (reasons.length) process.stdout.write(`${JSON.stringify({ decision: 'block', reason: reasons.join('\n') })}\n`);
  } catch (err) {
    process.stderr.write(`lesson-lint: fail-open: ${err && err.message}\n`);
  }
  return 0;
}

function usage() {
  process.stderr.write('usage: lesson-lint.js check --dir <dir> [--now <ISO>] [--json] | stop-hook --dir <dir>\n');
  return 2;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const o = parseArgs(rest);
  if (!o) return usage();
  if (cmd === 'check') return cmdCheck(o);
  if (cmd === 'stop-hook') return cmdStopHook(o);
  return usage();
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { parseFrontmatter, validMechanism, lintDir, lastUserTs, RULE_MARKERS };
