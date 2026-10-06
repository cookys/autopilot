#!/usr/bin/env node
'use strict';

// check-stage-vocab.js — KR4 vocabulary scan for the dev-flow stage-graph migration.
// Report-only by default (always exits 0, one findings JSON object on stdout). `--gate` (P5) makes it a failing gate:
// exit 1 when the total is non-zero. `--repo <consumer>` stays advisory unless `--gate` is passed explicitly.
//
//   node scripts/check-stage-vocab.js [--root <dir>] [--summary] [--gate]
//   node scripts/check-stage-vocab.js --repo <consumer-dir> [--summary] [--gate]
//
// Default mode scans shipped non-history text files under --root (default: this repo; `git ls-files`
// when it is a git work tree, else a directory walk). Excluded paths: CHANGELOG.md, docs/plans/**
// (incl. docs/plans/_archive/**), docs/projects/_archive/**, evals/skill-onoff/packs/**,
// .claude/worktrees/**, node_modules/**, .git/**, and this script plus its test. History/instrument exclusions (P5, by
// exact path or directory prefix; a `platforms/codex/plugin/` mirror of any of them is excluded too) — these are frozen
// or historical inputs, not shipped vocabulary: docs/projects/** (INDEX rows and maintenance logs are history),
// profiles/p0-sources/** (content-addressed P0 baseline snapshots, written once by `build-profile-payload.js snapshot`
// from the baseline commit) and profiles/guided-baseline-dispositions.json (append-only accounting of baseline rules
// by hash; its rationales cite the old ids on purpose), the digest-frozen eval instruments
// (evals/skill-onoff/lib/p1w-markers.sh, lib-r4/p1w-markers.sh, archaeology-scan.js, prereg/**) and the suites pinning
// them (hooks/tests/skill-onoff-p1w-markers.test.sh, skill-onoff-markers.test.sh), the negative eval assertion
// evals/engine-capabilities/no-skill-claim.expected.txt, the backlog-effort suites whose fixtures ARE the old values
// (hooks/tests/check-backlog-entries.test.sh, migrate-backlog-entries.test.sh), and skill-creator-workspace/**
// (recorded 2026-03/05 eval runs).
//
// Categories and patterns (case-sensitive):
//   old_stage_id    L-1..L-5 with optional .N (`L-5.7`), H-9 with optional .N, `S-scope-gate`; and
//                   `S.1`-`S.3` / `F.1`-`F.5` ONLY in a flow context (path under dev-flow, finish-flow,
//                   quality-pipeline, ceo-agent, project-config-template, .claude/, or a line naming
//                   dev-flow / finish-flow). Preceded/followed by word chars, `.`-digit or `-` -> no hit,
//                   so semver (`2.5`), `HTML-5`, `L-50`, section numbers such as `3.1` do not match.
//   old_size_enum   `Fix` or `H` as a whole word in a `**Effort**:` value, or on a SKILL.md/agent
//                   `description:` line.
//   marker_phase    `phase_set_at` anywhere; `--phase` only on a line that names `session-mode`, or
//                   anywhere in a session-mode*.js file (`--phase` is also a legitimate flag of
//                   check-phase-review-receipt.js, which is therefore not flagged).
//   owner_u4        a line that DESCRIBES U4 as the owner rung, within one clause: `U4 owner`, `U4 = owner`,
//                   `U4 (owner)`, `U4 · owner`, `owner (U4)`, `owner rung (U4)`, `owner rung is U4`,
//                   `U4 is the owner`, `U4 as owner`. A negation (not|never|no longer|without|isn't) in the
//                   same clause clears it (`U4 is NOT the owner`, `never U4 as owner`), and a line such as
//                   `U4 experiment ... U5 owner` is not a description of U4 as owner. Excluded by path:
//                   docs/BACKLOG.md, hooks/tests/mission-convergence.test.sh (unrelated U4).
//
// --repo <dir> scans a consumer repo's `.claude/*.md` and backlog files (BACKLOG.md, docs/BACKLOG.md,
// docs/backlog/*.md) for old_stage_id and old_size_enum, printing each stale line with a replacement
// hint (Fix->S, H->S!, L-5->finish, ...).
//
// Exit codes: 0 for a completed scan (findings are in the JSON), or in --gate mode when the total is 0; 1 in --gate mode
// when the total is non-zero; 2 usage / unreadable root.
// Node >= 20.10, built-ins only.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SELF_EXCLUDES = ['scripts/check-stage-vocab.js', 'hooks/tests/check-stage-vocab.test.sh', 'platforms/codex/plugin/scripts/check-stage-vocab.js'];
// marker_phase exemptions (P2b, plan §0.7). (1) Digest-frozen history that still names the removed phase flag: the frozen eval
// markers library and the suite pinning it against recorded transcripts. (2) The suite whose whole job is to pin that the
// removed flag is rejected. (3) A single line carrying the token `stage-vocab-allow` (a deliberate negative mention, e.g.
// the rejection message itself). Exempt from marker_phase only.
const MARKER_PHASE_HISTORY = ['evals/skill-onoff/lib/p1w-markers.sh', 'hooks/tests/skill-onoff-p1w-markers.test.sh', 'hooks/tests/session-mode-phase.test.sh'];
const MARKER_PHASE_ALLOW_TOKEN = 'stage-vocab-allow';
const EXCLUDE_PREFIXES = [
  'CHANGELOG.md',
  'docs/plans/',
  'docs/projects/_archive/',
  'evals/skill-onoff/packs/',
  '.claude/worktrees/',
  'node_modules/',
  '.git/',
];
const HISTORY_EXCLUDES = [
  'docs/projects/',
  'profiles/p0-sources/',
  'profiles/guided-baseline-dispositions.json',
  'evals/skill-onoff/lib/p1w-markers.sh',
  'evals/skill-onoff/lib-r4/p1w-markers.sh',
  'evals/skill-onoff/archaeology-scan.js',
  'evals/skill-onoff/prereg/',
  'hooks/tests/skill-onoff-p1w-markers.test.sh',
  'hooks/tests/skill-onoff-markers.test.sh',
  'evals/engine-capabilities/no-skill-claim.expected.txt',
  'hooks/tests/check-backlog-entries.test.sh',
  'hooks/tests/migrate-backlog-entries.test.sh',
  'skill-creator-workspace/',
];
const CODEX_MIRROR = 'platforms/codex/plugin/';
const U4_EXCLUDE_PATHS = ['docs/BACKLOG.md', 'hooks/tests/mission-convergence.test.sh'];
const TEXT_EXT = new Set(['.md', '.js', '.cjs', '.mjs', '.ts', '.tsx', '.sh', '.json', '.yml', '.yaml', '.txt', '.py']);
const MAX_BYTES = 2 * 1024 * 1024;

const RE_LH = /(?<![\w.-])(?:L-[1-5](?:\.\d+)?|H-9(?:\.\d+)?)(?![\w-]|\.\d)/g;
const RE_SCOPE = /(?<![\w.-])S-scope-gate(?![\w])/g;
const RE_SF = /(?<![\w.-])(?:S\.[1-3]|F\.[1-5])(?![\w-]|\.\d)/g;
const FLOW_PATH = /(^|\/)(dev-flow|finish-flow|quality-pipeline|ceo-agent|project-config-template)(\/|$)|^\.claude\//;
const FLOW_LINE = /dev-flow|finish-flow|finish flow/i;
const RE_EFFORT = /\*\*Effort\*\*:\s*(.*)$/;
const RE_SIZE_WORD = /(?<![\w.-])(?:Fix|H)(?![\w-])/;
const RE_U4 = /(?<![\w.])U4(?![\w])/;
// U4 described as the owner rung (see the owner_u4 header note). `U4`-adjacent forms and `owner`-first forms.
const RE_U4_AS_OWNER = [
  /(?<![\w.])U4\s*(?:=|·|:|—|–|-|\/)?\s*\(?\s*owner/i,
  /(?<![\w.])U4\s+(?:is|as)\s+(?:the\s+)?owner/i,
  /owner(?:\s+rung)?\s*\(\s*U4\s*\)/i,
  /owner(?:\s+rung)?\s+(?:is|=)\s+U4(?![\w])/i,
];
const RE_NEGATION = /\b(?:not|never|no longer|without)\b|n't\b/i;

function norm(p) {
  return p.split(path.sep).join('/');
}

function stageHint(m) {
  if (m === 'S-scope-gate') return 'removed: sizing is the S/M/L/XL choice (stage-graph.js limits --size <S>)';
  if (/^(L-5\.2|H-9\.2)$/.test(m)) return 'qc-gate';
  if (/^(L-5|H-9)(\.|$)/.test(m)) return 'finish';
  if (/^L-[1-4]/.test(m)) return 'intent/proposal/plan/plan-review/implement (node scripts/stage-graph.js nodes --size L)';
  if (/^S\./.test(m)) return 'qc-gate/finish (node scripts/stage-graph.js nodes --size S)';
  if (/^F\./.test(m)) return 'finish (node scripts/stage-graph.js nodes --size S)';
  return null;
}

function listFiles(root) {
  const g = spawnSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const top = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  const isOwnTop = top.status === 0 && fs.realpathSync(top.stdout.trim()) === fs.realpathSync(root);
  if (g.status === 0 && isOwnTop) return g.stdout.split('\n').filter(Boolean);
  const res = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = norm(path.relative(root, path.join(dir, e.name)));
      if (EXCLUDE_PREFIXES.some((x) => (rel + '/').startsWith(x) || rel === x)) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.isFile()) res.push(rel);
    }
  };
  walk(root);
  return res;
}

function excluded(rel) {
  if (SELF_EXCLUDES.includes(rel) || SELF_EXCLUDES.some((x) => rel === `platforms/codex/plugin/${x}`)) return true; // the codex mirror is the same file
  const canon = rel.startsWith(CODEX_MIRROR) ? rel.slice(CODEX_MIRROR.length) : rel;
  if (HISTORY_EXCLUDES.some((x) => canon === x || (x.endsWith('/') && canon.startsWith(x)))) return true;
  return EXCLUDE_PREFIXES.some((x) => rel === x || rel.startsWith(x) || canon === x || canon.startsWith(x));
}

function readText(root, rel) {
  const full = path.join(root, rel);
  if (!TEXT_EXT.has(path.extname(rel))) return null;
  try {
    const st = fs.statSync(full);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return fs.readFileSync(full, 'utf8');
  } catch (e) {
    return null;
  }
}

function clip(s) {
  const t = s.trim();
  return t.length > 200 ? `${t.slice(0, 197)}...` : t;
}

function scanStageAndSize(rel, lines, add, withHints) {
  const inFlowPath = FLOW_PATH.test(rel);
  const isSkillOrAgent = /(^|\/)(SKILL\.md|agents\/[^/]+\.md)$/.test(rel);
  lines.forEach((line, i) => {
    const n = i + 1;
    for (const re of [RE_LH, RE_SCOPE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) add('old_stage_id', rel, n, line, m[0], withHints ? stageHint(m[0]) : undefined);
    }
    if (inFlowPath || FLOW_LINE.test(line)) {
      RE_SF.lastIndex = 0;
      let m;
      while ((m = RE_SF.exec(line))) add('old_stage_id', rel, n, line, m[0], withHints ? stageHint(m[0]) : undefined);
    }
    const eff = RE_EFFORT.exec(line);
    if (eff) {
      const w = RE_SIZE_WORD.exec(eff[1]);
      if (w) add('old_size_enum', rel, n, line, w[0], withHints ? (w[0] === 'Fix' ? 'S' : 'S!') : undefined);
    }
    if (isSkillOrAgent && /^description:/.test(line)) {
      const w = RE_SIZE_WORD.exec(line);
      if (w) add('old_size_enum', rel, n, line, w[0], withHints ? (w[0] === 'Fix' ? 'S' : 'S!') : undefined);
    }
  });
}

function scanMarkerPhase(rel, lines, add) {
  if (MARKER_PHASE_HISTORY.includes(rel)) return;
  if (/^hooks\/tests\/fixtures\/session-marker\/invalid-[^/]*\.json$/.test(rel)) return; // intentional legacy examples
  const sessionModeFile = /(^|\/)session-mode[^/]*\.js$/.test(rel);
  lines.forEach((line, i) => {
    if (line.includes(MARKER_PHASE_ALLOW_TOKEN)) return;
    if (/phase_set_at/.test(line)) add('marker_phase', rel, i + 1, line, 'phase_set_at');
    if (/--phase(?![\w-])/.test(line) && (sessionModeFile || /session-mode/.test(line))) {
      add('marker_phase', rel, i + 1, line, '--phase');
    }
  });
}

function scanU4(rel, lines, add) {
  if (U4_EXCLUDE_PATHS.includes(rel)) return;
  lines.forEach((line, i) => {
    if (!RE_U4.test(line)) return;
    // Clause = the line split at sentence/semicolon boundaries; a negation in the clause clears the match.
    const hit = line.split(/[.;]\s|;/).some((clause) => RE_U4_AS_OWNER.some((re) => re.test(clause)) && !RE_NEGATION.test(clause));
    if (hit) add('owner_u4', rel, i + 1, line, 'U4');
  });
}

// process.exit() after process.stdout.write truncates a piped result at 64 KiB; write synchronously, retrying EAGAIN.
function writeStdout(text) {
  const buf = Buffer.from(text);
  let off = 0;
  while (off < buf.length) {
    try { off += fs.writeSync(1, buf, off, buf.length - off); } catch (err) { if (err.code !== 'EAGAIN') throw err; }
  }
}

function parseArgs(argv) {
  const o = { root: path.resolve(__dirname, '..'), repo: null, summary: false, gate: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--summary') o.summary = true;
    else if (a === '--gate') o.gate = true;
    else if (a === '--root' || a === '--repo') {
      if (argv[i + 1] === undefined) {
        process.stderr.write(`check-stage-vocab: ${a} needs a value\n`);
        process.exit(2);
      }
      if (a === '--root') o.root = path.resolve(argv[++i]);
      else o.repo = path.resolve(argv[++i]);
    } else {
      process.stderr.write(`check-stage-vocab: unknown argument ${a}\n`);
      process.exit(2);
    }
  }
  return o;
}

function consumerFiles(dir) {
  const res = [];
  const addDir = (sub, re) => {
    const d = path.join(dir, sub);
    if (!fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d)) if (re.test(f) && fs.statSync(path.join(d, f)).isFile()) res.push(norm(path.join(sub, f)));
  };
  addDir('.claude', /\.md$/);
  addDir('docs/backlog', /\.md$/);
  for (const f of ['BACKLOG.md', 'docs/BACKLOG.md']) if (fs.existsSync(path.join(dir, f))) res.push(f);
  return res;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const base = o.repo || o.root;
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
    process.stderr.write(`check-stage-vocab: not a directory: ${base}\n`);
    process.exit(2);
  }
  const findings = [];
  const add = (category, file, line, text, match, hint) => {
    const f = { category, file, line, match, text: clip(text) };
    if (hint) f.hint = hint;
    findings.push(f);
  };
  const files = o.repo ? consumerFiles(base) : listFiles(base).filter((r) => !excluded(r));
  for (const rel of files) {
    const text = readText(base, rel);
    if (text === null) continue;
    const lines = text.split('\n');
    scanStageAndSize(rel, lines, add, Boolean(o.repo));
    if (!o.repo) {
      scanMarkerPhase(rel, lines, add);
      scanU4(rel, lines, add);
    }
  }
  const counts = { old_stage_id: 0, old_size_enum: 0, marker_phase: 0, owner_u4: 0 };
  for (const f of findings) counts[f.category]++;
  const total = findings.length;
  const result = { mode: o.repo ? 'repo' : 'scan', root: base, report_only: !o.gate, counts, total };
  if (!o.summary) result.findings = findings;
  writeStdout(`${JSON.stringify(result)}\n`);
  process.stderr.write(
    `check-stage-vocab: ${total} hit(s) — ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')} ${o.gate ? '(gate)' : '(report-only)'}\n`,
  );
  process.exit(o.gate && total > 0 ? 1 : 0);
}

main();
