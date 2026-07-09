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

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/implementer-misplaced-no-op.txt" <<'NODE'
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
        status: 'no_op',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        branch: 'impl-branch',
        base: '1111111111111111111111111111111111111111',
        commit: null,
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        worktree: '/tmp/.gemini/out-of-cwd',
        agent_log: '/tmp/.gemini/logs/impl.log',
        error: '/tmp/.gemini/errors/ohno.log',
        containment: 'plain',
        contained: true,
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
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}:${entry.reconcile_by_ledger}:${entry.reconcile_status}:${entry.misplaced_write_evidence}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine flags misplaced no-op writes"
assert_contains "$OUT" "status=blocked" "AutopilotEngine returns blocked for misplaced no-op"
assert_contains "$OUT" "phase=misplaced_writes" "AutopilotEngine returns misplaced_writes phase for out-of-cwd writes"
assert_contains "$OUT" "likely hardcoded absolute path escaping the target worktree" "AutopilotEngine explains out-of-cwd misplacement cause"
assert_contains "$OUT" "dispatch_implementation:misplaced_writes" "AutopilotEngine records misplaced writes decision in dispatch_implementation ledger"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/implementer-empty-no-op.txt" <<'NODE'
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
        status: 'no_op',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        branch: 'impl-branch',
        base: '1111111111111111111111111111111111111111',
        commit: null,
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        worktree: null,
        agent_log: null,
        error: null,
        containment: 'plain',
        contained: true,
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
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}:${entry.reconcile_by_ledger}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine keeps plain no-op path unchanged"
assert_contains "$OUT" "status=blocked" "AutopilotEngine keeps plain no-op result blocked"
assert_contains "$OUT" "phase=dispatch_implementation" "AutopilotEngine preserves ordinary no-op dispatch phase"
assert_contains "$OUT" "reason=implementation status no_op" "AutopilotEngine keeps ordinary no-op reason"
assert_contains "$OUT" "dispatch_implementation:no_op" "AutopilotEngine leaves ordinary no-op as no_op dispatch status"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/split-brain-repo" "$TEST_TMP/split-brain-result.json" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = process.argv[2];
const repoBase = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));
const { execFileSync } = require('child_process');

const repo = path.join(repoBase, 'repo');
const prompt = path.join(repoBase, 'prompt.txt');
fs.mkdirSync(repo, { recursive: true });
fs.writeFileSync(prompt, 'implementer prompt for split-brain');
execFileSync('git', ['init'], { cwd: repo });
execFileSync('git', ['config', 'user.email', 'autopilot@example.test'], { cwd: repo });
execFileSync('git', ['config', 'user.name', 'Autopilot Test'], { cwd: repo });
fs.writeFileSync(path.join(repo, 'file.txt'), 'base\n', 'utf8');
execFileSync('git', ['add', 'file.txt'], { cwd: repo });
execFileSync('git', ['commit', '-m', 'base'], { cwd: repo, stdio: 'ignore' });

const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const branch = 'sb-loop';
execFileSync('git', ['checkout', '-b', branch], { cwd: repo });

const runId = 'autopilot-r2-split-brain-run-id';
const ledger = path.join(repo, '.autopilot', 'run-ledger.jsonl');
const runLedger = (...args) => {
  const output = execFileSync('bash', [path.join(root, 'scripts', 'run-ledger.sh'), ...args], {
    encoding: 'utf8',
  });
  return JSON.parse(output.trim().split('\n').pop());
};

execFileSync('bash', [path.join(root, 'scripts', 'run-ledger.sh'), 'init', '--ledger', ledger]);

let implementationCalls = 0;
let reviewCalls = 0;
let committedCommit = null;

const engine = new AutopilotEngine({
  implementationDispatcher() {
    implementationCalls += 1;
    fs.appendFileSync(path.join(repo, 'file.txt'), `updated ${implementationCalls}\n`, 'utf8');
    execFileSync('git', ['add', 'file.txt'], { cwd: repo });
    execFileSync('git', ['commit', '-m', `split-brain ${implementationCalls}`], { cwd: repo, stdio: 'ignore' });
    committedCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();

    const acquired = runLedger(
      'stage-acquire',
      '--ledger', ledger,
      '--run-id', runId,
      '--stage', 'implement',
      '--git-ref', branch,
      '--git-sha', committedCommit,
      '--worktree', repo,
    );
    runLedger(
      'stage-transition',
      '--ledger', ledger,
      '--run-id', runId,
      '--stage', 'implement',
      '--generation', String(acquired.generation),
      '--nonce', acquired.nonce,
      '--to-state', 'committed',
      '--idempotency-key', `${runId}-impl`,
      '--git-ref', branch,
      '--git-sha', committedCommit,
      '--worktree', repo,
    );

    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: new Error('simulated missing implementation result json'),
      result: null,
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
        verdict: 'SHIP-AS-IS',
        findings: '',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
  diffProvider() {
    const diffDir = fs.mkdtempSync(path.join(os.tmpdir(), `autopilot-r2-split-brain-${branch}-`));
    const file = path.join(diffDir, 'range.diff');
    fs.writeFileSync(file, 'split-brain diff', 'utf8');
    return file;
  },
});

const result = engine.runImplementationReviewLoop({
  promptFile: prompt,
  branch,
  base,
  runId,
  ledger,
  implementationStage: 'implement',
  resultJson: path.join(repo, '.autopilot', 'implementer-result.json'),
  gitDir: repo,
  roster: {
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
});

console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`rounds=${result.rounds}`);
console.log(`implementation_calls=${result.implementationChain.length}`);
console.log(`review_calls=${result.reviewChain.length}`);
console.log(`reconciled=${result.implementationChain[0].implementation && result.implementationChain[0].implementation.reconcile_by_ledger}`);
console.log(`dispatch_row=${result.ledger.find((entry) => entry.unit === 'dispatch_implementation').status}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine reconciles implementation outcome from run-ledger when result json is missing"
assert_contains "$OUT" "status=converged" "AutopilotEngine split-brain path converges from ledger/git-truth"
assert_contains "$OUT" "phase=converged" "AutopilotEngine split-brain path does not block"
assert_contains "$OUT" "rounds=1" "AutopilotEngine split-brain path runs one round"
assert_contains "$OUT" "implementation_calls=1" "AutopilotEngine split-brain path does not re-dispatch implementation"
assert_contains "$OUT" "review_calls=1" "AutopilotEngine split-brain path dispatches a single review"
assert_contains "$OUT" "reconciled=true" "AutopilotEngine split-brain path reconciles from ledger"
assert_contains "$OUT" "dispatch_row=committed" "AutopilotEngine split-brain path reaches committed dispatch state from ledger"

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

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/verification-loop" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = process.argv[2];
const tmp = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.mkdirSync(tmp, { recursive: true });
const verifyScript = path.join(tmp, 'verify-sequence.sh');
fs.writeFileSync(verifyScript, [
  '#!/usr/bin/env bash',
  'seq_file="$1"',
  'counter_file="$2"',
  'count=0',
  'if [ -f "$counter_file" ]; then count="$(cat "$counter_file")"; fi',
  'count=$((count + 1))',
  'printf "%s\\n" "$count" > "$counter_file"',
  'result="$(sed -n "${count}p" "$seq_file")"',
  'if [ "$result" = "pass" ]; then exit 0; fi',
  'exit 1',
  '',
].join('\n'), 'utf8');
fs.chmodSync(verifyScript, 0o755);

const prompt = path.join(tmp, 'prompt.txt');
fs.writeFileSync(prompt, 'implementer prompt');
const commits = [
  '2222222222222222222222222222222222222222',
  '3333333333333333333333333333333333333333',
  '4444444444444444444444444444444444444444',
  '5555555555555555555555555555555555555555',
];
const roster = {
  reviewer_engine: 'test-review-model',
  reviewer_effort: 'xhigh',
  reviewer_runner: 'test-review-runner',
  reviewer_qualified: true,
  implementer_engine: 'test-impl-model',
  implementer_effort: 'high',
  implementer_runner: 'test-impl-runner',
  loop_max_rounds: 3,
  loop_convergence_verdict: 'SHIP-AS-IS',
};

function mockWorktreeHandlers(prefix) {
  return {
    gitWorktreeAdd({ round }) {
      const parent = fs.mkdtempSync(path.join(tmp, `${prefix || 'verify'}-${round || 0}-wt-`));
      const worktree = path.join(parent, 'wt');
      fs.mkdirSync(worktree, { recursive: true });
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        worktree,
        parent,
      };
    },
    gitWorktreeRemove({ worktree }) {
      fs.rmSync(worktree, { recursive: true, force: true });
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
      };
    },
  };
}

function runScenario(name, options) {
  const scenarioDir = path.join(tmp, name);
  fs.mkdirSync(scenarioDir, { recursive: true });
  const seqFile = path.join(scenarioDir, 'verify-seq.txt');
  const counterFile = path.join(scenarioDir, 'verify-count.txt');
  if (options.verifySequence) {
    fs.writeFileSync(seqFile, `${options.verifySequence.join('\n')}\n`, 'utf8');
  }

  const implCalls = [];
  const reviewCalls = [];
  const repairCalls = [];
  const branchForceCalls = [];
  const engine = new AutopilotEngine({
    cwd: scenarioDir,
    ...mockWorktreeHandlers(name),
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
          commit: commits[call - 1],
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
      reviewCalls.push(true);
      const call = reviewCalls.length;
      const verdict = options.reviewVerdicts[call - 1] || options.reviewVerdicts[options.reviewVerdicts.length - 1];
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
          verdict,
          findings: `finding-${name}-${call}`,
          raw_log: '/tmp/log',
          error: null,
        },
      };
    },
    diffProvider({ round }) {
      const diffDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-verify-loop-diff-'));
      const file = path.join(diffDir, `${name}-round-${round}.diff`);
      fs.writeFileSync(file, `round ${round}`, 'utf8');
      return file;
    },
    repairPromptWriter({ round }) {
      repairCalls.push(round);
      const file = path.join(scenarioDir, `repair-${round}.txt`);
      fs.writeFileSync(file, `repair ${round}`, 'utf8');
      return file;
    },
    gitBranchForce(args) {
      branchForceCalls.push(args);
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
      };
    },
  });

  const input = {
    promptFile: prompt,
    branch: `${name}-branch`,
    base: '1111111111111111111111111111111111111111',
    maxRounds: options.maxRounds || 3,
    roster,
  };
  if (options.verifySequence) {
    input.verifyCmd = `${verifyScript} ${seqFile} ${counterFile}`;
  }
  if (options.noVerifyFirst) {
    input.noVerifyFirst = true;
  }

  const result = engine.runImplementationReviewLoop(input);
  const verifyEntries = result.ledger.filter((entry) => entry.unit === 'verify_round');
  const ratchetSelectEntries = result.ledger.filter((entry) => entry.unit === 'ratchet_select');
  const ratchetEntries = result.ledger.filter((entry) => entry.ratchet_reverted === true);
  console.log(`${name}_status=${result.status}`);
  console.log(`${name}_rounds=${result.rounds}`);
  console.log(`${name}_reason=${result.convergence_reason === undefined ? 'absent' : result.convergence_reason}`);
  console.log(`${name}_commit=${result.commit === undefined ? 'absent' : result.commit}`);
  console.log(`${name}_impl_calls=${implCalls.length}`);
  console.log(`${name}_review_calls=${reviewCalls.length}`);
  console.log(`${name}_repair_calls=${repairCalls.length}`);
  console.log(`${name}_branch_force_calls=${branchForceCalls.length}`);
  console.log(`${name}_branch_force_branch=${branchForceCalls[0] ? branchForceCalls[0].branch : ''}`);
  console.log(`${name}_branch_force_to=${branchForceCalls[0] ? branchForceCalls[0].commit : ''}`);
  console.log(`${name}_ratchet_select_branch=${ratchetSelectEntries[0] ? ratchetSelectEntries[0].branch : ''}`);
  console.log(`${name}_advisory_count=${Array.isArray(result.advisory_findings) ? result.advisory_findings.length : 'absent'}`);
  console.log(`${name}_verify_passes=${verifyEntries.map((entry) => String(entry.verify_pass)).join(',')}`);
  console.log(`${name}_ratchet_reverted_rounds=${result.ratchet_reverted_rounds === undefined ? 'absent' : result.ratchet_reverted_rounds}`);
  console.log(`${name}_ratchet_entry_count=${ratchetEntries.length}`);
  console.log(`${name}_has_verify_field=${Object.prototype.hasOwnProperty.call(result, 'verify_cmd_provided')}`);
  console.log(`${name}_ledger_has_verify=${verifyEntries.length > 0}`);
}

function runTopLevelReviewFindingsScenario() {
  const scenarioDir = path.join(tmp, 'top_level_findings');
  fs.mkdirSync(scenarioDir, { recursive: true });
  const seqFile = path.join(scenarioDir, 'verify-seq.txt');
  const counterFile = path.join(scenarioDir, 'verify-count.txt');
  fs.writeFileSync(seqFile, 'pass\n', 'utf8');

  const engine = new AutopilotEngine({
    cwd: scenarioDir,
    ...mockWorktreeHandlers('top-level-findings'),
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
          commit: commits[0],
          files_changed: 1,
          insertions: 1,
          deletions: 0,
          worktree: null,
          agent_log: '/tmp/impl-log',
          error: null,
        },
      };
    },
    diffProvider({ round }) {
      const diffDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-verify-loop-diff-'));
      const file = path.join(diffDir, `top-level-findings-round-${round}.diff`);
      fs.writeFileSync(file, `round ${round}`, 'utf8');
      return file;
    },
  });

  let reviewCalls = 0;
  engine.reviewDiff = () => {
    reviewCalls += 1;
    return {
      status: 'reviewed',
      verdict: 'FIX-THEN-SHIP',
      findings: 'top-level finding',
      ledger: [],
    };
  };

  const result = engine.runImplementationReviewLoop({
    promptFile: prompt,
    branch: 'top-level-findings-branch',
    base: '1111111111111111111111111111111111111111',
    maxRounds: 3,
    roster,
    verifyCmd: `${verifyScript} ${seqFile} ${counterFile}`,
  });

  console.log(`top_level_findings_status=${result.status}`);
  console.log(`top_level_findings_review_calls=${reviewCalls}`);
  console.log(`top_level_findings_advisory_count=${Array.isArray(result.advisory_findings) ? result.advisory_findings.length : 'absent'}`);
  console.log(`top_level_findings_advisory_0=${result.advisory_findings && result.advisory_findings[0]}`);
}

runScenario('no_verify', {
  reviewVerdicts: ['SHIP-AS-IS'],
  maxRounds: 1,
});
runScenario('verify_first_advisory', {
  verifySequence: ['pass'],
  reviewVerdicts: ['FIX-THEN-SHIP'],
  maxRounds: 3,
});
runScenario('repair_passes', {
  verifySequence: ['fail', 'pass'],
  reviewVerdicts: ['FIX-THEN-SHIP', 'FIX-THEN-SHIP'],
  maxRounds: 3,
});
runScenario('fail_tie_continues', {
  verifySequence: ['fail', 'fail', 'fail'],
  reviewVerdicts: ['FIX-THEN-SHIP', 'FIX-THEN-SHIP', 'FIX-THEN-SHIP'],
  maxRounds: 3,
});
runScenario('ratchet', {
  verifySequence: ['pass', 'fail', 'pass'],
  reviewVerdicts: ['FIX-THEN-SHIP', 'FIX-THEN-SHIP', 'FIX-THEN-SHIP'],
  noVerifyFirst: true,
  maxRounds: 3,
});
runScenario('no_verify_first', {
  verifySequence: ['pass', 'pass'],
  reviewVerdicts: ['FIX-THEN-SHIP', 'SHIP-AS-IS'],
  noVerifyFirst: true,
  maxRounds: 3,
});
runTopLevelReviewFindingsScenario();
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine verification-anchored loop scenarios exit 0"
assert_contains "$OUT" "no_verify_status=converged" "AutopilotEngine no-verify scenario preserves reviewer convergence"
assert_contains "$OUT" "no_verify_reason=absent" "AutopilotEngine omits convergence_reason without verify-cmd"
assert_contains "$OUT" "no_verify_has_verify_field=false" "AutopilotEngine omits verify-cmd result field without verify-cmd"
assert_contains "$OUT" "no_verify_ledger_has_verify=false" "AutopilotEngine omits verify ledger without verify-cmd"
assert_contains "$OUT" "verify_first_advisory_status=converged" "AutopilotEngine verify-first pass converges despite reviewer fix verdict"
assert_contains "$OUT" "verify_first_advisory_reason=verification" "AutopilotEngine records verification convergence reason"
assert_contains "$OUT" "verify_first_advisory_rounds=1" "AutopilotEngine verify-first pass stops after round one"
assert_contains "$OUT" "verify_first_advisory_advisory_count=1" "AutopilotEngine records reviewer findings as advisory after verified pass"
assert_contains "$OUT" "verify_first_advisory_impl_calls=1" "AutopilotEngine does not dispatch a repair after verified pass"
assert_contains "$OUT" "verify_first_advisory_review_calls=1" "AutopilotEngine still dispatches one advisory review after verified pass"
assert_contains "$OUT" "verify_first_advisory_verify_passes=true" "AutopilotEngine records round-one verify pass"
assert_contains "$OUT" "repair_passes_status=converged" "AutopilotEngine converges when repair round verification passes"
assert_contains "$OUT" "repair_passes_reason=verification" "AutopilotEngine repair pass records verification convergence"
assert_contains "$OUT" "repair_passes_rounds=2" "AutopilotEngine repair pass returns second round"
assert_contains "$OUT" "repair_passes_verify_passes=false,true" "AutopilotEngine records failed then passing verification"
assert_contains "$OUT" "fail_tie_continues_status=non_converged" "AutopilotEngine continues fail-fail ties to max rounds"
assert_contains "$OUT" "fail_tie_continues_rounds=3" "AutopilotEngine fail-fail tie reaches max rounds"
assert_contains "$OUT" "fail_tie_continues_impl_calls=3" "AutopilotEngine dispatches repairs while verification keeps failing without regression"
assert_contains "$OUT" "fail_tie_continues_branch_force_calls=0" "AutopilotEngine does not ratchet-select fail-fail ties"
assert_contains "$OUT" "ratchet_status=non_converged" "AutopilotEngine ratchet scenario remains review-gated under no-verify-first"
assert_contains "$OUT" "ratchet_commit=4444444444444444444444444444444444444444" "AutopilotEngine final commit reports best verified repair commit"
assert_contains "$OUT" "ratchet_branch_force_calls=1" "AutopilotEngine branch-selects after pass-to-fail regression"
assert_contains "$OUT" "ratchet_branch_force_branch=ratchet-branch-repair-r2-2222222" "AutopilotEngine ratchet branch update targets the current repair branch"
assert_contains "$OUT" "ratchet_branch_force_to=2222222222222222222222222222222222222222" "AutopilotEngine ratchet branch update targets best commit"
assert_contains "$OUT" "ratchet_ratchet_select_branch=ratchet-branch-repair-r2-2222222" "AutopilotEngine ratchet ledger records the current repair branch"
assert_contains "$OUT" "ratchet_ratchet_reverted_rounds=1" "AutopilotEngine counts ratchet-reverted rounds"
assert_contains "$OUT" "ratchet_ratchet_entry_count=1" "AutopilotEngine records reverted round in ledger"
assert_contains "$OUT" "no_verify_first_status=converged" "AutopilotEngine no-verify-first restores reviewer-gated convergence"
assert_contains "$OUT" "no_verify_first_reason=reviewer" "AutopilotEngine no-verify-first records reviewer convergence"
assert_contains "$OUT" "no_verify_first_rounds=2" "AutopilotEngine no-verify-first repairs after verified pass until reviewer ships"
assert_contains "$OUT" "no_verify_first_impl_calls=2" "AutopilotEngine no-verify-first dispatches repair after reviewer fix verdict"
assert_contains "$OUT" "no_verify_first_verify_passes=true,true" "AutopilotEngine no-verify-first still records per-round verification"
assert_contains "$OUT" "top_level_findings_status=converged" "AutopilotEngine converges with top-level review findings on verified pass"
assert_contains "$OUT" "top_level_findings_review_calls=1" "AutopilotEngine dispatches one top-level-shape advisory review"
assert_contains "$OUT" "top_level_findings_advisory_count=1" "AutopilotEngine records top-level review findings as advisory"
assert_contains "$OUT" "top_level_findings_advisory_0=top-level finding" "AutopilotEngine preserves top-level advisory finding text"

REAL_GIT="$(command -v git)"
OUT="$(node - "$REPO_ROOT" "$TEST_TMP/verify-worktree-regression" "$REAL_GIT" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.argv[2];
const tmp = process.argv[3];
const realGit = process.argv[4];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    shell: false,
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : result.stderr;
    throw new Error(`${cmd} ${args.join(' ')} failed: ${detail}`);
  }
  return result.stdout.trim();
}

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo, { recursive: true });
run(realGit, ['init', '-q'], { cwd: repo });
run(realGit, ['config', 'user.email', 'engine-test@example.invalid'], { cwd: repo });
run(realGit, ['config', 'user.name', 'Engine Test'], { cwd: repo });
fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n', 'utf8');
fs.writeFileSync(path.join(repo, 'sentinel.txt'), 'main checkout sentinel\n', 'utf8');
run(realGit, ['add', 'base.txt', 'sentinel.txt'], { cwd: repo });
run(realGit, ['commit', '-q', '-m', 'base'], { cwd: repo });
const base = run(realGit, ['rev-parse', 'HEAD'], { cwd: repo });

const binDir = path.join(tmp, 'bin');
fs.mkdirSync(binDir, { recursive: true });
const gitLog = path.join(tmp, 'git.log');
const gitShim = path.join(binDir, 'git');
fs.writeFileSync(gitShim, [
  '#!/usr/bin/env bash',
  `log=${JSON.stringify(gitLog)}`,
  `real_git=${JSON.stringify(realGit)}`,
  'printf "%s|git" "$PWD" >> "$log"',
  'for arg in "$@"; do printf " %q" "$arg" >> "$log"; done',
  'printf "\\n" >> "$log"',
  'exec "$real_git" "$@"',
  '',
].join('\n'), 'utf8');
fs.chmodSync(gitShim, 0o755);
process.env.PATH = `${binDir}:${process.env.PATH}`;

const prompt = path.join(tmp, 'prompt.txt');
fs.writeFileSync(prompt, 'implementer prompt', 'utf8');
const verifyScript = path.join(tmp, 'verify-round-file.sh');
fs.writeFileSync(verifyScript, [
  '#!/usr/bin/env bash',
  'test -f round-only.txt || exit 1',
  'test ! -f fail-marker.txt',
  '',
].join('\n'), 'utf8');
fs.chmodSync(verifyScript, 0o755);

const roster = {
  reviewer_engine: 'test-review-model',
  reviewer_effort: 'xhigh',
  reviewer_runner: 'test-review-runner',
  reviewer_qualified: true,
  implementer_engine: 'test-impl-model',
  implementer_effort: 'high',
  implementer_runner: 'test-impl-runner',
  loop_max_rounds: 2,
  loop_convergence_verdict: 'SHIP-AS-IS',
};

const commits = [];
let implementationCalls = 0;
const engine = new AutopilotEngine({
  cwd: repo,
  implementationDispatcher(args) {
    implementationCalls += 1;
    const branch = args[args.indexOf('--branch') + 1];
    const roundBase = args[args.indexOf('--base') + 1];
    const parent = fs.mkdtempSync(path.join(tmp, 'impl-wt-'));
    const worktree = path.join(parent, 'wt');
    try {
      run('git', ['worktree', 'add', '--detach', '-q', worktree, roundBase], { cwd: repo });
      fs.writeFileSync(path.join(worktree, 'round-only.txt'), `round ${implementationCalls}\n`, 'utf8');
      if (implementationCalls === 2) {
        fs.writeFileSync(path.join(worktree, 'fail-marker.txt'), 'regression\n', 'utf8');
      }
      run('git', ['add', 'round-only.txt'], { cwd: worktree });
      if (implementationCalls === 2) {
        run('git', ['add', 'fail-marker.txt'], { cwd: worktree });
      }
      run('git', ['commit', '-q', '-m', `round ${implementationCalls}`], { cwd: worktree });
      const commit = run('git', ['rev-parse', 'HEAD'], { cwd: worktree });
      run('git', ['branch', '-f', branch, commit], { cwd: repo });
      commits.push(commit);
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
          branch,
          base: roundBase,
          commit,
          files_changed: 1,
          insertions: 1,
          deletions: 0,
          worktree: null,
          agent_log: '/tmp/impl-log',
          error: null,
        },
      };
    } finally {
      run('git', ['worktree', 'remove', '--force', worktree], { cwd: repo });
      fs.rmSync(parent, { recursive: true, force: true });
    }
  },
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
        status: 'reviewed',
        verdict: 'FIX-THEN-SHIP',
        findings: 'keep repairing',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
  diffProvider({ round }) {
    const file = path.join(tmp, `round-${round}.diff`);
    fs.writeFileSync(file, `round ${round}`, 'utf8');
    return file;
  },
  repairPromptWriter({ round }) {
    const file = path.join(tmp, `repair-${round}.txt`);
    fs.writeFileSync(file, `repair ${round}`, 'utf8');
    return file;
  },
});

const beforeWorktrees = run('git', ['worktree', 'list', '--porcelain'], { cwd: repo }).split('\n').filter((line) => line.startsWith('worktree ')).length;
const result = engine.runImplementationReviewLoop({
  promptFile: prompt,
  branch: 'unit-verify-regression',
  base,
  maxRounds: 2,
  roster,
  verifyCmd: verifyScript,
  noVerifyFirst: true,
});
const afterWorktrees = run('git', ['worktree', 'list', '--porcelain'], { cwd: repo }).split('\n').filter((line) => line.startsWith('worktree ')).length;
const log = fs.readFileSync(gitLog, 'utf8');
const logLines = log.split('\n').filter(Boolean);
const mainSentinel = fs.readFileSync(path.join(repo, 'sentinel.txt'), 'utf8').trim();
const mainHasRoundOnly = fs.existsSync(path.join(repo, 'round-only.txt'));
const mainHead = run('git', ['rev-parse', 'HEAD'], { cwd: repo });
const status = run('git', ['status', '--short'], { cwd: repo });
const verifyEntries = result.ledger.filter((entry) => entry.unit === 'verify_round');
const ratchetSelectEntries = result.ledger.filter((entry) => entry.unit === 'ratchet_select');
const verifyWorktreeAdds = logLines.filter((line) => line.includes('|git worktree add ') && line.includes('/autopilot-verify-wt-'));
const verifyWorktreeRemoves = logLines.filter((line) => line.includes('|git worktree remove ') && line.includes('/autopilot-verify-wt-'));
const allWorktreeAdds = logLines.filter((line) => line.includes('|git worktree add '));
const allWorktreeRemoves = logLines.filter((line) => line.includes('|git worktree remove '));
const resetHardCalls = logLines.filter((line) => line.includes('|git reset --hard'));

console.log(`worktree_regression_status=${result.status}`);
console.log(`worktree_regression_commit=${result.commit}`);
console.log(`worktree_regression_best_commit=${commits[0]}`);
console.log(`worktree_regression_commit_is_best=${result.commit === commits[0]}`);
console.log(`worktree_regression_verify_passes=${verifyEntries.map((entry) => String(entry.verify_pass)).join(',')}`);
console.log(`worktree_regression_ratchet_rounds=${result.ratchet_reverted_rounds}`);
console.log(`worktree_regression_ratchet_select_statuses=${ratchetSelectEntries.map((entry) => entry.status).join(',')}`);
console.log(`worktree_regression_ratchet_selected_best=${ratchetSelectEntries.length === 1 && ratchetSelectEntries[0].selected_commit === commits[0]}`);
console.log(`worktree_regression_main_sentinel=${mainSentinel}`);
console.log(`worktree_regression_main_has_round_only=${mainHasRoundOnly}`);
console.log(`worktree_regression_main_head_unchanged=${mainHead === base}`);
console.log(`worktree_regression_status_clean=${status === ''}`);
console.log(`worktree_regression_worktree_count_delta=${afterWorktrees - beforeWorktrees}`);
console.log(`worktree_regression_worktree_adds=${allWorktreeAdds.length}`);
console.log(`worktree_regression_worktree_removes=${allWorktreeRemoves.length}`);
console.log(`worktree_regression_verify_worktree_adds=${verifyWorktreeAdds.length}`);
console.log(`worktree_regression_verify_worktree_removes=${verifyWorktreeRemoves.length}`);
console.log(`worktree_regression_verify_adds_from_repo=${verifyWorktreeAdds.every((line) => line.startsWith(`${repo}|git worktree add `))}`);
console.log(`worktree_regression_verify_removes_from_repo=${verifyWorktreeRemoves.every((line) => line.startsWith(`${repo}|git worktree remove `))}`);
console.log(`worktree_regression_reset_hard_calls=${resetHardCalls.length}`);
console.log(`worktree_regression_branch_force_best=${log.includes(`|git branch -f unit-verify-regression ${commits[0]}`)}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine real verify worktree regression scenario exits 0"
assert_contains "$OUT" "worktree_regression_status=non_converged" "AutopilotEngine keeps reviewer-gated status under no-verify-first"
assert_contains "$OUT" "worktree_regression_verify_passes=true,false" "AutopilotEngine runs verify-cmd in each round commit worktree"
assert_contains "$OUT" "worktree_regression_commit_is_best=true" "AutopilotEngine final result commit selects the best verified commit"
assert_contains "$OUT" "worktree_regression_ratchet_rounds=1" "AutopilotEngine ratchets pass-to-fail regression by selection"
assert_contains "$OUT" "worktree_regression_ratchet_select_statuses=selected" "AutopilotEngine records branch-selection ratchet status"
assert_contains "$OUT" "worktree_regression_ratchet_selected_best=true" "AutopilotEngine ratchet ledger selects the best verified commit"
assert_contains "$OUT" "worktree_regression_main_sentinel=main checkout sentinel" "AutopilotEngine leaves main checkout sentinel unchanged"
assert_contains "$OUT" "worktree_regression_main_has_round_only=false" "AutopilotEngine does not verify by mutating the main checkout"
assert_contains "$OUT" "worktree_regression_main_head_unchanged=true" "AutopilotEngine does not move the invoking checkout HEAD"
assert_contains "$OUT" "worktree_regression_status_clean=true" "AutopilotEngine leaves the invoking checkout clean"
assert_contains "$OUT" "worktree_regression_worktree_count_delta=0" "AutopilotEngine cleans up temp verify worktrees"
assert_contains "$OUT" "worktree_regression_verify_worktree_adds=2" "AutopilotEngine creates one temp verify worktree per round"
assert_contains "$OUT" "worktree_regression_verify_worktree_removes=2" "AutopilotEngine removes every temp verify worktree"
assert_contains "$OUT" "worktree_regression_verify_adds_from_repo=true" "AutopilotEngine creates verify worktrees from the repo cwd"
assert_contains "$OUT" "worktree_regression_verify_removes_from_repo=true" "AutopilotEngine removes verify worktrees from the repo cwd"
assert_contains "$OUT" "worktree_regression_reset_hard_calls=0" "AutopilotEngine never runs git reset --hard"
assert_contains "$OUT" "worktree_regression_branch_force_best=true" "AutopilotEngine branch-selects the best verified commit"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/verify-worktree-add-fail" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const tmp = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const osTmp = path.join(tmp, 'os-tmp');
fs.mkdirSync(osTmp, { recursive: true });
process.env.TMPDIR = osTmp;
const binDir = path.join(tmp, 'bin');
fs.mkdirSync(binDir, { recursive: true });
const gitShim = path.join(binDir, 'git');
fs.writeFileSync(gitShim, [
  '#!/usr/bin/env bash',
  'if [ "$1" = "worktree" ] && [ "$2" = "add" ]; then',
  '  mkdir -p "$5/partial"',
  '  printf "simulated worktree add failure\\n" >&2',
  '  exit 73',
  'fi',
  'printf "unexpected git call: %s\\n" "$*" >&2',
  'exit 99',
  '',
].join('\n'), 'utf8');
fs.chmodSync(gitShim, 0o755);
process.env.PATH = `${binDir}:${process.env.PATH}`;

const scenarioDir = path.join(tmp, 'repo');
fs.mkdirSync(scenarioDir, { recursive: true });
const prompt = path.join(tmp, 'prompt.txt');
fs.writeFileSync(prompt, 'implementer prompt', 'utf8');
const roster = {
  reviewer_engine: 'test-review-model',
  reviewer_effort: 'xhigh',
  reviewer_runner: 'test-review-runner',
  reviewer_qualified: true,
  implementer_engine: 'test-impl-model',
  implementer_effort: 'high',
  implementer_runner: 'test-impl-runner',
  loop_max_rounds: 1,
  loop_convergence_verdict: 'SHIP-AS-IS',
};
const engine = new AutopilotEngine({
  cwd: scenarioDir,
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
        branch: 'add-fail-branch',
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
  reviewDispatcher() {
    throw new Error('review should not run after verify worktree add failure');
  },
  diffProvider({ round }) {
    const file = path.join(tmp, `round-${round}.diff`);
    fs.writeFileSync(file, `round ${round}`, 'utf8');
    return file;
  },
});

const result = engine.runImplementationReviewLoop({
  promptFile: prompt,
  branch: 'add-fail-branch',
  base: '1111111111111111111111111111111111111111',
  maxRounds: 1,
  roster,
  verifyCmd: 'true',
});
const verifyEntry = result.ledger.find((entry) => entry.unit === 'verify_round');
const strayDirs = fs.readdirSync(osTmp).filter((name) => name.startsWith('autopilot-verify-wt-'));

console.log(`worktree_add_fail_status=${result.status}`);
console.log(`worktree_add_fail_setup_exit=${verifyEntry && verifyEntry.setup_exit_status}`);
console.log(`worktree_add_fail_blocked_reason=${verifyEntry && verifyEntry.blocked_reason}`);
console.log(`worktree_add_fail_stray_count=${strayDirs.length}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine verify worktree add-failure cleanup test exits 0"
assert_contains "$OUT" "worktree_add_fail_status=blocked" "AutopilotEngine blocks when verify worktree add fails"
assert_contains "$OUT" "worktree_add_fail_setup_exit=73" "AutopilotEngine records worktree add failure status"
assert_contains "$OUT" "worktree_add_fail_blocked_reason=git worktree command exited with status 73" "AutopilotEngine surfaces worktree add failure reason"
assert_contains "$OUT" "worktree_add_fail_stray_count=0" "AutopilotEngine removes failed verify worktree mkdtemp parent"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/verify-worktree-remove-fail" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const tmp = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const scenarioDir = path.join(tmp, 'repo');
fs.mkdirSync(scenarioDir, { recursive: true });
const prompt = path.join(tmp, 'prompt.txt');
fs.writeFileSync(prompt, 'implementer prompt', 'utf8');
const roster = {
  reviewer_engine: 'test-review-model',
  reviewer_effort: 'xhigh',
  reviewer_runner: 'test-review-runner',
  reviewer_qualified: true,
  implementer_engine: 'test-impl-model',
  implementer_effort: 'high',
  implementer_runner: 'test-impl-runner',
  loop_max_rounds: 1,
  loop_convergence_verdict: 'SHIP-AS-IS',
};
let parent = null;
let worktree = null;
let removeCalls = 0;
const engine = new AutopilotEngine({
  cwd: scenarioDir,
  gitWorktreeAdd({ round }) {
    parent = fs.mkdtempSync(path.join(tmp, `remove-fail-${round}-wt-`));
    worktree = path.join(parent, 'wt');
    fs.mkdirSync(worktree, { recursive: true });
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      worktree,
      parent,
    };
  },
  gitWorktreeRemove() {
    removeCalls += 1;
    return {
      error: null,
      status: 81,
      signal: null,
      stdout: '',
      stderr: 'simulated remove failure',
    };
  },
  verifyCommandRunner() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
    };
  },
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
        branch: 'remove-fail-branch',
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
        status: 'reviewed',
        verdict: 'SHIP-AS-IS',
        findings: '',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
  diffProvider({ round }) {
    const file = path.join(tmp, `round-${round}.diff`);
    fs.writeFileSync(file, `round ${round}`, 'utf8');
    return file;
  },
});

const result = engine.runImplementationReviewLoop({
  promptFile: prompt,
  branch: 'remove-fail-branch',
  base: '1111111111111111111111111111111111111111',
  maxRounds: 1,
  roster,
  verifyCmd: 'true',
});
const verifyEntry = result.ledger.find((entry) => entry.unit === 'verify_round');

console.log(`worktree_remove_fail_status=${result.status}`);
console.log(`worktree_remove_fail_cleanup_exit=${verifyEntry && verifyEntry.cleanup_exit_status}`);
console.log(`worktree_remove_fail_warning=${verifyEntry && verifyEntry.verify_cleanup_warning}`);
console.log(`worktree_remove_fail_warning_present=${Boolean(verifyEntry && verifyEntry.verify_cleanup_warning)}`);
console.log(`worktree_remove_fail_remove_calls=${removeCalls}`);
console.log(`worktree_remove_fail_worktree_exists=${fs.existsSync(worktree)}`);
console.log(`worktree_remove_fail_parent_exists=${fs.existsSync(parent)}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine verify worktree remove-failure warning test exits 0"
assert_contains "$OUT" "worktree_remove_fail_status=converged" "AutopilotEngine completes despite verify worktree remove failure"
assert_contains "$OUT" "worktree_remove_fail_cleanup_exit=81" "AutopilotEngine records worktree remove failure status"
assert_contains "$OUT" "worktree_remove_fail_warning=git worktree command exited with status 81" "AutopilotEngine records verify cleanup warning in ledger"
assert_contains "$OUT" "worktree_remove_fail_warning_present=true" "AutopilotEngine exposes verify cleanup warning"
assert_contains "$OUT" "worktree_remove_fail_remove_calls=1" "AutopilotEngine attempts git worktree remove"
assert_contains "$OUT" "worktree_remove_fail_worktree_exists=false" "AutopilotEngine force-removes worktree path after remove failure"
assert_contains "$OUT" "worktree_remove_fail_parent_exists=false" "AutopilotEngine removes verify worktree parent after remove failure"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/verify-first-signal" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = process.argv[2];
const tmp = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.mkdirSync(tmp, { recursive: true });
const prompt = path.join(tmp, 'prompt.txt');
fs.writeFileSync(prompt, 'implementer prompt');

function mockWorktreeHandlers(prefix) {
  return {
    gitWorktreeAdd({ round }) {
      const parent = fs.mkdtempSync(path.join(tmp, `${prefix || 'verify'}-${round || 0}-wt-`));
      const worktree = path.join(parent, 'wt');
      fs.mkdirSync(worktree, { recursive: true });
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        worktree,
        parent,
      };
    },
    gitWorktreeRemove({ worktree }) {
      fs.rmSync(worktree, { recursive: true, force: true });
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
      };
    },
  };
}

function runSignalScenario(name, options) {
  const scenarioDir = path.join(tmp, name);
  fs.mkdirSync(scenarioDir, { recursive: true });
  const resolverRoster = {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'xhigh',
    reviewer_runner: 'test-review-runner',
    reviewer_qualified: true,
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
    loop_max_rounds: 1,
    loop_convergence_verdict: 'SHIP-AS-IS',
  };
  if (options.verifyFirst === true) {
    resolverRoster.verify_first = true;
  }

  let implementationCalls = 0;
  let reviewCalls = 0;
  let verifyCalls = 0;
  const engine = new AutopilotEngine({
    cwd: scenarioDir,
    ...mockWorktreeHandlers(name),
    reviewLoopResolver() {
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        parseError: null,
        result: resolverRoster,
      };
    },
    implementationDispatcher(args) {
      implementationCalls += 1;
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
          verdict: 'SHIP-AS-IS',
          findings: '',
          raw_log: '/tmp/log',
          error: null,
        },
      };
    },
    diffProvider({ round }) {
      const diffDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-verify-first-signal-'));
      const file = path.join(diffDir, `${name}-round-${round}.diff`);
      fs.writeFileSync(file, `round ${round}`, 'utf8');
      return file;
    },
    verifyCommandRunner() {
      verifyCalls += 1;
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
      };
    },
  });

  const input = {
    promptFile: prompt,
    branch: `${name}-branch`,
    base: '1111111111111111111111111111111111111111',
  };
  if (options.verifyCmd) {
    input.verifyCmd = 'true';
  }

  const result = engine.runImplementationReviewLoop(input);
  const signalEntries = result.ledger.filter((entry) => entry.unit === 'verify_first_signal');
  console.log(`${name}_status=${result.status}`);
  console.log(`${name}_unused_key=${Object.prototype.hasOwnProperty.call(result, 'verify_first_signal_unused') ? result.verify_first_signal_unused : 'absent'}`);
  console.log(`${name}_signal_entries=${signalEntries.map((entry) => `${entry.unit}:${entry.status}`).join(',') || 'absent'}`);
  console.log(`${name}_implementation_calls=${implementationCalls}`);
  console.log(`${name}_review_calls=${reviewCalls}`);
  console.log(`${name}_verify_calls=${verifyCalls}`);
}

runSignalScenario('verify_first_without_cmd', { verifyFirst: true });
runSignalScenario('verify_first_with_cmd', { verifyFirst: true, verifyCmd: true });
runSignalScenario('no_verify_first_key', {});
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine verify_first unused-signal scenarios exit 0"
assert_contains "$OUT" "verify_first_without_cmd_status=converged" "AutopilotEngine verify_first without verify-cmd preserves loop convergence"
assert_contains "$OUT" "verify_first_without_cmd_unused_key=true" "AutopilotEngine reports unused verify_first signal without verify-cmd"
assert_contains "$OUT" "verify_first_without_cmd_signal_entries=verify_first_signal:unused" "AutopilotEngine records unused verify_first signal in ledger"
assert_contains "$OUT" "verify_first_without_cmd_implementation_calls=1" "AutopilotEngine verify_first unused-signal path still dispatches implementation once"
assert_contains "$OUT" "verify_first_without_cmd_review_calls=1" "AutopilotEngine verify_first unused-signal path still dispatches review once"
assert_contains "$OUT" "verify_first_without_cmd_verify_calls=0" "AutopilotEngine verify_first unused-signal path does not invent verification"
assert_contains "$OUT" "verify_first_with_cmd_unused_key=absent" "AutopilotEngine omits unused signal when verify-cmd is provided"
assert_contains "$OUT" "verify_first_with_cmd_signal_entries=absent" "AutopilotEngine omits unused signal ledger when verify-cmd is provided"
assert_contains "$OUT" "verify_first_with_cmd_verify_calls=1" "AutopilotEngine still runs provided verify-cmd"
assert_contains "$OUT" "no_verify_first_key_unused_key=absent" "AutopilotEngine omits unused signal when roster has no verify_first key"
assert_contains "$OUT" "no_verify_first_key_signal_entries=absent" "AutopilotEngine omits unused signal ledger when roster has no verify_first key"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { validateReviewLoopConfig } = require(path.join(root, 'src', 'engine', 'resolve-review-loop'));

const validPayload = {
  reviewer_engine: 'test-review-model',
  reviewer_effort: 'high',
  reviewer_runner: 'codex',
  implementer_engine: 'test-impl-model',
  implementer_effort: 'high',
  implementer_runner: 'auto',
  loop_max_rounds: 3,
  loop_convergence_verdict: 'SHIP-AS-IS',
  spec_review: 'on',
  independent_harness: 'off',
  qc_panel: ['test-reviewer'],
  qc_panel_aggregation: 'union-on-verified-critical',
  review_risk: 'low',
  required_review_families: 1,
  l1_required: false,
  cross_family_required: false,
  cross_family_satisfied: true,
  review_diff_scope: 'full',
  source: 'override',
  work_domain: 'mixed',
  domain_source: 'none',
  // Eight new fields
  capability_state_source: 'unknown',
  quota_status: 'ok',
  quota_reset_at: null,
  skill_mode_requested: 'selective',
  skill_mode_effective: 'selective',
  capability_warnings: ['warning 1'],
  reviewer_endpoint: '',
  implementer_endpoint: '',
  min_panel_size: 3,
  on_engine_unavailable: 'ask',
};

try {
  const validated = validateReviewLoopConfig(validPayload);
  console.log(`validated=true`);
  console.log(`capability_state_source=${validated.capability_state_source}`);
  console.log(`quota_status=${validated.quota_status}`);
  console.log(`quota_reset_at=${validated.quota_reset_at}`);
  console.log(`skill_mode_requested=${validated.skill_mode_requested}`);
  console.log(`skill_mode_effective=${validated.skill_mode_effective}`);
  console.log(`capability_warnings_0=${validated.capability_warnings[0]}`);
  console.log(`reviewer_endpoint=${validated.reviewer_endpoint}`);
  console.log(`implementer_endpoint=${validated.implementer_endpoint}`);
} catch (err) {
  console.log(`error=${err.message}`);
}

const payloadWithResetString = {
  ...validPayload,
  quota_reset_at: '2026-07-04T00:00:00Z',
  reviewer_endpoint: 'http://reviewer',
  implementer_endpoint: 'http://implementer',
};
try {
  const validated2 = validateReviewLoopConfig(payloadWithResetString);
  console.log(`validated2=true`);
  console.log(`quota_reset_at2=${validated2.quota_reset_at}`);
  console.log(`reviewer_endpoint2=${validated2.reviewer_endpoint}`);
  console.log(`implementer_endpoint2=${validated2.implementer_endpoint}`);
} catch (err) {
  console.log(`error2=${err.message}`);
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "validateReviewLoopConfig validates new fields process exits 0"
assert_contains "$OUT" "validated=true" "validateReviewLoopConfig validates payload with new fields"
assert_contains "$OUT" "capability_state_source=unknown" "validateReviewLoopConfig carries capability_state_source"
assert_contains "$OUT" "quota_status=ok" "validateReviewLoopConfig carries quota_status"
assert_contains "$OUT" "quota_reset_at=null" "validateReviewLoopConfig carries quota_reset_at"
assert_contains "$OUT" "skill_mode_requested=selective" "validateReviewLoopConfig carries skill_mode_requested"
assert_contains "$OUT" "skill_mode_effective=selective" "validateReviewLoopConfig carries skill_mode_effective"
assert_contains "$OUT" "capability_warnings_0=warning 1" "validateReviewLoopConfig carries capability_warnings"
assert_contains "$OUT" "reviewer_endpoint=" "validateReviewLoopConfig carries empty reviewer_endpoint"
assert_contains "$OUT" "implementer_endpoint=" "validateReviewLoopConfig carries empty implementer_endpoint"
assert_contains "$OUT" "validated2=true" "validateReviewLoopConfig validates payload with string quota_reset_at"
assert_contains "$OUT" "quota_reset_at2=2026-07-04T00:00:00Z" "validateReviewLoopConfig carries string quota_reset_at"
assert_contains "$OUT" "reviewer_endpoint2=http://reviewer" "validateReviewLoopConfig carries string reviewer_endpoint"
assert_contains "$OUT" "implementer_endpoint2=http://implementer" "validateReviewLoopConfig carries string implementer_endpoint"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { buildReviewArgs } = require(path.join(root, 'src', 'engine'));

const argsWithSpec = buildReviewArgs({
  diffFile: 'relative-diff.diff',
  specFile: 'some-spec.md',
  roster: {
    reviewer_engine: 'test-rev-model',
    reviewer_effort: 'high',
    reviewer_runner: 'test-rev-runner',
  },
});
console.log(`args_with_spec=${argsWithSpec.join(' ')}`);

const argsWithoutSpec = buildReviewArgs({
  diffFile: 'relative-diff.diff',
  roster: {
    reviewer_engine: 'test-rev-model',
    reviewer_effort: 'high',
    reviewer_runner: 'test-rev-runner',
  },
});
console.log(`args_without_spec=${argsWithoutSpec.join(' ')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine buildReviewArgs process exits 0"
assert_contains "$OUT" "--spec-file some-spec.md" "buildReviewArgs appends specFile when set"
assert_not_contains "$OUT" "args_without_spec=.*--spec-file" "buildReviewArgs omits specFile when absent"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = process.argv[2];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

let reviewArgsDefault = null;
let reviewArgsNoSpec = null;

const createEngine = (noReviewSpec) => new AutopilotEngine({
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
        branch: 'branch',
        base: 'base',
        commit: '1234567890123456789012345678901234567890',
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
    if (noReviewSpec) reviewArgsNoSpec = args;
    else reviewArgsDefault = args;
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
        findings: 'none',
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

const roster = {
  reviewer_engine: 'test-review-model',
  reviewer_effort: 'xhigh',
  reviewer_runner: 'test-review-runner',
  implementer_engine: 'test-impl-model',
  implementer_effort: 'high',
  implementer_runner: 'test-impl-runner',
  loop_max_rounds: 1,
  loop_convergence_verdict: 'SHIP-AS-IS',
};

const loopArgs = {
  promptFile: path.resolve('/tmp/some-prompt.md'),
  branch: 'repair-loop',
  base: '1111111111111111111111111111111111111111',
  maxRounds: 1,
  roster,
};

createEngine(false).runImplementationReviewLoop(loopArgs);
createEngine(true).runImplementationReviewLoop({ ...loopArgs, noReviewSpec: true });

console.log(`default_has_spec=${reviewArgsDefault.includes('--spec-file')}`);
console.log(`default_spec_value=${reviewArgsDefault[reviewArgsDefault.indexOf('--spec-file') + 1] === path.resolve('/tmp/some-prompt.md')}`);
console.log(`no_spec_has_spec=${reviewArgsNoSpec.includes('--spec-file')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine runImplementationReviewLoop spec-file tests exit 0"
assert_contains "$OUT" "default_has_spec=true" "runImplementationReviewLoop passes spec-file by default"
assert_contains "$OUT" "default_spec_value=true" "runImplementationReviewLoop uses prompt file as spec file by default"
assert_contains "$OUT" "no_spec_has_spec=false" "runImplementationReviewLoop suppresses spec-file when noReviewSpec is true"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const diffBase = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const calls = [];
const engine = new AutopilotEngine({
  reviewLoopResolver() {
    calls.push({
      phase: 'resolve',
      args: Array.from(arguments[0] || []),
    });
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
        implementer_engine: 'gpt-5.3-codex-spark',
        implementer_effort: 'high',
        implementer_runner: 'test-impl-runner',
        loop_max_rounds: 1,
        loop_convergence_verdict: 'SHIP-AS-IS',
      },
    };
  },
  reviewDispatcher(args) {
    calls.push({
      phase: 'review',
      args: Array.from(args || []),
    });
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
        findings: 'none',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
});

const sensitiveDiff = `${diffBase}.sensitive.diff`;
fs.writeFileSync(
  sensitiveDiff,
  [
    'diff --git a/auth/tenant-auth.ts b/auth/tenant-auth.ts',
    'index 1111111..2222222 100644',
    '--- a/auth/tenant-auth.ts',
    '+++ b/auth/tenant-auth.ts',
    '@@ -1,2 +1,2 @@',
    ' const user = tenant_id;',
    '+const tenantBoundary = true;',
  ].join('\n') + '\n',
);

const sensitiveResult = engine.reviewDiff({
  dynamicReviewRisk: true,
  diffFile: sensitiveDiff,
  implementerEngine: 'gpt-5.3-codex-spark',
  sourceTrust: 'low',
  oracleAvailable: 1,
  securitySurface: 0,
});

const sensitiveResolveArgs = calls.find((entry) => entry.phase === 'resolve')?.args.join(' ') || '';
const sensitiveReviewArgs = calls.find((entry) => entry.phase === 'review')?.args.join(' ') || '';
console.log(`sensitive_status=${sensitiveResult.status}`);
console.log(`sensitive_adversarial=${sensitiveResult.riskClassification && sensitiveResult.riskClassification.adversarial_review}`);
console.log(`sensitive_domains=${JSON.stringify(sensitiveResult.riskClassification ? sensitiveResult.riskClassification.domains : [])}`);
console.log(`sensitive_checklists=${JSON.stringify(sensitiveResult.riskClassification ? sensitiveResult.riskClassification.checklists : [])}`);
console.log(`sensitive_resolve_args=${sensitiveResolveArgs}`);
console.log(`sensitive_review_args=${sensitiveReviewArgs}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine reviewDiff dynamic-risk sensitive diff process exits 0"
assert_contains "$OUT" "sensitive_status=reviewed" "dynamic sensitive diff is reviewed"
assert_contains "$OUT" "sensitive_adversarial=true" "dynamic sensitive diff flagged adversarial"
assert_contains "$OUT" "sensitive_resolve_args=--check-scorecard --source-trust low" "risk flags from classifier flow into resolve args"
assert_contains "$OUT" "sensitive_review_args=--checklists authz-boundary,tenant-boundary" "classifier checklists are appended to review args"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const diffBase = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const calls = [];
const engine = new AutopilotEngine({
  reviewLoopResolver() {
    calls.push({
      phase: 'resolve',
      args: Array.from(arguments[0] || []),
    });
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
        implementer_engine: 'gpt-5.5',
        implementer_effort: 'high',
        implementer_runner: 'test-impl-runner',
        loop_max_rounds: 1,
        loop_convergence_verdict: 'SHIP-AS-IS',
      },
    };
  },
  reviewDispatcher(args) {
    calls.push({
      phase: 'review',
      args: Array.from(args || []),
    });
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
        findings: 'none',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
});

const lowriskDiff = `${diffBase}.sampling.diff`;
fs.writeFileSync(
  lowriskDiff,
  [
    'diff --git a/docs/readme.md b/docs/readme.md',
    'index 1111111..2222222 100644',
    '--- a/docs/readme.md',
    '+++ b/docs/readme.md',
    '@@ -1,2 +1,3 @@',
    ' # README',
    '+more docs content',
  ].join('\n') + '\n',
);

const lowriskResult = engine.reviewDiff({
  dynamicReviewRisk: true,
  diffFile: lowriskDiff,
  implementerEngine: 'gpt-5.5',
  sourceTrust: 'high',
  oracleAvailable: 1,
  securitySurface: 0,
  samplingRatio: 1,
  samplingSeed: 'engine-test-sampling',
});

const lowriskReviewArgs = calls.find((entry) => entry.phase === 'review')?.args.join(' ') || '';
console.log(`sampling_status=${lowriskResult.status}`);
console.log(`sampling_adversarial=${lowriskResult.riskClassification && lowriskResult.riskClassification.adversarial_review}`);
console.log(`sampling_selected=${lowriskResult.riskClassification && lowriskResult.riskClassification.sampling ? lowriskResult.riskClassification.sampling.selected : false}`);
console.log(`sampling_reason=${lowriskResult.riskClassification && lowriskResult.riskClassification.sampling ? lowriskResult.riskClassification.sampling.reason : ''}`);
console.log(`sampling_checklists=${JSON.stringify(lowriskResult.riskClassification ? lowriskResult.riskClassification.checklists : [])}`);
console.log(`sampling_review_args=${lowriskReviewArgs}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine reviewDiff low-risk sampling run exits 0"
assert_contains "$OUT" "sampling_status=reviewed" "low-risk sampling run is reviewed"
assert_contains "$OUT" "sampling_adversarial=true" "sampling-selected low-risk diff is adversarial"
assert_contains "$OUT" "sampling_selected=true" "sampling-selected bit is preserved"
assert_contains "$OUT" "sampling_reason=low-risk-sampling" "sampling reason is low-risk-sampling"
assert_contains "$OUT" "sampling_checklists=[\"sampling-sanity\"]" "sampling-sanity checklist is injected"
assert_contains "$OUT" "sampling_review_args=--checklists sampling-sanity" "sampling checklist is appended to review args"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const diffBase = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

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
        reviewer_engine: 'gpt-5.5',
        reviewer_effort: 'xhigh',
        reviewer_runner: 'test-review-runner',
        implementer_engine: 'gpt-5.5',
        implementer_effort: 'high',
        implementer_runner: 'test-impl-runner',
        loop_max_rounds: 1,
        loop_convergence_verdict: 'SHIP-AS-IS',
      },
    };
  },
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
        status: 'reviewed',
        verdict: 'SHIP-AS-IS',
        findings: 'none',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
});

const sameFamilyDiff = `${diffBase}.same-family.diff`;
fs.writeFileSync(
  sameFamilyDiff,
  [
    'diff --git a/docs/changelog.md b/docs/changelog.md',
    'index 1111111..2222222 100644',
    '--- a/docs/changelog.md',
    '+++ b/docs/changelog.md',
    '@@ -1,1 +1,2 @@',
    '+docs update',
  ].join('\n') + '\n',
);

const sameFamilyResult = engine.reviewDiff({
  dynamicReviewRisk: true,
  diffFile: sameFamilyDiff,
  implementerEngine: 'gpt-5.5',
  sourceTrust: 'high',
  oracleAvailable: 1,
  securitySurface: 0,
});

console.log(`same_family_status=${sameFamilyResult.status}`);
console.log(`same_family_phase=${sameFamilyResult.phase}`);
console.log(`same_family_reason=${sameFamilyResult.reason}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine reviewDiff same-family block process exits 0"
assert_contains "$OUT" "same_family_status=blocked" "same-family family-decorrelation blocks review"
assert_contains "$OUT" "same_family_phase=reviewer_family" "same-family block phase is reviewer_family"
assert_contains "$OUT" "same_family_reason=reviewer and implementer must be different families" "same-family block reason is explicit"

finalize_test
