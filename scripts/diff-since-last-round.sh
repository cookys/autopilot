#!/usr/bin/env bash
# diff-since-last-round.sh — checkpoint/delta helper for re-review short-circuit.
#
# Purpose: in quality-pipeline's Re-review Loop, after a fix round, the
# dispatcher needs to know whether re-review is worth running again (vs. a
# trivial doc-only round). This script provides that signal.
#
# CRITICAL: the delta output is for the DISPATCHER ONLY. Never pass to the
# reviewer agent — it leaks round-cycle meta-signal per
# references/blind-dispatch.md (forbidden "this is a re-review" cue).
#
# Subcommands:
#   mark              snapshot current HEAD SHA as the round-N marker
#   since             emit (a) full diff for reviewer + (b) delta-since-marker
#                     for dispatcher; sections are clearly labelled
#   stat              emit just the delta stat (one-liner for dispatch logic)
#   remediation       build an exact-commit-bound, reviewer-safe remediation delta
#   check-remediation validate a non-authoritative named-finding checker result
#   clear             remove the checkpoint
#
# Checkpoint file: <git-dir>/autopilot-rereview-checkpoint

set -euo pipefail

CMD="${1:-}"
shift || true
case "$CMD" in
  remediation|build-remediation-delta|check-remediation|validate-remediation) ;;
  *)
    GIT_DIR="$(git rev-parse --git-dir 2>/dev/null)" || { echo "not a git repo" >&2; exit 2; }
    CHECKPOINT_FILE="$GIT_DIR/autopilot-rereview-checkpoint"
    ;;
esac

remediation_usage() {
  cat >&2 <<'EOF'
usage:
  diff-since-last-round.sh remediation --previous <full-sha> --current <full-sha> \
    --findings-file <json> [--repo <dir>] [--out <json>]
  diff-since-last-round.sh check-remediation --delta-file <json> --result-file <json> \
    [--repo <dir>] [--out <json>]

The remediation artifact is a bounded, non-authoritative input for a named-finding
checker. It never contains a whole-candidate verdict and it fails closed on stale
ancestry, malformed contracts, or a finding that cannot be bound to a changed path.
EOF
}

# The normal `since` output intentionally remains dispatcher-only.  These helpers are
# separate so a caller cannot accidentally feed checkpoint prose or cycle metadata to a
# reviewer.  Keep the JSON construction in Node: shell JSON interpolation is not a safe
# boundary for attacker-controlled finding text or binary-ish diffs.
run_remediation_node() {
  local mode="$1"
  shift
  node - "$mode" "$@" <<'NODE'
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const childProcess = require('child_process');
const path = require('path');

const mode = process.argv[2];
const argv = process.argv.slice(3);
const opts = {};
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (!arg.startsWith('--')) throw new Error(`unknown argument: ${arg}`);
  const key = arg.slice(2);
  if (key === 'help') { opts.help = true; continue; }
  const value = argv[i + 1];
  if (!value || value.startsWith('--')) throw new Error(`missing value for --${key}`);
  opts[key] = value;
  i += 1;
}

function fail(message, extra = {}) {
  const body = {
    schema_version: 1,
    artifact_type: mode === 'check'
      ? 'review_remediation_check'
      : 'review_remediation_delta',
    status: 'needs_full_review',
    authority: 'non_authoritative',
    whole_candidate_pass: false,
    gate_clear: false,
    reason: message,
    ...extra,
  };
  writeOutput(body);
  process.exitCode = 1;
}

if (opts.help) {
  process.stdout.write(mode === 'check'
    ? 'check-remediation --delta-file <json> --result-file <json> [--repo <dir>] [--out <json>]\n'
    : 'remediation --previous <full-sha> --current <full-sha> --findings-file <json> [--repo <dir>] [--out <json>]\n');
  process.exit(0);
}

const repo = path.resolve(opts.repo || process.cwd());
function git(args, options = {}) {
  return childProcess.execFileSync('git', ['-C', repo, ...args], {
    encoding: options.encoding || 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function readJson(file, label, allowArray = false) {
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error.message}`); }
  if (!value || typeof value !== 'object' || (Array.isArray(value) && !allowArray)) {
    throw new Error(`${label} must be a JSON object or finding array`);
  }
  return value;
}
function fullSha(value, label) {
  if (!/^[0-9a-f]{40,64}$/u.test(String(value || ''))) {
    throw new Error(`${label} must be a full immutable git SHA`);
  }
  let resolved;
  try { resolved = git(['rev-parse', '--verify', `${value}^{commit}`]).trim(); }
  catch (_error) { throw new Error(`${label} is not present in the repository`); }
  if (resolved !== value) throw new Error(`${label} is not the exact commit object supplied`);
  return resolved;
}
function assertAncestry(previous, current) {
  try { git(['merge-base', '--is-ancestor', previous, current]); }
  catch (_error) { throw new Error('previous commit is not an ancestor of current commit'); }
  if (previous === current) throw new Error('previous and current commits must differ');
}
function pathSafe(value) {
  return typeof value === 'string' && value.length > 0 && !path.posix.isAbsolute(value)
    && !value.split('/').includes('..') && value !== '.';
}
function extractFindings(value) {
  const findings = Array.isArray(value) ? value : value.findings;
  if (!Array.isArray(findings) || findings.length === 0) {
    throw new Error('findings-file must contain a non-empty findings array');
  }
  const allowed = new Set(['finding_id', 'claim', 'severity', 'source']);
  const ids = new Set();
  return findings.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`finding ${index + 1} is not an object`);
    }
    const keys = Object.keys(item).sort();
    if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) {
      throw new Error(`finding ${index + 1} has an unsupported contract shape`);
    }
    if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(String(item.finding_id || ''))
        || ids.has(item.finding_id)) {
      throw new Error(`finding ${index + 1} has a missing or duplicate finding_id`);
    }
    if (typeof item.claim !== 'string' || item.claim.trim().length === 0
        || typeof item.source !== 'string' || item.source.trim().length === 0) {
      throw new Error(`finding ${item.finding_id} has an empty claim/source`);
    }
    if (!new Set(['🔴', '🟠', '🟡', '🔵', 'Critical', 'Major', 'Minor', 'Suggestion']).has(item.severity)) {
      throw new Error(`finding ${item.finding_id} has an invalid severity`);
    }
    ids.add(item.finding_id);
    return {
      finding_id: item.finding_id,
      claim: item.claim,
      severity: item.severity,
      source: item.source,
    };
  });
}
function changedPaths(previous, current) {
  const raw = git(['diff', '--name-only', '-z', '--no-ext-diff', previous, current]);
  return raw.split('\0').filter(Boolean).filter(pathSafe).sort();
}
function pathsFromFinding(finding) {
  const text = `${finding.claim}\n${finding.source}`;
  const paths = new Set();
  const re = /(?:^|[^A-Za-z0-9_.\/-])((?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+)(?::\d+(?::\d+)?|$|[^A-Za-z0-9_])/gu;
  for (const match of text.matchAll(re)) {
    const explicit = match[1].includes('/') || /:\d/u.test(match[0]);
    if (pathSafe(match[1]) && (explicit || match[1].includes('.'))) {
      paths.add(JSON.stringify({ path: match[1], explicit }));
    }
  }
  return [...paths].map((item) => JSON.parse(item)).sort((left, right) => left.path.localeCompare(right.path));
}
function writeOutput(body) {
  const text = `${JSON.stringify(body, null, 2)}\n`;
  if (opts.out || opts.output) {
    const output = path.resolve(opts.out || opts.output);
    fs.writeFileSync(output, text, { mode: 0o600 });
  }
  process.stdout.write(text);
}

try {
  try { git(['rev-parse', '--git-dir']); }
  catch (_error) { throw new Error(`not a git repository: ${repo}`); }
  if (mode === 'build') {
    const previous = fullSha(opts.previous || opts.base, 'previous commit');
    const current = fullSha(opts.current || opts.head, 'current commit');
    assertAncestry(previous, current);
    if (!opts['findings-file'] && !opts.findings) throw new Error('--findings-file is required');
    const findings = extractFindings(readJson(opts['findings-file'] || opts.findings, 'findings-file', true));
    const allPaths = changedPaths(previous, current);
    const changedSet = new Set(allPaths);
    const delta = findings.map((finding) => {
      const referenced = pathsFromFinding(finding);
      const relevant = referenced.filter((item) => changedSet.has(item.path)).map((item) => item.path);
      const unknown = referenced.filter((item) => item.explicit && !changedSet.has(item.path)).map((item) => item.path);
      let patch = '';
      for (const item of relevant) {
        patch += git(['diff', '--no-ext-diff', '--unified=80', previous, current, '--', item]);
      }
      return {
        finding_id: finding.finding_id,
        changed_paths: relevant,
        patch,
        binding: relevant.length > 0 && unknown.length === 0 ? 'bound' : 'needs_full_review',
      };
    });
    const unbound = delta.filter((item) => item.binding !== 'bound').map((item) => item.finding_id);
    const body = {
      schema_version: 1,
      artifact_type: 'review_remediation_delta',
      status: unbound.length === 0 && allPaths.length > 0 ? 'ready' : 'needs_full_review',
      authority: 'non_authoritative',
      whole_candidate_pass: false,
      gate_clear: false,
      review_role: 'remediation_checker',
      previous_commit: previous,
      current_commit: current,
      finding_contracts: findings,
      finding_contract_digest: sha256(canonical(findings)),
      changed_paths: allPaths,
      delta,
      excludes: ['prior_review_prose', 'round_metadata', 'whole_candidate_verdict', 'repository_crawl'],
      prior_findings_included: false,
      repository_crawl: false,
      fallback_reason: unbound.length > 0
        ? `findings cannot be bound to changed paths: ${unbound.join(', ')}`
        : (allPaths.length === 0 ? 'current commit has no changed paths' : null),
    };
    body.delta_digest = sha256(canonical(body));
    writeOutput(body);
    if (body.status !== 'ready') process.exitCode = 1;
  } else if (mode === 'check') {
    if (!opts['delta-file'] || !opts['result-file']) {
      throw new Error('--delta-file and --result-file are required');
    }
    const delta = readJson(opts['delta-file'], 'delta-file');
    const result = readJson(opts['result-file'], 'result-file');
    if (delta.artifact_type !== 'review_remediation_delta'
        || delta.authority !== 'non_authoritative'
        || delta.whole_candidate_pass !== false
        || delta.gate_clear !== false
        || !['ready', 'needs_full_review'].includes(delta.status)) {
      throw new Error('delta artifact is not a valid non-authoritative remediation input');
    }
    if (delta.status !== 'ready') {
      throw new Error('remediation delta requires full blind review');
    }
    const deltaKeys = [
      'artifact_type', 'authority', 'changed_paths', 'current_commit', 'delta',
      'delta_digest', 'excludes', 'fallback_reason', 'finding_contract_digest',
      'finding_contracts', 'gate_clear', 'prior_findings_included', 'previous_commit',
      'repository_crawl', 'review_role', 'schema_version', 'status',
      'whole_candidate_pass',
    ].sort();
    if (Object.keys(delta).sort().join('\0') !== deltaKeys.join('\0')) {
      throw new Error('delta artifact has an unsupported contract shape');
    }
    const previous = fullSha(delta.previous_commit, 'delta previous commit');
    const current = fullSha(delta.current_commit, 'delta current commit');
    assertAncestry(previous, current);
    const deltaDigest = delta.delta_digest;
    const withoutDigest = { ...delta };
    delete withoutDigest.delta_digest;
    if (!/^[0-9a-f]{64}$/u.test(deltaDigest || '') || sha256(canonical(withoutDigest)) !== deltaDigest) {
      throw new Error('delta digest is invalid');
    }
    const contracts = extractFindings(delta.finding_contracts);
    const expected = new Map(contracts.map((item) => [item.finding_id, item]));
    if (delta.finding_contract_digest !== sha256(canonical(contracts))) {
      throw new Error('delta finding contract binding is invalid');
    }
    const resultKeys = [
      'artifact_type', 'authority', 'current_commit', 'delta_digest', 'finding_contract_digest',
      'findings', 'gate_clear', 'previous_commit', 'schema_version', 'whole_candidate_pass',
    ].sort();
    const resultContent = { ...result };
    delete resultContent.whole_candidate_pass;
    if (Object.keys(result).sort().join('\0') !== resultKeys.join('\0')
        || /SHIP-AS-IS|FIX-THEN-SHIP|whole[-_ ]candidate/iu.test(JSON.stringify(resultContent))) {
      throw new Error('checker result contains unsupported or whole-candidate authority content');
    }
    if (result.schema_version !== 1 || result.artifact_type !== 'review_remediation_result'
        || result.authority !== 'non_authoritative' || result.whole_candidate_pass !== false
        || result.gate_clear !== false || result.previous_commit !== previous
        || result.current_commit !== current || result.delta_digest !== deltaDigest
        || result.finding_contract_digest !== delta.finding_contract_digest) {
      throw new Error('checker result is stale or bound to a different candidate/delta');
    }
    const items = result.findings;
    if (!Array.isArray(items) || items.length !== expected.size) {
      throw new Error('checker result must contain exactly one status for every named finding');
    }
    const seen = new Set();
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)
          || Object.keys(item).sort().join(',') !== 'evidence,finding_id,status'
          || !expected.has(item.finding_id) || seen.has(item.finding_id)
          || !['resolved', 'unresolved', 'needs_full_review'].includes(item.status)
          || typeof item.evidence !== 'string' || item.evidence.trim().length === 0) {
        throw new Error('checker result has an invalid, missing, or duplicate finding status');
      }
      seen.add(item.finding_id);
      if (/SHIP-AS-IS|FIX-THEN-SHIP|whole[-_ ]candidate/iu.test(JSON.stringify(item))) {
        throw new Error('checker result contains whole-candidate authority vocabulary');
      }
    }
    const statuses = items.map((item) => item.status);
    const status = statuses.includes('needs_full_review')
      ? 'needs_full_review'
      : (statuses.includes('unresolved') ? 'unresolved' : 'resolved');
    const body = {
      schema_version: 1,
      artifact_type: 'review_remediation_check',
      status,
      authority: 'non_authoritative',
      whole_candidate_pass: false,
      gate_clear: false,
      previous_commit: previous,
      current_commit: current,
      delta_digest: deltaDigest,
      finding_contract_digest: delta.finding_contract_digest,
      findings: items.map((item) => ({ ...item })),
      fallback_to_full_blind_review: status === 'needs_full_review',
    };
    body.receipt_digest = sha256(canonical(body));
    writeOutput(body);
  } else {
    throw new Error(`unknown remediation mode: ${mode}`);
  }
} catch (error) {
  fail(error.message || String(error));
}
NODE
}

case "$CMD" in
  remediation|build-remediation-delta)
    run_remediation_node build "$@"
    exit $?
    ;;
  check-remediation|validate-remediation)
    run_remediation_node check "$@"
    exit $?
    ;;
esac

require_checkpoint() {
  [[ -f "$CHECKPOINT_FILE" ]] || { echo "no checkpoint set; run: $0 mark" >&2; exit 2; }
}

case "$CMD" in
  mark)
    git rev-parse HEAD > "$CHECKPOINT_FILE"
    echo "marked checkpoint: $(cat "$CHECKPOINT_FILE")"
    ;;
  since)
    require_checkpoint
    sha="$(cat "$CHECKPOINT_FILE")"
    BASE="${BASE:-$(git merge-base HEAD develop 2>/dev/null || git merge-base HEAD main 2>/dev/null || echo "$sha")}"

    echo "===== SECTION A: FULL DIFF (give to reviewer) ====="
    git diff "$BASE"...HEAD
    echo ""
    echo "===== SECTION B: DELTA SINCE LAST ROUND (DISPATCHER ONLY — NOT for reviewer) ====="
    git diff --stat "$sha"...HEAD
    echo ""
    echo "Changed since last round:"
    git diff --name-only "$sha"...HEAD
    ;;
  stat)
    require_checkpoint
    sha="$(cat "$CHECKPOINT_FILE")"
    changed_files=$(git diff --name-only "$sha"...HEAD | wc -l | tr -d ' ')
    insertions=$(git diff --shortstat "$sha"...HEAD 2>/dev/null | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+' || echo 0)
    deletions=$(git diff --shortstat "$sha"...HEAD 2>/dev/null | grep -oE '[0-9]+ deletion'  | grep -oE '[0-9]+' || echo 0)
    # Doc-only? all changed files match doc patterns
    doc_only="false"
    if [[ "$changed_files" -gt 0 ]]; then
      non_doc=$(git diff --name-only "$sha"...HEAD | grep -vE '\.(md|txt|rst)$' | wc -l | tr -d ' ')
      [[ "$non_doc" -eq 0 ]] && doc_only="true"
    fi
    printf '{"checkpoint":"%s","changed_files":%d,"insertions":%d,"deletions":%d,"doc_only":%s}\n' \
      "$sha" "$changed_files" "$insertions" "$deletions" "$doc_only"
    ;;
  clear)
    rm -f "$CHECKPOINT_FILE"
    echo "checkpoint cleared"
    ;;
  *)
    echo "usage: $0 {mark|since|stat|remediation|check-remediation|clear}" >&2
    exit 2
    ;;
esac
