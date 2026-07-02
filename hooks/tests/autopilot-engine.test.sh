#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

DIFF="$TEST_TMP/review.diff"
printf '+const answer = 42;\n' > "$DIFF"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const calls = [];
const engine = new AutopilotEngine({
  clock: () => 1782864000000,
  reviewLoopResolver(args) {
    calls.push(['resolve', args]);
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        reviewer_engine: 'test-review-model',
        reviewer_effort: 'test-review-effort',
        reviewer_runner: 'test-review-runner',
        reviewer_qualified: true,
      },
    };
  },
  reviewDispatcher(args) {
    calls.push(['review', args]);
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'reviewed',
        verdict: 'FIX-THEN-SHIP',
        findings: 'stub finding',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
});

const result = engine.reviewDiff({ diffFile: diff, requireQualifiedReviewer: true });
console.log(`status=${result.status}`);
console.log(`verdict=${result.verdict}`);
console.log(`resolve_args=${calls[0][1].join(' ')}`);
console.log(`review_args=${calls[1][1].join(' ')}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine reviewDiff process exits 0"
assert_contains "$OUT" "status=reviewed" "AutopilotEngine returns reviewed status"
assert_contains "$OUT" "verdict=FIX-THEN-SHIP" "AutopilotEngine returns review verdict"
assert_contains "$OUT" "resolve_args=--check-scorecard" "AutopilotEngine resolves scorecard-aware roster by default"
assert_contains "$OUT" "--runner test-review-runner --model test-review-model --diff-file $DIFF --effort test-review-effort" "AutopilotEngine builds review dispatcher args from roster"
assert_contains "$OUT" "ledger=resolve_roster:resolved,dispatch_review:reviewed" "AutopilotEngine emits dispatch ledger"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  clock: () => '2026-07-01T00:00:00.000Z',
  reviewLoopResolver() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        reviewer_engine: 'test-review-model',
        reviewer_effort: 'test-review-effort',
        reviewer_runner: 'test-review-runner',
        reviewer_qualified: true,
      },
    };
  },
});

const result = engine.resolveRoster();
console.log(`status=${result.status}`);
console.log(`reviewer=${result.roster && result.roster.reviewer_engine}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine resolveRoster process exits 0"
assert_contains "$OUT" "status=resolved" "AutopilotEngine resolveRoster returns resolved status"
assert_contains "$OUT" "reviewer=test-review-model" "AutopilotEngine resolveRoster returns roster"
assert_contains "$OUT" "ledger=resolve_roster:resolved" "AutopilotEngine resolveRoster emits ledger"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  clock: () => Number.MAX_VALUE,
});
const result = engine.resolveRoster({ args: '' });
console.log(`status=${result.status}`);
console.log(`reason=${result.reason}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine resolveRoster bad-args process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine resolveRoster blocks bad args"
assert_contains "$OUT" "reason=resolveRoster args must be an array" "AutopilotEngine resolveRoster surfaces bad args"
assert_contains "$OUT" "ledger=resolve_roster:blocked" "AutopilotEngine resolveRoster bad args emits ledger"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  clock: () => new Date('not-a-date'),
});
const result = engine.resolveRoster({ args: '' });
console.log(`status=${result.status}`);
console.log(`started_type=${typeof result.ledger[0].started_at}`);
console.log(`ended_type=${typeof result.ledger[0].ended_at}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine invalid-Date clock process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine tolerates invalid Date clock values"
assert_contains "$OUT" "started_type=string" "AutopilotEngine keeps started_at as string with invalid Date clock"
assert_contains "$OUT" "ended_type=string" "AutopilotEngine keeps ended_at as string with invalid Date clock"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

let reviewCalls = 0;
const engine = new AutopilotEngine({
  clock: () => '2026-07-01T00:00:00.000Z',
  reviewLoopResolver() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '{bad',
      stderr: '',
      parseError: new Error('schema drift'),
      result: null,
    };
  },
  reviewDispatcher() {
    reviewCalls += 1;
    throw new Error('review should not run');
  },
});

const result = engine.reviewDiff({ diffFile: diff });
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`review_calls=${reviewCalls}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine resolve-block process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks on roster parse error"
assert_contains "$OUT" "phase=resolve_roster" "AutopilotEngine reports resolve_roster phase"
assert_contains "$OUT" "reason=schema drift" "AutopilotEngine surfaces parse error"
assert_contains "$OUT" "review_calls=0" "AutopilotEngine does not dispatch review after resolve block"
assert_contains "$OUT" "ledger=resolve_roster:blocked" "AutopilotEngine records blocked roster ledger"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

let reviewCalls = 0;
const engine = new AutopilotEngine({
  clock: () => '2026-07-01T00:00:00.000Z',
  reviewLoopResolver() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        reviewer_engine: 'test-review-model',
        reviewer_runner: 'test-review-runner',
      },
    };
  },
  reviewDispatcher() {
    reviewCalls += 1;
    throw new Error('review should not run');
  },
});

const result = engine.reviewDiff({ diffFile: diff });
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`review_calls=${reviewCalls}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine malformed-resolved-roster process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks malformed resolved roster"
assert_contains "$OUT" "phase=resolve_roster" "AutopilotEngine reports resolve phase for malformed roster"
assert_contains "$OUT" "reviewer_effort is required" "AutopilotEngine surfaces malformed roster reason"
assert_contains "$OUT" "review_calls=0" "AutopilotEngine does not dispatch malformed resolved roster"
assert_contains "$OUT" "ledger=resolve_roster:blocked" "AutopilotEngine records malformed roster in resolve ledger"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

let reviewCalls = 0;
const engine = new AutopilotEngine({
  clock: () => '2026-07-01T00:00:00.000Z',
  reviewLoopResolver() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        reviewer_engine: 'test-review-model',
        reviewer_effort: 'test-review-effort',
        reviewer_runner: 'test-review-runner',
        reviewer_qualified: false,
      },
    };
  },
  reviewDispatcher() {
    reviewCalls += 1;
    throw new Error('review should not run');
  },
});

const result = engine.reviewDiff({ diffFile: diff, requireQualifiedReviewer: true });
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`review_calls=${reviewCalls}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine qualification-block process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks unqualified reviewer when required"
assert_contains "$OUT" "phase=reviewer_qualification" "AutopilotEngine reports qualification phase"
assert_contains "$OUT" "reason=reviewer is not qualified or qualification is unknown" "AutopilotEngine surfaces qualification reason"
assert_contains "$OUT" "review_calls=0" "AutopilotEngine does not dispatch unqualified reviewer"
assert_contains "$OUT" "ledger=resolve_roster:resolved,reviewer_qualification:blocked" "AutopilotEngine records qualification ledger"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  clock: () => '2026-07-01T00:00:00.000Z',
  reviewDispatcher() {
    return {
      error: null,
      status: 1,
      signal: null,
      stdout: 'not json',
      stderr: '',
      parseError: new Error('no JSON object found'),
      result: null,
    };
  },
});

const result = engine.reviewDiff({
  diffFile: diff,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'test-review-effort',
    reviewer_runner: 'test-review-runner',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine dispatch-block process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks on review parse error"
assert_contains "$OUT" "phase=dispatch_review" "AutopilotEngine reports dispatch phase"
assert_contains "$OUT" "reason=review dispatch exited with status 1" "AutopilotEngine prioritizes nonzero review exit"
assert_contains "$OUT" "ledger=dispatch_review:blocked" "AutopilotEngine records blocked review ledger"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine();
const result = engine.reviewDiff({
  diffFile: diff,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_runner: 'test-review-runner',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine invalid-roster process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks partial injected roster"
assert_contains "$OUT" "phase=prepare_review" "AutopilotEngine reports prepare phase for invalid roster"
assert_contains "$OUT" "reviewer_effort is required" "AutopilotEngine rejects partial injected roster"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine();
const result = engine.reviewDiff({
  diffFile: diff,
  roster: 'bad-roster',
  requireQualifiedReviewer: true,
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine non-object-roster process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks non-object roster before qualification"
assert_contains "$OUT" "phase=prepare_review" "AutopilotEngine reports prepare phase for non-object roster"
assert_contains "$OUT" "reason=review roster is required" "AutopilotEngine surfaces non-object roster reason"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

let reviewCalls = 0;
const engine = new AutopilotEngine({
  reviewDispatcher() {
    reviewCalls += 1;
    return {
      error: null,
      status: 1,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'no_verdict',
        verdict: null,
        findings: '',
        raw_log: '/tmp/log',
        error: 'no verdict',
      },
    };
  },
});

const result = engine.reviewDiff({
  diffFile: diff,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'test-review-effort',
    reviewer_runner: 'test-review-runner',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`review_calls=${reviewCalls}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine nonzero-review process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks nonzero review status"
assert_contains "$OUT" "phase=dispatch_review" "AutopilotEngine reports dispatch phase for nonzero review"
assert_contains "$OUT" "reason=review dispatch exited with status 1" "AutopilotEngine surfaces nonzero review exit"
assert_contains "$OUT" "review_calls=1" "AutopilotEngine still records one review attempt"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  reviewDispatcher() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'no_verdict',
        verdict: null,
        findings: '',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
});

const result = engine.reviewDiff({
  diffFile: diff,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'test-review-effort',
    reviewer_runner: 'test-review-runner',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine zero-exit-no-verdict process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks parsed non-reviewed status"
assert_contains "$OUT" "phase=dispatch_review" "AutopilotEngine reports dispatch phase for non-reviewed status"
assert_contains "$OUT" "reason=review dispatch result status no_verdict" "AutopilotEngine surfaces non-reviewed status"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  reviewDispatcher() {
    return {
      error: null,
      status: null,
      signal: 'SIGTERM',
      stdout: '',
      stderr: '',
      parseError: null,
      result: null,
    };
  },
});

const result = engine.reviewDiff({
  diffFile: diff,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'test-review-effort',
    reviewer_runner: 'test-review-runner',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine review signal process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks review signal termination"
assert_contains "$OUT" "phase=dispatch_review" "AutopilotEngine reports dispatch phase for signal"
assert_contains "$OUT" "reason=review dispatch terminated by signal SIGTERM" "AutopilotEngine surfaces review signal"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  reviewDispatcher() {
    throw new Error('dispatcher exploded');
  },
});

const result = engine.reviewDiff({
  diffFile: diff,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'test-review-effort',
    reviewer_runner: 'test-review-runner',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine dispatcher exception process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks dispatcher exceptions"
assert_contains "$OUT" "phase=dispatch_review" "AutopilotEngine reports dispatch phase for dispatcher exception"
assert_contains "$OUT" "reason=dispatcher exploded" "AutopilotEngine surfaces dispatcher exception"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  reviewLoopResolver() {
    throw new Error('resolver exploded');
  },
});

const result = engine.reviewDiff({ diffFile: diff });
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine resolver-exception process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks resolver exceptions"
assert_contains "$OUT" "phase=resolve_roster" "AutopilotEngine reports resolve phase for exception"
assert_contains "$OUT" "reason=resolver exploded" "AutopilotEngine surfaces resolver exception"
assert_contains "$OUT" "ledger=resolve_roster:blocked" "AutopilotEngine records resolver exception ledger"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine();
const result = engine.reviewDiff({
  diffFile: diff,
  rosterArgs: '--bad',
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine reviewDiff bad-rosterArgs process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine reviewDiff blocks bad rosterArgs"
assert_contains "$OUT" "phase=resolve_roster" "AutopilotEngine reports resolve phase for bad rosterArgs"
assert_contains "$OUT" "reason=resolveRoster args must be an array" "AutopilotEngine surfaces bad rosterArgs"
assert_contains "$OUT" "ledger=resolve_roster:blocked" "AutopilotEngine records bad rosterArgs ledger"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  reviewLoopResolver() {
    return {
      error: null,
      status: null,
      signal: 'SIGINT',
      stdout: '',
      stderr: '',
      parseError: null,
      result: null,
    };
  },
});

const result = engine.reviewDiff({ diffFile: diff });
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine resolver signal process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks resolver signal termination"
assert_contains "$OUT" "phase=resolve_roster" "AutopilotEngine reports resolve phase for signal"
assert_contains "$OUT" "reason=review-loop terminated by signal SIGINT" "AutopilotEngine surfaces resolver signal"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine();
const result = engine.reviewDiff({
  diffFile: diff,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'test-review-effort',
    reviewer_runner: 'test-review-runner',
  },
  extraReviewArgs: ['--runner', 'agy'],
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine conflicting-extra-args process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks conflicting extra args"
assert_contains "$OUT" "phase=prepare_review" "AutopilotEngine reports prepare phase for conflicting args"
assert_contains "$OUT" "cannot override --runner" "AutopilotEngine rejects reserved review arg override"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine();
const result = engine.reviewDiff({
  diffFile: diff,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'test-review-effort',
    reviewer_runner: 'test-review-runner',
  },
  extraReviewArgs: '',
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine bad-extra-args process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks non-array extra args"
assert_contains "$OUT" "phase=prepare_review" "AutopilotEngine reports prepare phase for bad extra args"
assert_contains "$OUT" "extraReviewArgs must be an array" "AutopilotEngine surfaces bad extra args"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  reviewLoopResolver() {
    throw new Error('resolver should not run');
  },
});
const result = engine.reviewDiff({});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine missing-diff process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks missing diffFile before resolving"
assert_contains "$OUT" "phase=prepare_review" "AutopilotEngine reports prepare phase for missing diff"
assert_contains "$OUT" "reason=diffFile is required" "AutopilotEngine surfaces missing diff reason"
assert_contains "$OUT" "ledger=prepare_review:blocked" "AutopilotEngine records missing diff ledger"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { buildImplementationArgs } = require(path.join(root, 'src', 'engine'));

const args = buildImplementationArgs({
  promptFile: 'relative-prompt.md',
  branch: 'impl-branch',
  base: '1111111111111111111111111111111111111111',
  roster: {
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
  },
});
console.log(args.join(' '));
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine buildImplementationArgs absolutizes prompt path"
assert_contains "$OUT" "--prompt-file $REPO_ROOT/relative-prompt.md" "AutopilotEngine passes absolute prompt path to dispatch-hetero"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseImplementationOutput } = require(path.join(root, 'src', 'runners', 'implementer'));

try {
  parseImplementationOutput(JSON.stringify({
    status: 'committed',
    runner: 'codex',
    model: 'gpt-test',
    branch: 'impl-branch',
    base: '1111111111111111111111111111111111111111',
    commit: null,
    files_changed: 1,
    insertions: 1,
    deletions: 0,
    worktree: null,
    agent_log: '/tmp/log',
    error: null,
    containment: 'plain',
    contained: true,
  }));
  console.log('unexpected-ok');
} catch (error) {
  console.log(error.message);
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementer parser committed-null process exits 0"
assert_contains "$OUT" "status committed requires a non-empty commit" "AutopilotEngine implementer parser rejects committed outcome without commit"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseImplementationOutput } = require(path.join(root, 'src', 'runners', 'implementer'));

try {
  parseImplementationOutput(JSON.stringify({
    status: 'committed',
    runner: 'codex',
    model: 'gpt-test',
    branch: 'impl-branch',
    base: '1111111111111111111111111111111111111111',
    commit: 'not-a-sha',
    files_changed: 1,
    insertions: 1,
    deletions: 0,
    worktree: null,
    agent_log: '/tmp/log',
    error: null,
    containment: 'plain',
    contained: true,
  }));
  console.log('unexpected-ok');
} catch (error) {
  console.log(error.message);
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementer parser bad-commit process exits 0"
assert_contains "$OUT" "status committed requires a full immutable git SHA commit" "AutopilotEngine implementer parser rejects committed outcome with non-SHA commit"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseImplementationOutput } = require(path.join(root, 'src', 'runners', 'implementer'));

const parsed = parseImplementationOutput(JSON.stringify({
  status: 'precondition_failed',
  runner: 'codex',
  model: 'gpt-test',
  branch: '',
  base: '',
  commit: null,
  files_changed: 0,
  insertions: 0,
  deletions: 0,
  worktree: null,
  agent_log: null,
  error: '--branch is required',
}));
console.log(`status=${parsed.status}`);
console.log(`error=${parsed.error}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementer parser precondition-empty-branch process exits 0"
assert_contains "$OUT" "status=precondition_failed" "AutopilotEngine implementer parser accepts precondition_failed with empty branch"
assert_contains "$OUT" "error=--branch is required" "AutopilotEngine implementer parser preserves precondition_failed error"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseImplementationOutput } = require(path.join(root, 'src', 'runners', 'implementer'));

const valid = {
  status: 'committed',
  runner: 'codex',
  model: 'gpt-test',
  branch: 'impl-branch',
  base: '1111111111111111111111111111111111111111',
  commit: '2222222222222222222222222222222222222222',
  files_changed: 1,
  insertions: 1,
  deletions: 0,
  worktree: null,
  agent_log: '/tmp/log',
  error: null,
  containment: 'plain',
  contained: true,
};
try {
  parseImplementationOutput(`${JSON.stringify(valid)}\n{"status":"committed"`);
  console.log('unexpected-ok');
} catch (error) {
  console.log(error.message);
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementer parser trailing-incomplete process exits 0"
assert_contains "$OUT" "trailing incomplete JSON object" "AutopilotEngine implementer parser rejects trailing incomplete JSON after valid result"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/impl-cwd-runner.sh" "$TEST_TMP/caller-project" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const script = process.argv[3];
const caller = process.argv[4];
const { dispatchImplement } = require(path.join(root, 'src', 'runners', 'implementer'));

fs.writeFileSync(script, '#!/usr/bin/env bash\npwd\n');
fs.chmodSync(script, 0o755);
fs.mkdirSync(caller, { recursive: true });
process.chdir(caller);

const result = dispatchImplement([], {
  scriptPath: script,
  stdio: ['ignore', 'pipe', 'pipe'],
});
console.log(`status=${result.status}`);
console.log(`stdout=${String(result.stdout).trim()}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementer dispatcher cwd test process exits 0"
assert_contains "$OUT" "status=0" "AutopilotEngine implementer dispatcher cwd test script exits 0"
assert_contains "$OUT" "stdout=$TEST_TMP/caller-project" "AutopilotEngine implementer dispatcher defaults to caller cwd"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/implement-task-cwd-project" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const target = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'prompt.txt'), 'implementer prompt');
let resolverCwd = null;
let implementationCwd = null;
let promptArg = null;

const engine = new AutopilotEngine({
  cwd: target,
  reviewLoopResolver(_args, options) {
    resolverCwd = options && options.cwd;
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        reviewer_engine: 'test-review-model',
        reviewer_effort: 'xhigh',
        reviewer_runner: 'test-review-runner',
        implementer_engine: 'test-impl-model',
        implementer_effort: 'high',
        implementer_runner: 'test-impl-runner',
      },
    };
  },
  implementationDispatcher(args, options) {
    implementationCwd = options && options.cwd;
    promptArg = args[args.indexOf('--prompt-file') + 1];
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        branch: 'impl-branch',
        base: '1111111111111111111111111111111111111111',
        commit: '2222222222222222222222222222222222222222',
        files_changed: 1,
        insertions: 1,
        deletions: 0,
        worktree: null,
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
});

const result = engine.implementTask({
  promptFile: 'prompt.txt',
  branch: 'impl-branch',
  base: '1111111111111111111111111111111111111111',
});
console.log(`status=${result.status}`);
console.log(`resolver_cwd=${resolverCwd}`);
console.log(`implementation_cwd=${implementationCwd}`);
console.log(`prompt_arg=${promptArg}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementTask engine-cwd test exits 0"
assert_contains "$OUT" "status=committed" "AutopilotEngine implementTask engine-cwd dispatch commits"
assert_contains "$OUT" "resolver_cwd=$TEST_TMP/implement-task-cwd-project" "AutopilotEngine implementTask uses engine cwd for roster resolver"
assert_contains "$OUT" "implementation_cwd=$TEST_TMP/implement-task-cwd-project" "AutopilotEngine implementTask passes engine cwd to dispatcher"
assert_contains "$OUT" "prompt_arg=$TEST_TMP/implement-task-cwd-project/prompt.txt" "AutopilotEngine implementTask resolves relative prompt from engine cwd"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/implementer-prompt.txt" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'implementer prompt');
const calls = [];

const engine = new AutopilotEngine({
  implementationDispatcher(args) {
    calls.push(args);
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '{\"runner\":\"test-impl-runner\",\"model\":\"test-impl-model\",\"status\":\"committed\",\"commit\":\"2222222222222222222222222222222222222222\",\"base\":\"1111111111111111111111111111111111111111\",\"branch\":\"impl-branch\",\"files_changed\":2,\"insertions\":12,\"deletions\":1,\"worktree\":\"/tmp/impl-wt\",\"agent_log\":\"/tmp/impl-log\",\"error\":null,\"containment\":\"plain\",\"contained\":true}',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        commit: '2222222222222222222222222222222222222222',
        base: '1111111111111111111111111111111111111111',
        branch: 'impl-branch',
        files_changed: 2,
        insertions: 12,
        deletions: 1,
        worktree: '/tmp/impl-wt',
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
});

const result = engine.implementTask({
  promptFile: prompt,
  branch: 'impl-branch',
  base: '1111111111111111111111111111111111111111',
  roster: {
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`runner=${result.implementation && result.implementation.runner}`);
console.log(`model=${result.implementation && result.implementation.model}`);
console.log(`commit=${result.implementation && result.implementation.commit}`);
console.log(`args=${calls[0].join(' ')}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}:${entry.base}:${entry.branch}:${entry.commit}:${entry.runner}:${entry.model}:${entry.exit_status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementTask builds implementation args and ledger"
assert_contains "$OUT" "status=committed" "AutopilotEngine implementation dispatch returns committed"
assert_contains "$OUT" "phase=dispatch_implementation" "AutopilotEngine implementation dispatch phase is dispatch_implementation"
assert_contains "$OUT" "runner=test-impl-runner" "AutopilotEngine implementation output captures runner"
assert_contains "$OUT" "model=test-impl-model" "AutopilotEngine implementation output captures model"
assert_contains "$OUT" "commit=2222222222222222222222222222222222222222" "AutopilotEngine implementation output captures commit"
assert_contains "$OUT" "--runner test-impl-runner --model test-impl-model --prompt-file $TEST_TMP/implementer-prompt.txt --branch impl-branch --base 1111111111111111111111111111111111111111 --effort high" "AutopilotEngine builds implementation dispatcher args from roster"
assert_contains "$OUT" "dispatch_implementation:committed:1111111111111111111111111111111111111111:impl-branch:2222222222222222222222222222222222222222:test-impl-runner:test-impl-model:0" "AutopilotEngine emits implementation ledger row with runner/model/base/branch/commit/exit status"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/implementer-nonzero-prompt.txt" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'implementer prompt');

const engine = new AutopilotEngine({
  implementationDispatcher() {
    return {
      error: null,
      status: 1,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        commit: '2222222222222222222222222222222222222222',
        base: '1111111111111111111111111111111111111111',
        branch: 'impl-branch',
        files_changed: 1,
        insertions: 1,
        deletions: 0,
        worktree: null,
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
});

const result = engine.implementTask({
  promptFile: prompt,
  branch: 'impl-branch',
  base: '1111111111111111111111111111111111111111',
  roster: {
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine blocks nonzero committed implementation dispatch"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks nonzero committed implementation dispatch status"
assert_contains "$OUT" "phase=dispatch_implementation" "AutopilotEngine reports dispatch phase for nonzero committed implementation"
assert_contains "$OUT" "reason=implementation dispatch exited with status 1" "AutopilotEngine surfaces nonzero committed implementation exit"
assert_contains "$OUT" "ledger=dispatch_implementation:blocked" "AutopilotEngine records nonzero committed implementation as blocked"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/implementer-bad-commit-prompt.txt" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'implementer prompt');

const engine = new AutopilotEngine({
  implementationDispatcher() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        commit: 'not-a-sha',
        base: '1111111111111111111111111111111111111111',
        branch: 'impl-branch',
        files_changed: 1,
        insertions: 1,
        deletions: 0,
        worktree: null,
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
});

const result = engine.implementTask({
  promptFile: prompt,
  branch: 'impl-branch',
  base: '1111111111111111111111111111111111111111',
  roster: {
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine blocks committed implementation with non-SHA commit"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks committed implementation with non-SHA commit status"
assert_contains "$OUT" "phase=dispatch_implementation" "AutopilotEngine reports dispatch phase for non-SHA committed implementation"
assert_contains "$OUT" "reason=implementation result commit must be a full immutable git SHA" "AutopilotEngine surfaces non-SHA committed implementation"
assert_contains "$OUT" "ledger=dispatch_implementation:blocked" "AutopilotEngine records non-SHA committed implementation as blocked"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/implement-loop-prompt.txt" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'implementer prompt');
const implCalls = [];
const reviewCalls = [];
const diffCalls = [];
const repairCalls = [];

const engine = new AutopilotEngine({
  clock: () => '2026-07-01T00:00:00.000Z',
  reviewLoopResolver() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        reviewer_engine: 'test-review-model',
        reviewer_effort: 'xhigh',
        reviewer_runner: 'test-review-runner',
        reviewer_qualified: true,
        implementer_engine: 'test-impl-model',
        implementer_effort: 'high',
        implementer_runner: 'test-impl-runner',
        loop_max_rounds: 3,
        loop_convergence_verdict: 'SHIP-AS-IS',
        spec_review: 'off',
        independent_harness: 'off',
        qc_panel: [ 'test-review-model' ],
        qc_panel_aggregation: 'majority',
        review_risk: 'low',
        required_review_families: 1,
        l1_required: false,
        cross_family_required: false,
        cross_family_satisfied: true,
        review_diff_scope: 'full',
        source: 'test',
        work_domain: 'mixed',
        domain_source: 'none',
      },
    };
  },
  implementationDispatcher(args) {
    implCalls.push(args);
    const call = implCalls.length;
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        branch: args[args.indexOf('--branch') + 1],
        base: args[args.indexOf('--base') + 1],
        commit: call === 1 ? '2222222222222222222222222222222222222222' : '3333333333333333333333333333333333333333',
        files_changed: 1,
        insertions: 1,
        deletions: 0,
        worktree: '/tmp/impl-worktree',
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
  reviewDispatcher(args) {
    reviewCalls.push(args);
    const call = reviewCalls.length;
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'reviewed',
        verdict: call === 1 ? 'FIX-THEN-SHIP' : 'SHIP-AS-IS',
        findings: 'stub finding',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
  diffProvider({ base, commit, branch, round }) {
    diffCalls.push({ base, commit, branch, round });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-impl-diff-'));
    const file = path.join(tmpDir, `${branch}-${round}.diff`);
    fs.writeFileSync(file, `round ${round} diff`, 'utf8');
    return file;
  },
  repairPromptWriter({ promptFile, round, base, previousCommit, commit, review }) {
    repairCalls.push({ round, base, previousCommit, commit, verdict: review && review.verdict });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-repair-prompt-'));
    const file = path.join(tmpDir, `round-${round}-prompt.txt`);
    fs.writeFileSync(file, `repair ${round} for ${previousCommit}\n${fs.readFileSync(promptFile, 'utf8')}`, 'utf8');
    return file;
  },
});

const result = engine.runImplementationReviewLoop({
  promptFile: prompt,
  branch: 'impl-loop',
  base: '1111111111111111111111111111111111111111',
  maxRounds: 3,
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`rounds=${result.rounds}`);
console.log(`verdict=${result.verdict}`);
console.log(`implementation_calls=${implCalls.length}`);
console.log(`review_calls=${reviewCalls.length}`);
console.log(`repair_calls=${repairCalls.length}`);
console.log(`diff_calls=${diffCalls.length}`);
console.log(`impl1_base=${implCalls[0][implCalls[0].indexOf('--base') + 1]}`);
console.log(`impl2_base=${implCalls[1][implCalls[1].indexOf('--base') + 1]}`);
console.log(`review_bases=${diffCalls.map((d) => d.base).join(',')}`);
console.log(`impl_branches=${implCalls.map((args) => args[args.indexOf('--branch') + 1]).join(',')}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine converges through repair implementation-repair-review loop"
assert_contains "$OUT" "status=converged" "AutopilotEngine returns converged status after repair round"
assert_contains "$OUT" "phase=converged" "AutopilotEngine converged on implementation-review loop"
assert_contains "$OUT" "rounds=2" "AutopilotEngine returns converged round count"
assert_contains "$OUT" "verdict=SHIP-AS-IS" "AutopilotEngine returns converged verdict"
assert_contains "$OUT" "implementation_calls=2" "AutopilotEngine performs two implementation dispatches for one repair cycle"
assert_contains "$OUT" "review_calls=2" "AutopilotEngine performs two review dispatches for one repair cycle"
assert_contains "$OUT" "repair_calls=1" "AutopilotEngine performs one repair prompt write"
assert_contains "$OUT" "diff_calls=2" "AutopilotEngine reviews full base-to-commit diff after each implementation"
assert_contains "$OUT" "impl2_base=2222222222222222222222222222222222222222" "AutopilotEngine repair dispatch uses previous commit as repair base"
assert_contains "$OUT" "review_bases=1111111111111111111111111111111111111111,1111111111111111111111111111111111111111" "AutopilotEngine reviews against immutable original base"
assert_contains "$OUT" "ledger=resolve_roster:resolved,dispatch_implementation:committed,dispatch_review:reviewed,dispatch_implementation:committed,dispatch_review:reviewed" "AutopilotEngine logs both implementation and review dispatch units"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/moving-ref-loop-prompt.txt" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'implementer prompt');
let resolverCalls = 0;
let implementationCalls = 0;

const engine = new AutopilotEngine({
  reviewLoopResolver() {
    resolverCalls += 1;
    throw new Error('resolver should not run with a moving base ref');
  },
  implementationDispatcher() {
    implementationCalls += 1;
    throw new Error('implementation should not dispatch with a moving base ref');
  },
});

const result = engine.runImplementationReviewLoop({
  promptFile: prompt,
  branch: 'impl-loop',
  base: 'develop',
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`rounds=${result.rounds}`);
console.log(`resolver_calls=${resolverCalls}`);
console.log(`implementation_calls=${implementationCalls}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementation loop moving-ref base exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine implementation loop blocks moving base refs"
assert_contains "$OUT" "phase=prepare_implementation_loop" "AutopilotEngine implementation loop reports preparation phase for moving base refs"
assert_contains "$OUT" "reason=base must be a full immutable git SHA" "AutopilotEngine implementation loop explains immutable base requirement"
assert_contains "$OUT" "rounds=0" "AutopilotEngine implementation loop blocks moving base before round one"
assert_contains "$OUT" "resolver_calls=0" "AutopilotEngine implementation loop does not resolve roster with moving base"
assert_contains "$OUT" "implementation_calls=0" "AutopilotEngine implementation loop does not dispatch implementation with moving base"
assert_contains "$OUT" "ledger=prepare_implementation_loop:blocked" "AutopilotEngine implementation loop records moving-base block"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/unqualified-loop-prompt.txt" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'implementer prompt');
let implementationCalls = 0;
let reviewCalls = 0;

const engine = new AutopilotEngine({
  reviewLoopResolver() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        reviewer_engine: 'test-review-model',
        reviewer_effort: 'xhigh',
        reviewer_runner: 'test-review-runner',
        reviewer_qualified: false,
        implementer_engine: 'test-impl-model',
        implementer_effort: 'high',
        implementer_runner: 'test-impl-runner',
        loop_max_rounds: 1,
        loop_convergence_verdict: 'SHIP-AS-IS',
      },
    };
  },
  implementationDispatcher() {
    implementationCalls += 1;
    throw new Error('implementation should not dispatch before reviewer qualification passes');
  },
  reviewDispatcher() {
    reviewCalls += 1;
    throw new Error('review should not dispatch when reviewer is unqualified');
  },
});

const result = engine.runImplementationReviewLoop({
  promptFile: prompt,
  branch: 'impl-loop',
  base: '1111111111111111111111111111111111111111',
  requireQualifiedReviewer: true,
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`rounds=${result.rounds}`);
console.log(`reason=${result.reason}`);
console.log(`implementation_calls=${implementationCalls}`);
console.log(`review_calls=${reviewCalls}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementation loop reviewer-qualification preflight exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine implementation loop blocks unqualified reviewer"
assert_contains "$OUT" "phase=reviewer_qualification" "AutopilotEngine implementation loop reports reviewer qualification phase"
assert_contains "$OUT" "rounds=0" "AutopilotEngine implementation loop blocks before round one"
assert_contains "$OUT" "reason=reviewer is not qualified or qualification is unknown" "AutopilotEngine implementation loop surfaces reviewer qualification reason"
assert_contains "$OUT" "implementation_calls=0" "AutopilotEngine implementation loop does not dispatch implementation before qualification"
assert_contains "$OUT" "review_calls=0" "AutopilotEngine implementation loop does not dispatch review when qualification fails"
assert_contains "$OUT" "ledger=resolve_roster:resolved,reviewer_qualification:blocked" "AutopilotEngine implementation loop records qualification block"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/malformed-roster-loop-prompt.txt" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'implementer prompt');
let implementationCalls = 0;

const engine = new AutopilotEngine({
  implementationDispatcher() {
    implementationCalls += 1;
    throw new Error('implementation should not dispatch with malformed roster');
  },
});

const result = engine.runImplementationReviewLoop({
  promptFile: prompt,
  branch: 'impl-loop',
  base: '1111111111111111111111111111111111111111',
  maxRounds: 1,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'xhigh',
    reviewer_runner: 'test-review-runner',
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    loop_convergence_verdict: 'SHIP-AS-IS',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`rounds=${result.rounds}`);
console.log(`reason=${result.reason}`);
console.log(`implementation_calls=${implementationCalls}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementation loop malformed roster exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine implementation loop blocks malformed injected roster"
assert_contains "$OUT" "phase=prepare_implementation_loop" "AutopilotEngine implementation loop reports preparation phase for malformed roster"
assert_contains "$OUT" "rounds=0" "AutopilotEngine implementation loop blocks malformed roster before round one"
assert_contains "$OUT" "reason=implementer roster field implementer_runner is required" "AutopilotEngine implementation loop surfaces missing implementer field"
assert_contains "$OUT" "implementation_calls=0" "AutopilotEngine implementation loop does not dispatch with malformed roster"
assert_contains "$OUT" "ledger=prepare_implementation_loop:blocked" "AutopilotEngine implementation loop records malformed roster as preparation block"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/cwd-propagation-repo" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = process.argv[2];
const target = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'prompt.txt'), 'implementer prompt');
let resolverCwd = null;
let implementationCwd = null;
let reviewCwd = null;
let promptArg = null;

const engine = new AutopilotEngine({
  reviewLoopResolver(_args, options) {
    resolverCwd = options && options.cwd;
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        reviewer_engine: 'test-review-model',
        reviewer_effort: 'xhigh',
        reviewer_runner: 'test-review-runner',
        reviewer_qualified: true,
        implementer_engine: 'test-impl-model',
        implementer_effort: 'high',
        implementer_runner: 'test-impl-runner',
        loop_max_rounds: 1,
        loop_convergence_verdict: 'SHIP-AS-IS',
      },
    };
  },
  implementationDispatcher(args, options) {
    implementationCwd = options && options.cwd;
    promptArg = args[args.indexOf('--prompt-file') + 1];
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        branch: 'cwd-loop',
        base: '1111111111111111111111111111111111111111',
        commit: '2222222222222222222222222222222222222222',
        files_changed: 1,
        insertions: 1,
        deletions: 0,
        worktree: null,
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
  reviewDispatcher(_args, options) {
    reviewCwd = options && options.cwd;
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'reviewed',
        verdict: 'SHIP-AS-IS',
        findings: '',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
  diffProvider({ round }) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-cwd-propagation-diff-'));
    const file = path.join(tmpDir, `round-${round}.diff`);
    fs.writeFileSync(file, 'diff', 'utf8');
    return file;
  },
});

const result = engine.runImplementationReviewLoop({
  promptFile: 'prompt.txt',
  branch: 'cwd-loop',
  base: '1111111111111111111111111111111111111111',
  cwd: target,
});
console.log(`status=${result.status}`);
console.log(`resolver_cwd=${resolverCwd}`);
console.log(`implementation_cwd=${implementationCwd}`);
console.log(`review_cwd=${reviewCwd}`);
console.log(`prompt_arg=${promptArg}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementation loop cwd propagation exits 0"
assert_contains "$OUT" "status=converged" "AutopilotEngine implementation loop cwd propagation converges"
assert_contains "$OUT" "resolver_cwd=$TEST_TMP/cwd-propagation-repo" "AutopilotEngine implementation loop passes cwd to roster resolver"
assert_contains "$OUT" "implementation_cwd=$TEST_TMP/cwd-propagation-repo" "AutopilotEngine implementation loop passes cwd to implementation dispatcher"
assert_contains "$OUT" "review_cwd=$TEST_TMP/cwd-propagation-repo" "AutopilotEngine implementation loop passes cwd to review dispatcher"
assert_contains "$OUT" "prompt_arg=$TEST_TMP/cwd-propagation-repo/prompt.txt" "AutopilotEngine implementation loop resolves relative prompt from cwd"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/default-diff-prompt.txt" <<'NODE'
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'prompt');
const head = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
let diffFile = null;

const engine = new AutopilotEngine({
  implementationDispatcher(args) {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        branch: args[args.indexOf('--branch') + 1],
        base: args[args.indexOf('--base') + 1],
        commit: head,
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        worktree: null,
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
  reviewDispatcher(args) {
    diffFile = args[args.indexOf('--diff-file') + 1];
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'reviewed',
        verdict: 'SHIP-AS-IS',
        findings: '',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
});

const result = engine.runImplementationReviewLoop({
  promptFile: prompt,
  branch: 'feature/slash-branch',
  base: head,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'xhigh',
    reviewer_runner: 'test-review-runner',
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
    loop_max_rounds: 1,
    loop_convergence_verdict: 'SHIP-AS-IS',
  },
});

console.log(`status=${result.status}`);
console.log(`diff_exists=${fs.existsSync(diffFile)}`);
console.log(`diff_file=${diffFile}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine default diff provider handles slash branch names"
assert_contains "$OUT" "status=converged" "AutopilotEngine default diff provider converges"
assert_contains "$OUT" "diff_exists=true" "AutopilotEngine default diff provider writes diff file"
assert_contains "$OUT" "autopilot-review-loop-feature-slash-branch" "AutopilotEngine sanitizes slash branch in temp path"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/default-diff-large-prompt.txt" "$TEST_TMP/large-diff-repo" <<'NODE'
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = process.argv[2];
const prompt = process.argv[3];
const repo = process.argv[4];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'prompt');
fs.mkdirSync(repo, { recursive: true });
execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'autopilot@example.test'], { cwd: repo });
execFileSync('git', ['config', 'user.name', 'Autopilot Test'], { cwd: repo });
fs.writeFileSync(path.join(repo, 'README.md'), 'base\n');
execFileSync('git', ['add', 'README.md'], { cwd: repo });
execFileSync('git', ['commit', '-m', 'base'], { cwd: repo, stdio: 'ignore' });
const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
fs.writeFileSync(path.join(repo, 'large.txt'), `${'x'.repeat(2 * 1024 * 1024)}\n`);
execFileSync('git', ['add', 'large.txt'], { cwd: repo });
execFileSync('git', ['commit', '-m', 'large'], { cwd: repo, stdio: 'ignore' });
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const externalDiff = path.join(repo, 'external-diff.sh');
fs.writeFileSync(externalDiff, '#!/usr/bin/env bash\nexit 42\n');
fs.chmodSync(externalDiff, 0o755);
execFileSync('git', ['config', 'diff.external', externalDiff], { cwd: repo });

let diffSize = 0;
let implementationCwd = null;
const engine = new AutopilotEngine({
  implementationDispatcher(_args, options) {
    implementationCwd = options && options.cwd;
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        branch: 'large-diff',
        base,
        commit: head,
        files_changed: 1,
        insertions: 1,
        deletions: 0,
        worktree: null,
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
  reviewDispatcher(args) {
    const diffFile = args[args.indexOf('--diff-file') + 1];
    diffSize = fs.statSync(diffFile).size;
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'reviewed',
        verdict: 'SHIP-AS-IS',
        findings: '',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
});

const result = engine.runImplementationReviewLoop({
  promptFile: prompt,
  branch: 'large-diff',
  base,
  cwd: repo,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'xhigh',
    reviewer_runner: 'test-review-runner',
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
    loop_max_rounds: 1,
    loop_convergence_verdict: 'SHIP-AS-IS',
  },
});

console.log(`status=${result.status}`);
console.log(`implementation_cwd=${implementationCwd}`);
console.log(`external_diff_configured=${fs.existsSync(externalDiff)}`);
console.log(`diff_over_default_buffer=${diffSize > 1024 * 1024}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine default diff provider streams large diffs"
assert_contains "$OUT" "status=converged" "AutopilotEngine large diff provider loop converges"
assert_contains "$OUT" "implementation_cwd=$TEST_TMP/large-diff-repo" "AutopilotEngine implementation loop passes cwd to implementation dispatcher"
assert_contains "$OUT" "external_diff_configured=true" "AutopilotEngine default diff provider test configures failing external diff"
assert_contains "$OUT" "diff_over_default_buffer=true" "AutopilotEngine default diff provider writes diff larger than spawnSync default buffer"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/default-repair-prompt.txt" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'original implementation prompt');
let implementationCalls = 0;
let secondPromptText = '';
let reviewCalls = 0;

const engine = new AutopilotEngine({
  implementationDispatcher(args) {
    implementationCalls += 1;
    if (implementationCalls === 2) {
      secondPromptText = fs.readFileSync(args[args.indexOf('--prompt-file') + 1], 'utf8');
    }
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        branch: args[args.indexOf('--branch') + 1],
        base: args[args.indexOf('--base') + 1],
        commit: implementationCalls === 1 ? '2222222222222222222222222222222222222222' : '3333333333333333333333333333333333333333',
        files_changed: 1,
        insertions: 1,
        deletions: 0,
        worktree: null,
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
  reviewDispatcher() {
    reviewCalls += 1;
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'reviewed',
        verdict: reviewCalls === 1 ? 'FIX-THEN-SHIP' : 'SHIP-AS-IS',
        findings: 'line 12 still calls the shell directly',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
  diffProvider({ round }) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-default-repair-diff-'));
    const file = path.join(tmpDir, `round-${round}.diff`);
    fs.writeFileSync(file, `round ${round}`, 'utf8');
    return file;
  },
});

const result = engine.runImplementationReviewLoop({
  promptFile: prompt,
  branch: 'repair-loop',
  base: '1111111111111111111111111111111111111111',
  maxRounds: 2,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'xhigh',
    reviewer_runner: 'test-review-runner',
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
    loop_max_rounds: 2,
    loop_convergence_verdict: 'SHIP-AS-IS',
  },
});

console.log(`status=${result.status}`);
console.log(`implementation_calls=${implementationCalls}`);
console.log(`repair_prompt_has_findings=${secondPromptText.includes('line 12 still calls the shell directly')}`);
console.log(`repair_prompt_has_original=${secondPromptText.includes('original implementation prompt')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine default repair prompt carries review findings"
assert_contains "$OUT" "status=converged" "AutopilotEngine default repair prompt loop converges"
assert_contains "$OUT" "implementation_calls=2" "AutopilotEngine default repair prompt triggers second implementation"
assert_contains "$OUT" "repair_prompt_has_findings=true" "AutopilotEngine default repair prompt includes reviewer findings"
assert_contains "$OUT" "repair_prompt_has_original=true" "AutopilotEngine default repair prompt preserves original task"

finalize_test
