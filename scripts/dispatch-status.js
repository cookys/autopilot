#!/usr/bin/env node
'use strict';
// dispatch-status — mid-run observability for hetero dispatches (Stage 1 of the
// dispatch-observability plan; BACKLOG "Dispatch observability Stage 1").
//
// PROBLEM: dispatch-hetero.sh / dispatch-review.sh are fire-and-forget — the run's
// identity (log path, worktree, cgroup scope) only surfaced in the FINAL JSON, so
// depth-0 could not locate, watch, or liveness-probe a run mid-flight. The worker
// event stream is ALREADY streamed to a log file live (run_worker `> "$LOG" 2>&1`);
// this tool parses that stream + probes liveness, and the dispatchers now emit a
// START-time run manifest under ${TMPDIR}/autopilot-dispatch-runs/ that names it.
//
// TRUST BOUNDARY (unchanged): everything here is SCHEDULING telemetry, derived from
// the harness event stream / kernel lock / cgroup / git — NEVER from worker
// self-report, and NEVER a verdict input. Artifact verification and fail-closed
// verdict rails are untouched by this tool.
//
// USAGE:
//   dispatch-status.js --run <run-id> [--dir <manifest-dir>] [--stall-secs N]
//   dispatch-status.js --log <path> [--manifest <path>] [--stall-secs N]
//   dispatch-status.js --log <path> --summary [--format F]    # parse-only, no liveness
//   dispatch-status.js --log <path> --usage-only [--format F] # ONE line: usage object or `null`
//   dispatch-status.js --list [--dir <manifest-dir>]
//   --format codex-chrome|jsonl|pi-rpc|plain|auto — the DISPATCHER-declared stream format
//   (manifest `log_format` when reading via --run). Telemetry parsing trusts the
//   declaration, never content sniffing: a worker's own output can contain JSON
//   lines, and sniffing would promote that self-report into telemetry. 'auto'
//   (bare --log with no declaration) is for ad-hoc diagnostics only.
//
// OUTPUT (status mode), one JSON object:
//   { schema, run_id, role, runner, model, phase: "running"|"exited"|"unknown",
//     alive: bool|null, liveness: {lock, pid, scope}, log: {path, exists, bytes,
//     mtime_age_s}, last_event_age_s, events, tool_calls, last_action,
//     files_touched, tokens, usage_source, stall, manifest }
//   Telemetry fields are null when the log format carries no such signal — the
//   parser NEVER fabricates a value ("telemetry unavailable" is an honest answer).
//   files_touched is git-artifact-derived (worktree status/diff), not log-derived.
//
// LOG FORMAT DETECTION (auto): codex-chrome (header "OpenAI Codex v…"; sections
//   user/exec/codex/thinking; trailing "tokens used" + number — empirically
//   captured from codex v0.144.0, see hooks/tests/fixtures/dispatch-status/),
//   jsonl (≥1 parseable JSON line early — generic key scan, not vendor-schema
//   specific), else plain (agy pseudo-TTY / cc-shim text → events/tokens null).
//
// LIVENESS (advisory ordering — lock is primary, pid weakest):
//   lock  — flock(1) -n probe on the worktree lifetime lock (same contract as
//           lib/worktree-reap.sh _wt_is_live; survives dispatcher detach since the
//           detached child inherits the fd). "held" ⇒ live.
//   scope — systemctl --user is-active <scope_unit> (inline cgroup path only).
//   pid   — kill-0; in detach mode the manifest pid is rewritten by the child.
//   alive = any positive signal; all probes unavailable ⇒ alive:null / "unknown".
//
// EXIT: 0 ok (including exited/unknown phases) ; 2 usage error ; 3 manifest/log
//   not found. --usage-only ALWAYS prints `null` on any internal failure and
//   exits 0 (it is embedded in dispatch-hetero's emit path — must never break it).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_STALL_SECS = 180;
const FILES_TOUCHED_CAP = 50;

function manifestDir(explicit) {
  if (explicit) return explicit;
  if (process.env.AUTOPILOT_DISPATCH_RUNS_DIR) return process.env.AUTOPILOT_DISPATCH_RUNS_DIR;
  return path.join(process.env.TMPDIR || '/tmp', 'autopilot-dispatch-runs');
}

function sanitizeRunId(id) {
  return String(id).replace(/[^A-Za-z0-9._-]/g, '-');
}

function readManifest(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('manifest is not a JSON object');
  }
  return parsed;
}

// --- log parsing (format auto-detect; telemetry-null when signal absent) -------

function detectFormat(text) {
  const head = text.slice(0, 4096).split(/\r?\n/);
  for (const line of head) {
    const t = line.trim();
    if (!t) continue;
    if (/^OpenAI Codex v\d/.test(t)) return 'codex-chrome';
  }
  let jsonLines = 0;
  for (const line of head.slice(0, 20)) {
    const t = line.trim();
    if (!t.startsWith('{') || !t.endsWith('}')) continue;
    try { JSON.parse(t); jsonLines += 1; } catch (_e) { /* not JSON */ }
  }
  if (jsonLines >= 1) return 'jsonl';
  // codex header may be preceded by merged stdout noise; scan whole text once
  if (/^OpenAI Codex v\d/m.test(text)) return 'codex-chrome';
  return 'plain';
}

function emptyTokens() {
  return { total_tokens: null, input_tokens: null, output_tokens: null, cache_read_tokens: null };
}

function parseCodexChrome(text) {
  // Empirical format (codex v0.143/0.144, hooks/tests/fixtures/dispatch-status/):
  // section headers on their own line: user / exec / codex / thinking; the run
  // ends with a standalone "tokens used" line followed by a comma-grouped number.
  //
  // Injection posture (gpt-5.5 R3): worker command output is embedded UNESCAPED in
  // this text stream, so any pattern a worker can type is spoofable mid-stream.
  // tokens are therefore TAIL-ANCHORED only — the genuine footer is written by the
  // harness as the very last thing, so anything non-blank after a candidate footer
  // disqualifies it. This nulls tokens for mid-run reads (footer not written yet —
  // honest) and defeats mid-stream fakes. Residual: an ABORTED run whose final
  // output happens to be a crafted fake footer; dispatch-hetero's emit() closes
  // that by extracting usage only on a clean worker exit (genuine footer then
  // always owns the tail). events/tool_calls/last_action remain best-effort
  // HEURISTIC counters in this text format (a worker can echo section-header-like
  // lines) — scheduling color only, never precision inputs.
  const lines = text.split(/\r?\n/);
  let events = 0;
  let toolCalls = 0;
  let lastAction = null;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (t === 'user' || t === 'exec' || t === 'codex' || t === 'thinking') {
      events += 1;
      lastAction = t;
      if (t === 'exec') toolCalls += 1;
    }
  }
  let total = null;
  let i = lines.length - 1;
  while (i >= 0 && lines[i].trim() === '') i -= 1;
  if (i >= 1 && /^[\d,]+$/.test(lines[i].trim()) && lines[i - 1].trim() === 'tokens used') {
    const v = Number(lines[i].trim().replace(/,/g, ''));
    if (Number.isFinite(v)) total = v;
  }
  const tokens = emptyTokens();
  tokens.total_tokens = total;
  const hasTokens = total !== null;
  return { events: events || null, tool_calls: toolCalls, last_action: lastAction, tokens: hasTokens ? tokens : null, usage_source: hasTokens ? 'codex-chrome' : 'none' };
}

function numOrNull(v) {
  return Number.isFinite(v) && v >= 0 ? v : null;
}

function scanTokenKeys(obj, acc) {
  // Generic key scan (NOT a vendor schema claim): accepts the common Anthropic/
  // OpenAI-style usage key spellings wherever they appear in the object tree.
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') { scanTokenKeys(v, acc); continue; }
    if (typeof v !== 'number') continue;
    if (k === 'input_tokens' || k === 'prompt_tokens' || k === 'inputTokens') acc.input = v;
    else if (k === 'output_tokens' || k === 'completion_tokens' || k === 'outputTokens') acc.output = v;
    else if (k === 'cache_read_input_tokens' || k === 'cached_tokens' || k === 'cacheReadInputTokens') acc.cache = v;
    else if (k === 'total_tokens' || k === 'totalTokens') acc.total = v;
  }
}

function parseJsonl(text) {
  const lines = text.split(/\r?\n/);
  let events = 0;
  let toolCalls = 0;
  let lastAction = null;
  const acc = { input: NaN, output: NaN, cache: NaN, total: NaN };
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('{') || !t.endsWith('}')) continue;
    let obj;
    try { obj = JSON.parse(t); } catch (_e) { continue; }
    if (!obj || typeof obj !== 'object') continue;
    events += 1;
    const type = typeof obj.type === 'string' ? obj.type : (typeof obj.event === 'string' ? obj.event : null);
    if (type) lastAction = type;
    if ((type && /tool/i.test(type)) || obj.tool_name || obj.toolName) toolCalls += 1;
    scanTokenKeys(obj, acc); // last-seen wins: cumulative usage events overwrite older ones
  }
  const tokens = emptyTokens();
  tokens.input_tokens = numOrNull(acc.input);
  tokens.output_tokens = numOrNull(acc.output);
  tokens.cache_read_tokens = numOrNull(acc.cache);
  tokens.total_tokens = numOrNull(acc.total);
  if (tokens.total_tokens === null && tokens.input_tokens !== null && tokens.output_tokens !== null) {
    tokens.total_tokens = tokens.input_tokens + tokens.output_tokens;
  }
  const hasTokens = Object.values(tokens).some((v) => v !== null);
  return { events: events || null, tool_calls: toolCalls || (events ? 0 : null), last_action: lastAction, tokens: hasTokens ? tokens : null, usage_source: hasTokens ? 'jsonl' : 'none' };
}

function parsePiRpc(text) {
  // pi-rpc parser is separate because `message.usage` includes a nested `cost`
  // object. The generic recursive JSONL scan would recurse into cost and can
  // incorrectly treat its zeroes as real per-message usage.
  const lines = text.split(/\r?\n/);
  let events = 0;
  let toolCalls = 0;
  let lastAction = null;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let hadUsage = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('{') || !t.endsWith('}')) continue;
    let obj;
    try { obj = JSON.parse(t); } catch (_e) { continue; }
    if (!obj || typeof obj !== 'object') continue;
    events += 1;
    const type = typeof obj.type === 'string' ? obj.type : (typeof obj.event === 'string' ? obj.event : null);
    if (type) lastAction = type;
    if (type === 'tool_execution_start') toolCalls += 1;
    const usage = obj?.message?.usage;
    if (usage && typeof usage === 'object') {
      const iu = Number(usage.input);
      const ou = Number(usage.output);
      const cr = Number(usage.cacheRead);
      if (Number.isFinite(iu)) input += iu;
      if (Number.isFinite(ou)) output += ou;
      if (Number.isFinite(cr)) cacheRead += cr;
      hadUsage = true;
    }
  }
  const tokens = emptyTokens();
  if (hadUsage) {
    tokens.input_tokens = input;
    tokens.output_tokens = output;
    tokens.cache_read_tokens = cacheRead;
    tokens.total_tokens = input + output;
  }
  return {
    events: events || null,
    tool_calls: toolCalls,
    last_action: lastAction,
    tokens: hadUsage ? tokens : null,
    usage_source: hadUsage ? 'pi-rpc' : 'none',
  };
}

function parseLog(logPath, declaredFormat) {
  // declaredFormat is the DISPATCHER's declaration of what stream format it invoked
  // (manifest log_format / --format): the dispatcher knows its own runner flags, so
  // this is a harness-authoritative channel. Content sniffing ('auto') exists ONLY
  // for ad-hoc diagnostics on a bare --log — it must never be the embedded path,
  // because a worker's own output can contain JSON lines (or fake chrome) and
  // sniffing would promote that self-report into telemetry (gpt-5.5 R2 finding).
  const base = { events: null, tool_calls: null, last_action: null, tokens: null, usage_source: 'none', log_bytes: null, format: 'missing' };
  let text;
  try {
    text = fs.readFileSync(logPath, 'utf8');
  } catch (_e) {
    return base;
  }
  base.log_bytes = Buffer.byteLength(text);
  const format = declaredFormat && declaredFormat !== 'auto' ? declaredFormat : detectFormat(text);
  base.format = format;
  if (format === 'codex-chrome') return { ...base, ...parseCodexChrome(text) };
  if (format === 'jsonl') return { ...base, ...parseJsonl(text) };
  if (format === 'pi-rpc') return { ...base, ...parsePiRpc(text) };
  return base; // plain: honest nulls (agy pseudo-TTY / cc-shim text carry no usage)
}

// --- liveness probes ------------------------------------------------------------

function probeLock(lockPath) {
  if (!lockPath) return 'n/a';
  if (!fs.existsSync(lockPath)) return 'n/a';
  // flock(1) -n: acquires+releases if free (rc 0 → NOT live), rc 1 → held (live).
  // Same probe contract as lib/worktree-reap.sh _wt_is_live.
  const r = spawnSync('flock', ['-n', lockPath, 'true'], { stdio: 'ignore', timeout: 5000 });
  if (r.error || typeof r.status !== 'number') return 'unsupported';
  if (r.status === 0) return 'free';
  return 'held';
}

function probePid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return 'n/a';
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (err) {
    if (err && err.code === 'EPERM') return 'alive';
    return 'dead';
  }
}

function probeScope(unit) {
  if (!unit) return 'n/a';
  const r = spawnSync('systemctl', ['--user', 'is-active', unit], { stdio: 'ignore', timeout: 5000 });
  if (r.error || typeof r.status !== 'number') return 'n/a';
  return r.status === 0 ? 'active' : 'inactive';
}

function filesTouched(worktree, baseSha) {
  // Git-artifact-derived (never log/self-report). Null when the worktree is gone
  // (post-success reap) or git fails — an honest "can't tell", not an empty list.
  if (!worktree || !fs.existsSync(worktree)) return null;
  const files = new Set();
  const status = spawnSync('git', ['-C', worktree, 'status', '--porcelain'], { encoding: 'utf8', timeout: 10000 });
  if (status.error || status.status !== 0) return null;
  for (const line of status.stdout.split('\n')) {
    if (line.length > 3) files.add(line.slice(3).trim());
  }
  if (baseSha) {
    const diff = spawnSync('git', ['-C', worktree, 'diff', '--name-only', `${baseSha}..HEAD`], { encoding: 'utf8', timeout: 10000 });
    if (!diff.error && diff.status === 0) {
      for (const line of diff.stdout.split('\n')) {
        const t = line.trim();
        if (t) files.add(t);
      }
    }
  }
  return Array.from(files).slice(0, FILES_TOUCHED_CAP);
}

// --- modes -----------------------------------------------------------------------

function buildStatus(manifest, manifestPath, logOverride, stallSecs, formatOverride) {
  const logPath = logOverride || (manifest ? manifest.log_path : null);
  const declared = formatOverride || (manifest && manifest.log_format) || 'auto';
  const parsed = logPath ? parseLog(logPath, declared) : parseLog('', declared);
  let logStat = null;
  if (logPath && fs.existsSync(logPath)) {
    const st = fs.statSync(logPath);
    logStat = { path: logPath, exists: true, bytes: st.size, mtime_age_s: Math.max(0, Math.round((Date.now() - st.mtimeMs) / 1000)) };
  } else {
    logStat = { path: logPath, exists: false, bytes: null, mtime_age_s: null };
  }

  const liveness = {
    lock: probeLock(manifest ? manifest.lock_path : null),
    pid: probePid(manifest ? manifest.pid : null),
    scope: probeScope(manifest ? manifest.scope_unit : null),
  };
  // flock is PRIMARY and authoritative in BOTH directions (the _wt_is_live contract):
  // the worker inherits the lock fd, so "free" means dispatcher AND worker are gone —
  // a still-"alive" pid at that point is pid reuse, never the run. scope/pid are
  // consulted only when no lock verdict exists (review manifests have no lock).
  let alive;
  if (liveness.lock === 'held') {
    alive = true;
  } else if (liveness.lock === 'free') {
    alive = false;
  } else if (liveness.scope === 'active' || liveness.pid === 'alive') {
    alive = true;
  } else if (liveness.pid === 'n/a' && liveness.scope === 'n/a') {
    alive = null;
  } else {
    alive = false;
  }
  let phase = alive === true ? 'running' : (alive === false ? 'exited' : 'unknown');
  if (manifest && manifest.ended_at) { alive = false; phase = 'exited'; }

  const lastEventAge = logStat.mtime_age_s;
  const stall = alive === true && lastEventAge !== null ? lastEventAge > stallSecs : (alive === true ? null : false);

  return {
    schema: 1,
    run_id: manifest ? manifest.run_id || null : null,
    role: manifest ? manifest.role || null : null,
    runner: manifest ? manifest.runner || null : null,
    model: manifest ? manifest.model || null : null,
    phase,
    alive,
    liveness,
    log: logStat,
    last_event_age_s: lastEventAge,
    events: parsed.events,
    tool_calls: parsed.tool_calls,
    last_action: parsed.last_action,
    files_touched: filesTouched(manifest ? manifest.worktree : null, manifest ? manifest.base_sha : null),
    tokens: parsed.tokens,
    usage_source: parsed.usage_source,
    final_status: manifest ? manifest.final_status || null : null,
    stall,
    manifest: manifestPath || null,
  };
}

function usageOnly(logPath, declaredFormat) {
  // Output discipline: EXACTLY one line — a usage object or the literal `null`.
  // Embedded in dispatch-hetero emit(); must never emit anything else or fail.
  try {
    const parsed = parseLog(logPath, declaredFormat);
    if (!parsed.tokens) { process.stdout.write('null\n'); return; }
    process.stdout.write(`${JSON.stringify({ ...parsed.tokens, source: parsed.usage_source })}\n`);
  } catch (_e) {
    process.stdout.write('null\n');
  }
}

function main(argv) {
  const args = { stallSecs: DEFAULT_STALL_SECS };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--run') { args.run = argv[++i]; }
    else if (a === '--dir') { args.dir = argv[++i]; }
    else if (a === '--log') { args.log = argv[++i]; }
    else if (a === '--manifest') { args.manifest = argv[++i]; }
    else if (a === '--runner') { args.runner = argv[++i]; } // labeling hint only
    else if (a === '--format') { args.format = argv[++i]; } // dispatcher-declared stream format
    else if (a === '--stall-secs') { args.stallSecs = Number(argv[++i]); }
    else if (a === '--summary') { args.summary = true; }
    else if (a === '--usage-only') { args.usageOnly = true; }
    else if (a === '--list') { args.list = true; }
    else if (a === '--help' || a === '-h') { args.help = true; }
    else { process.stderr.write(`unknown argument: ${a}\n`); return 2; }
  }
  if (args.help) {
    const src = fs.readFileSync(__filename, 'utf8');
    for (const line of src.split('\n')) {
      if (line.startsWith('//')) process.stdout.write(`${line.replace(/^\/\/ ?/, '')}\n`);
      else if (!line.startsWith('#!') && !line.startsWith("'use strict'")) break;
    }
    return 0;
  }
  if (!Number.isFinite(args.stallSecs) || args.stallSecs <= 0) {
    process.stderr.write('--stall-secs must be a positive number\n');
    return 2;
  }
  if (args.format && !['codex-chrome', 'jsonl', 'pi-rpc', 'plain', 'auto'].includes(args.format)) {
    // usage-only must still honor its never-fail discipline
    if (args.usageOnly) { process.stdout.write('null\n'); return 0; }
    process.stderr.write('--format must be codex-chrome|jsonl|pi-rpc|plain|auto\n');
    return 2;
  }

  if (args.usageOnly) {
    usageOnly(args.log || '', args.format || 'auto');
    return 0;
  }

  if (args.list) {
    const dir = manifestDir(args.dir);
    let entries = [];
    try {
      entries = fs.readdirSync(dir).filter((f) => f.endsWith('.manifest.json'));
    } catch (_e) { /* absent dir → empty list */ }
    const out = [];
    for (const f of entries) {
      try {
        const m = readManifest(path.join(dir, f));
        out.push({ run_id: m.run_id || null, role: m.role || null, runner: m.runner || null, model: m.model || null, started_at: m.started_at || null, ended_at: m.ended_at || null, manifest: path.join(dir, f) });
      } catch (_e) { /* unreadable manifest skipped */ }
    }
    out.sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
    process.stdout.write(`${JSON.stringify(out)}\n`);
    return 0;
  }

  if (args.summary) {
    if (!args.log) { process.stderr.write('--summary requires --log <path>\n'); return 2; }
    const parsed = parseLog(args.log, args.format || 'auto');
    process.stdout.write(`${JSON.stringify({ events: parsed.events, tool_calls: parsed.tool_calls, last_action: parsed.last_action, tokens: parsed.tokens, usage_source: parsed.usage_source, log_bytes: parsed.log_bytes, format: parsed.format })}\n`);
    return 0;
  }

  let manifest = null;
  let manifestPath = null;
  if (args.run) {
    const dir = manifestDir(args.dir);
    manifestPath = path.join(dir, `${sanitizeRunId(args.run)}.manifest.json`);
    try {
      manifest = readManifest(manifestPath);
    } catch (_e) {
      process.stdout.write(`${JSON.stringify({ error: 'manifest not found or unreadable', run_id: args.run, manifest: manifestPath })}\n`);
      return 3;
    }
  } else if (args.manifest) {
    manifestPath = args.manifest;
    try {
      manifest = readManifest(manifestPath);
    } catch (_e) {
      process.stdout.write(`${JSON.stringify({ error: 'manifest not found or unreadable', manifest: manifestPath })}\n`);
      return 3;
    }
  } else if (!args.log) {
    process.stderr.write('need --run <run-id>, --manifest <path>, or --log <path> (see --help)\n');
    return 2;
  }

  const status = buildStatus(manifest, manifestPath, args.log || null, args.stallSecs, args.format || null);
  process.stdout.write(`${JSON.stringify(status)}\n`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
