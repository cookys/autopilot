#!/usr/bin/env node
/**
 * check-phase-review-receipt.js — validate review phase receipts or plan-artifact dispositions.
 *
 * Mode A: receipt validation
 *   Flags: --ledger <dir> --phase <id> --branch <b> [--repo-root <r>]
 *   Validates <ledger>/receipt-<phase>.json against git history and review artifacts.
 *   Optional --post-head-ledger <file>: declared-and-re-derived check of head..tip past the generation cap (see checkPostHeadLedger).
 *
 * Mode C: review packet set (a range too big for one packet, split by path)
 *   Flags: --packets <packets.json> --ledger <dir> --branch <b> --phase-base <sha> [--repo-root <r>]
 *   Every packet phase `<set>-<id>` must pass Mode A (SHIP-AS-IS), the packets must cover the reviewed range
 *   exactly once, and no packet file may have changed since its packet's last reviewed head. A packet
 *   receipt alone is refused by Mode A. Exit 0 only when the whole set holds. Plan:
 *   project/plans/_archive/2026/10/2026-10-11-review-packet-mode.md. Shared rules: scripts/lib/review-packets.js.
 *
 * Mode D: review chain (sets A,B,... reviewing one contiguous base..tip; see validateReviewChain)
 *   Flags: --chain <A,B[,C...]> --ledger <dir> --branch <b> --phase-base <sha> [--repo-root <r>]
 *   Packets members are not supported yet: validate those with --packets, separately.
 *
 * Mode B: plan-artifact / dispositions validation
 *   Flags: --plan-artifact <gN.json> --dispositions <gN-disposition.json>
 *   Validates that all candidate blockers have valid accepted/rejected dispositions.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const deriveReceiptState = require('./lib/review-chain-derive');

const { EXCLUDE_ALLOWLIST, isPathspecAllowed, loadConsumerExcludeAllowlist } = require('./lib/exclude-allowlist');
const reviewPackets = require('./lib/review-packets');
const LAYOUT = require('./lib/repo-layout.js');
// Plans sit where the layout registry puts them (docs/plans at bootstrap, project/plans from P1) when the repo is this one,
// and under the docs/plans convention in any other repo (LAYOUT.pathFor decides per repo root).
const planDirsAbs = (repoRoot) => [path.join(repoRoot, LAYOUT.pathFor(repoRoot, 'plans_dir'))];
const inPlanDirs = (repoRoot, name) => planDirsAbs(repoRoot).map((d) => path.join(d, name));

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

function printUsage() {
  console.log(`Usage:
  Mode A (Receipt validation):
    node scripts/check-phase-review-receipt.js --ledger <dir> --phase <id> --branch <b> --phase-base <sha> [--repo-root <r>] [--post-head-ledger <file> --post-head-target <ref>]

  Mode C (Review packet set — a range too big for one packet, split by path):
    node scripts/check-phase-review-receipt.js --packets <packets.json> --ledger <dir> --branch <b> --phase-base <sha> [--repo-root <r>]

  Mode D (Review chain — several review sets that together review one contiguous base..tip):
    node scripts/check-phase-review-receipt.js --chain <A,B[,C...]> --ledger <dir> --branch <b> --phase-base <sha> [--repo-root <r>]

  Mode B (Plan-artifact / dispositions validation):
    node scripts/check-phase-review-receipt.js --plan-artifact <gN.json> --dispositions <gN-disp.json> [--plan-file <p>] [--rubric-file <r>]

Flags:
  --ledger <dir>                    Ledger directory containing receipts
  --phase <id>                      Phase identifier
  --chain <A,B[,C...]>              Review sets in review order (Mode A phase ids in one --ledger); each must pass Mode A
                                    (SHIP-AS-IS), set k must start at set k-1's last reviewed head, and every changed path
                                    must be in the range of some set. Packets members are not supported yet: validate those
                                    with --packets, separately.
  --branch <b>                      Git branch name
  --post-head-ledger <file>         Mode A only. Replaces "branch head must equal the last reviewed head" with a re-derived
                                    check of the own commits past the head, for work past the generation cap (BL-0377).
                                    Needs --post-head-target. The file is JSON:
                                    {"schema":"post-head-ledger/1","phase":"<id>","reviewed_head":"<full sha>",
                                     "ruling":"<PM ruling id or text>",
                                     "commits":[{"sha":"<full sha>","paths":["..."],"verification":"<how depth-0 verified it>"}]}
                                    Passes only when reviewed_head is the last finalized head and an ancestor of the tip,
                                    phase equals --phase, every non-merge commit of git rev-list --no-merges head..tip ^target
                                    (the branch's own commits) is listed exactly once (no extras, no duplicates, no abbreviated
                                    shas), each commit's real paths (git diff-tree -r --no-renames --name-only) are a subset of
                                    its listed paths, and every verification is non-empty. A merge commit M in that range whose
                                    tree differs from git's own re-merge of its two parents (git diff-tree --remerge-diff:
                                    conflict resolution, evil merge, taking one side whole, -X, -s ours) must be listed under
                                    its own sha with paths covering that difference; a clean merge needs no entry; a merge with
                                    more than two parents fails closed. Commits that came in from the target are not listed.
                                    Not supported with --chain, --packets or Mode B (refused).
  --post-head-target <ref>          Required with --post-head-ledger (and refused without it): the line the branch merges into
                                    (normally origin/develop) as it was before this work. Resolved to a sha once. It must descend
                                    from --phase-base and must NOT contain the last reviewed head (so not the tip, the branch, or
                                    a line that already took the work) and must lie on the first-parent history of the merge
                                    target ref (a side branch cut from the phase base is refused). Own commits are head..tip
                                    minus what that sha reaches.
  --post-head-target-ref <ref>      The merge target's own ref, default refs/remotes/origin/develop (fetch first). Only its
                                    first-parent history is used, to check that --post-head-target is on the mainline. A
                                    ref that does not resolve fails closed. Not read from repo config.
  --phase-base <sha>                Expected phase base commit sha (mandatory for review mode)
  --repo-root <r>                   Path to repository root (defaults to cwd)
  --plan-artifact <gN.json>         Plan artifact JSON file
  --dispositions <gN-disp.json>     Dispositions JSON file
  --plan-file <file>                Plan markdown file (optional, resolved automatically if omitted)
  --rubric-file <file>              Rubric markdown file (optional, resolved automatically if omitted)
  --min-reviewed-seats <n>          Minimum reviewed seats required per generation
  --help, -h                        Show this help message and exit 0

Merge gate: always run on the tip. Below the generation cap a product-code delta after the last reviewed
head needs one more single-seat delta review (so the receipt itself passes on the tip); at the cap use
--post-head-ledger together with the PM ruling.

Chain rules (Mode A): every chain entry must be 'finalized' except an 'aborted' one (hetero-review-loop
wrote it when the branch moved during collection, a seat's findings failed to parse, or a seat gap
left the generation without a usable review: reasons seat_gap, seat_gap_below_min). An aborted entry
is accepted only as a recorded non-review: it must not be the last entry, it carries no head, the next
generation continues from its base, and its range.json (if present) names that base. It contributes no
findings and closes none (review-chain-derive skips it). v2.36.3.
`);
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        flags[key] = argv[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function runResolverField(resolverPath, repoRoot, fieldName) {
  try {
    const args = ['--field', fieldName];
    if (repoRoot) {
      args.push('--repo-root', repoRoot);
    }
    const res = spawnSync(resolverPath, args, {
      encoding: 'utf8',
      cwd: repoRoot || process.cwd(),
      env: { ...process.env },
    });
    if (res.status === 0 && res.stdout) {
      return res.stdout.trim();
    }
    return '';
  } catch (_e) {
    return '';
  }
}

function resolvePlanFile(flags, planArtifact, dispositions, planArtifactPath, dispositionsPath, repoRoot) {
  const explicit = flags['plan-file'] || flags['plan_file'] || flags.plan || flags['plan-path'] || flags['plan_path']
    || planArtifact.plan_path || planArtifact.plan_file || planArtifact.planFile
    || dispositions.plan_path || dispositions.plan_file || dispositions.planFile;
  if (explicit) {
    const resolved = path.isAbsolute(explicit) ? explicit : path.resolve(repoRoot, explicit);
    if (fs.existsSync(resolved)) return resolved;
  }
  const id = planArtifact.logical_plan_id;
  if (id) {
    const candidates = [
      ...inPlanDirs(repoRoot, `${id}.md`),
      path.join(repoRoot, `${id}.md`),
      path.join(path.dirname(planArtifactPath), `${id}.md`),
      path.join(path.dirname(planArtifactPath), 'plan.md'),
      path.join(path.dirname(dispositionsPath), `${id}.md`),
      path.join(path.dirname(dispositionsPath), 'plan.md'),
    ];
    const mSuff = id.match(/^(.+)-(\d{4}-\d{2}-\d{2})$/);
    if (mSuff) {
      candidates.push(...inPlanDirs(repoRoot, `${mSuff[2]}-${mSuff[1]}.md`));
      candidates.push(path.join(path.dirname(planArtifactPath), `${mSuff[2]}-${mSuff[1]}.md`));
      candidates.push(path.join(path.dirname(dispositionsPath), `${mSuff[2]}-${mSuff[1]}.md`));
    }
    const mPref = id.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
    if (mPref) {
      candidates.push(...inPlanDirs(repoRoot, `${mPref[2]}-${mPref[1]}.md`));
      candidates.push(path.join(path.dirname(planArtifactPath), `${mPref[2]}-${mPref[1]}.md`));
      candidates.push(path.join(path.dirname(dispositionsPath), `${mPref[2]}-${mPref[1]}.md`));
    }
    for (const cand of candidates) {
      if (fs.existsSync(cand)) return cand;
    }
  }
  if (planArtifact.plan_sha256) {
    const searchDirs = [path.dirname(planArtifactPath), path.dirname(dispositionsPath), ...planDirsAbs(repoRoot)];
    for (const d of searchDirs) {
      try {
        if (!fs.existsSync(d)) continue;
        const files = fs.readdirSync(d);
        for (const file of files) {
          if (file.endsWith('.md') && !file.endsWith('.rubric.md')) {
            const full = path.join(d, file);
            const bytes = fs.readFileSync(full);
            if (crypto.createHash('sha256').update(bytes).digest('hex') === planArtifact.plan_sha256) {
              return full;
            }
          }
        }
      } catch (_e) {}
    }
  }
  return null;
}

function resolveRubricFile(flags, planArtifact, dispositions, planArtifactPath, dispositionsPath, planFilePath, repoRoot) {
  const explicit = flags['rubric-file'] || flags['rubric_file'] || flags.rubric || flags['rubric-path'] || flags['rubric_path']
    || planArtifact.rubric_path || planArtifact.rubric_file || planArtifact.rubricFile
    || dispositions.rubric_path || dispositions.rubric_file || dispositions.rubricFile;
  if (explicit) {
    const resolved = path.isAbsolute(explicit) ? explicit : path.resolve(repoRoot, explicit);
    if (fs.existsSync(resolved)) return resolved;
  }
  if (planFilePath) {
    const parsed = path.parse(planFilePath);
    const cand = path.join(parsed.dir, `${parsed.name}.rubric.md`);
    if (fs.existsSync(cand)) return cand;
  }
  const id = planArtifact.logical_plan_id;
  if (id) {
    const candidates = [
      ...inPlanDirs(repoRoot, `${id}.rubric.md`),
      path.join(repoRoot, `${id}.rubric.md`),
      path.join(path.dirname(planArtifactPath), `${id}.rubric.md`),
      path.join(path.dirname(planArtifactPath), 'rubric.md'),
      path.join(path.dirname(dispositionsPath), `${id}.rubric.md`),
      path.join(path.dirname(dispositionsPath), 'rubric.md'),
    ];
    const mSuff = id.match(/^(.+)-(\d{4}-\d{2}-\d{2})$/);
    if (mSuff) {
      candidates.push(...inPlanDirs(repoRoot, `${mSuff[2]}-${mSuff[1]}.rubric.md`));
      candidates.push(path.join(path.dirname(planArtifactPath), `${mSuff[2]}-${mSuff[1]}.rubric.md`));
      candidates.push(path.join(path.dirname(dispositionsPath), `${mSuff[2]}-${mSuff[1]}.rubric.md`));
    }
    const mPref = id.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
    if (mPref) {
      candidates.push(...inPlanDirs(repoRoot, `${mPref[2]}-${mPref[1]}.rubric.md`));
      candidates.push(path.join(path.dirname(planArtifactPath), `${mPref[2]}-${mPref[1]}.rubric.md`));
      candidates.push(path.join(path.dirname(dispositionsPath), `${mPref[2]}-${mPref[1]}.rubric.md`));
    }
    for (const cand of candidates) {
      if (fs.existsSync(cand)) return cand;
    }
  }
  if (planArtifact.rubric_sha256) {
    const searchDirs = [path.dirname(planArtifactPath), path.dirname(dispositionsPath), ...planDirsAbs(repoRoot), path.join(repoRoot, 'evals')];
    for (const d of searchDirs) {
      try {
        if (!fs.existsSync(d)) continue;
        const files = fs.readdirSync(d);
        for (const file of files) {
          if (file.endsWith('.md')) {
            const full = path.join(d, file);
            const bytes = fs.readFileSync(full);
            if (crypto.createHash('sha256').update(bytes).digest('hex') === planArtifact.rubric_sha256) {
              return full;
            }
          }
        }
      } catch (_e) {}
    }
  }
  return null;
}

function validateModeB(flags) {
  const planArtifactPath = flags['plan-artifact'];
  const dispositionsPath = flags.dispositions;
  const repoRoot = flags['repo-root'] ? path.resolve(flags['repo-root']) : process.cwd();

  let planArtifact;
  try {
    const content = fs.readFileSync(planArtifactPath, 'utf8');
    planArtifact = JSON.parse(content);
  } catch (err) {
    console.error(`Failed to read or parse plan-artifact: ${err.message}`);
    process.exit(1);
  }

  let dispositions;
  try {
    const content = fs.readFileSync(dispositionsPath, 'utf8');
    dispositions = JSON.parse(content);
  } catch (err) {
    console.error(`Failed to read or parse dispositions: ${err.message}`);
    process.exit(1);
  }

  if (!planArtifact || typeof planArtifact !== 'object' || Array.isArray(planArtifact)) {
    console.error('Plan artifact must parse as a JSON object');
    process.exit(1);
  }

  if (!dispositions || typeof dispositions !== 'object' || Array.isArray(dispositions)) {
    console.error('Dispositions must parse as a JSON object');
    process.exit(1);
  }

  // Canonical plan_review_artifact shape:
  // artifact_type, logical_plan_id, generation, plan_sha256, rubric_sha256
  if (planArtifact.artifact_type !== 'plan_review_artifact') {
    console.error(`Invalid or missing artifact_type in plan-artifact: expected 'plan_review_artifact', got '${planArtifact.artifact_type}'`);
    process.exit(1);
  }

  if (typeof planArtifact.logical_plan_id !== 'string' || planArtifact.logical_plan_id.trim().length === 0) {
    console.error('Missing or invalid logical_plan_id in plan-artifact');
    process.exit(1);
  }

  if (typeof planArtifact.generation !== 'number' || !Number.isInteger(planArtifact.generation)) {
    console.error('Missing or invalid generation in plan-artifact');
    process.exit(1);
  }

  const sha256Regex = /^[0-9a-f]{64}$/i;
  if (typeof planArtifact.plan_sha256 !== 'string' || !sha256Regex.test(planArtifact.plan_sha256)) {
    console.error('Missing or invalid plan_sha256 in plan-artifact');
    process.exit(1);
  }

  if (typeof planArtifact.rubric_sha256 !== 'string' || !sha256Regex.test(planArtifact.rubric_sha256)) {
    console.error('Missing or invalid rubric_sha256 in plan-artifact');
    process.exit(1);
  }

  if (!Array.isArray(planArtifact.findings)) {
    console.error('Plan artifact must contain a findings array');
    process.exit(1);
  }

  // Dispositions file identity match:
  // logical_plan_id and generation must match artifact
  if (typeof dispositions.logical_plan_id !== 'string' || dispositions.logical_plan_id !== planArtifact.logical_plan_id) {
    console.error(`Dispositions logical_plan_id mismatch: expected '${planArtifact.logical_plan_id}', got '${dispositions.logical_plan_id}'`);
    process.exit(1);
  }

  if (dispositions.generation !== planArtifact.generation) {
    console.error(`Dispositions generation mismatch: expected ${planArtifact.generation}, got ${dispositions.generation}`);
    process.exit(1);
  }

  if (!Array.isArray(dispositions.findings)) {
    console.error('Dispositions must contain a findings array');
    process.exit(1);
  }

  // Verify actual plan file and rubric file on disk
  const planFile = resolvePlanFile(flags, planArtifact, dispositions, planArtifactPath, dispositionsPath, repoRoot);
  if (!planFile || !fs.existsSync(planFile)) {
    console.error(`Cannot find plan file on disk for logical_plan_id '${planArtifact.logical_plan_id}'`);
    process.exit(1);
  }

  let planBytes;
  try {
    planBytes = fs.readFileSync(planFile);
  } catch (err) {
    console.error(`Failed to read plan file at ${planFile}: ${err.message}`);
    process.exit(1);
  }
  const computedPlanSha = crypto.createHash('sha256').update(planBytes).digest('hex');
  if (computedPlanSha !== planArtifact.plan_sha256) {
    console.error(`Plan file sha256 mismatch: expected '${planArtifact.plan_sha256}', computed '${computedPlanSha}'`);
    process.exit(1);
  }

  const rubricFile = resolveRubricFile(flags, planArtifact, dispositions, planArtifactPath, dispositionsPath, planFile, repoRoot);
  if (!rubricFile || !fs.existsSync(rubricFile)) {
    console.error(`Cannot find rubric file on disk for logical_plan_id '${planArtifact.logical_plan_id}'`);
    process.exit(1);
  }

  let rubricBytes;
  try {
    rubricBytes = fs.readFileSync(rubricFile);
  } catch (err) {
    console.error(`Failed to read rubric file at ${rubricFile}: ${err.message}`);
    process.exit(1);
  }
  const computedRubricSha = crypto.createHash('sha256').update(rubricBytes).digest('hex');
  if (computedRubricSha !== planArtifact.rubric_sha256) {
    console.error(`Rubric file sha256 mismatch: expected '${planArtifact.rubric_sha256}', computed '${computedRubricSha}'`);
    process.exit(1);
  }

  const allowedDispositions = new Set([
    'accepted_blocker',
    'accepted_nonblocking',
    'rejected',
    'duplicate',
    'deferred',
    'verified',
    'refuted',
  ]);

  function validateFindingObj(f, sourceName) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) {
      console.error(`Finding in ${sourceName} is not an object`);
      process.exit(1);
    }
    const idVal = f.fingerprint !== undefined ? f.fingerprint : f.id;
    if (typeof idVal !== 'string' || idVal.trim().length === 0) {
      console.error(`Finding in ${sourceName} missing valid string id/fingerprint`);
      process.exit(1);
    }
    if (sourceName === 'plan artifact' && typeof f.candidate_blocker !== 'boolean') {
      console.error(`Finding '${idVal}' in ${sourceName} candidate_blocker is mandatory and must be a boolean`);
      process.exit(1);
    }
    // The controller (dispatch-plan-review.js) writes every terminal artifact with
    // `disposition: null` on its findings — depth-0's adjudication lives in the
    // separate dispositions file this checker overlays below. So `null` is the
    // artifact's normal shape, not a defect; every artifact on record before this
    // change carried it, which meant no plan receipt had ever validated. A string
    // on the artifact side is still checked when present; the dispositions side
    // must always carry one.
    const nullAllowed = sourceName === 'plan artifact' && (f.disposition === null || f.disposition === undefined);
    if (!nullAllowed && (typeof f.disposition !== 'string' || !allowedDispositions.has(f.disposition))) {
      console.error(`Finding '${idVal}' in ${sourceName} invalid disposition '${f.disposition}'`);
      process.exit(1);
    }
    return idVal;
  }

  // Validate each finding object in planArtifact & check duplicates
  const artifactFindingMap = new Map();
  for (const f of planArtifact.findings) {
    const id = validateFindingObj(f, 'plan artifact');
    if (artifactFindingMap.has(id)) {
      console.error(`Duplicate finding id in plan-artifact: '${id}'`);
      process.exit(1);
    }
    artifactFindingMap.set(id, f);
  }

  // Validate each finding object in dispositions & check duplicates
  const dispMap = new Map();
  for (const f of dispositions.findings) {
    const id = validateFindingObj(f, 'dispositions');
    if (dispMap.has(id)) {
      console.error(`Duplicate finding id in dispositions: '${id}'`);
      process.exit(1);
    }
    dispMap.set(id, f);
  }

  // Require exact one-to-one disposition coverage: every finding id in the artifact
  // has exactly one disposition, no extras, no duplicates
  for (const id of artifactFindingMap.keys()) {
    if (!dispMap.has(id)) {
      console.error(`Finding '${id}' in plan-artifact missing in dispositions`);
      process.exit(1);
    }
  }

  for (const id of dispMap.keys()) {
    if (!artifactFindingMap.has(id)) {
      console.error(`Dispositions contains unexpected finding id '${id}' not in plan-artifact`);
      process.exit(1);
    }
  }

  // 'rejected' is a valid disposition for both blocker and non-blocker findings — only
  // 'accepted_blocker' is exclusive to candidate_blocker=true findings.
  const blockerValidDispositions = new Set(['accepted_blocker', 'rejected']);
  const blockerExclusiveDispositions = new Set(['accepted_blocker']);
  const rationaleRequiredDispositions = new Set(['accepted_blocker', 'rejected']);
  const failingFindings = [];

  for (const finding of planArtifact.findings) {
    if (!finding) {
      continue;
    }
    const id = finding.fingerprint !== undefined ? finding.fingerprint : finding.id;
    const disp = dispMap.get(id);
    if (!disp) {
      failingFindings.push(`Finding '${id}': missing in dispositions`);
      continue;
    }
    const disposition = disp.disposition;

    if (finding.candidate_blocker === true) {
      if (!blockerValidDispositions.has(disposition)) {
        failingFindings.push(
          `Finding '${id}': invalid disposition '${disposition}' (candidate_blocker=true requires 'accepted_blocker' or 'rejected')`
        );
        continue;
      }
    } else {
      // d2-plan-candidate-blocker-fail-open: a non-blocker finding's disposition class must
      // match — it must NOT be disposed with a blocker-exclusive disposition, which would let a
      // finding evade the blocker-specific checks above by simply mislabelling itself.
      // 'rejected' is NOT blocker-exclusive: a non-blocker finding may legitimately be rejected.
      if (blockerExclusiveDispositions.has(disposition)) {
        failingFindings.push(
          `Finding '${id}': disposition '${disposition}' is blocker-exclusive but candidate_blocker=false`
        );
        continue;
      }
    }

    if (rationaleRequiredDispositions.has(disposition)) {
      const rationale = typeof disp.rationale === 'string' ? disp.rationale.trim() : '';
      if (!rationale) {
        failingFindings.push(`Finding '${id}': rationale must be a non-empty string`);
        continue;
      }
    }
  }

  if (failingFindings.length > 0) {
    for (const failMsg of failingFindings) {
      console.error(failMsg);
    }
    process.exit(1);
  }

  process.exit(0);
}

const CANONICAL_POSITIVE_INT_RE = /^[1-9][0-9]*$/;

// Item 2 / d2-seat-receipt-forgery: the minimum reviewed-seat count is taken ONLY from
// trusted configuration (a CLI flag or an environment variable) — never from the receipt
// under test, which would otherwise let a forger ship its own passing threshold alongside
// the forged evidence. With no configuration supplied, the default is "all seats".
// The configured value, when present, must be a canonical positive integer string
// (no leading zeros, no sign, no trailing junk) — parseInt() alone would silently accept
// '3x' as 3 or '-1' as -1, so this is validated up front, before any generation validation.
function resolveConfiguredMinSeats(flags) {
  let raw;
  let source;
  if (flags['min-reviewed-seats'] !== undefined) {
    raw = flags['min-reviewed-seats'];
    source = '--min-reviewed-seats';
  } else if (flags['min-seats'] !== undefined) {
    raw = flags['min-seats'];
    source = '--min-seats';
  } else if (flags['min_reviewed_seats'] !== undefined) {
    raw = flags['min_reviewed_seats'];
    source = '--min_reviewed_seats';
  } else if (process.env.AUTOPILOT_MIN_REVIEWED_SEATS !== undefined) {
    raw = process.env.AUTOPILOT_MIN_REVIEWED_SEATS;
    source = 'AUTOPILOT_MIN_REVIEWED_SEATS';
  } else {
    return null;
  }

  const str = typeof raw === 'string' ? raw : String(raw);
  if (!CANONICAL_POSITIVE_INT_RE.test(str)) {
    console.error(`Invalid ${source} value '${raw}': must be a canonical positive integer (e.g. '1', '2', '3'; no zero, negatives, signs, decimals, or trailing characters)`);
    process.exit(1);
  }
  return parseInt(str, 10);
}

// opts.packetSet ({ set, id, sha256, paths }) is passed only by the set check (validatePacketSet) — an
// in-process parameter, never a CLI flag. A receipt whose chain carries `packet` covers only that
// packet's files, so it must not pass as a whole-range receipt on its own.
// Thrown in place of process.exit while validatePacketSet runs a packet's Mode A in-process. Every catch
// inside validateModeA re-throws it, otherwise a catch that wraps a process.exit would swallow the exit and
// report a misleading second error. (Chosen over one child process per packet: the packet context stays an
// in-process parameter, not a CLI flag a caller could pass to a lone receipt.)
class ExitSignal { constructor(code) { this.code = code; } }

// The one rule for "the branch moved past the last reviewed head": the move is tolerated only when EVERY
// changed path is an allowlisted exclusion or a sidecar (CHANGELOG.md, projects index). Mode A step (5) and
// the --chain tail check both call this, so the two can never diverge.
function pathsMovedAfterHead(repoRoot, range, consumerAllowlist) {
  // --no-renames: a rename shows only its destination otherwise (and diff.renames in the user's git config
  // decides), so a reviewed product file moved onto an allowlisted path would list only the allowed path.
  const diffRes = spawnSync('git', ['diff', '--no-renames', '--name-only', range], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const changedPaths = (diffRes.stdout || '')
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
  const sidecarAllowed = (p) => p === 'CHANGELOG.md' || p === LAYOUT.pathFor(repoRoot, 'projects_index');
  const blocked = changedPaths.filter((p) => !(isPathspecAllowed(p, consumerAllowlist, repoRoot) || sidecarAllowed(p)));
  return { changedPaths, blocked, allAllowed: diffRes.status === 0 && blocked.length === 0 };
}

// Post-head ledger (BL-0377). At the generation cap the branch tip may sit past the last reviewed head. The ledger
// DECLARES every own commit past the head, the paths it touched and how depth-0 verified it; this function
// re-derives the commit list and the paths with git and compares. Nothing in the ledger is trusted (ADR-0001):
// no hash, no signature, an unlisted commit or path is a failure.
// Scope ("the branch's own commits"): `git rev-list --no-merges <head>..<tip> ^<target>`, where <target> is what the
// branch merges into (--post-head-target, normally origin/develop). Commits that arrived by merging the target
// into the branch are reachable from the target and are not listed: another phase reviewed them.
// The target is the caller's choice, so it is not trusted: it is resolved to a sha once, and must be a line the
// branch grew from (phase-base is its ancestor) that does not yet contain the work (the last reviewed head is NOT
// its ancestor, which also rules out a target at or past the tip or any post-head commit). Otherwise `^target` would
// subtract the branch's own commits and an empty ledger would pass.
// A merge commit M in that range is listed only when it carries content of its own: the paths where M's tree
// differs from git's own automatic re-merge of M's two parents (`git diff-tree --remerge-diff`). That covers
// conflict resolutions, evil merges, taking one side whole (--ours/--theirs, -X, -s ours) and mixed hunks, none of
// which `--cc` lists when the result equals one parent. Then M must be listed under its own sha and its paths must
// cover that list. A clean merge (empty list) needs no entry. A merge with more than two parents fails closed.
// --remerge-diff (not `git merge-tree --write-tree`) because git runs it in a temporary object directory: the
// check leaves no objects in the repository it inspects.
const POST_HEAD_LEDGER_SCHEMA = 'post-head-ledger/1';
function checkPostHeadLedger({ ledgerFile, repoRoot, phase, branch, head, tip, target, targetRef, phaseBase }) {
  const problems = [];
  const git = (args) => spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 28 });
  const nul = (r) => r.stdout.split('\0').filter(Boolean); // -z output: no C-quoting of unusual path names
  if (typeof target !== 'string' || !target) {
    return ['--post-head-target <ref> is required with --post-head-ledger (the merge target, normally origin/develop; own commits are head..tip not reachable from it)'];
  }
  const tg = git(['rev-parse', '--verify', '--end-of-options', `${target}^{commit}`]);
  if (tg.status !== 0) return [`--post-head-target '${target}' does not resolve to a commit`];
  const targetSha = tg.stdout.trim(); // every later git call uses the sha, never the movable name
  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  } catch (e) {
    return [`post-head ledger '${ledgerFile}' cannot be read or parsed: ${e.message}`];
  }
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return [`post-head ledger '${ledgerFile}' is not a JSON object`];
  if (ledger.schema !== POST_HEAD_LEDGER_SCHEMA) problems.push(`post-head ledger schema is '${ledger.schema}' (expected '${POST_HEAD_LEDGER_SCHEMA}')`);
  if (ledger.phase !== phase) problems.push(`post-head ledger phase '${ledger.phase}' does not match --phase '${phase}'`);
  if (ledger.reviewed_head !== head) problems.push(`post-head ledger reviewed_head '${ledger.reviewed_head}' is not the last finalized head '${head}'`);
  if (typeof ledger.ruling !== 'string' || !ledger.ruling.trim()) problems.push('post-head ledger ruling is missing or empty (the PM ruling id or text for exceeding the generation cap)');
  if (!Array.isArray(ledger.commits)) return problems.concat('post-head ledger commits is not an array');

  if (git(['merge-base', '--is-ancestor', '--end-of-options', head, tip]).status !== 0) {
    return problems.concat(`last reviewed head ${head} is not an ancestor of '${branch}' (${tip})`);
  }
  if (git(['merge-base', '--is-ancestor', '--end-of-options', head, targetSha]).status === 0) {
    return problems.concat(`--post-head-target '${target}' (${targetSha}) already contains the last reviewed head ${head}: it is the tip, the branch, or a line that took work from it, and would hide the branch's own commits; give the line the branch merges into as it was before this work`);
  }
  if (git(['merge-base', '--is-ancestor', '--end-of-options', phaseBase, targetSha]).status !== 0) {
    return problems.concat(`--post-head-target '${target}' (${targetSha}) does not descend from --phase-base ${phaseBase}: it is not the line the branch grew from`);
  }
  // The target must be on the merge target's mainline. A side branch cut from the phase base passes both rules above,
  // and `^side` would then subtract an unreviewed commit that was merged into the branch.
  const tr = git(['rev-parse', '--verify', '--end-of-options', `${targetRef}^{commit}`]);
  if (tr.status !== 0) return problems.concat(`--post-head-target-ref '${targetRef}' does not resolve to a commit (fetch it, or name the merge target with --post-head-target-ref)`);
  const mainline = git(['rev-list', '--first-parent', '-z', tr.stdout.trim()]);
  if (mainline.status !== 0) return problems.concat(`git rev-list --first-parent ${targetRef} failed: ${mainline.stderr || 'unknown error'}`);
  if (!nul(mainline).includes(targetSha)) {
    return problems.concat(`--post-head-target '${target}' (${targetSha}) is not on the first-parent history of ${targetRef}: a side branch is not the line the branch merges into`);
  }
  const range = `${head}..${tip} ^${targetSha}`;
  const own = git(['rev-list', '--no-merges', '-z', `${head}..${tip}`, '--not', targetSha]);
  if (own.status !== 0) return problems.concat(`git rev-list --no-merges ${range} failed: ${own.stderr || 'unknown error'}`);
  const actual = nul(own);
  const mg = git(['rev-list', '--merges', '-z', `${head}..${tip}`, '--not', targetSha]);
  if (mg.status !== 0) return problems.concat(`git rev-list --merges ${range} failed: ${mg.stderr || 'unknown error'}`);
  // merge commits with content of their own: must be listed too
  const mergeOwn = new Map();
  for (const m of nul(mg)) {
    const pr = git(['rev-list', '--parents', '-n', '1', m]);
    if (pr.status !== 0) { problems.push(`git rev-list --parents ${m} failed: ${pr.stderr || 'unknown error'}`); continue; }
    const parents = pr.stdout.trim().split(/\s+/).slice(1);
    if (parents.length !== 2) { problems.push(`merge commit ${m} has ${parents.length} parents: the re-merge check supports exactly two (failing closed; split the merge or list the work in another way)`); continue; }
    const rm = git(['diff-tree', '--remerge-diff', '-z', '--no-renames', '--name-only', '--no-commit-id', '-r', m]);
    if (rm.status !== 0) { problems.push(`git diff-tree --remerge-diff ${m} failed (failing closed, not falling back to --cc; --remerge-diff needs git >= 2.36): ${rm.stderr || 'unknown error'}`); continue; }
    const ps = nul(rm);
    if (ps.length) mergeOwn.set(m, ps);
  }
  const expected = new Set([...actual, ...mergeOwn.keys()]);

  const seen = new Set();
  const byListed = new Map();
  ledger.commits.forEach((c, i) => {
    const at = `post-head ledger commits[${i}]`;
    if (!c || typeof c !== 'object' || typeof c.sha !== 'string') { problems.push(`${at} has no sha string`); return; }
    if (seen.has(c.sha)) { problems.push(`${at}: sha ${c.sha} is listed twice`); return; }
    seen.add(c.sha);
    if (!expected.has(c.sha)) problems.push(`${at}: sha ${c.sha} is not an own commit in ${range} (extra entry, abbreviated sha, a commit the target already has, or a merge that equals git's own re-merge)`);
    if (!Array.isArray(c.paths) || c.paths.some((p) => typeof p !== 'string' || !p)) { problems.push(`${at} (${c.sha}): paths is not an array of non-empty strings`); return; }
    if (typeof c.verification !== 'string' || !c.verification.trim()) problems.push(`${at} (${c.sha}): verification is empty (state how depth-0 verified it: red/green or mutation, with an evidence path)`);
    byListed.set(c.sha, c);
  });

  for (const sha of actual) {
    const entry = byListed.get(sha);
    if (!entry) { problems.push(`commit ${sha} is in ${range} but not in the post-head ledger (an unlisted post-head commit)`); continue; }
    const dt = git(['diff-tree', '--root', '-z', '--no-commit-id', '-r', '--no-renames', '--name-only', sha]);
    if (dt.status !== 0) { problems.push(`git diff-tree ${sha} failed: ${dt.stderr || 'unknown error'}`); continue; }
    const declared = new Set(entry.paths);
    for (const p of nul(dt)) {
      if (!declared.has(p)) problems.push(`commit ${sha} touched '${p}' which its ledger paths do not list`);
    }
  }
  for (const [m, ps] of mergeOwn) {
    const entry = byListed.get(m);
    if (!entry) { problems.push(`merge commit ${m} carries content of its own (conflict resolution or evil merge: ${ps.join(' ')}) but is not in the post-head ledger`); continue; }
    const declared = new Set(entry.paths);
    for (const p of ps) {
      if (!declared.has(p)) problems.push(`merge commit ${m} changed '${p}' on its own which its ledger paths do not list`);
    }
  }
  return problems;
}

function validateModeA(flags, opts = {}) {
  const packetSet = opts.packetSet || null;
  // Validated first, before any generation/chain validation runs — see resolveConfiguredMinSeats.
  const configuredMinSeats = resolveConfiguredMinSeats(flags);

  const ledgerDir = flags.ledger;
  const phase = flags.phase;
  const branch = flags.branch;
  const repoRoot = flags['repo-root'] ? path.resolve(flags['repo-root']) : process.cwd();
  const consumerAllowlist = loadConsumerExcludeAllowlist(repoRoot);

  if (!ledgerDir || !phase || !branch) {
    console.error('Mode A requires --ledger, --phase, and --branch');
    process.exit(1);
  }

  const receiptPath = path.join(ledgerDir, `receipt-${phase}.json`);
  let receipt;
  try {
    if (!fs.existsSync(receiptPath)) {
      console.error(`Receipt file not found: ${receiptPath}`);
      process.exit(1);
    }
    const content = fs.readFileSync(receiptPath, 'utf8');
    receipt = JSON.parse(content);
  } catch (err) {
    if (err instanceof ExitSignal) throw err; // in-process set check: an exit inside a try must reach runModeAInProcess
    console.error(`Failed to read or parse receipt file: ${err.message}`);
    process.exit(1);
  }

  if (!receipt || typeof receipt !== 'object') {
    console.error('Receipt content is not a valid object');
    process.exit(1);
  }

  if (receipt.kind === 'review') {
    const expectedBaseSha = flags['phase-base'];
    if (!expectedBaseSha || typeof expectedBaseSha !== 'string') {
      console.error('Review mode requires mandatory --phase-base <sha>');
      process.exit(1);
    }

    const reviewPhaseDir = path.join(ledgerDir, `review-${phase}`);
    const chainPath = path.join(reviewPhaseDir, 'chain.json');
    let chainOnDisk = [];
    try {
      if (!fs.existsSync(chainPath)) {
        console.error(`Chain file not found at ${chainPath}`);
        process.exit(1);
      }
      chainOnDisk = JSON.parse(fs.readFileSync(chainPath, 'utf8'));
    } catch (err) {
      if (err instanceof ExitSignal) throw err; // in-process set check: an exit inside a try must reach runModeAInProcess
      console.error(`Failed to read or parse ledger chain at ${chainPath}: ${err.message}`);
      process.exit(1);
    }

    if (!Array.isArray(chainOnDisk) || chainOnDisk.length === 0) {
      console.error('Ledger chain.json is empty or not an array');
      process.exit(1);
    }

    // Item 5: Deep chain equality with disk
    if (!Array.isArray(receipt.chain) || !deepEqual(receipt.chain, chainOnDisk)) {
      console.error('Receipt chain diverges from on-disk chain.json (different generations, dropped/reordered entries, or differing fields)');
      process.exit(1);
    }

    // Drive validation from disk: use chainOnDisk
    const chain = [...chainOnDisk];
    chain.sort((a, b) => (a.generation || 0) - (b.generation || 0));

    // Require ledger chain first entry base to equal expectedBaseSha
    const firstEntryDisk = chain[0];
    if (!firstEntryDisk || firstEntryDisk.base !== expectedBaseSha) {
      console.error(`Ledger chain first entry base '${firstEntryDisk && firstEntryDisk.base}' does not match expected phase-base '${expectedBaseSha}'`);
      process.exit(1);
    }

    const packetEntries = chain.filter((e) => e && e.packet !== undefined);
    if (!packetSet && (receipt.packet !== undefined || packetEntries.length > 0)) {
      console.error(`Receipt for phase '${phase}' is a review-packet receipt: it covers only that packet's files, so it cannot stand for the whole range on its own — validate the set with --packets <packets.json>`);
      process.exit(1);
    }
    if (packetSet) {
      if (!receipt.packet || receipt.packet.set !== packetSet.set || receipt.packet.id !== packetSet.id) {
        console.error(`Receipt for phase '${phase}' does not name packet ${packetSet.set}/${packetSet.id} (receipt.packet: ${JSON.stringify(receipt.packet)})`);
        process.exit(1);
      }
    }

    const findingsByGeneration = new Map();
    const dispositionsByGeneration = new Map();

    // Continuity is tracked against the last FINALIZED head, not the previous entry: an aborted
    // generation has no head (nothing advanced) and the loop continues the next generation from
    // the aborted one's base (hetero-review-loop.js collect, prevEntry.status === 'aborted').
    let expectedEntryBase = expectedBaseSha;

    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i];
      if (entry.generation !== i + 1) {
        console.error(`Invalid generation order or gap in chain: expected generation ${i + 1}, got ${entry.generation}`);
        process.exit(1);
      }

      // first entry's base must equal expectedBaseSha, each later entry's base must equal the
      // last finalized head (== the aborted predecessor's base when the predecessor aborted)
      if (entry.base !== expectedEntryBase) {
        if (i === 0) {
          console.error(`First chain entry base '${entry.base}' does not match expected phase-base '${expectedBaseSha}'`);
        } else {
          console.error(`Chain broken at generation ${entry.generation}: base '${entry.base}' does not match previous head '${expectedEntryBase}'`);
        }
        process.exit(1);
      }

      // (3a) v2.36.3: an aborted generation is a recorded, non-reviewing attempt (<host> report:
      // a branch that moved during collection left the phase permanently un-receiptable). It is
      // accepted ONLY as evidence that nothing was reviewed: it must not be the last entry (the
      // phase needs a finalized generation after it — an abort can never stand in for a review),
      // it carries no head (checked above: the successor continues from the same base), and its
      // range.json, when present, must name the same base. No findings/dispositions/seats are
      // required or read, and review-chain-derive skips it (it closes nothing).
      if (entry.status === 'aborted') {
        if (i === chain.length - 1) {
          console.error(`Chain entry generation ${entry.generation} is 'aborted' and is the last entry: the phase has no finalized review after the abort`);
          process.exit(1);
        }
        if (Object.prototype.hasOwnProperty.call(entry, 'head')) { // any own head, even "" (review 🔵)
          console.error(`Chain entry generation ${entry.generation} is 'aborted' but carries a head '${entry.head}' (an aborted generation advances nothing)`);
          process.exit(1);
        }
        const abortedRangePath = path.join(reviewPhaseDir, `g${entry.generation}`, 'range.json');
        if (fs.existsSync(abortedRangePath)) {
          let abortedRange;
          try {
            abortedRange = JSON.parse(fs.readFileSync(abortedRangePath, 'utf8'));
          } catch (err) {
            if (err instanceof ExitSignal) throw err; // in-process set check: an exit inside a try must reach runModeAInProcess
            console.error(`Failed to read or parse range.json for aborted generation ${entry.generation}: ${err.message}`);
            process.exit(1);
          }
          if (abortedRange.base !== entry.base) {
            console.error(`range.json base mismatch for aborted generation ${entry.generation}`);
            process.exit(1);
          }
        }
        continue; // expectedEntryBase unchanged: the next generation continues from this base
      }

      // (3) every other entry's status must be "finalized"
      if (entry.status !== 'finalized') {
        console.error(`Chain entry generation ${entry.generation} status is '${entry.status}' (expected 'finalized')`);
        process.exit(1);
      }
      expectedEntryBase = entry.head;

      // Item 2 / d2-seat-receipt-forgery: seat coverage and the reviewed-seat count are
      // resolved further below, once the per-generation directory (gDir) is known and each
      // seat artifact can be read and sha-verified from disk — never trusted from chain-level
      // counts (reviewed_seats/total_seats) or from the receipt.

      const gDir = path.join(reviewPhaseDir, `g${entry.generation}`);

      // (4) read <ledger>/review-<phase>/g<generation>/range.json
      const rangePath = path.join(gDir, 'range.json');
      let rangeObj;
      try {
        if (!fs.existsSync(rangePath)) {
          console.error(`Missing range.json for generation ${entry.generation} at ${rangePath}`);
          process.exit(1);
        }
        rangeObj = JSON.parse(fs.readFileSync(rangePath, 'utf8'));
      } catch (err) {
        if (err instanceof ExitSignal) throw err; // in-process set check: an exit inside a try must reach runModeAInProcess
        console.error(`Failed to read or parse range.json for generation ${entry.generation}: ${err.message}`);
        process.exit(1);
      }

      if (rangeObj.base !== entry.base || rangeObj.head !== entry.head) {
        console.error(`range.json base/head mismatch for generation ${entry.generation}`);
        process.exit(1);
      }

      // Packet generation: the packet record must be the one the set file defines, byte-pinned, and a
      // packet generation never carries exclusions (a packet slices by cover, not by leaving paths out).
      const hasExclusions = Array.isArray(rangeObj.excluded) && rangeObj.excluded.length > 0;
      if (packetSet) {
        const pk = entry.packet;
        if (!pk || pk.set !== packetSet.set || pk.id !== packetSet.id || pk.packets_sha256 !== packetSet.sha256 || !deepEqual(pk.paths, packetSet.paths)) {
          console.error(`Chain entry generation ${entry.generation} does not carry the packet record of ${packetSet.set}/${packetSet.id} as defined by the packets file`);
          process.exit(1);
        }
        if (!deepEqual(rangeObj.packet, pk)) {
          console.error(`range.json packet record differs from the chain entry for generation ${entry.generation}`);
          process.exit(1);
        }
        if (hasExclusions) {
          console.error(`Generation ${entry.generation} of packet ${packetSet.id} carries exclusions; a packet may not exclude paths`);
          process.exit(1);
        }
      }

      // Item 7: Exclusion allowlist enforcement
      if (hasExclusions || packetSet) {
        for (const pattern of (hasExclusions ? rangeObj.excluded : [])) {
          if (!isPathspecAllowed(pattern, consumerAllowlist, repoRoot)) {
            console.error(`ERROR: Exclude pathspec '${pattern}' is not permitted by allowlist`);
            process.exit(1);
          }
        }
        if (!rangeObj.full_range_sha256 || typeof rangeObj.full_range_sha256 !== 'string') {
          console.error(`Missing full_range_sha256 in range.json for generation ${entry.generation} with exclusions`);
          process.exit(1);
        }
        const fullDiffRes = spawnSync('git', ['diff', `${entry.base}..${entry.head}`], {
          cwd: repoRoot,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        });
        if (fullDiffRes.status !== 0) {
          console.error(`git diff (full range) failed for generation ${entry.generation}: ${fullDiffRes.stderr || 'unknown error'}`);
          process.exit(1);
        }
        const computedFullSha = crypto.createHash('sha256').update(fullDiffRes.stdout, 'utf8').digest('hex');
        if (computedFullSha !== rangeObj.full_range_sha256) {
          console.error(`full_range_sha256 mismatch for generation ${entry.generation}: expected '${rangeObj.full_range_sha256}', computed '${computedFullSha}'`);
          process.exit(1);
        }
        if (entry.full_range_sha256 && entry.full_range_sha256 !== rangeObj.full_range_sha256) {
          console.error(`Chain entry full_range_sha256 mismatch for generation ${entry.generation}`);
          process.exit(1);
        }
      }

      // git diff <base>..<head> with maxBuffer 64MB and negative pathspecs if rangeObj.excluded exists
      const diffArgs = ['diff', `${entry.base}..${entry.head}`];
      if (hasExclusions) {
        diffArgs.push('--');
        for (const pattern of rangeObj.excluded) {
          diffArgs.push(`:!${pattern}`);
        }
      }
      let diffRes;
      if (packetSet) {
        try {
          diffRes = { status: 0, stdout: reviewPackets.packetDiff(repoRoot, entry.base, entry.head, packetSet.paths) };
        } catch (err) {
          if (err instanceof ExitSignal) throw err; // in-process set check: an exit inside a try must reach runModeAInProcess
          console.error(`git diff failed for generation ${entry.generation}: ${err.message}`);
          process.exit(1);
        }
      } else {
        diffRes = spawnSync('git', diffArgs, {
          cwd: repoRoot,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        });
      }
      if (diffRes.status !== 0) {
        console.error(`git diff failed for generation ${entry.generation}: ${diffRes.stderr || 'unknown error'}`);
        process.exit(1);
      }

      const computedDiffSha = crypto.createHash('sha256').update(diffRes.stdout, 'utf8').digest('hex');
      if (computedDiffSha !== rangeObj.diff_sha256) {
        console.error(`diff_sha256 mismatch for generation ${entry.generation}: expected '${rangeObj.diff_sha256}', computed '${computedDiffSha}'`);
        process.exit(1);
      }

      // Item 6: findings/seat sha verification
      const findingsPath = path.join(gDir, 'findings.json');
      const dispositionsPath = path.join(gDir, 'dispositions.json');

      if (!fs.existsSync(findingsPath)) {
        console.error(`Missing findings.json for finalized generation ${entry.generation} at ${findingsPath}`);
        process.exit(1);
      }
      if (!fs.existsSync(dispositionsPath)) {
        console.error(`Missing snapshotted dispositions.json for finalized generation ${entry.generation} at ${dispositionsPath}`);
        process.exit(1);
      }

      let findingsRaw;
      try {
        findingsRaw = fs.readFileSync(findingsPath);
      } catch (err) {
        if (err instanceof ExitSignal) throw err; // in-process set check: an exit inside a try must reach runModeAInProcess
        console.error(`Failed to read findings.json for generation ${entry.generation}: ${err.message}`);
        process.exit(1);
      }

      const computedFindingsSha = crypto.createHash('sha256').update(findingsRaw).digest('hex');
      if (!entry.findings_sha256 || computedFindingsSha !== entry.findings_sha256) {
        console.error(`findings_sha256 mismatch or missing for generation ${entry.generation}: expected '${entry.findings_sha256}', computed '${computedFindingsSha}'`);
        process.exit(1);
      }

      // Seat artifacts verification
      // Item 2 / d2-seat-receipt-forgery: exact seat-to-hash coverage for every seat listed in
      // this chain entry, reviewed status derived from each validated (sha-verified) seat
      // artifact on disk — never from chain-level counts or the receipt — and the minimum
      // reviewed-seat count enforced from trusted configuration only (default: all seats).
      if (!Array.isArray(entry.seats) || entry.seats.length === 0) {
        console.error(`Chain entry generation ${entry.generation} is missing a non-empty 'seats' array; cannot verify review coverage`);
        process.exit(1);
      }
      const entrySeatIds = entry.seats.map((s) => (s && typeof s === 'object' ? s.id : s));
      if (entrySeatIds.some((id) => typeof id !== 'string' || id.length === 0)) {
        console.error(`Chain entry generation ${entry.generation} has a seat with a missing or invalid id`);
        process.exit(1);
      }

      if (!entry.seat_artifact_sha256 || typeof entry.seat_artifact_sha256 !== 'object' || Array.isArray(entry.seat_artifact_sha256)) {
        console.error(`seat_artifact_sha256 missing or not an object for generation ${entry.generation}`);
        process.exit(1);
      }
      const shaKeys = Object.keys(entry.seat_artifact_sha256);
      if (shaKeys.length === 0) {
        console.error(`seat_artifact_sha256 is empty for generation ${entry.generation}; no seat evidence provided (forged empty-seat receipt)`);
        process.exit(1);
      }
      const sortedEntrySeatIds = [...entrySeatIds].sort();
      const sortedShaKeys = [...shaKeys].sort();
      const exactSeatCoverage = sortedEntrySeatIds.length === sortedShaKeys.length
        && sortedEntrySeatIds.every((id, idx) => id === sortedShaKeys[idx]);
      if (!exactSeatCoverage) {
        console.error(`seat_artifact_sha256 keys [${sortedShaKeys.join(', ')}] do not exactly match the seats [${sortedEntrySeatIds.join(', ')}] listed for generation ${entry.generation}`);
        process.exit(1);
      }

      let reviewedCount = 0;
      for (const seatId of entrySeatIds) {
        const expectedSha = entry.seat_artifact_sha256[seatId];
        const seatFile = path.join(gDir, `seat-${seatId}.json`);
        if (!fs.existsSync(seatFile)) {
          console.error(`Missing seat artifact at ${seatFile} for generation ${entry.generation}`);
          process.exit(1);
        }
        const seatRaw = fs.readFileSync(seatFile);
        const computedSeatSha = crypto.createHash('sha256').update(seatRaw).digest('hex');
        if (computedSeatSha !== expectedSha) {
          console.error(`seat_artifact_sha256 mismatch for seat '${seatId}' in generation ${entry.generation}: expected '${expectedSha}', computed '${computedSeatSha}'`);
          process.exit(1);
        }
        let seatContent;
        try {
          seatContent = JSON.parse(seatRaw.toString('utf8'));
        } catch (err) {
          if (err instanceof ExitSignal) throw err; // in-process set check: an exit inside a try must reach runModeAInProcess
          console.error(`Failed to parse seat artifact ${seatFile} for generation ${entry.generation}: ${err.message}`);
          process.exit(1);
        }
        if (seatContent && seatContent.status === 'reviewed') {
          reviewedCount++;
        }
      }

      const requiredMinSeats = (configuredMinSeats !== null && !isNaN(configuredMinSeats))
        ? configuredMinSeats
        : entrySeatIds.length;
      if (reviewedCount < requiredMinSeats) {
        console.error(`Generation ${entry.generation} reviewed seats (${reviewedCount}) below minimum required (${requiredMinSeats})`);
        process.exit(1);
      }

      let dispBytes;
      try {
        dispBytes = fs.readFileSync(dispositionsPath);
      } catch (err) {
        if (err instanceof ExitSignal) throw err; // in-process set check: an exit inside a try must reach runModeAInProcess
        console.error(`Failed to read dispositions.json for generation ${entry.generation}: ${err.message}`);
        process.exit(1);
      }

      const dispSha256 = crypto.createHash('sha256').update(dispBytes).digest('hex');
      if (!entry.dispositions_sha256 || dispSha256 !== entry.dispositions_sha256) {
        console.error(`dispositions_sha256 mismatch for generation ${entry.generation}: expected '${entry.dispositions_sha256}', computed '${dispSha256}'`);
        process.exit(1);
      }

      // Item 4: Strict validation of findings.json and dispositions.json
      let findingsData;
      try {
        findingsData = JSON.parse(findingsRaw.toString('utf8'));
      } catch (err) {
        if (err instanceof ExitSignal) throw err; // in-process set check: an exit inside a try must reach runModeAInProcess
        console.error(`Failed to parse findings.json for generation ${entry.generation}: ${err.message}`);
        process.exit(1);
      }

      if (!findingsData || typeof findingsData !== 'object' || Array.isArray(findingsData) || !Array.isArray(findingsData.findings)) {
        console.error(`findings.json for generation ${entry.generation} must be a JSON object with a findings array`);
        process.exit(1);
      }

      const SEVERITY_WORDS = new Set(['Critical', 'Major', 'Minor', 'Suggestion']);
      const findingsList = findingsData.findings;
      const findingsMap = new Map();
      for (let j = 0; j < findingsList.length; j++) {
        const f = findingsList[j];
        if (!f || typeof f !== 'object' || Array.isArray(f)) {
          console.error(`Finding at index ${j} in generation ${entry.generation} is not an object`);
          process.exit(1);
        }
        if (typeof f.id !== 'string' || f.id.trim().length === 0) {
          console.error(`Finding at index ${j} in generation ${entry.generation} missing valid string id`);
          process.exit(1);
        }
        if (findingsMap.has(f.id)) {
          console.error(`Duplicate finding id '${f.id}' in generation ${entry.generation} findings.json`);
          process.exit(1);
        }
        if (!SEVERITY_WORDS.has(f.severity)) {
          console.error(`Finding '${f.id}' has invalid severity '${f.severity}' in generation ${entry.generation}`);
          process.exit(1);
        }
        findingsMap.set(f.id, f);
      }

      let dispData;
      try {
        dispData = JSON.parse(dispBytes.toString('utf8'));
      } catch (err) {
        if (err instanceof ExitSignal) throw err; // in-process set check: an exit inside a try must reach runModeAInProcess
        console.error(`Failed to parse dispositions.json for generation ${entry.generation}: ${err.message}`);
        process.exit(1);
      }

      if (!dispData || typeof dispData !== 'object' || Array.isArray(dispData) || !Array.isArray(dispData.findings)) {
        console.error(`dispositions.json for generation ${entry.generation} must be a JSON object with a findings array`);
        process.exit(1);
      }

      const allowedDispositions = new Set(['verified', 'refuted', 'deferred']);
      const dispList = dispData.findings;
      const dispMap = new Map();
      for (let j = 0; j < dispList.length; j++) {
        const d = dispList[j];
        if (!d || typeof d !== 'object' || Array.isArray(d)) {
          console.error(`Disposition at index ${j} in generation ${entry.generation} is not an object`);
          process.exit(1);
        }
        if (typeof d.id !== 'string' || d.id.trim().length === 0) {
          console.error(`Disposition at index ${j} in generation ${entry.generation} missing valid string id`);
          process.exit(1);
        }
        if (dispMap.has(d.id)) {
          console.error(`Duplicate disposition id '${d.id}' in generation ${entry.generation} dispositions.json`);
          process.exit(1);
        }
        if (!allowedDispositions.has(d.disposition)) {
          console.error(`Disposition '${d.id}' has invalid disposition '${d.disposition}' in generation ${entry.generation}`);
          process.exit(1);
        }
        if (typeof d.rationale !== 'string' || d.rationale.trim().length === 0) {
          console.error(`Disposition '${d.id}' missing non-empty rationale string in generation ${entry.generation}`);
          process.exit(1);
        }
        dispMap.set(d.id, d);
      }

      // Check matching IDs: one entry per finding id, no extras, none missing
      for (const fid of findingsMap.keys()) {
        if (!dispMap.has(fid)) {
          console.error(`Dispositions missing finding id '${fid}' in generation ${entry.generation}`);
          process.exit(1);
        }
      }
      for (const did of dispMap.keys()) {
        if (!findingsMap.has(did)) {
          console.error(`Dispositions contains unexpected finding id '${did}' in generation ${entry.generation}`);
          process.exit(1);
        }
      }

      findingsByGeneration.set(entry.generation, findingsList);
      let resList = [];
      if (dispData.resolutions !== undefined) {
        if (!Array.isArray(dispData.resolutions)) {
          console.error(`dispositions.json resolutions for generation ${entry.generation} must be an array`);
          process.exit(1);
        }
        for (const r of dispData.resolutions) {
          if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.id !== 'string' || r.id.trim().length === 0
              || typeof r.rationale !== 'string' || r.rationale.trim().length === 0) {
            console.error(`Malformed resolution entry in generation ${entry.generation} dispositions.json (needs string id and non-empty rationale)`);
            process.exit(1);
          }
        }
        resList = dispData.resolutions;
      }
      dispositionsByGeneration.set(entry.generation, { findings: dispList, resolutions: resList });
    }

    // Item 4: Call shared review-chain-derive routine. It discards chain-entry closed_findings
    // stamps in place (they are its output, BL-0092), so the on-disk stamps are snapshotted first
    // for the aborted-attribution scan below.
    const stampsOnDisk = chainOnDisk.map((e) => (e && Array.isArray(e.closed_findings) ? e.closed_findings.map((cf) => ({ ...cf })) : []));
    const derivedState = deriveReceiptState(chain, findingsByGeneration, dispositionsByGeneration);
    if (derivedState.unmatched_resolutions.length > 0) {
      const u = derivedState.unmatched_resolutions[0];
      console.error(`Resolution '${u.id}' in generation ${u.generation} names no open verified finding of an earlier generation`);
      process.exit(1);
    }

    // v2.36.3 (<host>): no closure may be attributed to an aborted generation — it produced no
    // findings, so "closed by absence in generation N" is meaningless for an aborted N. Checked
    // on the receipt's own closed_findings BEFORE the equality comparison below so a receipt
    // written by the pre-v2.36.3 finalize (which did exactly this) is refused with a named
    // reason and the remedy, not a bare mismatch. The re-derived state is asserted too, as a
    // self-check on the derive routine.
    const abortedGens = new Set(chain.filter((e) => e.status === 'aborted').map((e) => e.generation));
    const namesAborted = (list) => (Array.isArray(list) ? list : [])
      .find((cf) => cf && abortedGens.has(cf.closed_by_generation));
    // The loop's finalize writes the stamps onto chain ENTRIES (chain[i].closed_findings), not a
    // top-level receipt field — the <host> ledger carries `{id, closed_by_generation: 3}` on its
    // g2 entry with g3 aborted — so the on-disk chain entries are scanned as well.
    const badReceiptClosure = namesAborted(receipt.closed_findings)
      || stampsOnDisk.map((l) => namesAborted(l)).find(Boolean);
    if (badReceiptClosure) {
      console.error(`Receipt/chain closed_findings attributes '${badReceiptClosure.id}' to generation ${badReceiptClosure.closed_by_generation}, which is aborted — an aborted generation reviewed nothing and can close nothing (stamp written before v2.36.3; run hetero-review-loop.js refinalize --generation <last> to re-derive)`);
      process.exit(1);
    }
    const badDerivedClosure = namesAborted(derivedState.closed_findings);
    if (badDerivedClosure) {
      console.error(`Re-derived closed_findings attributes '${badDerivedClosure.id}' to aborted generation ${badDerivedClosure.closed_by_generation} (derive routine defect)`);
      process.exit(1);
    }

    // Item 1: Require both recorded and re-derived SHIP-AS-IS
    if (receipt.verdict !== 'SHIP-AS-IS' || derivedState.verdict !== 'SHIP-AS-IS') {
      console.error(`Receipt verdict is not SHIP-AS-IS or re-derived verdict mismatch (receipt: '${receipt.verdict}', re-derived: '${derivedState.verdict}')`);
      process.exit(1);
    }

    // Item 8 / d2-open-findings-drift: the shared format requires verified Major/Minor findings
    // to populate the canonical open_findings array — a numeric count (or an absent field) would
    // let a forged receipt omit their actionable details while still passing. open_findings is
    // therefore mandatory whenever the chain re-derives to a non-empty set, and must deep-equal
    // the re-derived entries (id, severity, disposition) exactly, in order.
    if (!Array.isArray(receipt.open_findings)) {
      console.error(`Receipt open_findings must be the canonical array of re-derived open findings (got ${typeof receipt.open_findings})`);
      process.exit(1);
    }
    if (receipt.open_findings.length !== derivedState.open_findings.length) {
      console.error(`Receipt open_findings length mismatch: expected ${derivedState.open_findings.length}, got ${receipt.open_findings.length}`);
      process.exit(1);
    }
    for (let i = 0; i < derivedState.open_findings.length; i++) {
      const recF = receipt.open_findings[i];
      const derF = derivedState.open_findings[i];
      if (!recF || recF.id !== derF.id || recF.severity !== derF.severity || recF.disposition !== derF.disposition) {
        console.error(`Receipt open_findings mismatch at index ${i}: expected {id: '${derF.id}', severity: '${derF.severity}', disposition: '${derF.disposition}'}, got ${JSON.stringify(recF)}`);
        process.exit(1);
      }
    }

    // Check closed_findings if present on receipt
    if (receipt.closed_findings !== undefined) {
      if (Array.isArray(receipt.closed_findings)) {
        if (receipt.closed_findings.length !== derivedState.closed_findings.length) {
          console.error(`Receipt closed_findings length mismatch: expected ${derivedState.closed_findings.length}, got ${receipt.closed_findings.length}`);
          process.exit(1);
        }
        for (let i = 0; i < derivedState.closed_findings.length; i++) {
          const recF = receipt.closed_findings[i];
          const derF = derivedState.closed_findings[i];
          if (!recF || recF.id !== derF.id || recF.closed_by_generation !== derF.closed_by_generation) {
            console.error(`Receipt closed_findings mismatch at index ${i}`);
            process.exit(1);
          }
        }
      } else if (typeof receipt.closed_findings === 'number') {
        if (receipt.closed_findings !== derivedState.closed_findings.length) {
          console.error(`Receipt closed_findings count mismatch: expected ${derivedState.closed_findings.length}, got ${receipt.closed_findings}`);
          process.exit(1);
        }
      } else {
        console.error(`Receipt closed_findings is neither an array nor a number (got ${typeof receipt.closed_findings})`);
        process.exit(1);
      }
    }

    // Packet member: the set check owns the head rule (ancestor of the tip, no packet path changed
    // since this packet's last reviewed head) — a fix landed for ANOTHER packet moves the tip legitimately.
    // Chain member: the chain check owns the head rule (contiguity, tip ancestry, tail coverage).
    if (packetSet || opts.chainMember) process.exit(0);

    // (5) the last chain entry's head must equal current git rev-parse <branch> in repoRoot
    const lastEntry = chain[chain.length - 1];
    const revParseRes = spawnSync('git', ['rev-parse', branch], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (revParseRes.status !== 0) {
      console.error(`Failed to rev-parse branch '${branch}': ${revParseRes.stderr || 'unknown error'}`);
      process.exit(1);
    }
    const currentBranchHead = revParseRes.stdout.trim();
    if (flags['post-head-ledger'] !== undefined) {
      // BL-0377: the declared-and-re-derived ledger replaces the "head must equal the tip" rule.
      if (typeof flags['post-head-ledger'] !== 'string') {
        console.error('--post-head-ledger requires a file path');
        process.exit(1);
      }
      const problems = checkPostHeadLedger({
        ledgerFile: flags['post-head-ledger'], repoRoot, phase, branch, head: lastEntry.head, tip: currentBranchHead, target: flags['post-head-target'], targetRef: typeof flags['post-head-target-ref'] === 'string' ? flags['post-head-target-ref'] : 'refs/remotes/origin/develop', phaseBase: flags['phase-base'],
      });
      if (problems.length) {
        console.error(`Post-head ledger does not cover '${branch}' (${currentBranchHead}) past last reviewed head ${lastEntry.head}:\n${problems.join('\n')}`);
        process.exit(1);
      }
      console.log(`Post-head ledger ok: ${lastEntry.head}..${currentBranchHead} (own commits vs ${flags['post-head-target']}) fully declared`);
      process.exit(0);
    }
    if (currentBranchHead !== lastEntry.head) {
      const range = `${lastEntry.head}..${currentBranchHead}`;
      const moved = pathsMovedAfterHead(repoRoot, range, consumerAllowlist);
      const changedPaths = moved.changedPaths;
      const allAllowed = moved.allAllowed;
      if (!allAllowed) {
        console.error(`Branch '${branch}' head has moved: expected '${lastEntry.head}', got '${currentBranchHead}'`);
        process.exit(1);
      }
      const countRes = spawnSync('git', ['rev-list', '--count', range], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
      const n = (countRes.status === 0 && countRes.stdout.trim())
        ? countRes.stdout.trim()
        : String(changedPaths.length);
      console.log(`Head moved by ${n} allowlisted-only commit(s): ${changedPaths.join(' ')}`);
    }

    process.exit(0);
  } else if (receipt.kind === 'opt-out') {
    // (1) configured_value === "off"
    if (receipt.configured_value !== 'off') {
      console.error(`Invalid opt-out configured_value: expected 'off', got '${receipt.configured_value}'`);
      process.exit(1);
    }

    // (2) re-run resolver for --field <knob> and --field <knob>_resolved_from
    let resolverPath = process.env.AUTOPILOT_REVIEW_LOOP_RESOLVER;
    if (!resolverPath) {
      resolverPath = flags['repo-root']
        ? path.join(repoRoot, 'scripts', 'resolve-review-loop.sh')
        : path.join('scripts', 'resolve-review-loop.sh');
    }

    const knob = receipt.knob;
    const allowedKnobs = new Set(['plan_review', 'hetero_review']);
    if (!knob || !allowedKnobs.has(knob)) {
      console.error(`Invalid or missing knob '${knob}' (must be 'plan_review' or 'hetero_review')`);
      process.exit(1);
    }

    const resolvedKnob = runResolverField(resolverPath, flags['repo-root'] ? repoRoot : '', knob);
    const resolvedFrom = runResolverField(resolverPath, flags['repo-root'] ? repoRoot : '', `${knob}_resolved_from`);

    if (resolvedKnob !== 'off') {
      console.error(`Resolver field '${knob}' returned '${resolvedKnob}' (expected 'off')`);
      process.exit(1);
    }
    if (resolvedFrom !== receipt.resolved_from) {
      console.error(`Resolver field '${knob}_resolved_from' returned '${resolvedFrom}' (expected '${receipt.resolved_from}')`);
      process.exit(1);
    }

    // (3) recompute sha256 of the bytes at config_source.path
    if (!receipt.config_source || typeof receipt.config_source.path !== 'string') {
      console.error('Opt-out receipt missing or invalid config_source.path');
      process.exit(1);
    }

    if (!fs.existsSync(receipt.config_source.path)) {
      console.error(`Config source path does not exist: ${receipt.config_source.path}`);
      process.exit(1);
    }

    let configBytes;
    try {
      configBytes = fs.readFileSync(receipt.config_source.path);
    } catch (err) {
      if (err instanceof ExitSignal) throw err; // in-process set check: an exit inside a try must reach runModeAInProcess
      console.error(`Failed to read config source file: ${err.message}`);
      process.exit(1);
    }

    const computedSha = crypto.createHash('sha256').update(configBytes).digest('hex');
    if (computedSha !== receipt.config_source.sha256) {
      console.error(`Config source sha256 mismatch: expected '${receipt.config_source.sha256}', computed '${computedSha}'`);
      process.exit(1);
    }

    process.exit(0);
  } else {
    console.error(`Unsupported or unknown receipt kind: '${receipt.kind}'`);
    process.exit(1);
  }
}

// Run validateModeA in-process for one packet phase without letting its process.exit end this
// process: exit is turned into a thrown signal, console.error into a captured message list.
function runModeAInProcess(flags, opts) {
  const realExit = process.exit;
  const realErr = console.error;
  const realLog = console.log;
  const msgs = [];
  process.exit = (code) => { throw new ExitSignal(code === undefined ? 0 : code); };
  console.error = (...a) => { msgs.push(a.join(' ')); };
  console.log = () => {};
  let code;
  try {
    validateModeA(flags, opts);
    code = 0;
  } catch (e) {
    if (e instanceof ExitSignal) code = e.code;
    else { code = 1; msgs.push(String(e && e.stack || e)); }
  } finally {
    process.exit = realExit;
    console.error = realErr;
    console.log = realLog;
  }
  return { code, msgs };
}

// Mode C — review packet set. The packets file defines the cover; each packet is its own phase
// (`<set>-<id>`) validated by Mode A (so SHIP-AS-IS, reviewed-seat floor, packet diff re-derived);
// this function adds the set rules. Plan: project/plans/_archive/2026/10/2026-10-11-review-packet-mode.md §2.4.
function validatePacketSet(flags) {
  const fail = (msg) => { console.error(msg); process.exit(1); };
  const ledgerDir = flags.ledger;
  const branch = flags.branch;
  const base = flags['phase-base'];
  const repoRoot = flags['repo-root'] ? path.resolve(flags['repo-root']) : process.cwd();
  if (typeof flags.packets !== 'string' || !ledgerDir || !branch || typeof base !== 'string') {
    fail('Packet set check requires --packets <file>, --ledger, --branch and --phase-base');
  }
  const loaded = reviewPackets.loadPacketsFile(flags.packets);
  if (!loaded.ok) fail(`Invalid packets file: ${loaded.errors.join('; ')}`);
  const { set, packets, sha256 } = loaded;
  const ids = Object.keys(packets).sort();

  const tipRes = spawnSync('git', ['rev-parse', branch], { cwd: repoRoot, encoding: 'utf8' });
  if (tipRes.status !== 0) fail(`Failed to rev-parse branch '${branch}': ${tipRes.stderr || 'unknown error'}`);
  const tip = tipRes.stdout.trim();

  // Rule 2: every packet passes Mode A as a member of this set.
  const problems = [];
  const chains = {};
  for (const id of ids) {
    const phase = reviewPackets.packetPhase(set, id);
    const memberFlags = { ...flags, phase, branch, 'phase-base': base, 'repo-root': repoRoot };
    delete memberFlags.packets;
    const r = runModeAInProcess(memberFlags, { packetSet: { set, id, sha256, paths: packets[id] } });
    if (r.code !== 0) {
      problems.push(`packet '${id}' (phase ${phase}) did not pass: ${r.msgs.join(' | ') || `exit ${r.code}`}`);
      continue;
    }
    try {
      chains[id] = JSON.parse(fs.readFileSync(path.join(ledgerDir, `review-${phase}`, 'chain.json'), 'utf8'));
    } catch (e) {
      problems.push(`packet '${id}': cannot read chain.json: ${e.message}`);
    }
  }
  if (problems.length) fail(problems.join('\n'));

  // Rule 3: one pinned range h1 = the earliest first reviewed head; the cover equals h1's changed list exactly.
  // A packet may be first reviewed at a later head h2 only if none of its OWN paths changed between h1 and h2
  // (what it reviewed is then identical to what it would have seen at h1). BL-0118.
  const firstHead = {};
  const lastHead = {};
  for (const id of ids) {
    const finalized = chains[id].filter((e) => e && e.status === 'finalized');
    const first = finalized[0];
    const last = finalized[finalized.length - 1];
    if (!first || !first.head || !last || !last.head) { problems.push(`packet '${id}' has no finalized generation`); continue; }
    firstHead[id] = first.head;
    lastHead[id] = last.head;
  }
  if (problems.length) fail(problems.join('\n'));
  const isAncestor = (a, b) => spawnSync('git', ['merge-base', '--is-ancestor', '--end-of-options', a, b], { cwd: repoRoot, encoding: 'utf8' }).status === 0;
  const distinctHeads = [...new Set(Object.values(firstHead))];
  const h1 = distinctHeads.find((h) => distinctHeads.every((o) => o === h || isAncestor(h, o))) || firstHead[ids[0]];
  for (const id of ids) {
    if (firstHead[id] === h1) continue;
    const why = `packet '${id}' was first reviewed at a different head (${firstHead[id]}, not ${h1})`;
    if (!isAncestor(h1, firstHead[id])) { problems.push(`${why}: it is not a descendant of ${h1}, so the packets do not pin one range`); continue; }
    const own = new Set(packets[id]);
    const ownChanged = reviewPackets.rangeNames(repoRoot, h1, firstHead[id]).filter((n) => own.has(n));
    if (ownChanged.length) problems.push(`${why}: its own path(s) changed between them (${ownChanged.join(', ')}), so every packet must pin the same full range`);
  }
  if (problems.length) fail(problems.join('\n'));
  try {
    problems.push(...reviewPackets.coverErrors(reviewPackets.rangeNames(repoRoot, base, h1), packets, true));
  } catch (e) {
    problems.push(e.message);
  }
  if (problems.length) fail(`Packets do not cover the reviewed range ${base}..${h1} exactly once:\n${problems.join('\n')}`);

  // Rule 4: relative to the tip, nothing a packet reviewed has changed since its last reviewed head,
  // and nothing outside the cover has entered the range.
  try {
    problems.push(...reviewPackets.coverErrors(reviewPackets.rangeNames(repoRoot, base, tip), packets, false));
    for (const id of ids) {
      const anc = spawnSync('git', ['merge-base', '--is-ancestor', lastHead[id], tip], { cwd: repoRoot, encoding: 'utf8' });
      if (anc.status !== 0) { problems.push(`packet '${id}' last reviewed head ${lastHead[id]} is not an ancestor of '${branch}' (${tip})`); continue; }
      const own = new Set(packets[id]);
      for (const n of reviewPackets.rangeNames(repoRoot, lastHead[id], tip)) {
        if (own.has(n)) problems.push(`packet '${id}': '${n}' changed after its last reviewed head ${lastHead[id]}`);
      }
    }
  } catch (e) {
    problems.push(e.message);
  }
  if (problems.length) fail(`Packet set is stale against '${branch}':\n${problems.join('\n')}`);

  console.log(`Packet set '${set}' ok: ${ids.length} packet(s), ${reviewPackets.union(packets).size} path(s) covered exactly once at ${h1}, tip ${tip}`);
  process.exit(0);
}

// Review chain — several review sets, each its own Mode A phase, that together review one contiguous
// base..tip (e.g. set A frozen at x, new files added by the fix, set B reviewing x..tip). Every member
// passes Mode A unchanged (SHIP-AS-IS included) except the "branch head == last chain head" step, which this
// function replaces: set k must start where set k-1 ended (so the sets tile base..lastHead exactly), the last
// set's head must be an ancestor of the tip, and whatever lies between the last head and the tip must be
// tolerated by the same function Mode A uses past its head (pathsMovedAfterHead).
function validateReviewChain(flags) {
  const fail = (msg) => { console.error(msg); process.exit(1); };
  const ledgerDir = flags.ledger;
  const branch = flags.branch;
  const base = flags['phase-base'];
  const repoRoot = flags['repo-root'] ? path.resolve(flags['repo-root']) : process.cwd();
  if (typeof flags.chain !== 'string' || !ledgerDir || !branch || typeof base !== 'string') {
    fail('Review chain check requires --chain <A,B[,C...]>, --ledger, --branch and --phase-base');
  }
  if (flags.phase !== undefined || flags.packets !== undefined || flags['plan-artifact'] !== undefined || flags.dispositions !== undefined) {
    fail('--chain cannot be combined with --phase, --packets, --plan-artifact or --dispositions');
  }
  const names = flags.chain.split(',');
  if (names.some((n) => !reviewPackets.validId(n))) fail(`--chain names must be phase ids separated by commas (got '${flags.chain}')`);
  if (new Set(names).size !== names.length) fail(`--chain names a review set twice: '${flags.chain}'`);
  if (names.length < 2) fail(`--chain needs at least two review sets (got '${flags.chain}'); a single set is validated with --phase`);

  const git = (args) => spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  const isAncestor = (a, b) => git(['merge-base', '--is-ancestor', '--end-of-options', a, b]).status === 0;
  const tipRes = git(['rev-parse', branch]);
  if (tipRes.status !== 0) fail(`Failed to rev-parse branch '${branch}': ${tipRes.stderr || 'unknown error'}`);
  const tip = tipRes.stdout.trim();
  const consumerAllowlist = loadConsumerExcludeAllowlist(repoRoot);

  const problems = [];
  const sets = []; // { name, base, head } for members that passed Mode A
  for (const name of names) {
    let firstBase = base;
    try {
      const c = JSON.parse(fs.readFileSync(path.join(ledgerDir, `review-${name}`, 'chain.json'), 'utf8'));
      if (Array.isArray(c) && c[0] && typeof c[0].base === 'string') firstBase = c[0].base;
    } catch (_e) { /* Mode A reports the unreadable chain */ }
    const memberFlags = { ...flags, phase: name, branch, 'phase-base': firstBase, 'repo-root': repoRoot };
    delete memberFlags.chain;
    const r = runModeAInProcess(memberFlags, { chainMember: true });
    if (r.code) { problems.push(`chain member '${name}' did not pass: ${r.msgs.join(' | ') || `exit ${r.code}`}`); continue; }
    const chain = JSON.parse(fs.readFileSync(path.join(ledgerDir, `review-${name}`, 'chain.json'), 'utf8'));
    const finalized = chain.filter((e) => e && e.status === 'finalized');
    const last = finalized[finalized.length - 1];
    if (!last || !last.head) { problems.push(`chain member '${name}' has no finalized generation`); continue; }
    sets.push({ name, base: chain[0].base, head: last.head });
  }
  if (problems.length) fail(problems.join('\n'));

  // Contiguity: exact sha equality at every seam.
  for (let k = 0; k < sets.length; k++) {
    const cur = sets[k];
    const want = k === 0 ? base : sets[k - 1].head;
    const wantWhat = k === 0 ? `--phase-base ${base}` : `set '${sets[k - 1].name}' last reviewed head ${want}`;
    if (cur.base !== want) {
      let kind = 'the sets are not on one line';
      if (k > 0) {
        if (isAncestor(want, cur.base)) kind = `gap: commits ${want}..${cur.base} were reviewed by no set`;
        else if (isAncestor(cur.base, want)) kind = `overlap or out of order: set '${cur.name}' starts before ${wantWhat}`;
      } else if (isAncestor(base, cur.base)) kind = `gap: commits ${base}..${cur.base} were reviewed by no set`;
      problems.push(`chain contiguity: set '${cur.name}' base ${cur.base} is not ${wantWhat} (${kind})`);
    }
    if (cur.head === cur.base || !isAncestor(cur.base, cur.head)) {
      problems.push(`chain contiguity: set '${cur.name}' last reviewed head ${cur.head} is not a descendant of its base ${cur.base}`);
    }
  }
  const finalSet = sets[sets.length - 1];
  if (!isAncestor(finalSet.head, tip)) {
    problems.push(`chain head: set '${finalSet.name}' last reviewed head ${finalSet.head} is not an ancestor of '${branch}' (${tip})`);
  }
  if (problems.length) fail(`Review chain is not one contiguous range ${base}..${tip}:\n${problems.join('\n')}`);

  // Tail: past the last reviewed head the branch may only move the way Mode A tolerates (pathsMovedAfterHead,
  // the same function as Mode A step (5)). This also covers a path an earlier set reviewed and that changed
  // again after the last head, and a path put back to its base content (it would vanish from base..tip).
  // Base..lastHead needs no separate owner loop: the contiguity check above makes the sets tile it exactly.
  if (finalSet.head !== tip) {
    const moved = pathsMovedAfterHead(repoRoot, `${finalSet.head}..${tip}`, consumerAllowlist);
    for (const p of moved.blocked) {
      problems.push(`chain tail: '${p}' changed after set '${finalSet.name}' last reviewed head ${finalSet.head} (at '${branch}' ${tip}) and is not a path Mode A tolerates past the last head`);
    }
    if (!moved.allAllowed && moved.blocked.length === 0) problems.push(`chain tail: git diff ${finalSet.head}..${tip} failed`);
  }
  if (problems.length) fail(`Review chain does not cover '${branch}':\n${problems.join('\n')}`);

  let changed;
  try { changed = reviewPackets.rangeNames(repoRoot, base, tip); } catch (e) { fail(`Review chain: ${e.message}`); }
  console.log(`Review chain ${names.join(',')} ok: ${sets.length} set(s), ${changed.length} path(s), base ${base} .. tip ${tip}`);
  process.exit(0);
}

function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) {
    printUsage();
    process.exit(0);
  }

  if ((flags['post-head-ledger'] !== undefined || flags['post-head-target'] !== undefined || flags['post-head-target-ref'] !== undefined) && (flags.chain !== undefined || flags.packets !== undefined || flags['plan-artifact'] !== undefined || flags.dispositions !== undefined)) {
    console.error('--post-head-ledger, --post-head-target and --post-head-target-ref are supported in Mode A only (with --ledger/--phase/--branch); they cannot be combined with --chain, --packets, --plan-artifact or --dispositions yet');
    process.exit(1);
  }
  if ((flags['post-head-target'] !== undefined || flags['post-head-target-ref'] !== undefined) && flags['post-head-ledger'] === undefined) {
    console.error('--post-head-target and --post-head-target-ref only mean something with --post-head-ledger; refusing instead of ignoring it');
    process.exit(1);
  }
  if (flags.chain !== undefined) {
    validateReviewChain(flags); // first: it refuses a mix with Mode B/C/A flags instead of silently dropping --chain
  } else if (flags['plan-artifact'] && flags.dispositions) {
    validateModeB(flags);
  } else if (flags.packets !== undefined) {
    validatePacketSet(flags);
  } else if (flags.ledger || flags.phase || flags.branch) {
    validateModeA(flags);
  } else {
    console.error('Invalid arguments: must provide Mode A (--ledger, --phase, --branch) or Mode B (--plan-artifact, --dispositions) flags');
    process.exit(1);
  }
}

main();
