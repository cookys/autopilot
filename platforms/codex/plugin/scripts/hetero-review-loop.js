#!/usr/bin/env node
'use strict';

// hetero-review-loop.js — multi-seat review loop driver: collect / finalize / opt-out (see --help).
// Packet mode (--packets <file> --packet <id>) carries a range too big for one review packet by
// splitting it BY PATH into per-packet phases that a set check proves cover the range exactly once
// (check-phase-review-receipt.js --packets); it never excludes a path. Without those flags every
// behavior is unchanged. Plan: project/plans/_archive/2026/10/2026-10-11-review-packet-mode.md.

const fs = require('fs');
const path = require('path');
const process = require('process');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const deriveReceiptState = require('./lib/review-chain-derive');
const { majorDispositionError, downgradeMisuseError } = deriveReceiptState;
const { isSafeSeatId } = require('./lib/seat-id-guard');
const { stageWrite, familyOfEngine } = require('./lib/stage-write');
const { invalidSeatModels } = require('./lib/seat-model-id');

function assertSafeSeatId(id) {
  if (!isSafeSeatId(id)) {
    console.error(`ERROR: Unsafe seat id '${id}'`);
    process.exit(1);
  }
}

function writeFileSyncAtomic(targetPath, content) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpName = `.tmp-${Date.now()}-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const tmpPath = path.join(dir, tmpName);
  try {
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch (_e) {}
    throw err;
  }
}

// Exclusive lock around a chain.json read-modify-write. mkdir is atomic, so the lock directory
// <chain>.lock is the mutex. The holder writes a pid+random token file inside it and release() removes
// the lock only while that token is still there, so a holder whose lock was broken as stale can never
// delete its successor's lock. A stale lock (crashed holder) is broken by atomically renaming the
// directory to a unique tombstone (only one waiter's rename can succeed) and re-checking the
// tombstone's age before discarding it. Waiting is bounded: past the timeout the caller gets a loud
// error instead of a lost or interleaved update. A process.on('exit') hook releases the lock on any
// process.exit inside the locked region.
function acquireChainLock(chainPath) {
  const lockPath = `${chainPath}.lock`;
  const timeoutMs = Number(process.env.AUTOPILOT_CHAIN_LOCK_TIMEOUT_MS) > 0 ? Number(process.env.AUTOPILOT_CHAIN_LOCK_TIMEOUT_MS) : 15000;
  const staleMs = Number(process.env.AUTOPILOT_CHAIN_LOCK_STALE_MS) > 0 ? Number(process.env.AUTOPILOT_CHAIN_LOCK_STALE_MS) : 30000;
  const ownerFile = path.join(lockPath, 'owner');
  const token = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  fs.mkdirSync(path.dirname(chainPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.mkdirSync(lockPath);
      try { fs.writeFileSync(ownerFile, token); } catch (_e) { /* a breaker may already have taken the dir; release() re-checks */ }
      break;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
      let ageMs;
      try { ageMs = Date.now() - fs.statSync(lockPath).mtimeMs; } catch (_e) { continue; } // released meanwhile: retry
      if (ageMs > staleMs) {
        const tomb = `${lockPath}.dead-${token}`;
        try { fs.renameSync(lockPath, tomb); } catch (_e) { continue; } // another waiter won the break
        let tombAge = Infinity;
        try { tombAge = Date.now() - fs.statSync(tomb).mtimeMs; } catch (_e) { /* gone */ }
        if (tombAge <= staleMs) {
          // The lock was replaced by a fresh holder between our stat and rename: put it back.
          try { fs.renameSync(tomb, lockPath); continue; } catch (_e) { /* fall through to discard */ }
        }
        try { fs.rmSync(tomb, { recursive: true, force: true }); } catch (_e) { /* best effort */ }
        continue;
      }
      if (Date.now() >= deadline) {
        console.error(`ERROR: Timed out after ${timeoutMs}ms waiting for the chain.json lock ${lockPath} (another collect/finalize holds it; remove it if none is running)`);
        process.exit(1);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    process.removeListener('exit', release);
    try {
      if (fs.readFileSync(ownerFile, 'utf8') !== token) return; // not ours any more
      fs.rmSync(lockPath, { recursive: true, force: true });
    } catch (_e) { /* already gone */ }
  };
  process.on('exit', release);
  return release;
}

// Events feed (autopilot.events/1, src/status/events/sources/review.js): remember where this repo's ledgers live.
// One O_APPEND write of one short line to <git-common-dir>/autopilot/review-ledgers.txt, called with the chain lock
// held. Fail-open and silent: a feed pointer never changes a review's output or exit code. Readers dedupe and trim
// lines, so a lost race only duplicates a line.
function recordLedgerPointer(ledgerDir, repoRoot) {
  try {
    const cwd = repoRoot || process.cwd();
    const res = spawnSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8', cwd });
    if (res.status !== 0 || !res.stdout) return;
    const commonDir = fs.realpathSync(path.resolve(cwd, res.stdout.trim()));
    const line = `${path.resolve(ledgerDir)}\n`;
    if (Buffer.byteLength(line) > 4000) return;
    const pointer = path.join(commonDir, 'autopilot', 'review-ledgers.txt');
    fs.mkdirSync(path.dirname(pointer), { recursive: true });
    try {
      if (fs.readFileSync(pointer, 'utf8').split('\n').some((l) => l.trim() === path.resolve(ledgerDir))) return;
    } catch (_e) { /* no pointer file yet */ }
    const fd = fs.openSync(pointer, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT, 0o644);
    try { fs.writeSync(fd, line); } finally { fs.closeSync(fd); }
  } catch (_e) { /* fail-open */ }
}

function withChainLock(chainPath, fn) {
  const release = acquireChainLock(chainPath);
  try {
    return fn();
  } finally {
    release();
  }
}

// Trusted floor for reviewed seats — the SAME sources check-phase-review-receipt.js honours
// (--min-reviewed-seats flag, else AUTOPILOT_MIN_REVIEWED_SEATS, else all seats), same grammar.
const CANONICAL_POSITIVE_INT_RE = /^[1-9][0-9]*$/;
function resolveMinReviewedSeats(flags, totalSeats) {
  let raw; let source;
  if (flags['min-reviewed-seats'] !== undefined) { raw = flags['min-reviewed-seats']; source = '--min-reviewed-seats'; }
  else if (flags['min-seats'] !== undefined) { raw = flags['min-seats']; source = '--min-seats'; }
  else if (flags['min_reviewed_seats'] !== undefined) { raw = flags['min_reviewed_seats']; source = '--min_reviewed_seats'; }
  else if (process.env.AUTOPILOT_MIN_REVIEWED_SEATS !== undefined) { raw = process.env.AUTOPILOT_MIN_REVIEWED_SEATS; source = 'AUTOPILOT_MIN_REVIEWED_SEATS'; }
  else return { value: totalSeats === null ? null : totalSeats, source: 'default: all seats' };
  const str = String(raw);
  if (!CANONICAL_POSITIVE_INT_RE.test(str)) {
    console.error(`ERROR: Invalid ${source} value '${raw}': must be a canonical positive integer`);
    process.exit(1);
  }
  return { value: parseInt(str, 10), source };
}

const { EXCLUDE_ALLOWLIST, isPathspecAllowed, loadConsumerExcludeAllowlist } = require('./lib/exclude-allowlist');
const reviewPackets = require('./lib/review-packets');

// Packet mode (collect/finalize): --packets <packets.json> --packet <id> makes this call one packet of a
// packet set — its own phase `<set>-<id>`, reviewing only that packet's files of the full range. Returns
// null when neither flag is given (the unchanged, whole-range path). Plan: project/plans/_archive/2026/10/2026-10-11-review-packet-mode.md.
function resolvePacketFlags(flags) {
  if (flags.packets === undefined && flags.packet === undefined) return null;
  if (typeof flags.packets !== 'string' || typeof flags.packet !== 'string') {
    console.error('ERROR: --packets <packets.json> and --packet <id> must be given together');
    process.exit(2);
  }
  if (flags.exclude !== undefined) {
    console.error('ERROR: --exclude cannot be combined with --packets: a packet set covers every changed path, it never leaves one out');
    process.exit(2);
  }
  const loaded = reviewPackets.loadPacketsFile(path.resolve(flags.packets));
  if (!loaded.ok) {
    console.error(`ERROR: Invalid packets file: ${loaded.errors.join('; ')}`);
    process.exit(1);
  }
  if (!Object.prototype.hasOwnProperty.call(loaded.packets, flags.packet)) {
    console.error(`ERROR: Unknown packet '${flags.packet}' (the set '${loaded.set}' has: ${Object.keys(loaded.packets).join(', ')})`);
    process.exit(2);
  }
  const phase = reviewPackets.packetPhase(loaded.set, flags.packet);
  if (flags.phase !== undefined && flags.phase !== phase) {
    console.error(`ERROR: --phase '${flags.phase}' conflicts with the packet phase '${phase}' (derived as <set>-<packet>); omit --phase`);
    process.exit(2);
  }
  return {
    set: loaded.set,
    id: flags.packet,
    phase,
    packets: loaded.packets,
    paths: loaded.packets[flags.packet],
    sha256: loaded.sha256,
    file: path.resolve(flags.packets),
  };
}

function showHelp() {
  console.log(`Usage: node scripts/hetero-review-loop.js <subcommand> [flags]

Subcommands:
  collect     Collect reviews across seat panel for a generation
  finalize    Finalize review generation, aggregate verdict, and write receipt
  refinalize  Re-derive chain stamps, verdict and receipt of an already finalized chain (--generation = last entry);
              refuses when any finalized generation's findings/dispositions no longer match their recorded sha256
              --add-resolutions <file> [--repo-root <path>]: file = [{ id, rationale, fix_sha, reviewed_head }];
              closes open verified findings after the fact through review-<phase>/resolutions-addendum.json
              (pinned in the receipt as resolutions_addendum). Verified against the chain and git, else exit 1.
  opt-out     Record opt-out receipt for review loop

Common flags:
  --repo-root <path>    Path to target git repository
  --ledger <dir>        Path to ledger directory
  --phase <id>          Phase identifier
  --help, -h            Show this help message

Packet mode (collect and finalize): a range too big for one review packet is split BY PATH, never by
exclusion:
  --packets <file>      packets.json (autopilot.review-packets/1): { set, packets: { <id>: [exact file paths] } }
  --packet <id>         Review only this packet's files; the phase is derived as <set>-<id> (omit --phase)
                        Generation 1 requires the packets to cover every changed path exactly once;
                        --exclude is refused. The whole set is gated by
                        check-phase-review-receipt.js --packets <file> (a lone packet receipt is refused).

Collect flags:
  --generation <n>      Generation number (integer >= 1)
  --branch <b>          Target git branch
  --phase-base <sha>    Base commit sha (required for generation 1)
  --seats <specs>       Comma-separated list of seats (engine/effort@runner[:endpoint])
  --spec-file <file>    Task specification file to pass to reviewer
  --exclude <specs>     Comma-separated git pathspecs to exclude from diff
  --expect-range <r>    full | delta | <base>..<head>: the range the reviewers are expected to cover.
                        Overrides a 'Range:' line in the first paragraph of the spec file. collect
                        warns when it differs from the base..head actually collected; nothing declared,
                        nothing checked.
  --strict-range        Turn the range warning into an error raised before g<N>/ exists
  --full-range          Generation > 1 only: review <generation 1 base>..<head> instead of the delta from
                        the previous head. Opt-in; the chain entry and range.json gain range_mode: "full",
                        which only a checker from this version accepts.
  --timeout <duration>  Timeout for dispatch (default: 20m)
  --allow-seat-gap      Allow generation to proceed even if some seats return no_verdict — but only
                        down to the receipt floor (--min-reviewed-seats <n> / AUTOPILOT_MIN_REVIEWED_SEATS,
                        default: all seats). Below it the generation is recorded aborted
                        (seat_gap_below_min) instead of a pending entry the checker would refuse forever.
  --min-reviewed-seats <n>  Reviewed-seat floor (aliases --min-seats, --min_reviewed_seats, env
                        AUTOPILOT_MIN_REVIEWED_SEATS — the checker's own spellings). Applied to
                        every generation, gap or not; validated before any seat is dispatched.
                        Pass the same value to check-phase-review-receipt.js.

Generation numbers are never reused. If a generation is aborted (e.g. the target branch
moved during collection, or a seat's findings failed to parse), its evidence directory is
left untouched on disk and stays referenced from chain.json; collect the next generation
number instead — it continues from the aborted generation's base. An aborted generation
contributes nothing to finalize (it closes no earlier finding) and check-phase-review-receipt
accepts it only when a finalized generation follows it (v2.36.3).

Finalize flags:
  --generation <n>      Generation number (integer >= 1)
  --dispositions <file> Path to dispositions JSON file
  --branch <b>          Target git branch (optional)
  --controller-notes <file>  Depth-0 authored free text. Appended to hands-brief.md
                        under "Controller notes:" and scanned with the other
                        controller-written lines (engine, branch, base, head).
                        Verbatim finding text, finding ids, and seat names are
                        not scanned. Must be a readable regular file.

  --allow-unresolved    finalize refuses by default (exit 1, nothing written) when the verdict is
                        SHIP-AS-IS but verified findings of earlier generations remain open with no
                        resolution. Resolve them (a "resolutions" entry in the dispositions file) or
                        pass --allow-unresolved --reason "<text>" to leave them open on purpose; the
                        receipt then records unresolved_allowed { reason, ids }.
  --reason <text>       Required, non-empty, with --allow-unresolved (refused without it).

Opt-out flags:
  --knob <knob>         Review knob to opt out (plan_review|hetero_review)

Environment overrides:
  AUTOPILOT_DISPATCH_REVIEW_SCRIPT  Path to reviewer dispatcher script (overrides default dispatch-review.sh)
  AUTOPILOT_REVIEW_LOOP_RESOLVER    Path to review-loop resolver script (overrides default resolve-review-loop.sh)
  AUTOPILOT_CHECK_REDISPATCH_PROMPT_SCRIPT Path to check-redispatch-prompt script (overrides default check-redispatch-prompt.sh)
`);
}

function parseArgv(argv) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key === 'allow-seat-gap' || key === 'allow-unresolved' || key === 'strict-range' || key === 'full-range') {
        flags[key] = true;
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        flags[key] = argv[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

function getResolverPath(_repoRoot) {
  if (process.env.AUTOPILOT_REVIEW_LOOP_RESOLVER) {
    return process.env.AUTOPILOT_REVIEW_LOOP_RESOLVER;
  }
  return path.join(__dirname, 'resolve-review-loop.sh');
}

function runResolver(resolverPath, repoRoot, fieldName) {
  const args = fieldName ? ['--field', fieldName] : [];
  const res = spawnSync(resolverPath, args, {
    encoding: 'utf8',
    cwd: repoRoot || process.cwd(),
    env: { ...process.env },
  });
  if (res.error) {
    const errDetail = res.error.message || String(res.error);
    console.error(`ERROR: Failed to run review-loop resolver (${resolverPath}): ${errDetail}`);
    process.exit(2);
  }
  if (res.status !== 0) {
    const errDetail = (res.stderr || '').trim() || (res.stdout || '').trim() || `exit code ${res.status}`;
    console.error(`ERROR: Review-loop resolver failed: ${errDetail}`);
    process.exit(2);
  }
  return (res.stdout || '').trim();
}

function resolveConfig(resolverPath, repoRoot) {
  const stdout = runResolver(resolverPath, repoRoot);
  try {
    return JSON.parse(stdout);
  } catch (e) {
    console.error(`ERROR: Failed to parse review-loop resolver JSON: ${e.message}`);
    process.exit(2);
  }
}

function resolveField(resolverPath, repoRoot, name) {
  return runResolver(resolverPath, repoRoot, name);
}

function parseSeatSpec(spec, id) {
  let seatStr = spec.trim();
  let endpoint = '';
  const colonIdx = seatStr.indexOf(':');
  if (colonIdx !== -1) {
    endpoint = seatStr.slice(colonIdx + 1);
    seatStr = seatStr.slice(0, colonIdx);
  }

  const atIdx = seatStr.indexOf('@');
  if (atIdx === -1) {
    throw new Error(`Invalid seat specification: ${spec}`);
  }
  const runner = seatStr.slice(atIdx + 1);
  const engineEffort = seatStr.slice(0, atIdx);

  const slashIdx = engineEffort.indexOf('/');
  if (slashIdx === -1) {
    throw new Error(`Invalid seat engine/effort in spec: ${spec}`);
  }
  const engine = engineEffort.slice(0, slashIdx);
  const effort = engineEffort.slice(slashIdx + 1);

  return {
    id,
    runner,
    engine,
    effort,
    endpoint: endpoint || undefined,
  };
}

function resolveSeats(seatsArg, repoRoot) {
  if (seatsArg) {
    const specs = seatsArg.split(',').map((s) => s.trim()).filter(Boolean);
    return specs.map((spec, idx) => {
      const id = `s${idx}`;
      assertSafeSeatId(id);
      return parseSeatSpec(spec, id);
    });
  }

  const resolver = getResolverPath(repoRoot);
  const fullJson = resolveConfig(resolver, repoRoot);

  const qcComplete = fullJson && fullJson.qc_panel_seats_complete;
  const qcSeats = fullJson && fullJson.qc_panel_seats;

  if (qcComplete !== true || !Array.isArray(qcSeats) || qcSeats.length === 0) {
    const cfgSource = (fullJson && (fullJson.config_source || fullJson.config_path)) || '';
    if (cfgSource) {
      console.error(`ERROR: Resolved qc panel is incomplete (${cfgSource})`);
    } else {
      console.error('ERROR: Resolved qc panel is incomplete');
    }
    process.exit(2);
  }

  return qcSeats.map((seatObj, idx) => {
    let endpoint = seatObj.endpoint;
    if (endpoint === null || endpoint === undefined || endpoint === '' || endpoint === '@none') {
      endpoint = undefined;
    }
    const id = `s${idx}`;
    assertSafeSeatId(id);
    return {
      id,
      runner: seatObj.runner || '',
      engine: seatObj.model || '',
      effort: seatObj.effort || '',
      endpoint,
      family: typeof seatObj.family === 'string' && seatObj.family && seatObj.family !== 'unknown' ? seatObj.family : undefined,
    };
  });
}

const SEVERITY_WORDS = new Set(['Critical', 'Major', 'Minor', 'Suggestion']);
const EMOJI_TO_WORD = {
  '🔴': 'Critical',
  '🟠': 'Major',
  '🟡': 'Minor',
  '🔵': 'Suggestion',
};

// A seat may head a finding with a coloured-marker glyph outside the four-level vocabulary (a GLM seat
// used the green circle on 2026-11-03, which aborted the whole round). That finding is kept, never
// dropped: it is filed at the conservative level (Major, so depth-0 has to judge it, never silently
// demoted) and flagged `severity_unrecognised` with the original glyph. No fifth level is added.
const UNRECOGNISED_SEVERITY_GLYPH = /^(?:[-*#>\s\d.)]*)(🟢|🟣|🟤|⚫|⚪|🟥|🟧|🟨|🟩|🟦|🟪|🟫|⬛|⬜)/u;
const UNRECOGNISED_SEVERITY_FALLBACK = 'Major';

function extractFindings(seatId, findingsText) {
  if (!findingsText || typeof findingsText !== 'string') return [];
  const lines = findingsText.split(/\r?\n/);
  const findings = [];

  function parseSeverityFromLine(line) {
    const trimmed = line.trim();
    // Recognise four line shapes:
    // 1. A severity glyph alone at start of line
    // 2. A severity glyph followed by the plain severity word
    // 3. The plain severity word alone with no glyph
    // 4. A severity glyph immediately followed by a bracketed id (glyph then whitespace then open bracket)
    const unknown = trimmed.match(UNRECOGNISED_SEVERITY_GLYPH);
    if (unknown) return { word: UNRECOGNISED_SEVERITY_FALLBACK, glyph: unknown[1] };
    const match = trimmed.match(/^(?:[-*#>\s\d.)]*)(?:(🔴|🟠|🟡|🔵)(?:\s*\[|\s+(Critical|Major|Minor|Suggestion)\b|\s*$|\s+)|(Critical|Major|Minor|Suggestion)\b)/i);
    if (!match) return null;
    if (match[1]) {
      const word = EMOJI_TO_WORD[match[1]];
      if (word) return { word };
    }
    const rawWord = match[2] || match[3];
    if (rawWord) {
      const lower = rawWord.toLowerCase();
      for (const w of SEVERITY_WORDS) {
        if (w.toLowerCase() === lower) return { word: w };
      }
    }
    return null;
  }

  let currentFinding = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sev = parseSeverityFromLine(line);
    if (sev) {
      if (currentFinding) {
        findings.push(currentFinding);
      }
      currentFinding = {
        severity: sev.word,
        unrecognisedGlyph: sev.glyph,
        lines: [line],
      };
      if (sev.glyph) {
        console.error(`WARN: seat ${seatId} used severity symbol ${sev.glyph} outside the four-level vocabulary; kept as ${sev.word} with severity_unrecognised for depth-0 judgement`);
      }
    } else {
      if (currentFinding) {
        currentFinding.lines.push(line);
      }
    }
  }
  if (currentFinding) {
    findings.push(currentFinding);
  }

  return findings.map((f) => {
    const text = f.lines.join('\n');
    const firstLine = f.lines[0] || '';
    const normalizedFirstLine = firstLine.trim().replace(/\s+/g, ' ');
    const idInput = `${seatId}|${f.severity}|${normalizedFirstLine}`;
    const id = crypto.createHash('sha256').update(idInput, 'utf8').digest('hex');
    const out = {
      id,
      severity: f.severity,
      seat: seatId,
      text,
    };
    if (f.unrecognisedGlyph) {
      out.severity_unrecognised = true;
      out.original_severity_symbol = f.unrecognisedGlyph;
    }
    return out;
  });
}

function runGitRevParse(branch, repoRoot) {
  const res = spawnSync('git', ['rev-parse', branch], {
    encoding: 'utf8',
    cwd: repoRoot || process.cwd(),
  });
  if (res.status !== 0 || !res.stdout) {
    throw new Error(`git rev-parse ${branch} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

function runGitDiff(base, head, repoRoot, excludes = []) {
  const args = ['diff', `${base}..${head}`];
  if (Array.isArray(excludes) && excludes.length > 0) {
    args.push('--');
    for (const pattern of excludes) {
      args.push(`:!${pattern}`);
    }
  }
  const res = spawnSync('git', args, {
    encoding: 'utf8',
    cwd: repoRoot || process.cwd(),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(`git diff ${base}..${head} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout;
}

// BL-0197: one seat answered but broke an output rule (dispatch-review marks that
// `format_reject`; transport / timeout / rc failures never carry it). Re-ask THAT seat once, same
// diff and same spec, with a one-line notice of what was wrong. The rules are unchanged; a second
// failure is recorded exactly as before. Every other seat is untouched. The attempt is recorded
// on the seat artifact as `format_retry` and on stderr.
const FORMAT_RETRY_LIMIT = 1;
async function runSeatDispatch(seat, repoRoot, ledgerPhaseGDir, specFile, timeout) {
  let result = await runSeatDispatchOnce(seat, repoRoot, ledgerPhaseGDir, specFile, timeout, '');
  const isFormatReject = (r) => r.status === 'no_verdict'
    && r.rawOutput && r.rawOutput.format_reject === true
    && typeof r.rawOutput.error === 'string' && r.rawOutput.error.length > 0;
  let attempts = 0;
  const history = [];
  while (attempts < FORMAT_RETRY_LIMIT && isFormatReject(result)) {
    attempts += 1;
    const reason = typeof result.rawOutput.reject_reason === 'string' && result.rawOutput.reject_reason ? result.rawOutput.reject_reason : result.rawOutput.error;
    console.error(`INFO: seat ${seat.id} answer rejected for format (${reason}); re-asking this seat once (format retry ${attempts}/${FORMAT_RETRY_LIMIT})`);
    history.push({ attempt: attempts, reason, raw_log: result.rawOutput.raw_log || null, usage: result.rawOutput.usage === undefined ? null : result.rawOutput.usage });
    result = await runSeatDispatchOnce(seat, repoRoot, ledgerPhaseGDir, specFile, timeout, reason);
    if (result.rawOutput && typeof result.rawOutput === 'object') {
      result.rawOutput.format_retry = {
        attempts,
        first_reason: history[0].reason,
        first_raw_log: history[0].raw_log,
        first_usage: history[0].usage,
        outcome: result.status === 'reviewed' ? 'reviewed' : 'still_rejected',
      };
    }
    console.error(`INFO: seat ${seat.id} format retry ${attempts}/${FORMAT_RETRY_LIMIT} outcome: ${result.status === 'reviewed' ? 'reviewed' : 'still rejected'}`);
  }
  return result;
}

function runSeatDispatchOnce(seat, repoRoot, ledgerPhaseGDir, specFile, timeout, retryNote) {
  return new Promise((resolve) => {
    let dispatchScript = process.env.AUTOPILOT_DISPATCH_REVIEW_SCRIPT;
    if (!dispatchScript) {
      dispatchScript = path.join(__dirname, 'dispatch-review.sh');
    }

    const diffFile = path.join(ledgerPhaseGDir, 'diff.txt');

    const args = [
      '--runner', seat.runner,
      '--model', seat.engine,
      '--effort', seat.effort,
      '--diff-file', diffFile,
      '--timeout', timeout || '20m',
    ];
    if (seat.endpoint) {
      args.push('--endpoint', seat.endpoint);
    }
    if (specFile) {
      args.push('--spec-file', specFile);
    }

    const childEnv = { ...process.env };
    if (retryNote) {
      childEnv.AUTOPILOT_REVIEW_RETRY_NOTE = retryNote;
    } else {
      delete childEnv.AUTOPILOT_REVIEW_RETRY_NOTE;
    }
    if (process.env.AUTOPILOT_DISPATCH_REVIEW_SCRIPT) {
      childEnv.STUB_SEAT_ID = seat.id;
    }
    const child = spawn(dispatchScript, args, {
      cwd: repoRoot || process.cwd(),
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      resolve({
        seat,
        status: 'no_verdict',
        rawOutput: { status: 'no_verdict', error: err.message },
      });
    });

    child.on('close', (exitCode) => {
      let parsed = null;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch (_e) {
        parsed = null;
      }

      const validVerdict = parsed && (parsed.verdict === 'SHIP-AS-IS' || parsed.verdict === 'FIX-THEN-SHIP' || parsed.verdict === null || parsed.verdict === 'no_verdict');
      const validShape = parsed && typeof parsed === 'object' && typeof parsed.status === 'string' && validVerdict;

      if (exitCode !== 0 || !validShape) {
        const errorMsg = exitCode !== 0
          ? `dispatch-review exited with status ${exitCode}`
          : 'Invalid or non-matching output shape from dispatch-review';
        const fallbackRaw = (parsed && typeof parsed === 'object') ? parsed : { raw: stdout };
        resolve({
          seat,
          status: 'no_verdict',
          rawOutput: {
            ...fallbackRaw,
            status: 'no_verdict',
            verdict: 'no_verdict',
            error: errorMsg,
            // The runner's own reason (the exit-code message above hides it); the format retry quotes it.
            ...(parsed && typeof parsed === 'object' && typeof parsed.error === 'string' ? { reject_reason: parsed.error } : {}),
          },
        });
        return;
      }

      const status = parsed.status === 'reviewed' ? 'reviewed' : 'no_verdict';
      resolve({
        seat,
        status,
        rawOutput: parsed,
      });
    });
  });
}

// P7d (stage-graph, plan Owner addendum A1): publish a small round summary for the status band / Review tab.
// Additive and fail-open: lives in the live dir (`<live>/review-rounds/<project_key>.json`, one file per repo, the
// latest round overwrites), never touches the ledger, chain.json or any receipt. Reader: src/status/review-input.js.
function publishRoundSummary({ repoRoot, phase, generation, base, head, seatResults, converged }) {
  try {
    const { scopeFromCwd } = require('../src/status/project-key');
    const { resolveLiveDir } = require('./lib/live-state-dir');
    const { project_key: key } = scopeFromCwd(repoRoot || process.cwd());
    if (!key) return;
    const dir = path.join(resolveLiveDir({ warn: () => {} }).base, 'review-rounds');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const summary = {
      schema: 'autopilot.review-round/1',
      project_key: key,
      phase,
      generation,
      base,
      head,
      seats: seatResults.map((r) => ({
        id: r.seat.id,
        family: r.seat.family || familyOfEngine(r.seat.engine),
        status: r.status === 'reviewed' ? 'reviewed' : 'no_verdict',
        verdict: r.rawOutput && typeof r.rawOutput.verdict === 'string' ? r.rawOutput.verdict : null,
      })),
      converged,
      at: new Date().toISOString(),
    };
    writeFileSyncAtomic(path.join(dir, `${key}.json`), JSON.stringify(summary, null, 2) + '\n');
  } catch (_e) { /* fail-open: a status summary never changes the review result */ }
}

// BL-0389: a spec may declare which range its reviewers are expected to cover. Only the first
// paragraph of the file is searched and only the first `Range:` line counts. Returns null when
// nothing is declared (no check, no warning).
function parseSpecRange(specText) {
  const lines = String(specText || '').split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  for (; i < lines.length && lines[i].trim() !== ''; i++) {
    const m = /^\s*Range:\s*(\S.*?)\s*$/i.exec(lines[i]);
    if (m) return m[1].replace(/\s+#.*$/, '').trim();
  }
  return null;
}

function resolveFullSha(rev, repoRoot) {
  const res = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], {
    encoding: 'utf8',
    cwd: repoRoot || process.cwd(),
  });
  return res.status === 0 && res.stdout.trim() ? res.stdout.trim() : '';
}

// Compare a declared range with the base..head that collect is about to use. Returns an array of
// warning strings (empty when it matches). Pure comparison plus read-only git rev-parse.
function rangeMismatches(declared, ctx) {
  const { generation, base, head, chain, flagPhaseBase, repoRoot } = ctx;
  const out = [];
  if (declared === 'delta') {
    if (generation > 1) {
      const prev = chain.find((c) => c && c.generation === generation - 1);
      const expected = prev ? (prev.status === 'finalized' ? prev.head : prev.base) : '';
      if (expected && expected !== base) {
        out.push(`spec declares Range: delta but generation ${generation} collects ${base}..${head}, not from the generation ${generation - 1} head ${expected}`);
      }
    }
  } else if (declared === 'full') {
    if (generation > 1) {
      const g1 = chain.find((c) => c && c.generation === 1);
      const fullBase = (g1 && g1.base) || (typeof flagPhaseBase === 'string' ? flagPhaseBase.trim() : '');
      if (fullBase && fullBase !== base) {
        out.push(`spec declares Range: full but generation ${generation} collects ${base}..${head} (a delta from the previous generation); the phase base is ${fullBase}, so files unchanged since then are not in this diff. Declare Range: delta, or review the full range in a separate phase`);
      }
    }
  } else {
    const m = /^(\S+?)\.\.(\S+)$/.exec(declared);
    if (!m) {
      out.push(`unrecognised Range declaration '${declared}' (expected full, delta or <base>..<head>)`);
    } else {
      const wantBase = resolveFullSha(m[1], repoRoot);
      const wantHead = resolveFullSha(m[2], repoRoot);
      const gotBase = resolveFullSha(base, repoRoot) || base;
      const gotHead = resolveFullSha(head, repoRoot) || head;
      if (!wantBase || !wantHead) {
        out.push(`declared Range '${declared}' does not resolve to two commits in this repository`);
      } else if (wantBase !== gotBase || wantHead !== gotHead) {
        out.push(`spec declares Range: ${declared} (${wantBase}..${wantHead}) but generation ${generation} collects ${gotBase}..${gotHead}`);
      }
    }
  }
  return out;
}

async function handleCollect(flags) {
  // v2.36.5: validate the reviewed-seat floor FIRST — before any generation directory or seat
  // dispatch exists — so a garbage value costs nothing and cannot leave g<N>/ without a chain
  // entry (review 🟠). The value is re-resolved after the seats are known (default: all seats).
  resolveMinReviewedSeats(flags, null);
  const generation = parseInt(flags.generation, 10);
  if (!flags.generation || isNaN(generation) || generation < 1) {
    console.error('ERROR: --generation <n> must be an integer >= 1');
    process.exit(2);
  }

  const branch = flags.branch;
  if (!branch) {
    console.error('ERROR: --branch <b> is required');
    process.exit(2);
  }

  const repoRoot = flags['repo-root'] ? path.resolve(flags['repo-root']) : '';
  const ledgerDir = flags.ledger ? path.resolve(flags.ledger) : '';
  const packetCtx = resolvePacketFlags(flags);
  const phase = packetCtx ? packetCtx.phase : flags.phase;

  if (!ledgerDir || !phase) {
    console.error('ERROR: --ledger <dir> and --phase <id> are required');
    process.exit(2);
  }

  const reviewPhaseDir = path.join(ledgerDir, `review-${phase}`);
  const chainPath = path.join(reviewPhaseDir, 'chain.json');

  let chain = [];
  if (fs.existsSync(chainPath)) {
    try {
      chain = JSON.parse(fs.readFileSync(chainPath, 'utf8'));
    } catch (_e) {
      console.error(`ERROR: Failed to parse chain.json at ${chainPath}`);
      process.exit(1);
    }
    if (!Array.isArray(chain)) {
      console.error(`ERROR: Malformed chain.json at ${chainPath}: expected array`);
      process.exit(1);
    }
  }

  const existingGenEntry = chain.find((c) => c && c.generation === generation);
  if (existingGenEntry) {
    console.error(`ERROR: Generation ${generation} already exists with status '${existingGenEntry.status}'; generation numbers are never reused (including aborted ones) — collect the next generation number instead`);
    process.exit(1);
  }

  const gDir = path.join(reviewPhaseDir, `g${generation}`);
  if (fs.existsSync(gDir)) {
    console.error(`ERROR: Generation directory ${gDir} already exists; refusing to reuse`);
    process.exit(1);
  }

  let base = '';
  // BL-0389: opt-in --full-range at generation > 1 reviews chain[0].base..head instead of the delta.
  let fullRange = false;
  if (flags['full-range']) {
    if (generation === 1) {
      console.error('ERROR: --full-range only applies at generation > 1 (generation 1 already reviews the whole phase range)');
      process.exit(2);
    }
    fullRange = true;
  }
  if (generation === 1) {
    if (!flags['phase-base']) {
      console.error('ERROR: --phase-base <sha> is required for generation 1');
      process.exit(2);
    }
    base = flags['phase-base'].trim();
  } else {
    // generation > 1
    const prevEntry = chain.find((c) => c && c.generation === generation - 1);
    if (!prevEntry) {
      console.error(`ERROR: Contiguous chain broken: missing generation ${generation - 1} in ${chainPath}`);
      process.exit(1);
    }
    if (prevEntry.status === 'finalized') {
      base = prevEntry.head;
    } else if (prevEntry.status === 'aborted') {
      // The aborted generation never produced a reviewable result, so nothing advanced;
      // continue from the same base it was attempted against. Its evidence directory is
      // preserved on disk and remains referenced from this chain.json entry.
      base = prevEntry.base;
      // An aborted full-range attempt continues as full range (its base is the phase base).
      if (prevEntry.range_mode === 'full') fullRange = true;
    } else {
      console.error(`ERROR: Cannot collect generation ${generation}: generation ${generation - 1} is not finalized (status is '${prevEntry.status}')`);
      process.exit(1);
    }
  }

  if (generation > 1) {
    const g1Entry = chain.find((c) => c && c.generation === 1);
    const g1Base = g1Entry && g1Entry.base;
    if (fullRange) {
      if (!g1Base) {
        console.error('ERROR: --full-range needs generation 1 in chain.json to name the phase base');
        process.exit(1);
      }
      base = g1Base;
    }
    // BL-0389 (R7): --phase-base is read at generation 1 only; say so instead of ignoring it silently.
    if (typeof flags['phase-base'] === 'string' && g1Base) {
      const given = flags['phase-base'].trim();
      const same = given === g1Base || (resolveFullSha(given, repoRoot) || given) === (resolveFullSha(g1Base, repoRoot) || g1Base);
      if (!same) console.error('WARNING: --phase-base ignored at generation > 1; use --full-range');
    }
  }

  // Persist phase base for generation 1 at the documented ledger-root path
  // (<ledger>/phase-<phase>.base) — this is what skills/dev-flow/SKILL.md and
  // skills/dev-flow/references/hetero-loops.md `cat` to build --phase-base.
  if (generation === 1) {
    fs.mkdirSync(ledgerDir, { recursive: true });
    const phaseBaseFile = path.join(ledgerDir, `phase-${phase}.base`);
    writeFileSyncAtomic(phaseBaseFile, base + '\n');
  }

  let head = '';
  try {
    head = runGitRevParse(branch, repoRoot);
  } catch (e) {
    console.error(`ERROR: Failed to resolve branch '${branch}': ${e.message}`);
    process.exit(1);
  }

  // Packet mode: the cover must hold BEFORE any seat is dispatched or any evidence directory exists.
  // Generation 1 reviews the whole range, so the packets' union must equal the changed list exactly;
  // a later generation reviews a fix on top, which may only touch covered files.
  if (packetCtx) {
    let names;
    try {
      names = reviewPackets.rangeNames(repoRoot, base, head);
    } catch (e) {
      console.error(`ERROR: Failed to list changed paths: ${e.message}`);
      process.exit(1);
    }
    const coverProblems = reviewPackets.coverErrors(names, packetCtx.packets, generation === 1);
    if (coverProblems.length > 0) {
      console.error(`ERROR: packets '${packetCtx.set}' do not cover ${base}..${head}${generation === 1 ? ' exactly once' : ''}:\n${coverProblems.join('\n')}`);
      process.exit(1);
    }
    if (generation > 1 && !names.some((n) => packetCtx.paths.includes(n))) {
      console.error(`ERROR: nothing in packet '${packetCtx.id}' changed in ${base}..${head}; there is nothing for its seats to review (the set check already requires its files to be unchanged since its last reviewed head)`);
      process.exit(1);
    }
    const pinPath = path.join(ledgerDir, `packets-${packetCtx.set}.json`);
    if (fs.existsSync(pinPath)) {
      const pinned = crypto.createHash('sha256').update(fs.readFileSync(pinPath)).digest('hex');
      if (pinned !== packetCtx.sha256) {
        console.error(`ERROR: ${pinPath} already pins different packets bytes for set '${packetCtx.set}'; a set's packets file is frozen once its first packet is collected`);
        process.exit(1);
      }
    }
  }

  // Resolve seats
  let seats = [];
  try {
    seats = resolveSeats(flags.seats, repoRoot);
  } catch (e) {
    console.error(`ERROR: Seat resolution failed: ${e.message}`);
    process.exit(1);
  }

  if (!seats.length) {
    console.error('ERROR: No seats configured or resolved');
    process.exit(1);
  }

  for (let idx = 0; idx < seats.length; idx++) {
    const seat = seats[idx];
    if (!seat.runner) {
      console.error(`ERROR: Seat ${seat.id || `s${idx}`} missing runner`);
      process.exit(2);
    }
    if (!seat.engine) {
      console.error(`ERROR: Seat ${seat.id || `s${idx}`} missing engine`);
      process.exit(2);
    }
  }

  // BL-0364: refuse a seat whose model the runner's CLI would reject at startup, before any
  // dispatch and before g<N>/ exists — such a seat would otherwise burn the generation as a seat_gap.
  const badModels = invalidSeatModels(seats);
  if (badModels.length) {
    for (const b of badModels) console.error(`ERROR: ${b.message}`);
    console.error('ERROR: no seat was dispatched and generation ' + generation + ' was not consumed; fix the seat model and collect again');
    process.exit(2);
  }

  // Read the caller's spec BEFORE g<N>/ exists: exiting after the mkdir strands the generation
  // (dir present, no chain entry), the same shape as the seat-gap exit.
  let specText = '';
  if (flags['spec-file']) {
    try {
      specText = fs.readFileSync(path.resolve(flags['spec-file']), 'utf8');
    } catch (e) {
      console.error(`ERROR: Failed to read spec-file: ${e.message}`);
      process.exit(1);
    }
  }

  // BL-0389: compare the range a caller declared (spec header `Range:` or --expect-range) with the
  // range about to be collected. Before g<N>/ exists, so --strict-range consumes no generation.
  // Nothing declared: no check, no output.
  {
    const flagRange = typeof flags['expect-range'] === 'string' ? flags['expect-range'].trim() : '';
    const headerRange = parseSpecRange(specText);
    let declaredRange = headerRange;
    if (flagRange) {
      if (headerRange) console.error(`NOTE: --expect-range '${flagRange}' overrides the spec header 'Range: ${headerRange}'`);
      declaredRange = flagRange;
    }
    if (declaredRange) {
      const problems = rangeMismatches(declaredRange, { generation, base, head, chain, flagPhaseBase: flags['phase-base'], repoRoot });
      for (const w of problems) console.error(`WARNING: ${w}`);
      if (problems.length > 0 && flags['strict-range']) {
        console.error(`ERROR: --strict-range: declared range does not match; no seat was dispatched and generation ${generation} was not consumed`);
        process.exit(1);
      }
    }
  }

  // Range and diff
  fs.mkdirSync(reviewPhaseDir, { recursive: true });
  try {
    fs.mkdirSync(gDir);
  } catch (err) {
    if (err.code === 'EEXIST') {
      console.error(`ERROR: Generation directory ${gDir} already exists; refusing to overwrite`);
      process.exit(1);
    }
    throw err;
  }

  const excludedList = typeof flags.exclude === 'string'
    ? flags.exclude.split(',').map((p) => p.trim()).filter(Boolean)
    : [];

  const consumerAllowlist = loadConsumerExcludeAllowlist(repoRoot);
  for (const pattern of excludedList) {
    if (!isPathspecAllowed(pattern, consumerAllowlist, repoRoot)) {
      console.error(`ERROR: Exclude pathspec '${pattern}' is not permitted by allowlist`);
      process.exit(1);
    }
  }

  if (packetCtx) {
    const pinPath = path.join(ledgerDir, `packets-${packetCtx.set}.json`);
    if (!fs.existsSync(pinPath)) writeFileSyncAtomic(pinPath, fs.readFileSync(packetCtx.file));
  }

  let diffText = '';
  try {
    diffText = packetCtx
      ? reviewPackets.packetDiff(repoRoot, base, head, packetCtx.paths)
      : runGitDiff(base, head, repoRoot, excludedList);
  } catch (e) {
    console.error(`ERROR: Failed to generate diff: ${e.message}`);
    process.exit(1);
  }

  const diffBytes = Buffer.byteLength(diffText, 'utf8');
  // An empty diff (base == head, no commits, or every changed path excluded) would be reviewed and
  // recorded like a normal one. Fail closed, and remove the still-empty generation directory so the
  // same generation number can be collected once the range has content.
  if (diffBytes === 0) {
    try { fs.rmdirSync(gDir); } catch (_) { /* best effort */ }
    console.error(`ERROR: empty review range: ${base}..${head} has no diff${excludedList.length ? ` after --exclude ${excludedList.join(',')}` : ''}${packetCtx ? ` for packet '${packetCtx.id}'` : ''}; nothing to review. A cherry-pick that conflicted and produced no commit leaves this shape; fix the range or --phase-base and collect again`);
    process.exit(1);
  }
  const diffSha256 = crypto.createHash('sha256').update(diffText, 'utf8').digest('hex');

  let fullRangeSha256 = diffSha256;
  if (excludedList.length > 0 || packetCtx) {
    try {
      const fullRangeDiffText = runGitDiff(base, head, repoRoot, []);
      fullRangeSha256 = crypto.createHash('sha256').update(fullRangeDiffText, 'utf8').digest('hex');
    } catch (e) {
      console.error(`ERROR: Failed to generate unfiltered diff: ${e.message}`);
      process.exit(1);
    }
  }

  const rangeJson = {
    base,
    head,
    diff_sha256: diffSha256,
    full_range_sha256: fullRangeSha256,
    excluded: excludedList,
    diff_bytes: diffBytes,
    ...(fullRange ? { range_mode: 'full' } : {}),
  };
  const packetRecord = packetCtx
    ? { set: packetCtx.set, id: packetCtx.id, packets_sha256: packetCtx.sha256, paths: packetCtx.paths }
    : null;
  if (packetRecord) rangeJson.packet = packetRecord;
  writeFileSyncAtomic(path.join(gDir, 'range.json'), JSON.stringify(rangeJson, null, 2) + '\n');
  writeFileSyncAtomic(path.join(gDir, 'diff.txt'), diffText);

  // Before dispatching, if diff exceeds 400000 bytes, print warning
  if (diffBytes > 400000 && packetCtx) {
    console.warn(`WARNING: Packet diff size (${diffBytes} bytes) exceeds 400000 bytes; split packet '${packetCtx.id}' into smaller packets (every changed path must stay in exactly one packet)`);
  } else if (diffBytes > 400000) {
    console.warn(`WARNING: Diff size (${diffBytes} bytes) exceeds 400000 bytes; consider using --exclude <pathspec,...>`);
  }

  // Dispatch all seats concurrently
  const timeout = flags.timeout || '20m';
  let specFile = flags['spec-file'] ? path.resolve(flags['spec-file']) : '';

  // Packet mode: each seat sees only its own packet's diff, so a spec that names files in
  // sibling packets reads as "unimplemented". Tell the seat which paths belong to the other
  // packets (reviewed separately, out of this packet's scope). The caller's spec, if any, is
  // kept verbatim ahead of the scope section; the combined text is written next to the diff.
  if (packetCtx) {
    const siblings = Object.entries(packetCtx.packets).filter(([id]) => id !== packetCtx.id);
    if (siblings.length > 0) {
      const lines = [];
      if (specFile) {
        lines.push(specText.replace(/\s+$/, ''), '');
      }
      lines.push(
        `Packet scope: you are reviewing packet '${packetCtx.id}' of review set '${packetCtx.set}'.`,
        'Your diff contains only the files of this packet. Files listed below are owned by sibling packets,',
        'which are reviewed separately, and are out of this packet\'s scope. A file or change that the',
        'spec names and that is listed below is delivered in its own packet, not missing or unimplemented.',
        ''
      );
      for (const [id, paths] of siblings) {
        lines.push(`Sibling packet '${id}':`);
        for (const sp of paths) lines.push(`- ${sp}`);
        lines.push('');
      }
      const scopeFile = path.join(gDir, 'packet-scope.md');
      writeFileSyncAtomic(scopeFile, lines.join('\n'));
      specFile = scopeFile;
    }
  }

  // Stage graph (plan §2.7 writers): a review round starts here (collect only; finalize/opt-out never write). Fail-open.
  stageWrite({ to: 'code-review' });
  const seatPromises = seats.map((seat) => runSeatDispatch(seat, repoRoot, gDir, specFile, timeout));
  const seatResults = await Promise.all(seatPromises);

  // Write per-seat JSON files and compute hashes
  const seatArtifactSha256 = {};
  for (const res of seatResults) {
    assertSafeSeatId(res.seat.id);
    const seatPath = path.join(gDir, `seat-${res.seat.id}.json`);
    const seatContent = JSON.stringify(res.rawOutput, null, 2) + '\n';
    writeFileSyncAtomic(seatPath, seatContent);
    seatArtifactSha256[res.seat.id] = crypto.createHash('sha256').update(seatContent, 'utf8').digest('hex');
  }

  function saveChainEntry(newEntry, opts) {
    withChainLock(chainPath, () => {
      saveChainEntryLocked(newEntry);
      if (opts && opts.recordPointer) recordLedgerPointer(ledgerDir, repoRoot);
    });
  }
  function saveChainEntryLocked(entryIn) {
    // BL-0389: additive, only when --full-range was used (absent = delta, the default)
    const newEntry = fullRange ? { ...entryIn, range_mode: 'full' } : entryIn;
    let currentChain = [];
    if (fs.existsSync(chainPath)) {
      try {
        currentChain = JSON.parse(fs.readFileSync(chainPath, 'utf8'));
      } catch (_e) {
        currentChain = [];
      }
      if (!Array.isArray(currentChain)) {
        currentChain = [];
      }
    }
    const existingIdx = currentChain.findIndex((c) => c && c.generation === generation);
    if (existingIdx !== -1) {
      currentChain[existingIdx] = newEntry;
    } else {
      currentChain.push(newEntry);
    }
    writeFileSyncAtomic(chainPath, JSON.stringify(currentChain, null, 2) + '\n');
  }

  // Check head again
  let postHead = '';
  try {
    postHead = runGitRevParse(branch, repoRoot);
  } catch (e) {
    console.error(`ERROR: Failed to re-check branch '${branch}': ${e.message}`);
    process.exit(1);
  }

  if (postHead !== head) {
    // Head moved during dispatch
    saveChainEntry({
      generation,
      base,
      status: 'aborted',
    });
    console.error(`ERROR: Branch '${branch}' moved from ${head} to ${postHead} during review collection`);
    process.exit(1);
  }

  // Parse findings per seat and handle placeholders / parse failures
  const seatFindingMap = new Map();
  for (const res of seatResults) {
    const raw = res.rawOutput || {};
    const findingsStr = typeof raw.findings === 'string' ? raw.findings : '';
    const trimmedFindings = findingsStr.trim();
    const lowerFindings = trimmedFindings.toLowerCase();
    const isPlaceholder = lowerFindings === 'none' || lowerFindings === 'n/a' || lowerFindings === 'no findings';
    const extracted = extractFindings(res.seat.id, findingsStr);
    seatFindingMap.set(res.seat.id, extracted);

    // If findingsStr is non-empty and nothing parses out of it and the text is not a placeholder token,
    // that seat's collection aborts with a parse-failure result, regardless of verdict.
    if (trimmedFindings.length > 0 && extracted.length === 0 && !isPlaceholder) {
      saveChainEntry({
        generation,
        base,
        status: 'aborted',
        reason: 'parse_failed',
      });
      console.error(`ERROR: Failed to parse non-empty findings for seat ${res.seat.id}`);
      process.exit(1);
    }

    const verdict = raw.verdict;
    const proof = (typeof raw.no_finding_proof === 'string') ? raw.no_finding_proof.trim() : '';

    if (verdict === 'FIX-THEN-SHIP') {
      if (extracted.length === 0) {
        // FIX-THEN-SHIP with empty findings is no_verdict
        res.status = 'no_verdict';
        raw.status = 'no_verdict';
        raw.verdict = 'no_verdict';
      } else if (raw.status === 'reviewed') {
        res.status = 'reviewed';
      } else {
        res.status = 'no_verdict';
      }
    } else if (verdict === 'SHIP-AS-IS') {
      if (extracted.length === 0) {
        if (!proof) {
          res.status = 'no_verdict';
          raw.status = 'no_verdict';
        } else if (raw.status === 'reviewed') {
          res.status = 'reviewed';
        } else {
          res.status = 'no_verdict';
        }
      } else if (raw.status === 'reviewed') {
        res.status = 'reviewed';
      } else {
        res.status = 'no_verdict';
      }
    } else {
      // verdict null, missing, or any other verdict
      // A seat whose verdict is null or missing is never counted as reviewed; treat it as a gap (no_verdict)
      // unless real findings parsed out of it.
      if (extracted.length > 0) {
        res.status = 'reviewed';
      } else {
        res.status = 'no_verdict';
        raw.status = 'no_verdict';
        raw.verdict = 'no_verdict';
      }
    }
  }

  // Same-node update: ONLY families of seats whose review completed (status reviewed after the verdict parse
  // above). Seats that failed / had no verdict contribute nothing; planned families are written nowhere. Fail-open.
  stageWrite({
    to: 'code-review',
    families: seatResults.filter((r) => r.status === 'reviewed').map((r) => r.seat.family || familyOfEngine(r.seat.engine)),
  });

  // Extract findings
  const allFindings = [];
  let hasGap = false;
  const seatIds = seats.map((s) => s.id);

  for (const res of seatResults) {
    if (res.status === 'reviewed') {
      const seatFindings = seatFindingMap.get(res.seat.id) || [];
      allFindings.push(...seatFindings);
    } else {
      hasGap = true;
    }
  }

  const allowSeatGap = Boolean(flags['allow-seat-gap']);

  if (hasGap && !allowSeatGap) {
    const gapSeats = seatResults.filter((r) => r.status !== 'reviewed').map((r) => r.seat.id);
    // Record the generation aborted: g<N>/ is already on disk, so without a chain entry it
    // can neither be re-collected (dir exists) nor continued (g<N+1> fails "Contiguous chain
    // broken"). An aborted entry lets the next generation continue from this base.
    saveChainEntry({
      generation,
      base,
      status: 'aborted',
      reason: 'seat_gap',
    });
    console.error(`ERROR: Review seat gap detected on seat(s): ${gapSeats.join(', ')}; generation ${generation} recorded as aborted (seat_gap) — collect generation ${generation + 1} from the same base`);
    process.exit(1);
  }

  // v2.36.5 (<host>, plan 066): --allow-seat-gap used to write a pending-with-gap entry no
  // matter how many seats were lost, while check-phase-review-receipt requires reviewed seats
  // >= its trusted floor (--min-reviewed-seats / AUTOPILOT_MIN_REVIEWED_SEATS, default ALL
  // seats of the entry). A finalized generation below that floor is a historical fact the
  // checker refuses forever and no later generation can repair. The gap is therefore
  // tolerated only down to the SAME floor, resolved here from the same trusted sources; below
  // it the generation is recorded `aborted` (reason seat_gap_below_min — a recorded
  // non-review, v2.36.3 semantics) so the next generation continues from this base.
  // The floor applies whether or not there was a gap (review 🟠): a configured floor above the
  // seat count with every seat reviewed would otherwise still write a pending entry the checker
  // refuses forever.
  {
    const reviewedNow = seatResults.filter((r) => r.status === 'reviewed').length;
    const floor = resolveMinReviewedSeats(flags, seatResults.length);
    if (reviewedNow < floor.value) {
      saveChainEntry({
        generation,
        base,
        status: 'aborted',
        reason: 'seat_gap_below_min',
        reviewed_seats: reviewedNow,
        total_seats: seatResults.length,
        min_reviewed_seats: floor.value,
        min_reviewed_seats_source: floor.source,
      });
      console.error(`ERROR: only ${reviewedNow} of ${seatResults.length} seats reviewed, below the receipt floor of ${floor.value} (${floor.source}); generation ${generation} recorded as aborted (seat_gap_below_min) — check-phase-review-receipt would refuse it forever. Collect generation ${generation + 1} from the same base (fix the failing seat, shrink the diff with --exclude, or lower the floor for BOTH collect and the checker — same flag/env spellings on both).`);
      process.exit(1);
    }
    if (hasGap) {
      console.error(`WARN: --allow-seat-gap: ${reviewedNow} of ${seatResults.length} seats reviewed; the receipt floor is ${floor.value} (${floor.source}) — pass the same floor to check-phase-review-receipt.`);
    }
  }

  // Write findings.json
  const findingsJson = {
    findings: allFindings,
  };
  const findingsContent = JSON.stringify(findingsJson, null, 2) + '\n';
  writeFileSyncAtomic(path.join(gDir, 'findings.json'), findingsContent);
  const findingsSha256 = crypto.createHash('sha256').update(findingsContent, 'utf8').digest('hex');

  // Seat gap status and counts for chain entry
  const seatRecords = seatResults.map((res) => ({
    id: res.seat.id,
    status: res.status === 'reviewed' ? 'reviewed' : 'no_verdict',
  }));
  const reviewedSeatsCount = seatResults.filter((r) => r.status === 'reviewed').length;
  const totalSeatsCount = seatResults.length;

  // Update chain.json
  const genStatus = hasGap ? 'pending-with-gap' : 'pending';
  saveChainEntry({
    generation,
    base,
    head,
    seats: seatRecords,
    reviewed_seats: reviewedSeatsCount,
    total_seats: totalSeatsCount,
    reviewed_seats_count: reviewedSeatsCount,
    total_seats_count: totalSeatsCount,
    status: genStatus,
    diff_sha256: diffSha256,
    full_range_sha256: fullRangeSha256,
    findings_sha256: findingsSha256,
    seat_artifact_sha256: seatArtifactSha256,
    ...(packetRecord ? { packet: packetRecord } : {}),
    collected_at: new Date().toISOString(),
  }, { recordPointer: true });

  publishRoundSummary({
    repoRoot, phase, generation, base, head, seatResults,
    converged: !hasGap && allFindings.length === 0,
  });

  const seatSummaries = {};
  for (const res of seatResults) {
    const extracted = seatFindingMap.get(res.seat.id) || [];
    const proof = (res.rawOutput && typeof res.rawOutput.no_finding_proof === 'string')
      ? res.rawOutput.no_finding_proof.trim()
      : '';
    seatSummaries[res.seat.id] = {
      findings_count: extracted.length,
      proof_present: proof.length > 0,
    };
  }

  // Output summary JSON
  const summary = {
    phase,
    generation,
    base,
    head,
    seats: seatIds,
    findings_count: allFindings.length,
    status: genStatus,
    seat_summaries: seatSummaries,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

async function handleFinalize(flags) {
  const repoRoot = flags['repo-root'] ? path.resolve(flags['repo-root']) : '';
  const ledgerDir = flags.ledger ? path.resolve(flags.ledger) : '';
  const packetCtx = resolvePacketFlags(flags);
  const phase = packetCtx ? packetCtx.phase : flags.phase;
  const generationRaw = flags.generation;
  const dispositionsFile = flags.dispositions ? path.resolve(flags.dispositions) : '';
  const branch = flags.branch || '';

  if (!ledgerDir || !phase || !generationRaw || !dispositionsFile) {
    console.error('ERROR: --ledger <dir>, --phase <id>, --generation <n>, and --dispositions <file> are required for finalize');
    process.exit(2);
  }

  let controllerNotes = '';
  if (flags['controller-notes']) {
    const notesPath = path.resolve(String(flags['controller-notes']));
    let notesStat = null;
    try {
      notesStat = fs.statSync(notesPath);
    } catch (_e) {
      notesStat = null;
    }
    if (!notesStat || !notesStat.isFile()) {
      console.error(`ERROR: --controller-notes is not a readable regular file: ${notesPath}`);
      process.exit(1);
    }
    try {
      fs.accessSync(notesPath, fs.constants.R_OK);
      controllerNotes = fs.readFileSync(notesPath, 'utf8');
    } catch (_e) {
      console.error(`ERROR: --controller-notes is not a readable regular file: ${notesPath}`);
      process.exit(1);
    }
  }

  const generation = parseInt(generationRaw, 10);
  if (isNaN(generation) || generation < 1) {
    console.error(`ERROR: Invalid --generation: '${generationRaw}' (must be integer >= 1)`);
    process.exit(2);
  }

  const reviewPhaseDir = path.join(ledgerDir, `review-${phase}`);
  const gDir = path.join(reviewPhaseDir, `g${generation}`);
  const findingsPath = path.join(gDir, 'findings.json');
  const rangePath = path.join(gDir, 'range.json');

  // Require readable range.json file for that generation
  if (!fs.existsSync(rangePath)) {
    console.error(`ERROR: Missing or unreadable range.json at ${rangePath}`);
    process.exit(1);
  }
  let rangeObj;
  try {
    rangeObj = JSON.parse(fs.readFileSync(rangePath, 'utf8'));
    if (!rangeObj || typeof rangeObj !== 'object') {
      console.error(`ERROR: Invalid range.json at ${rangePath}`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`ERROR: Failed to parse range.json at ${rangePath}: ${e.message}`);
    process.exit(1);
  }

  // Chain entry validation. finalize reads, mutates and rewrites chain.json, so it holds the chain
  // lock from before the read until the process exits (every path ends in process.exit).
  const chainPath = path.join(reviewPhaseDir, 'chain.json');
  if (fs.existsSync(reviewPhaseDir)) {
    acquireChainLock(chainPath); // released by its own exit hook
  }
  let chain = [];
  if (!fs.existsSync(chainPath)) {
    console.error(`ERROR: Missing chain.json at ${chainPath}`);
    process.exit(1);
  }
  try {
    chain = JSON.parse(fs.readFileSync(chainPath, 'utf8'));
  } catch (e) {
    console.error(`ERROR: Failed to parse chain.json at ${chainPath}: ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(chain)) {
    console.error(`ERROR: Malformed chain.json at ${chainPath}: expected array`);
    process.exit(1);
  }

  // When more than one chain entry exists for the same generation, select the last one in the chain array
  let targetChainIdx = -1;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i] && chain[i].generation === generation) {
      targetChainIdx = i;
      break;
    }
  }

  if (targetChainIdx === -1) {
    console.error(`ERROR: No chain entry found for generation ${generation}`);
    process.exit(1);
  }

  const targetChainEntry = chain[targetChainIdx];
  // --allow-unresolved needs a written reason; checked before any write. --reason alone is a misuse, not a no-op.
  if (flags['allow-unresolved'] && (typeof flags.reason !== 'string' || flags.reason.trim().length === 0)) {
    console.error('ERROR: --allow-unresolved requires a non-empty --reason "<text>"; nothing was written');
    process.exit(1);
  }
  if (!flags['allow-unresolved'] && flags.reason !== undefined) {
    console.error('ERROR: --reason is only meaningful with --allow-unresolved; nothing was written');
    process.exit(1);
  }
  const allowedPendingStatuses = new Set(['pending', 'pending-with-gap']);
  if (!allowedPendingStatuses.has(targetChainEntry.status)) {
    console.error(`ERROR: Chain entry for generation ${generation} is not pending (got '${targetChainEntry.status}')`);
    process.exit(1);
  }

  // Never fabricate or default a chain entry with a blank base or head field if the real entry is missing fields
  if (!targetChainEntry.base || typeof targetChainEntry.base !== 'string' || !targetChainEntry.base.trim() ||
      !targetChainEntry.head || typeof targetChainEntry.head !== 'string' || !targetChainEntry.head.trim()) {
    console.error(`ERROR: Chain entry for generation ${generation} is missing base or head field`);
    process.exit(1);
  }

  // Validate findings.json
  if (!fs.existsSync(findingsPath)) {
    console.error(`ERROR: Missing findings.json at ${findingsPath}`);
    process.exit(1);
  }

  let findingsData;
  try {
    findingsData = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
  } catch (e) {
    console.error(`ERROR: Failed to parse ${findingsPath}: ${e.message}`);
    process.exit(1);
  }

  if (!findingsData || typeof findingsData !== 'object' || Array.isArray(findingsData) || !Array.isArray(findingsData.findings)) {
    console.error(`ERROR: findings.json must be a JSON object holding a findings array`);
    process.exit(1);
  }

  const findingsList = findingsData.findings;
  const findingsMap = new Map();
  for (let i = 0; i < findingsList.length; i++) {
    const f = findingsList[i];
    if (!f || typeof f !== 'object') {
      console.error(`ERROR: Finding entry at index ${i} is not an object`);
      process.exit(1);
    }
    if (typeof f.id !== 'string' || f.id.trim().length === 0) {
      console.error(`ERROR: Finding entry at index ${i} has empty or non-string id`);
      process.exit(1);
    }
    if (findingsMap.has(f.id)) {
      console.error(`ERROR: Duplicate finding id in findings.json: ${f.id}`);
      process.exit(1);
    }
    if (!SEVERITY_WORDS.has(f.severity)) {
      console.error(`ERROR: Finding ${f.id} has invalid severity '${f.severity}' (must be Critical, Major, Minor, or Suggestion)`);
      process.exit(1);
    }
    findingsMap.set(f.id, f);
  }

  // Validate dispositions file
  if (!fs.existsSync(dispositionsFile)) {
    console.error(`ERROR: Missing dispositions file at ${dispositionsFile}`);
    process.exit(1);
  }

  let dispData;
  try {
    dispData = JSON.parse(fs.readFileSync(dispositionsFile, 'utf8'));
  } catch (e) {
    console.error(`ERROR: Failed to parse dispositions file ${dispositionsFile}: ${e.message}`);
    process.exit(1);
  }

  if (!dispData || typeof dispData !== 'object' || Array.isArray(dispData) || !Array.isArray(dispData.findings)) {
    console.error(`ERROR: Dispositions file must be a JSON object holding a findings array`);
    process.exit(1);
  }

  if (dispData.schema_version !== 1) {
    console.error(`ERROR: Schema version mismatch in dispositions file: expected 1, got ${dispData.schema_version}`);
    process.exit(1);
  }

  if (dispData.phase !== phase || dispData.generation !== generation) {
    console.error(`ERROR: Phase or generation mismatch in dispositions file: expected phase '${phase}' generation ${generation}, got phase '${dispData.phase}' generation ${dispData.generation}`);
    process.exit(1);
  }

  const allowedDispositions = new Set(['verified', 'refuted', 'deferred', 'downgraded']);
  const dispFindings = dispData.findings;
  const dispMap = new Map();
  for (let i = 0; i < dispFindings.length; i++) {
    const df = dispFindings[i];
    if (!df || typeof df !== 'object') {
      console.error(`ERROR: Dispositions entry at index ${i} is not an object`);
      process.exit(1);
    }
    if (typeof df.id !== 'string' || df.id.trim().length === 0) {
      console.error(`ERROR: Dispositions entry at index ${i} has empty or non-string id`);
      process.exit(1);
    }
    if (dispMap.has(df.id)) {
      console.error(`ERROR: Duplicate finding id in dispositions file: ${df.id}`);
      process.exit(1);
    }
    if (!allowedDispositions.has(df.disposition)) {
      console.error(`ERROR: Finding ${df.id} has invalid disposition '${df.disposition}' (must be verified, refuted, deferred, or downgraded)`);
      process.exit(1);
    }
    if (typeof df.rationale !== 'string' || df.rationale.trim().length === 0) {
      console.error(`ERROR: Finding ${df.id} missing non-empty rationale string`);
      process.exit(1);
    }
    dispMap.set(df.id, df);
  }
  // Gate rule A (G14): a Critical/Major finding is verified, refuted as false (kind + evidence) or downgraded (to + kind + evidence).
  for (const df of dispFindings) {
    const fnd = findingsMap.get(df.id);
    const bad = fnd && (majorDispositionError(fnd, df) || downgradeMisuseError(fnd, df));
    if (bad) {
      console.error(`ERROR: ${bad}. Refusing to finalize; nothing was written.`);
      process.exit(1);
    }
  }

  // Optional explicit re-verification of EARLIER verified findings (BL-0032): the only way a later
  // generation closes one; absence from this generation's findings never does.
  let dispResolutions = [];
  if (dispData.resolutions !== undefined) {
    if (!Array.isArray(dispData.resolutions)) {
      console.error('ERROR: Dispositions "resolutions" must be an array of { id, rationale }');
      process.exit(1);
    }
    const seenRes = new Set();
    for (let i = 0; i < dispData.resolutions.length; i++) {
      const r = dispData.resolutions[i];
      if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.id !== 'string' || r.id.trim().length === 0) {
        console.error(`ERROR: Dispositions resolutions entry at index ${i} needs a non-empty string id`);
        process.exit(1);
      }
      if (typeof r.rationale !== 'string' || r.rationale.trim().length === 0) {
        console.error(`ERROR: Resolution ${r.id} missing non-empty rationale string`);
        process.exit(1);
      }
      if (seenRes.has(r.id) || findingsMap.has(r.id)) {
        console.error(`ERROR: Resolution ${r.id} is duplicated or names a finding of this same generation`);
        process.exit(1);
      }
      seenRes.add(r.id);
    }
    dispResolutions = dispData.resolutions;
  }

  // Check matching IDs: one entry per finding id, no extras, none missing
  for (const fid of findingsMap.keys()) {
    if (!dispMap.has(fid)) {
      console.error(`ERROR: Dispositions file missing finding id: ${fid}`);
      process.exit(1);
    }
  }
  for (const did of dispMap.keys()) {
    if (!findingsMap.has(did)) {
      console.error(`ERROR: Dispositions file contains unexpected finding id: ${did}`);
      process.exit(1);
    }
  }

  // Resolve provenance before any finalize-side write: the resolver exits the process on
  // failure, and a failure after the chain is marked finalized would strand the phase
  // (finalized chain, no receipt, re-run refused as "not pending").
  const resolverPath = getResolverPath(repoRoot);
  let resolvedFrom = resolveField(resolverPath, repoRoot, 'hetero_review_resolved_from');
  if (!resolvedFrom) {
    resolvedFrom = 'unknown';
  }
  // review_fresh_context (BL-0111): resolved with the other provenance, before any write. Only a
  // literal "off" is stamped; anything else (on, empty from a stub resolver) leaves the receipt as it was.
  const freshContext = resolveField(resolverPath, repoRoot, 'review_fresh_context') === 'off' ? 'off' : 'on';

  // Snapshot dispositions file into the generation's ledger directory as dispositions.json
  const snapshotRelPath = path.join(`review-${phase}`, `g${generation}`, 'dispositions.json');
  const snapshotAbsPath = path.join(gDir, 'dispositions.json');
  const dispRawBytes = fs.readFileSync(dispositionsFile);
  const dispSha256 = crypto.createHash('sha256').update(dispRawBytes).digest('hex');
  // (written below, after the unresolved-findings refusal point: a refusal must leave the ledger untouched)

  // Load findings and dispositions across generations in the chain
  const findingsByGeneration = new Map();
  const dispositionsByGeneration = new Map();

  for (const entry of chain) {
    const g = entry.generation;
    if (g === generation) {
      findingsByGeneration.set(g, findingsList);
      dispositionsByGeneration.set(g, { findings: dispFindings, resolutions: dispResolutions });
    } else if (entry.status === 'finalized' && entry.dispositions_path) {
      const earlierGDir = path.join(reviewPhaseDir, `g${g}`);
      const earlierFindingsPath = path.join(earlierGDir, 'findings.json');
      let earlierDispPath = entry.dispositions_path;
      if (!path.isAbsolute(earlierDispPath)) {
        earlierDispPath = path.join(ledgerDir, earlierDispPath);
      }
      let earlierFindings = [];
      let earlierDisps = [];
      let edResolutions;
      // v2.36.3: disk evidence is the ONLY closure input (review-chain-derive no longer honours
      // chain-entry stamps), so an unreadable earlier generation must fail closed — defaulting
      // to [] would read as "that generation reported nothing" and close every open finding.
      try {
        const efData = JSON.parse(fs.readFileSync(earlierFindingsPath, 'utf8'));
        earlierFindings = Array.isArray(efData.findings) ? efData.findings : [];
      } catch (e) {
        console.error(`ERROR: Cannot read findings.json of finalized generation ${g} at ${earlierFindingsPath}: ${e.message}`);
        process.exit(1);
      }
      try {
        const edData = JSON.parse(fs.readFileSync(earlierDispPath, 'utf8'));
        earlierDisps = Array.isArray(edData.findings) ? edData.findings : [];
        edResolutions = edData.resolutions;
      } catch (e) {
        console.error(`ERROR: Cannot read dispositions of finalized generation ${g} at ${earlierDispPath}: ${e.message}`);
        process.exit(1);
      }
      findingsByGeneration.set(g, earlierFindings);
      dispositionsByGeneration.set(g, { findings: earlierDisps, resolutions: Array.isArray(edResolutions) ? edResolutions : [] });
    }
  }

  // Derive final verdict, open findings, and closed findings using shared routine
  const derived = deriveReceiptState(chain, findingsByGeneration, dispositionsByGeneration);
  if (derived.unmatched_resolutions.length > 0) {
    const u = derived.unmatched_resolutions[0];
    console.error(`ERROR: Resolution '${u.id}' (generation ${u.generation}) names no open verified finding of an earlier generation`);
    process.exit(1);
  }
  const verdict = derived.verdict;
  const openFindings = derived.open_findings || derived.openFindings;

  // BL-0384: a converged verdict (no verified Critical or Major) can still carry verified Minor findings
  // of EARLIER generations that no resolution closed -- absence closes nothing. Refuse by default before
  // any write; --allow-unresolved --reason records the choice in the receipt (unresolved_allowed).
  let unresolvedAllowed;
  if (verdict === 'SHIP-AS-IS') {
    const unresolved = openFindings.filter((f) => f && !findingsMap.has(f.id));
    if (unresolved.length > 0) {
      if (flags['allow-unresolved']) {
        unresolvedAllowed = { reason: String(flags.reason).trim(), ids: unresolved.map((f) => f.id) };
      } else {
        const ids = unresolved.map((f) => String(f.id).slice(0, 8)).join(', ');
        console.error(`ERROR: verdict is SHIP-AS-IS but ${unresolved.length} verified finding(s) from earlier generations stay open with no resolution: ${ids}`);
        console.error(`ERROR: add a { "id": "<finding id>", "rationale": "..." } entry to "resolutions" in generation ${generation}'s dispositions file for each one that is now fixed, or pass --allow-unresolved --reason "<text>" to leave them open on purpose. Refusing to finalize; nothing was written.`);
        process.exit(1);
      }
    }
  }
  writeFileSyncAtomic(snapshotAbsPath, dispRawBytes);

  // If FIX-THEN-SHIP, write hands-brief.md and run check-redispatch-prompt.sh
  const briefPath = path.join(gDir, 'hands-brief.md');
  if (verdict === 'FIX-THEN-SHIP') {
    let engineLine = 'Engine: sonnet@claude-native effort=high';
    const topologyPath = process.env.AUTOPILOT_TOPOLOGY_FILE || path.join(process.env.HOME || '', '.autopilot', 'topology.json');
    if (fs.existsSync(topologyPath)) {
      try {
        const topData = JSON.parse(fs.readFileSync(topologyPath, 'utf8'));
        if (Array.isArray(topData.implementer_ladder) && topData.implementer_ladder.length > 0) {
          const first = topData.implementer_ladder[0];
          const eng = first.engine || '';
          const run = first.runner || '';
          const eff = first.effort || '';
          if (eng && run && eff) {
            engineLine = `Engine: ${eng}@${run} effort=${eff}`;
          }
        }
      } catch (_e) {
        engineLine = 'Engine: sonnet@claude-native effort=high';
      }
    }

    const briefLines = [engineLine];
    // Controller-written lines only. Verbatim finding text, finding ids, and
    // seat names stay out so the suppression linter cannot treat a quoted
    // reviewer (or the id/seat label) as the controller.
    const controllerFields = [{ label: 'the engine line', text: engineLine }];
    if (branch) {
      const branchLine = `Branch: ${branch}`;
      briefLines.push(branchLine);
      controllerFields.push({ label: 'the branch line', text: branchLine });
    }

    const baseSha = rangeObj.base || '';
    const headSha = rangeObj.head || '';
    const baseLine = `Base: ${baseSha}`;
    const headLine = `Head: ${headSha}`;
    briefLines.push(baseLine);
    briefLines.push(headLine);
    briefLines.push('');
    controllerFields.push({ label: 'the base line', text: baseLine });
    controllerFields.push({ label: 'the head line', text: headLine });

    // One paragraph per verified finding (any severity) written in plain prose.
    // The id/seat prefix is brief text only.
    for (const f of findingsList) {
      const disp = dispMap.get(f.id);
      if (disp && disp.disposition === 'verified') {
        const cleanText = (f.text || '')
          .replace(/```[\s\S]*?```/g, ' ')
          .replace(/[🔴🟠🟡🔵]/g, '')
          .replace(/\baround\s+line\s+\d+\b/gi, 'at the specified line')
          .replace(/[\r\n]+/g, ' ')
          .trim();
        const findingPrefix = `Finding ${f.id} from seat ${f.seat}:`;
        briefLines.push(`${findingPrefix} ${cleanText}`);
        briefLines.push('');
      }
    }

    if (flags['controller-notes']) {
      briefLines.push('Controller notes:');
      briefLines.push(controllerNotes.replace(/\s+$/, ''));
      briefLines.push('');
      controllerFields.push({ label: 'controller notes', text: controllerNotes });
    }

    writeFileSyncAtomic(briefPath, briefLines.join('\n').trim() + '\n');
    const controllerText = controllerFields.map((field) => field.text).join('\n').trim() + '\n';

    const runPromptCheck = (scriptPath, scriptLabel, args) => {
      const res = spawnSync(scriptPath, args, {
        encoding: 'utf8',
        cwd: repoRoot || process.cwd(),
        env: { ...process.env },
      });
      if (res.error) {
        console.error(`ERROR: ${scriptLabel} not found at ${scriptPath}`);
        process.exit(1);
      }
      return res;
    };

    // Run scripts/check-redispatch-prompt.sh from __dirname (with env override)
    const checkScript = process.env.AUTOPILOT_CHECK_REDISPATCH_PROMPT_SCRIPT
      || path.join(__dirname, 'check-redispatch-prompt.sh');

    const checkRes = runPromptCheck(checkScript, 'check-redispatch-prompt.sh', [briefPath]);

    if (checkRes.status !== 0) {
      console.error(`ERROR: check-redispatch-prompt.sh failed for ${briefPath}: ${checkRes.stderr || checkRes.stdout}`);
      process.exit(1);
    }

    // Run scripts/check-dispatch-suppression.sh from __dirname (no env override; see blind-dispatch.md).
    // Input is controller-written lines only, not the verbatim finding text.
    const suppressionScript = path.join(__dirname, 'check-dispatch-suppression.sh');
    const controllerPath = path.join(gDir, `.hands-brief-controller-${process.pid}.txt`);
    let suppressionRes;
    try {
      writeFileSyncAtomic(controllerPath, controllerText);
      suppressionRes = spawnSync(suppressionScript, [controllerPath], {
        encoding: 'utf8',
        cwd: repoRoot || process.cwd(),
        env: { ...process.env },
      });
    } finally {
      try {
        if (fs.existsSync(controllerPath)) fs.unlinkSync(controllerPath);
      } catch (_e) {}
    }

    if (suppressionRes && suppressionRes.error) {
      console.error(`ERROR: check-dispatch-suppression.sh not found at ${suppressionScript}`);
      process.exit(1);
    }

    if (!suppressionRes || suppressionRes.status !== 0) {
      const detail = suppressionRes ? (suppressionRes.stderr || suppressionRes.stdout || '') : 'no result';
      const phrases = [];
      for (const line of String(detail).split('\n')) {
        const matched = /^\s+-\s+(.*\S)\s*$/.exec(line);
        if (matched) phrases.push(matched[1]);
      }
      const blocked = [];
      for (const field of controllerFields) {
        const haystack = field.text.toLowerCase();
        if (phrases.some((phrase) => haystack.includes(phrase.toLowerCase()))) {
          blocked.push(field.label);
        }
      }
      const fieldLabel = blocked.length > 0 ? blocked.join(', ') : 'controller-written text';
      const quoted = phrases.length > 0 ? phrases.map((phrase) => `"${phrase}"`).join(', ') : '"(unparsed)"';
      console.error(`ERROR: check-dispatch-suppression.sh failed for ${briefPath}: ${fieldLabel} blocked by suppression phrase ${quoted}; rewrite it as a neutral instruction or move quoted reviewer text out of controller notes. ${detail}`);
      process.exit(1);
    }
  }

  // Update target chain entry
  targetChainEntry.status = 'finalized';
  targetChainEntry.finalized_at = new Date().toISOString();
  targetChainEntry.dispositions_path = snapshotRelPath;
  targetChainEntry.dispositions_sha256 = dispSha256;
  if (!targetChainEntry.findings_sha256 && fs.existsSync(findingsPath)) {
    targetChainEntry.findings_sha256 = crypto.createHash('sha256').update(fs.readFileSync(findingsPath)).digest('hex');
  }
  if (targetChainEntry.reviewed_seats === undefined && Array.isArray(targetChainEntry.seats)) {
    const revCount = targetChainEntry.seats.filter((s) => typeof s === 'string' || s.status === 'reviewed').length;
    targetChainEntry.reviewed_seats = revCount;
    targetChainEntry.total_seats = targetChainEntry.seats.length;
    targetChainEntry.reviewed_seats_count = revCount;
    targetChainEntry.total_seats_count = targetChainEntry.seats.length;
  }

  writeFileSyncAtomic(chainPath, JSON.stringify(chain, null, 2) + '\n');

  // Receipt
  let phaseBaseSha = '';
  const gen1Entry = chain.find((c) => c && c.generation === 1);
  if (gen1Entry && gen1Entry.base) {
    phaseBaseSha = gen1Entry.base;
  }

  const receipt = {
    kind: 'review',
    phase,
    branch: branch || undefined,
    ...(chain.some((c) => c && c.packet) ? { packet: (() => { const p = chain.find((c) => c && c.packet).packet; return { set: p.set, id: p.id }; })() } : {}),
    phase_base_sha: phaseBaseSha,
    chain,
    verdict,
    open_findings: openFindings,
    ...(unresolvedAllowed ? { unresolved_allowed: unresolvedAllowed } : {}),
    resolved_from: resolvedFrom,
    ...(freshContext === 'off' ? { review_fresh_context: 'off' } : {}),
    written_at: new Date().toISOString(),
  };

  const receiptPath = path.join(ledgerDir, `receipt-${phase}.json`);
  writeFileSyncAtomic(receiptPath, JSON.stringify(receipt, null, 2) + '\n');

  // Opt-in archive copy. Absent or empty dir: resolve config only, then return.
  // Any failure is one stderr line. The summary and exit code stay as they were.
  try {
    const archiveLib = require('./lib/review-ledger-copy.js');
    const archiveCfg = archiveLib.resolveArchiveConfig();
    if (archiveCfg.dir) {
      if (fs.existsSync(archiveCfg.dir)) {
        fs.accessSync(archiveCfg.dir, fs.constants.W_OK);
      }
      archiveLib.copyLedger({
        ledgerDir,
        repoDir: repoRoot,
        phases: [phase],
      });
    }
  } catch (archiveErr) {
    console.error(`review-ledger-archive: ${archiveErr && archiveErr.message ? archiveErr.message : archiveErr}`);
  }

  const summary = {
    phase,
    generation,
    verdict,
    open_findings_count: openFindings.length,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

// BL-0384 (b): independent verification of a resolutions addendum (ADR-0001: the claim is re-derived from
// the chain and git, never trusted). Returns an error string, or '' when every item holds. Pure apart from
// read-only git calls. The checker repeats these checks on its own (check-phase-review-receipt.js).
function verifyAddendumItems(items, ctx) {
  const { chain, findingsByGeneration, dispositionsByGeneration, baseDerived, repoRoot } = ctx;
  const git = (args) => spawnSync('git', args, { cwd: repoRoot || process.cwd(), encoding: 'utf8' });
  const seen = new Set();
  const dispOf = (g) => {
    const d = dispositionsByGeneration.get(g);
    return d && Array.isArray(d.findings) ? d.findings : [];
  };
  for (const it of items) {
    for (const k of ['id', 'rationale', 'fix_sha', 'reviewed_head']) {
      if (typeof it[k] !== 'string' || it[k].trim().length === 0) return `resolution entry needs a non-empty string '${k}'`;
    }
    if (it.fix_sha.startsWith('-') || it.reviewed_head.startsWith('-')) return `resolution '${it.id}': fix_sha/reviewed_head must be commit ids`;
    if (seen.has(it.id)) return `resolution '${it.id}' appears twice in the addendum`;
    seen.add(it.id);
    if (!baseDerived.open_findings.some((f) => f && f.id === it.id)) {
      return `resolution '${it.id}' names no open verified finding of the chain`;
    }
    const headEntry = chain.find((c) => c && c.status === 'finalized' && c.head === it.reviewed_head);
    if (!headEntry) return `resolution '${it.id}': reviewed_head ${it.reviewed_head} is not the head of a finalized generation`;
    let findingGen = 0;
    for (const e of chain) {
      if (!e || e.status !== 'finalized') continue;
      const fl = findingsByGeneration.get(e.generation) || [];
      const verified = fl.some((f) => f && f.id === it.id) && dispOf(e.generation).some((d) => d && d.id === it.id && d.disposition === 'verified');
      if (verified) findingGen = e.generation;
    }
    const findingEntry = chain.find((c) => c && c.generation === findingGen);
    if (!findingEntry || !findingEntry.head) return `resolution '${it.id}': cannot locate the generation that raised the finding`;
    const fix = git(['rev-parse', '--verify', '--quiet', `${it.fix_sha}^{commit}`]);
    if (fix.status !== 0 || !fix.stdout.trim()) return `resolution '${it.id}': fix_sha ${it.fix_sha} is not a commit in this repository`;
    const fixSha = fix.stdout.trim();
    if (git(['merge-base', '--is-ancestor', '--end-of-options', fixSha, it.reviewed_head]).status !== 0) {
      return `resolution '${it.id}': fix_sha ${fixSha} is not an ancestor of reviewed_head ${it.reviewed_head}`;
    }
    // Lower bound = the raising generation's HEAD (the code the reviewers flagged), not its base: a commit
    // inside that generation's own range is not a fix made after the finding. The head bound implies the base
    // bound (the head descends from the base), and together with the ancestor rule above it makes reviewed_head
    // a strictly later finalized head than the raising one.
    if (fixSha === findingEntry.head || git(['merge-base', '--is-ancestor', '--end-of-options', findingEntry.head, fixSha]).status !== 0) {
      return `resolution '${it.id}': fix_sha ${fixSha} is not a strict descendant of the head ${findingEntry.head} of generation ${findingGen}, the code the finding was raised on`;
    }
    it.fix_sha = fixSha;
  }
  return '';
}

function addendumRelPath(phase) {
  return `review-${phase}/resolutions-addendum.json`;
}

// refinalize (BL-0092): repair path for a chain whose closed_findings stamps were written by an older
// derive (e.g. pre-v2.36.3 attributing a closure to an aborted generation). Pure re-derivation: every
// finalized generation's findings.json / dispositions.json must still hash to the sha256 its chain
// entry recorded, otherwise it refuses and writes nothing. No new claim is accepted — the stamps,
// verdict and open_findings are recomputed from the same on-disk evidence, the other receipt fields
// are carried over unchanged.
async function handleRefinalize(flags) {
  const ledgerDir = flags.ledger ? path.resolve(flags.ledger) : '';
  const phase = flags.phase;
  const generation = parseInt(flags.generation, 10);
  if (!ledgerDir || !phase || isNaN(generation) || generation < 1) {
    console.error('ERROR: --ledger <dir>, --phase <id>, and --generation <n> are required for refinalize');
    process.exit(2);
  }
  const reviewPhaseDir = path.join(ledgerDir, `review-${phase}`);
  const chainPath = path.join(reviewPhaseDir, 'chain.json');
  const receiptPath = path.join(ledgerDir, `receipt-${phase}.json`);
  if (!fs.existsSync(chainPath) || !fs.existsSync(receiptPath)) {
    console.error(`ERROR: refinalize needs both ${chainPath} and ${receiptPath}`);
    process.exit(1);
  }
  acquireChainLock(chainPath);
  let chain;
  let receipt;
  try {
    chain = JSON.parse(fs.readFileSync(chainPath, 'utf8'));
    receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch (e) {
    console.error(`ERROR: Failed to parse chain or receipt: ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(chain) || chain.length === 0) {
    console.error('ERROR: Malformed chain.json: expected a non-empty array');
    process.exit(1);
  }
  const last = chain[chain.length - 1];
  if (!last || last.generation !== generation || last.status !== 'finalized') {
    console.error(`ERROR: --generation must be the last chain entry and finalized (last is generation ${last && last.generation}, status '${last && last.status}')`);
    process.exit(1);
  }
  const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
  const findingsByGeneration = new Map();
  const dispositionsByGeneration = new Map();
  for (const entry of chain) {
    if (entry.status !== 'finalized') continue;
    const g = entry.generation;
    if (!entry.findings_sha256 || !entry.dispositions_sha256 || !entry.dispositions_path) {
      console.error(`ERROR: Generation ${g} has no recorded findings/dispositions sha256 to verify against; refinalize cannot vouch for it`);
      process.exit(1);
    }
    const fPath = path.join(reviewPhaseDir, `g${g}`, 'findings.json');
    const dPath = path.isAbsolute(entry.dispositions_path) ? entry.dispositions_path : path.join(ledgerDir, entry.dispositions_path);
    let fBytes;
    let dBytes;
    try {
      fBytes = fs.readFileSync(fPath);
      dBytes = fs.readFileSync(dPath);
    } catch (e) {
      console.error(`ERROR: Cannot read evidence of generation ${g}: ${e.message}`);
      process.exit(1);
    }
    if (sha(fBytes) !== entry.findings_sha256) {
      console.error(`ERROR: findings.json of generation ${g} no longer matches its recorded sha256; refusing to refinalize`);
      process.exit(1);
    }
    if (sha(dBytes) !== entry.dispositions_sha256) {
      console.error(`ERROR: dispositions.json of generation ${g} no longer matches its recorded sha256; refusing to refinalize`);
      process.exit(1);
    }
    let fData;
    let dData;
    try {
      fData = JSON.parse(fBytes.toString('utf8'));
      dData = JSON.parse(dBytes.toString('utf8'));
    } catch (e) {
      console.error(`ERROR: Cannot parse evidence of generation ${g}: ${e.message}`);
      process.exit(1);
    }
    findingsByGeneration.set(g, Array.isArray(fData.findings) ? fData.findings : []);
    dispositionsByGeneration.set(g, {
      findings: Array.isArray(dData.findings) ? dData.findings : [],
      resolutions: Array.isArray(dData.resolutions) ? dData.resolutions : [],
    });
  }
  const baseDerived = deriveReceiptState(chain, findingsByGeneration, dispositionsByGeneration);
  if (baseDerived.unmatched_resolutions.length > 0) {
    const u = baseDerived.unmatched_resolutions[0];
    console.error(`ERROR: Resolution '${u.id}' (generation ${u.generation}) names no open verified finding of an earlier generation`);
    process.exit(1);
  }
  // BL-0384 (b): resolutions addendum. An addendum the receipt already carries is re-verified (sha pin,
  // then the same checks as a new one) and stays applied; --add-resolutions adds entries. Every check
  // runs before the first write, so a refusal leaves the ledger untouched.
  let addendumItems = [];
  let addendumWrite = null;
  const addendumPath = path.join(ledgerDir, addendumRelPath(phase));
  if (receipt.resolutions_addendum !== undefined) {
    const ra = receipt.resolutions_addendum;
    if (!ra || ra.path !== addendumRelPath(phase) || typeof ra.sha256 !== 'string') {
      console.error('ERROR: receipt.resolutions_addendum is malformed (needs the phase addendum path and a sha256)');
      process.exit(1);
    }
    let bytes;
    try { bytes = fs.readFileSync(addendumPath); } catch (e) {
      console.error(`ERROR: Cannot read ${addendumPath}: ${e.message}`);
      process.exit(1);
    }
    if (sha(bytes) !== ra.sha256) {
      console.error(`ERROR: ${addendumPath} no longer matches receipt.resolutions_addendum.sha256; refusing to refinalize`);
      process.exit(1);
    }
    try { addendumItems = JSON.parse(bytes.toString('utf8')); } catch (e) {
      console.error(`ERROR: Cannot parse ${addendumPath}: ${e.message}`);
      process.exit(1);
    }
    if (!Array.isArray(addendumItems) || addendumItems.length === 0) {
      console.error(`ERROR: ${addendumPath} must hold a non-empty JSON array; nothing was written`);
      process.exit(1);
    }
  }
  if (flags['add-resolutions'] !== undefined) {
    if (typeof flags['add-resolutions'] !== 'string') {
      console.error('ERROR: --add-resolutions needs a file path');
      process.exit(2);
    }
    let added;
    try { added = JSON.parse(fs.readFileSync(path.resolve(flags['add-resolutions']), 'utf8')); } catch (e) {
      console.error(`ERROR: Cannot read --add-resolutions file: ${e.message}`);
      process.exit(1);
    }
    if (!Array.isArray(added) || added.length === 0 || added.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
      console.error('ERROR: --add-resolutions file must be a non-empty JSON array of { id, rationale, fix_sha, reviewed_head }');
      process.exit(1);
    }
    addendumItems = addendumItems.concat(added.map((r) => ({ id: r.id, rationale: r.rationale, fix_sha: r.fix_sha, reviewed_head: r.reviewed_head })));
    addendumWrite = true;
  }
  let derived = baseDerived;
  if (addendumItems.length > 0) {
    const repoRoot = flags['repo-root'] ? path.resolve(flags['repo-root']) : '';
    if (!repoRoot) {
      console.error('ERROR: --repo-root <path> is required to verify a resolutions addendum against git');
      process.exit(2);
    }
    const bad = verifyAddendumItems(addendumItems, { chain, findingsByGeneration, dispositionsByGeneration, baseDerived, repoRoot });
    if (bad) {
      console.error(`ERROR: ${bad}; nothing was written`);
      process.exit(1);
    }
    derived = deriveReceiptState(chain, findingsByGeneration, dispositionsByGeneration, addendumItems);
    if (derived.unmatched_resolutions.length > 0) {
      const u = derived.unmatched_resolutions[0];
      console.error(`ERROR: Resolution '${u.id}' names no open verified finding at its reviewed_head; nothing was written`);
      process.exit(1);
    }
  }
  if (addendumWrite) {
    const addBytes = JSON.stringify(addendumItems, null, 2) + '\n';
    fs.mkdirSync(reviewPhaseDir, { recursive: true });
    writeFileSyncAtomic(addendumPath, addBytes);
    receipt.resolutions_addendum = { path: addendumRelPath(phase), sha256: sha(Buffer.from(addBytes, 'utf8')) };
  }
  writeFileSyncAtomic(chainPath, JSON.stringify(chain, null, 2) + '\n');
  receipt.chain = chain;
  receipt.verdict = derived.verdict;
  receipt.open_findings = derived.open_findings;
  // unresolved_allowed is derived output too: re-derive its id set from the new open set (an addendum may have closed some).
  if (receipt.unresolved_allowed !== undefined) {
    const lastIds = new Set((findingsByGeneration.get(generation) || []).filter((f) => f && f.id).map((f) => f.id));
    const ids = derived.open_findings.filter((f) => f && !lastIds.has(f.id)).map((f) => f.id);
    if (ids.length > 0) receipt.unresolved_allowed = { ...receipt.unresolved_allowed, ids };
    else delete receipt.unresolved_allowed;
  }
  // A top-level closed_findings (older writers) is derived output too; leaving it would keep a stale value the checker compares.
  if (receipt.closed_findings !== undefined) receipt.closed_findings = derived.closed_findings;
  receipt.written_at = new Date().toISOString();
  writeFileSyncAtomic(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ phase, generation, verdict: derived.verdict, open_findings_count: derived.open_findings.length, refinalized: true }, null, 2));
  process.exit(0);
}

async function handleOptOut(flags) {
  const repoRoot = flags['repo-root'] ? path.resolve(flags['repo-root']) : '';
  const ledgerDir = flags.ledger ? path.resolve(flags.ledger) : '';
  const phase = flags.phase;
  const knob = flags.knob;

  if (!ledgerDir || !phase || !knob) {
    console.error('ERROR: --ledger <dir>, --phase <id>, and --knob <knob> are required for opt-out');
    process.exit(2);
  }

  if (knob !== 'plan_review' && knob !== 'hetero_review') {
    console.error(`ERROR: Invalid --knob '${knob}' (must be plan_review or hetero_review)`);
    process.exit(2);
  }

  const configRelPath = path.join('.claude', 'review-loop-config.md');
  const configPath = repoRoot ? path.join(repoRoot, configRelPath) : configRelPath;

  if (!fs.existsSync(configPath)) {
    console.error(`ERROR: Config source file does not exist at ${configPath}`);
    process.exit(1);
  }

  let configuredValue = 'absent';
  let configBytes;

  try {
    configBytes = fs.readFileSync(configPath);
    const text = configBytes.toString('utf8');
    const lines = text.split(/\r?\n/);
    const regex = new RegExp(`(?:^|[-\\s#*>])${knob}(?:[\\s:=]+)(off|on|auto)\\b`, 'i');
    for (const line of lines) {
      const m = line.match(regex);
      if (m) {
        configuredValue = m[1].toLowerCase();
        break;
      }
    }
  } catch (e) {
    console.error(`ERROR: Failed to read config source file at ${configPath}: ${e.message}`);
    process.exit(1);
  }

  const sha256 = crypto.createHash('sha256').update(configBytes).digest('hex');
  const configSource = {
    path: configPath,
    sha256,
  };

  const resolverPath = getResolverPath(repoRoot);
  let resolvedFrom = resolveField(resolverPath, repoRoot, `${knob}_resolved_from`);
  if (!resolvedFrom) {
    resolvedFrom = 'unknown';
  }

  const receipt = {
    kind: 'opt-out',
    phase,
    knob,
    configured_value: configuredValue,
    config_source: configSource,
    resolved_from: resolvedFrom,
    written_at: new Date().toISOString(),
  };

  const receiptPath = path.join(ledgerDir, `receipt-${phase}.json`);
  writeFileSyncAtomic(receiptPath, JSON.stringify(receipt, null, 2) + '\n');

  const summary = {
    phase,
    knob,
    configured_value: configuredValue,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

async function main() {
  const argv = process.argv.slice(2);
  const { positional, flags } = parseArgv(argv);

  if (flags.help || positional.length === 0) {
    showHelp();
    process.exit(0);
  }

  const subcommand = positional[0];

  if (subcommand === 'collect') {
    await handleCollect(flags);
  } else if (subcommand === 'finalize') {
    await handleFinalize(flags);
  } else if (subcommand === 'refinalize') {
    await handleRefinalize(flags);
  } else if (subcommand === 'opt-out') {
    await handleOptOut(flags);
  } else {
    console.error(`Subcommand '${subcommand}' is not yet implemented.`);
    console.error('Usage: node scripts/hetero-review-loop.js <subcommand> [flags]');
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
