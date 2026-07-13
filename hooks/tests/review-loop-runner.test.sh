#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/missing-scorecard" <<'NODE'
const path = require('path');
const root = process.argv[2];
const scorecard = process.argv[3];
const { resolveReviewLoopJson } = require(path.join(root, 'src', 'engine', 'resolve-review-loop'));
const run = resolveReviewLoopJson(['--check-scorecard'], {
  env: {
    ...process.env,
    ENGINE_SCORECARD_DIR: scorecard,
  },
});
console.log(`status=${run.status}`);
console.log(`parse=${run.parseError ? 'error' : 'ok'}`);
console.log(`reviewer=${run.result && run.result.reviewer_engine}`);
console.log(`qualified=${run.result && run.result.reviewer_qualified}`);
console.log(`fallback=${JSON.stringify(run.result && run.result.fallback_ladder)}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review-loop JS capture process exits 0"
assert_contains "$OUT" "status=0" "review-loop runner preserves child exit 0"
assert_contains "$OUT" "parse=ok" "review-loop runner parses JSON"
assert_contains "$OUT" "reviewer=gpt-5.5" "review-loop runner captures reviewer engine"
assert_contains "$OUT" "qualified=false" "review-loop runner captures fail-closed scorecard state"
assert_contains "$OUT" "fallback=[]" "review-loop runner captures empty scorecard ladder"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/empty-scorecard" <<'NODE'
const path = require('path');
const root = process.argv[2];
const scorecard = process.argv[3];
const { resolveReviewLoopJson } = require(path.join(root, 'src', 'engine', 'resolve-review-loop'));
const run = resolveReviewLoopJson(['--check-scorecard', '--enforce'], {
  env: {
    ...process.env,
    ENGINE_SCORECARD_DIR: scorecard,
  },
});
console.log(`status=${run.status}`);
console.log(`parse=${run.parseError ? 'error' : 'ok'}`);
console.log(`qualified=${run.result && run.result.reviewer_qualified}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review-loop enforced capture process exits 0"
assert_contains "$OUT" "status=3" "review-loop runner preserves enforce exit 3"
assert_contains "$OUT" "parse=ok" "review-loop runner parses JSON on enforce block"
assert_contains "$OUT" "qualified=false" "review-loop runner keeps enforce block data"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { resolveReviewLoop } = require(path.join(root, 'src', 'engine', 'resolve-review-loop'));
const result = resolveReviewLoop([], {
  scriptPath: path.join(root, 'scripts', 'missing-resolve-review-loop.sh'),
  stdio: 'pipe',
});
console.log(result.error ? 'error' : 'no-error');
console.log(result.status === null ? 'status-null' : `status-${result.status}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review-loop missing-script process exits 0"
assert_contains "$OUT" "error" "review-loop module reports missing script"
assert_contains "$OUT" "status-null" "review-loop module missing script has null status"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseReviewLoopOutput } = require(path.join(root, 'src', 'engine', 'resolve-review-loop'));
try {
  parseReviewLoopOutput('not json\n');
  console.log('unexpected-ok');
} catch (err) {
  console.log('parse-error');
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review-loop parser missing JSON process exits 0"
assert_contains "$OUT" "parse-error" "review-loop parser fails loud on missing JSON"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseReviewLoopOutput } = require(path.join(root, 'src', 'engine', 'resolve-review-loop'));
const valid = {
  reviewer_engine: 'gpt-5.5',
  reviewer_effort: 'xhigh',
  reviewer_runner: 'codex',
  implementer_engine: 'gpt-5.3-codex-spark',
  implementer_effort: 'high',
  implementer_runner: 'auto',
  loop_max_rounds: 5,
  loop_convergence_verdict: 'SHIP-AS-IS',
  spec_review: 'on',
  independent_harness: 'on',
  qc_panel: ['gpt-5.5'],
  qc_panel_aggregation: 'union-on-verified-critical',
  review_risk: 'low',
  required_review_families: 1,
  l1_required: false,
  cross_family_required: true,
  cross_family_satisfied: true,
  review_diff_scope: 'full',
  source: 'test',
  work_domain: 'mixed',
  domain_source: 'none',
  capability_state_source: 'unknown',
  quota_status: 'unknown',
  quota_reset_at: null,
  skill_mode_requested: 'off',
  skill_mode_effective: 'off',
  capability_warnings: [],
  reviewer_endpoint: '',
  implementer_endpoint: '',
  min_panel_size: 3,
  on_engine_unavailable: 'ask',
  reviewer_engine_low_risk: '',
  reviewer_effort_low_risk: '',
};
const parsed = parseReviewLoopOutput([
  '{not valid json}',
  JSON.stringify({ reviewer_engine: 'gpt-5.5' }),
  JSON.stringify(valid),
].join('\n'));
console.log(parsed.reviewer_engine);
console.log(parsed.loop_max_rounds);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review-loop parser skips invalid candidates"
assert_contains "$OUT" "gpt-5.5" "review-loop parser finds valid later JSON"
assert_contains "$OUT" "5" "review-loop parser preserves numeric fields"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseReviewLoopOutput } = require(path.join(root, 'src', 'engine', 'resolve-review-loop'));
const valid = {
  reviewer_engine: 'gpt-5.5',
  reviewer_effort: 'xhigh',
  reviewer_runner: 'codex',
  implementer_engine: 'gpt-5.3-codex-spark',
  implementer_effort: 'high',
  implementer_runner: 'auto',
  loop_max_rounds: 5,
  loop_convergence_verdict: 'SHIP-AS-IS',
  spec_review: 'on',
  independent_harness: 'on',
  qc_panel: ['gpt-5.5'],
  qc_panel_aggregation: 'union-on-verified-critical',
  review_risk: 'low',
  required_review_families: 1,
  l1_required: false,
  cross_family_required: true,
  cross_family_satisfied: true,
  review_diff_scope: 'full',
  source: 'test',
  work_domain: 'mixed',
  domain_source: 'none',
  capability_state_source: 'unknown',
  quota_status: 'unknown',
  quota_reset_at: null,
  skill_mode_requested: 'off',
  skill_mode_effective: 'off',
  capability_warnings: [],
  reviewer_endpoint: '',
  implementer_endpoint: '',
  min_panel_size: 3,
  on_engine_unavailable: 'ask',
  reviewer_engine_low_risk: '',
  reviewer_effort_low_risk: '',
};
const parsed = parseReviewLoopOutput([
  'resolver preface',
  JSON.stringify(valid, null, 2),
  'resolver suffix',
].join('\n'));
console.log(parsed.reviewer_engine);
console.log(parsed.qc_panel_aggregation);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review-loop parser accepts pretty JSON stdout with preface"
assert_contains "$OUT" "gpt-5.5" "review-loop parser pretty JSON with preface reviewer"
assert_contains "$OUT" "union-on-verified-critical" "review-loop parser pretty JSON with preface aggregation"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseReviewLoopOutput } = require(path.join(root, 'src', 'engine', 'resolve-review-loop'));
try {
  parseReviewLoopOutput(JSON.stringify({
    reviewer_engine: 'gpt-5.5',
    loop_max_rounds: '5',
  }));
  console.log('unexpected-ok');
} catch (err) {
  console.log(err.message);
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review-loop parser invalid schema process exits 0"
assert_contains "$OUT" "missing field" "review-loop parser validates required fields"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseReviewLoopOutput } = require(path.join(root, 'src', 'engine', 'resolve-review-loop'));
const partial = {
  reviewer_engine: 'gpt-5.5',
  reviewer_effort: 'xhigh',
  reviewer_runner: 'codex',
  implementer_engine: 'gpt-5.3-codex-spark',
  implementer_effort: 'high',
  implementer_runner: 'auto',
  loop_max_rounds: 5,
  loop_convergence_verdict: 'SHIP-AS-IS',
  spec_review: 'on',
  independent_harness: 'on',
  qc_panel: ['gpt-5.5'],
  qc_panel_aggregation: 'union-on-verified-critical',
  review_risk: 'low',
  required_review_families: 1,
  l1_required: false,
  cross_family_required: true,
  cross_family_satisfied: true,
  review_diff_scope: 'full',
  source: 'test',
  work_domain: 'mixed',
  domain_source: 'none',
  reviewer_qualified: false,
  capability_state_source: 'unknown',
  quota_status: 'unknown',
  quota_reset_at: null,
  skill_mode_requested: 'off',
  skill_mode_effective: 'off',
  capability_warnings: [],
  reviewer_endpoint: '',
  implementer_endpoint: '',
  min_panel_size: 3,
  on_engine_unavailable: 'ask',
  reviewer_engine_low_risk: '',
  reviewer_effort_low_risk: '',
};
try {
  parseReviewLoopOutput(JSON.stringify(partial));
  console.log('unexpected-ok');
} catch (err) {
  console.log(err.message);
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review-loop parser partial scorecard schema process exits 0"
assert_contains "$OUT" "together" "review-loop parser requires scorecard fields together"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseReviewLoopOutput } = require(path.join(root, 'src', 'engine', 'resolve-review-loop'));
const invalid = {
  reviewer_engine: 'gpt-5.5',
  reviewer_effort: 'xhigh',
  reviewer_runner: 'codex',
  implementer_engine: 'gpt-5.3-codex-spark',
  implementer_effort: 'high',
  implementer_runner: 'auto',
  loop_max_rounds: 5,
  loop_convergence_verdict: 'SHIP-AS-IS',
  spec_review: 'on',
  independent_harness: 'on',
  qc_panel: [''],
  qc_panel_aggregation: 'majority',
  review_risk: 'low',
  required_review_families: 1,
  l1_required: false,
  cross_family_required: true,
  cross_family_satisfied: true,
  review_diff_scope: 'full',
  source: 'test',
  work_domain: 'mixed',
  domain_source: 'none',
  capability_state_source: 'unknown',
  quota_status: 'unknown',
  quota_reset_at: null,
  skill_mode_requested: 'off',
  skill_mode_effective: 'off',
  capability_warnings: [],
  reviewer_endpoint: '',
  implementer_endpoint: '',
  min_panel_size: 3,
  on_engine_unavailable: 'ask',
  reviewer_engine_low_risk: '',
  reviewer_effort_low_risk: '',
};
try {
  parseReviewLoopOutput(JSON.stringify(invalid, null, 2));
  console.log('unexpected-ok');
} catch (err) {
  console.log(err.message);
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review-loop parser enum/schema rejection process exits 0"
assert_contains "$OUT" "one of" "review-loop parser rejects invalid enum before fallback generic error"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseReviewLoopOutput } = require(path.join(root, 'src', 'engine', 'resolve-review-loop'));
const valid = {
  reviewer_engine: 'gpt-5.5',
  reviewer_effort: 'xhigh',
  reviewer_runner: 'codex',
  implementer_engine: 'gpt-5.3-codex-spark',
  implementer_effort: 'high',
  implementer_runner: 'auto',
  loop_max_rounds: 5,
  loop_convergence_verdict: 'SHIP-AS-IS',
  spec_review: 'on',
  independent_harness: 'on',
  qc_panel: ['gpt-5.5'],
  qc_panel_aggregation: 'union-on-verified-critical',
  review_risk: 'low',
  required_review_families: 1,
  l1_required: false,
  cross_family_required: true,
  cross_family_satisfied: true,
  review_diff_scope: 'full',
  source: 'test',
  work_domain: 'mixed',
  domain_source: 'none',
  capability_state_source: 'unknown',
  quota_status: 'unknown',
  quota_reset_at: null,
  skill_mode_requested: 'off',
  skill_mode_effective: 'off',
  capability_warnings: [],
  reviewer_endpoint: '',
  implementer_endpoint: '',
  min_panel_size: 3,
  on_engine_unavailable: 'ask',
  reviewer_engine_low_risk: '',
  reviewer_effort_low_risk: '',
};
const parsed = parseReviewLoopOutput(`${JSON.stringify(valid)}\nlog line with {debug braces}`);
console.log(parsed.reviewer_engine);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review-loop parser skips trailing non-schema brace logs"
assert_contains "$OUT" "gpt-5.5" "review-loop parser keeps earlier valid schema after brace log"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseReviewLoopOutput } = require(path.join(root, 'src', 'engine', 'resolve-review-loop'));
const valid = {
  reviewer_engine: 'gpt-5.5',
  reviewer_effort: 'xhigh',
  reviewer_runner: 'codex',
  implementer_engine: 'gpt-5.3-codex-spark',
  implementer_effort: 'high',
  implementer_runner: 'auto',
  loop_max_rounds: 5,
  loop_convergence_verdict: 'SHIP-AS-IS',
  spec_review: 'on',
  independent_harness: 'on',
  qc_panel: ['gpt-5.5'],
  qc_panel_aggregation: 'union-on-verified-critical',
  review_risk: 'low',
  required_review_families: 1,
  l1_required: false,
  cross_family_required: true,
  cross_family_satisfied: true,
  review_diff_scope: 'full',
  source: 'test',
  work_domain: 'mixed',
  domain_source: 'none',
  capability_state_source: 'unknown',
  quota_status: 'unknown',
  quota_reset_at: null,
  skill_mode_requested: 'off',
  skill_mode_effective: 'off',
  capability_warnings: [],
  reviewer_endpoint: '',
  implementer_endpoint: '',
  min_panel_size: 3,
  on_engine_unavailable: 'ask',
  reviewer_engine_low_risk: '',
  reviewer_effort_low_risk: '',
};
try {
  parseReviewLoopOutput(`${JSON.stringify(valid)}\n{"reviewer_engine":"bad"}`);
  console.log('unexpected-ok');
} catch (err) {
  console.log(err.message);
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review-loop parser rejects invalid trailing JSON object process exits 0"
assert_contains "$OUT" "missing field" "review-loop parser treats last complete JSON object as authoritative"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseReviewLoopOutput } = require(path.join(root, 'src', 'engine', 'resolve-review-loop'));
const valid = {
  reviewer_engine: 'gpt-5.5',
  reviewer_effort: 'xhigh',
  reviewer_runner: 'codex',
  implementer_engine: 'gpt-5.3-codex-spark',
  implementer_effort: 'high',
  implementer_runner: 'auto',
  loop_max_rounds: 5,
  loop_convergence_verdict: 'SHIP-AS-IS',
  spec_review: 'on',
  independent_harness: 'on',
  qc_panel: ['gpt-5.5'],
  qc_panel_aggregation: 'union-on-verified-critical',
  review_risk: 'low',
  required_review_families: 1,
  l1_required: false,
  cross_family_required: true,
  cross_family_satisfied: true,
  review_diff_scope: 'full',
  source: 'test',
  work_domain: 'mixed',
  domain_source: 'none',
  capability_state_source: 'unknown',
  quota_status: 'unknown',
  quota_reset_at: null,
  skill_mode_requested: 'off',
  skill_mode_effective: 'off',
  capability_warnings: [],
  reviewer_endpoint: '',
  implementer_endpoint: '',
  min_panel_size: 3,
  on_engine_unavailable: 'ask',
  reviewer_engine_low_risk: '',
  reviewer_effort_low_risk: '',
};
try {
  parseReviewLoopOutput(`${JSON.stringify(valid)}\n{"reviewer_engine":`);
  console.log('unexpected-ok');
} catch (err) {
  console.log(err.message);
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review-loop parser rejects trailing incomplete JSON process exits 0"
assert_contains "$OUT" "trailing incomplete" "review-loop parser fails loud on trailing incomplete JSON"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseReviewLoopOutput } = require(path.join(root, 'src', 'engine', 'resolve-review-loop'));
try {
  parseReviewLoopOutput('x'.repeat(1024 * 1024 + 1));
  console.log('unexpected-ok');
} catch (err) {
  console.log(err.message);
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review-loop parser oversized stdout process exits 0"
assert_contains "$OUT" "exceeds maximum" "review-loop parser bounds stdout parse size"

finalize_test
