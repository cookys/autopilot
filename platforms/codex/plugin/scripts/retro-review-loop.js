#!/usr/bin/env node
'use strict';
/*
 * retro-review-loop.js — the "review-loop lens" for `skills/retro` (Step 1f).
 *
 * Git-history retro (Steps 1a–1e) measures COMMITTED output. For a `/l5`-heavy
 * workflow that is only half the story: the hetero-engine dispatch / decorrelated
 * review / cross-family debate effort mostly never becomes a commit (reviews,
 * harness runs) or is SQUASHED into one (3 dispatch rounds -> 1 commit). This
 * script recovers that invisible middle, deterministically (NO LLM), from two
 * sources:
 *   (A) session transcripts (~/.claude/projects/<encoded-cwd>/*.jsonl) — counts
 *       REAL Bash `tool_use` invocations by dispatch/review pattern. Only actual
 *       tool_use command inputs are counted, so CLAUDE.md / reference-doc content
 *       loaded into context (which mentions these script names) never inflates it.
 *   (B) git commit MESSAGES in the window — review-round / QC-verdict / converged
 *       markers, which encode the loop even when the rounds were squashed.
 *
 * HONESTY: the transcript `review_dispatch` count includes ad-hoc harness/debug
 * runs of dispatch-review.sh, not only decorrelated reviews of a change; the git
 * `review_rounds` / `qc_verdicts` signals are the cleaner "how many review cycles"
 * proxy. Only covers transcripts on THIS machine (fleet work elsewhere is unseen).
 *
 * Usage:
 *   node scripts/retro-review-loop.js [--days N] [--json] [--no-git]
 *       [--transcript-dir <dir>]   # override (default: ~/.claude/projects/<encoded-cwd>)
 * Env: RETRO_TRANSCRIPT_DIR overrides the transcript dir (for tests).
 * Exit: 0 always (fail-safe — a missing transcript dir yields zero counts, not an error).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

function parseArgs(argv) {
  const out = { days: 7, json: false, git: true, transcriptDir: '' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--days') out.days = Number(argv[++i]) || 7;
    else if (a === '--json') out.json = true;
    else if (a === '--no-git') out.git = false;
    else if (a === '--transcript-dir') out.transcriptDir = argv[++i] || '';
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  }
  return out;
}

function printHelp() {
  process.stdout.write(
    'retro-review-loop.js — review-loop lens for skills/retro (Step 1f)\n' +
    '  --days N            window size in days (default 7)\n' +
    '  --json              machine-readable JSON only\n' +
    '  --no-git            skip git commit-message signals (transcript counts only)\n' +
    '  --transcript-dir D  override transcript dir (default ~/.claude/projects/<encoded-cwd>)\n'
  );
}

// The dispatch/review classification. Order matters: first match wins per command.
const PATTERNS = [
  ['impl_dispatch', /dispatch-hetero\.sh\s+--runner/],
  ['review_dispatch', /dispatch-review\.sh\s+--runner/],
  ['codex_exec', /codex\s+exec\b/],
  ['grok_dispatch', /\bgrok\s+-p\b/],
  ['agy_dispatch', /\bagy\s+-p\b/],
  ['explore', /dispatch-explore\.sh/],
  ['author', /dispatch-author\.sh/],
  ['engine_implement_review', /implement-review/],
];

function resolveTranscriptDir(opts) {
  if (opts.transcriptDir) return opts.transcriptDir;
  if (process.env.RETRO_TRANSCRIPT_DIR) return process.env.RETRO_TRANSCRIPT_DIR;
  // Claude Code encodes the project's cwd as the transcript dir name by replacing
  // every non-alphanumeric char with '-'. Mirror that so retro finds this repo's sessions.
  const encoded = process.cwd().replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', encoded);
}

function scanTranscripts(dir, cutoffMs) {
  const result = {
    sessions: 0, total_tool_calls: 0, bash_calls: 0, agent_calls: 0,
    impl_dispatch: 0, review_dispatch: 0, codex_exec: 0, grok_dispatch: 0,
    agy_dispatch: 0, explore: 0, author: 0, engine_implement_review: 0,
  };
  let files = [];
  try {
    files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(dir, f))
      .filter((p) => { try { return fs.statSync(p).mtimeMs >= cutoffMs; } catch { return false; } });
  } catch { return result; } // dir missing -> fail-safe zero counts

  for (const file of files) {
    result.sessions += 1;
    let content = '';
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (o.type !== 'assistant' || !o.message || !Array.isArray(o.message.content)) continue;
      for (const c of o.message.content) {
        if (!c || c.type !== 'tool_use') continue;
        result.total_tool_calls += 1;
        if (c.name === 'Agent') result.agent_calls += 1;
        if (c.name !== 'Bash') continue;
        result.bash_calls += 1;
        const cmd = (c.input && c.input.command) || '';
        for (const [key, re] of PATTERNS) {
          if (re.test(cmd)) { result[key] += 1; break; }
        }
      }
    }
  }
  return result;
}

function gitSignals(days) {
  const sig = { review_rounds: 0, qc_verdicts: 0, converged: 0, versions: 0, available: false };
  let log = '';
  try {
    // `-z` separates COMMITS with NUL — collision-free (commit text can never contain NUL),
    // unlike a printable delimiter that a markdown `===`/fence line in a body could forge.
    log = execSync(
      `git log origin/develop --since="${days} days ago" -z --format="%s%n%b"`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
  } catch {
    return sig; // not a git repo / no origin/develop -> available:false, zero
  }
  sig.available = true;
  // Count COMMITS carrying each signal (not lines) — a `%s%n%b` body with several
  // "QC PASS"/"Rn" lines is ONE review-driven commit, not many. NUL-delimited per commit.
  const commits = log.split('\0').map((c) => c.trim()).filter(Boolean);
  const commitsWith = (re) => commits.filter((c) => re.test(c)).length;
  sig.review_rounds = commitsWith(/gpt-5\.5\s+R[0-9]|review round[s]? [0-9]|\(R[0-9]\)|\b[0-9]+ rounds?\b/i);
  sig.qc_verdicts = commitsWith(/qc[- ]?verdict|qc pass|depth-0 qc/i);
  sig.converged = commitsWith(/converged|SHIP-AS-IS/i);
  const versions = new Set();
  for (const m of log.matchAll(/v2\.[0-9]+\.[0-9]+/g)) versions.add(m[0]);
  sig.versions = versions.size;
  return sig;
}

function main() {
  const opts = parseArgs(process.argv);
  const cutoffMs = Date.now() - opts.days * 86400 * 1000;
  const dir = resolveTranscriptDir(opts);
  const t = scanTranscripts(dir, cutoffMs);
  const g = opts.git ? gitSignals(opts.days) : { available: false, review_rounds: 0, qc_verdicts: 0, converged: 0, versions: 0 };
  const dispatchTotal = t.impl_dispatch + t.review_dispatch + t.codex_exec + t.grok_dispatch + t.agy_dispatch + t.explore + t.author + t.engine_implement_review;

  const out = {
    window_days: opts.days,
    transcript_dir: dir,
    transcript: t,
    hetero_dispatch_total: dispatchTotal,
    git_signals: g,
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }

  const L = [];
  L.push('🔁 Review-Loop Lens (review-loop effort git-history retro cannot see)');
  L.push(`   window: ${opts.days}d | transcripts: ${dir}`);
  L.push('');
  L.push(`   sessions parsed        : ${t.sessions}`);
  L.push(`   total tool_use calls   : ${t.total_tool_calls} (Bash ${t.bash_calls} / Agent ${t.agent_calls})`);
  L.push('   ── hetero-engine dispatch / review / debate (real Bash invocations) ──');
  L.push(`   impl dispatch (hetero) : ${t.impl_dispatch}`);
  L.push(`   review dispatch        : ${t.review_dispatch}   [incl. ad-hoc harness/debug runs]`);
  L.push(`   direct codex exec      : ${t.codex_exec}`);
  L.push(`   agy / grok / explore   : ${t.agy_dispatch} / ${t.grok_dispatch} / ${t.explore}`);
  L.push(`   engine implement-review: ${t.engine_implement_review}`);
  L.push(`   ─────  TOTAL           : ${dispatchTotal} hetero dispatch/review/debate invocations`);
  if (g.available) {
    L.push('   ── git commit-message loop signals (commits carrying each marker) ──');
    L.push(`   review-driven commits  : ${g.review_rounds}   (mention Rn / N rounds)`);
    L.push(`   QC-verdict commits     : ${g.qc_verdicts}`);
    L.push(`   converged / SHIP-AS-IS : ${g.converged}`);
    L.push(`   distinct versions      : ${g.versions}`);
  }
  L.push('');
  L.push('   NOTE: review_dispatch includes harness/debug runs (not only decorrelated');
  L.push('   reviews); the git review-round/QC markers are the cleaner cycle count. Covers');
  L.push('   only transcripts on THIS machine.');
  process.stdout.write(`${L.join('\n')}\n`);
}

main();
