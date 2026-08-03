#!/usr/bin/env bash
# Cross-harness retro adapter/attribution/metrics regression suite.
# Synthetic fixtures only: no user transcript root is read.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/retro-review-loop.js"
SCHEMA="$REPO_ROOT/schemas/normalized-transcript-event.schema.json"
FIX="$TEST_TMP/legacy-transcripts"
mkdir -p "$FIX"

json_field() {
  node -e '
    let value = JSON.parse(require("fs").readFileSync(0, "utf8"));
    for (const key of process.argv[1].split(".")) value = value[key];
    process.stdout.write(String(value));
  ' "$1"
}

field() {
  printf '%s' "$OUT" | json_field "$1"
}

# Table-driven field equality against $OUT (path, expected, message).
assert_fields() {
  while IFS=$'\t' read -r path expected msg; do
    [ -n "$path" ] || continue
    assert_eq "$expected" "$(field "$path")" "$msg"
  done
}

# ---------------------------------------------------------------------------
# Backward-compatible Claude-only surface. Mentions in user/tool-result bodies
# never count as dispatches; only assistant tool_use calls do.
# ---------------------------------------------------------------------------
{
  printf '%s\n' '{"type":"mode","mode":"default","timestamp":"2026-07-27T09:00:00.000Z"}'
  printf '%s\n' '{"type":"file-history-snapshot","timestamp":"2026-07-27T09:00:01.000Z"}'
  printf '%s\n' '{not valid json at all'
  printf '%s\n' ''
  printf '%s\n' '{"type":"user","timestamp":"2026-07-27T09:00:02.000Z","message":{"role":"user","content":[{"type":"text","text":"remember scripts/dispatch-hetero.sh --runner auto exists"}]}}'
  printf '%s\n' '{"type":"assistant","timestamp":"2026-07-27T09:00:03.000Z","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"bash scripts/dispatch-hetero.sh --runner auto --model model --branch b"}}]}}'
  printf '%s\n' '{"type":"assistant","timestamp":"2026-07-27T09:00:04.000Z","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"bash scripts/dispatch-review.sh --runner codex --diff-file d"}}]}}'
  printf '%s\n' '{"type":"assistant","timestamp":"2026-07-27T09:00:05.000Z","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"codex exec --model model -c x < /dev/null"}}]}}'
  printf '%s\n' '{"type":"assistant","timestamp":"2026-07-27T09:00:06.000Z","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"git status"}}]}}'
  printf '%s\n' '{"type":"assistant","timestamp":"2026-07-27T09:00:07.000Z","message":{"role":"assistant","content":[{"type":"tool_use","name":"Agent","input":{"prompt":"go"}}]}}'
  printf '%s\n' '{"type":"user","timestamp":"2026-07-27T09:00:08.000Z","message":{"role":"user","content":[{"type":"tool_result","content":"ran scripts/dispatch-hetero.sh --runner auto and dispatch-review.sh --runner codex"}]}}'
} >"$FIX/session-a.jsonl"

OUT="$(RETRO_TRANSCRIPT_DIR="$FIX" node "$SCRIPT" --no-git --json 2>&1)"
EXIT=$?
assert_fields <<'EOF'
transcript.sessions	1	legacy explicit root includes one session
transcript.impl_dispatch	1	impl dispatch counted once
transcript.review_dispatch	1	review dispatch counted once
transcript.codex_exec	1	codex exec counted once
transcript.bash_calls	4	four Bash calls
transcript.agent_calls	1	one Agent call
hetero_dispatch_total	3	legacy hetero total remains additive
git_signals.available	false	--no-git remains unavailable
provenance.0.parse_error_count	1	malformed legacy line is counted
EOF
assert_eq "0" "$EXIT" "legacy retro-review-loop exits zero"

# ---------------------------------------------------------------------------
# classifyCommand: only the invoked executable/script position counts.
# Compact tuples: [id, command, category, dispatch_kind, provider?]
# Oracle grammar (fail closed otherwise):
#   + direct script | bash|sh|dash|zsh|ksh|rbash script
#   + bash -c|+c|-cx|-cc|+xc|+cx|+cc body
#   + bash allowlisted long continue then script|-c body
#   + allowlisted no-arg short clusters; space-separated arg-taking opts
#   + busybox sh|ash|dash … (explicit shell applet only)
#   - bash --command; -c=…; -n/-D suppress; -s stdin; unknown shorts; o/O cluster
#   - busybox -c … (applet lookup, not shell)
# ---------------------------------------------------------------------------
CLASSIFY_OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const { classifyCommand } = require(path.join(
  process.argv[2],
  'scripts/lib/transcript-adapters/common',
));
const TC = 'tool_call';
const PD = 'provider_dispatch';
// [id, command, category, dispatch_kind, provider?]
const cases = [
  // negatives: text-only / non-invoking
  ['echo_quoted_false_positive', 'echo "scripts/dispatch-review.sh --runner grok"', TC, null],
  ['echo_unquoted_false_positive', 'echo scripts/dispatch-review.sh --runner grok', TC, null],
  ['cat_script_path', 'cat scripts/dispatch-review.sh', TC, null],
  // negatives: option-consumed path is not the invoked script
  ['bash_init_file_option_arg', "bash --init-file scripts/dispatch-review.sh -c 'echo ok'", TC, null],
  ['bash_rcfile_option_arg', "bash --rcfile scripts/dispatch-review.sh -c 'echo ok'", TC, null],
  ['bash_o_option_arg', "bash -o errexit -c 'echo ok'", TC, null],
  ['bash_O_option_arg', "bash -O extglob -c 'echo ok'", TC, null],
  // negatives: attached opt=value (Bash rejects; never strip =)
  ['bash_c_equals_false_positive', 'bash -c=scripts/dispatch-review.sh', TC, null],
  ['bash_c_equals_with_runner', 'bash -c=scripts/dispatch-review.sh --runner grok', TC, null],
  ['bash_c_equals_quoted_body', "bash -c='scripts/dispatch-review.sh --runner grok'", TC, null],
  ['bash_init_file_equals', "bash --init-file=scripts/dispatch-review.sh -c 'echo ok'", TC, null],
  ['bash_rcfile_equals', "bash --rcfile=scripts/dispatch-review.sh -c 'echo ok'", TC, null],
  ['bash_o_equals', "bash -o=errexit -c 'scripts/dispatch-review.sh --runner grok'", TC, null],
  ['bash_O_equals', "bash -O=extglob -c 'scripts/dispatch-review.sh --runner grok'", TC, null],
  ['bash_xc_equals', "bash -xc='scripts/dispatch-review.sh --runner grok'", TC, null],
  // negatives: Sol bash-wrapper-long-command — Bash has no --command
  ['bash_wrapper_long_command', "bash --command 'scripts/dispatch-review.sh --runner grok'", TC, null],
  ['bash_wrapper_long_command_unquoted', 'bash --command scripts/dispatch-review.sh --runner grok', TC, null],
  // negatives: unknown short flags
  ['bash_unknown_short_Z', 'bash -Z scripts/dispatch-review.sh --runner grok', TC, null],
  ['bash_unknown_short_cluster_Zx', 'bash -Zx scripts/dispatch-review.sh --runner grok', TC, null],
  ['bash_unknown_short_with_c', "bash -Zc 'scripts/dispatch-review.sh --runner grok'", TC, null],
  // negatives: o/O cluster steals body / unknown long / missing args
  ['bash_co_cluster_steals_body', "bash -co 'scripts/dispatch-review.sh --runner grok'", TC, null],
  ['bash_cO_cluster', "bash -cO 'scripts/dispatch-review.sh --runner grok'", TC, null],
  ['bash_c_missing_body', 'bash -c', TC, null],
  ['bash_init_file_missing_arg', 'bash --init-file', TC, null],
  ['bash_o_missing_arg_then_script', 'bash -o', TC, null],
  ['bash_unknown_long_option', 'bash --not-a-real-flag scripts/dispatch-review.sh --runner grok', TC, null],
  ['bash_help_long_no_promote', 'bash --help scripts/dispatch-review.sh --runner grok', TC, null],
  ['bash_version_long_no_promote', 'bash --version scripts/dispatch-review.sh --runner grok', TC, null],
  // negatives: execution-suppressing / source-changing modes
  ['bash_n_suppresses_script', 'bash -n scripts/dispatch-review.sh --runner grok', TC, null],
  ['bash_nc_suppresses_body', "bash -nc 'scripts/dispatch-review.sh --runner grok'", TC, null],
  ['bash_D_suppresses_script', 'bash -D scripts/dispatch-review.sh --runner grok', TC, null],
  ['bash_Dc_suppresses_body', "bash -Dc 'scripts/dispatch-review.sh --runner grok'", TC, null],
  ['bash_s_stdin_not_script', 'bash -s scripts/dispatch-review.sh --runner grok', TC, null],
  // negatives: Sol nonbash-wrapper-grammar — busybox -c is applet lookup
  ['busybox_c_not_shell', "busybox -c 'scripts/dispatch-review.sh --runner grok'", TC, null],
  ['busybox_bare_script', 'busybox scripts/dispatch-review.sh --runner grok', TC, null],
  // negatives: non-bash long options fail closed
  ['sh_long_command_fail_closed', "sh --command 'scripts/dispatch-review.sh --runner grok'", TC, null],
  ['dash_norc_fail_closed', 'dash --norc scripts/dispatch-review.sh --runner grok', TC, null],
  ['zsh_long_option_fail_closed', 'zsh --verbose scripts/dispatch-review.sh --runner grok', TC, null],
  // positives: direct invocation
  ['direct_review', 'scripts/dispatch-review.sh --runner grok --ticket-id t --generation 2', PD, 'review_dispatch', 'grok'],
  ['direct_hetero', './scripts/dispatch-hetero.sh --runner auto', PD, 'impl_dispatch', 'auto'],
  // positives: ordinary shell script wrappers
  ['bash_wrapper_review', 'bash scripts/dispatch-review.sh --runner codex', PD, 'review_dispatch', 'codex'],
  ['bash_wrapper_hetero', 'bash scripts/dispatch-hetero.sh --runner auto --model m --branch b', PD, 'impl_dispatch', 'auto'],
  ['bash_known_short_x_wrapper', 'bash -x scripts/dispatch-review.sh --runner codex', PD, 'review_dispatch', 'codex'],
  ['bash_known_short_cluster_eux', 'bash -eux scripts/dispatch-review.sh --runner codex', PD, 'review_dispatch', 'codex'],
  ['sh_wrapper_explore', 'sh scripts/dispatch-explore.sh', PD, 'explore'],
  ['dash_wrapper_review', 'dash scripts/dispatch-review.sh --runner codex', PD, 'review_dispatch', 'codex'],
  ['zsh_wrapper_review', 'zsh scripts/dispatch-review.sh --runner codex', PD, 'review_dispatch', 'codex'],
  ['ksh_wrapper_review', 'ksh scripts/dispatch-review.sh --runner codex', PD, 'review_dispatch', 'codex'],
  ['rbash_wrapper_review', 'rbash scripts/dispatch-review.sh --runner codex', PD, 'review_dispatch', 'codex'],
  ['env_bash_wrapper', 'env bash scripts/dispatch-author.sh', PD, 'author'],
  // positives: -c body and oracle clusters (+c/-cx/-cc/+xc/+cx/+cc)
  ['bash_plain_c_body', "bash -c 'scripts/dispatch-review.sh --runner codex'", PD, 'review_dispatch', 'codex'],
  ['bash_plus_c_body', "bash +c 'scripts/dispatch-review.sh --runner codex'", PD, 'review_dispatch', 'codex'],
  ['bash_plus_c_unquoted_path', 'bash +c scripts/dispatch-review.sh', PD, 'review_dispatch'],
  ['bash_cx_body', "bash -cx 'scripts/dispatch-review.sh --runner codex'", PD, 'review_dispatch', 'codex'],
  ['bash_cc_body', "bash -cc 'scripts/dispatch-review.sh --runner codex'", PD, 'review_dispatch', 'codex'],
  ['bash_plus_xc_body', "bash +xc 'scripts/dispatch-review.sh --runner codex'", PD, 'review_dispatch', 'codex'],
  ['bash_plus_cx_body', "bash +cx 'scripts/dispatch-review.sh --runner codex'", PD, 'review_dispatch', 'codex'],
  ['bash_plus_cc_body', "bash +cc 'scripts/dispatch-review.sh --runner codex'", PD, 'review_dispatch', 'codex'],
  ['bash_terminal_c_cluster_xc', "bash -xc 'scripts/dispatch-review.sh --runner codex'", PD, 'review_dispatch', 'codex'],
  ['bash_terminal_c_cluster_exc', "bash -exc 'scripts/dispatch-review.sh --runner codex'", PD, 'review_dispatch', 'codex'],
  ['bash_sc_body_still_command_mode', "bash -sc 'scripts/dispatch-review.sh --runner codex'", PD, 'review_dispatch', 'codex'],
  ['bash_n_plus_n_clears_noexec', "bash -n +n -c 'scripts/dispatch-review.sh --runner codex'", PD, 'review_dispatch', 'codex'],
  // positives: allowlisted bash long options that continue
  ['bash_norc_script', 'bash --norc scripts/dispatch-review.sh --runner codex', PD, 'review_dispatch', 'codex'],
  ['bash_norc_c_body', "bash --norc -c 'scripts/dispatch-review.sh --runner codex'", PD, 'review_dispatch', 'codex'],
  ['bash_double_dash_script', 'bash -- scripts/dispatch-review.sh --runner codex', PD, 'review_dispatch', 'codex'],
  ['bash_x_double_dash_script', 'bash -x -- scripts/dispatch-review.sh --runner codex', PD, 'review_dispatch', 'codex'],
  // positives: busybox with explicit shell applet
  ['busybox_sh_c_body', "busybox sh -c 'scripts/dispatch-review.sh --runner codex'", PD, 'review_dispatch', 'codex'],
  ['busybox_sh_script', 'busybox sh scripts/dispatch-review.sh --runner codex', PD, 'review_dispatch', 'codex'],
  ['sh_c_body', "sh -c 'scripts/dispatch-explore.sh'", PD, 'explore'],
  ['codex_exec', 'codex exec --model model -c x', PD, 'codex_exec', 'codex'],
  ['grok_p', 'grok -p hi', PD, 'grok_dispatch', 'grok'],
  ['agy_p', 'agy -p hi', PD, 'agy_dispatch', 'agy'],
];
const failures = [];
const byId = Object.create(null);
for (const item of cases) {
  const [id, command, category, dispatch_kind, provider] = item;
  byId[id] = item;
  const result = classifyCommand(command);
  if (result.category !== category) {
    failures.push(`${id}: category ${result.category} != ${category}`);
  }
  if (result.control.dispatch_kind !== dispatch_kind) {
    failures.push(
      `${id}: dispatch_kind ${result.control.dispatch_kind} != ${dispatch_kind}`,
    );
  }
  if (provider !== undefined && result.control.provider !== provider) {
    failures.push(`${id}: provider ${result.control.provider} != ${provider}`);
  }
}
// Named samples for shell-level oracle surface (kind | category)
const sample = (id, which) => {
  const r = classifyCommand(byId[id][1]);
  return which === 'category' ? r.category : r.control.dispatch_kind;
};
process.stdout.write(JSON.stringify({
  ok: failures.length === 0,
  failures,
  case_count: cases.length,
  samples: {
    echo_quoted_category: sample('echo_quoted_false_positive', 'category'),
    bash_wrapper_kind: sample('bash_wrapper_review', 'kind'),
    bash_unknown_short_kind: sample('bash_unknown_short_Z', 'kind'),
    bash_unknown_short_category: sample('bash_unknown_short_Z', 'category'),
    bash_init_file_kind: sample('bash_init_file_option_arg', 'kind'),
    bash_init_file_category: sample('bash_init_file_option_arg', 'category'),
    bash_plus_c_kind: sample('bash_plus_c_body', 'kind'),
    bash_cx_kind: sample('bash_cx_body', 'kind'),
    bash_cc_kind: sample('bash_cc_body', 'kind'),
    bash_xc_kind: sample('bash_terminal_c_cluster_xc', 'kind'),
    bash_c_equals_kind: sample('bash_c_equals_false_positive', 'kind'),
    bash_c_equals_category: sample('bash_c_equals_false_positive', 'category'),
    bash_double_dash_kind: sample('bash_double_dash_script', 'kind'),
    bash_long_command_kind: sample('bash_wrapper_long_command', 'kind'),
    bash_long_command_category: sample('bash_wrapper_long_command', 'category'),
    busybox_c_kind: sample('busybox_c_not_shell', 'kind'),
    busybox_c_category: sample('busybox_c_not_shell', 'category'),
    busybox_sh_c_kind: sample('busybox_sh_c_body', 'kind'),
    bash_n_kind: sample('bash_n_suppresses_script', 'kind'),
    bash_s_kind: sample('bash_s_stdin_not_script', 'kind'),
    bash_norc_kind: sample('bash_norc_script', 'kind'),
  },
}));
NODE
)"
assert_eq "true" "$(printf '%s' "$CLASSIFY_OUT" | json_field ok)" \
  "classifyCommand invocation-position cases all pass"
assert_eq "72" "$(printf '%s' "$CLASSIFY_OUT" | json_field case_count)" \
  "classifyCommand case table size stays complete"

# Explicit oracle samples (kind/category) — table-driven over samples.*
while IFS=$'\t' read -r key expected msg; do
  [ -n "$key" ] || continue
  assert_eq "$expected" "$(printf '%s' "$CLASSIFY_OUT" | json_field "samples.$key")" "$msg"
done <<'EOF'
echo_quoted_category	tool_call	text-only echo of dispatch path is not provider_dispatch
bash_wrapper_kind	review_dispatch	bash-wrapper dispatch-review remains provider_dispatch
bash_unknown_short_kind	null	bash -Z does not treat following path as invoked script
bash_unknown_short_category	tool_call	unsupported short wrapper option fails closed (not provider_dispatch)
bash_init_file_kind	null	bash --init-file <path> does not treat option arg as invoked script
bash_init_file_category	tool_call	bash --init-file ... -c 'echo ok' remains non-dispatch tool_call
bash_plus_c_kind	review_dispatch	oracle: bash +c executes command body
bash_cx_kind	review_dispatch	oracle: bash -cx executes command body
bash_cc_kind	review_dispatch	oracle: bash -cc executes command body
bash_xc_kind	review_dispatch	bash -xc classifies inline body as dispatch
bash_c_equals_kind	null	bash -c=path is not a real dispatch (Bash rejects attached =)
bash_c_equals_category	tool_call	bash -c=scripts/dispatch-review.sh remains non-dispatch tool_call
bash_double_dash_kind	review_dispatch	bash -- script still classifies as dispatch
bash_long_command_kind	null	Sol bash-wrapper-long-command: --command is not a Bash option
bash_long_command_category	tool_call	bash --command remains non-dispatch tool_call
busybox_c_kind	null	Sol nonbash-wrapper-grammar: busybox -c is applet lookup, not dispatch
busybox_c_category	tool_call	busybox -c remains non-dispatch tool_call
busybox_sh_c_kind	review_dispatch	busybox sh -c body still classifies as dispatch
bash_n_kind	null	bash -n does not execute script (not dispatch)
bash_s_kind	null	bash -s without -c reads stdin (not script dispatch)
bash_norc_kind	review_dispatch	bash --norc script continues into dispatch
EOF

# End-to-end: a session whose only Bash tool_use is a text-only mention must
# not increment provider_dispatches / review_dispatch counters.
FP_ROOT="$TEST_TMP/dispatch-false-positive"
mkdir -p "$FP_ROOT"
{
  printf '%s\n' '{"type":"system","sessionId":"fp","timestamp":"2026-07-27T09:00:00.000Z","cwd":"__REPO__"}'
  printf '%s\n' '{"type":"assistant","sessionId":"fp","timestamp":"2026-07-27T09:00:01.000Z","cwd":"__REPO__","message":{"role":"assistant","content":[{"type":"tool_use","id":"text-only","name":"Bash","input":{"command":"echo \"scripts/dispatch-review.sh --runner grok\""}}]}}'
  printf '%s\n' '{"type":"assistant","sessionId":"fp","timestamp":"2026-07-27T09:00:02.000Z","cwd":"__REPO__","message":{"role":"assistant","content":[{"type":"tool_use","id":"real-direct","name":"Bash","input":{"command":"scripts/dispatch-review.sh --runner codex --ticket-id fp-ticket --generation 1"}}]}}'
  printf '%s\n' '{"type":"assistant","sessionId":"fp","timestamp":"2026-07-27T09:00:03.000Z","cwd":"__REPO__","message":{"role":"assistant","content":[{"type":"tool_use","id":"real-wrapper","name":"Bash","input":{"command":"bash scripts/dispatch-hetero.sh --runner auto --ticket-id fp-ticket --generation 1"}}]}}'
} | sed "s|__REPO__|$TEST_TMP/fp-repo|g" >"$FP_ROOT/session.jsonl"
mkdir -p "$TEST_TMP/fp-repo"
git -C "$TEST_TMP/fp-repo" init -q -b main 2>/dev/null || true
OUT="$(node "$SCRIPT" --no-git --json --days 7 \
  --now 2026-07-28T12:00:00.000Z \
  --repo "$TEST_TMP/fp-repo" \
  --claude-root "$FP_ROOT" \
  --codex-root "$TEST_TMP/missing-fp-codex" 2>&1)"
assert_fields <<'EOF'
transcript.review_dispatch	1	only real review dispatch counts (text-only echo excluded)
transcript.impl_dispatch	1	bash-wrapper hetero dispatch still counts
loop_metrics.deterministic.provider_dispatches.value	2	provider_dispatches excludes text-only false positive
EOF

# Missing legacy root stays fail-safe and explicitly not_present.
OUT="$(RETRO_TRANSCRIPT_DIR="$TEST_TMP/does-not-exist" node "$SCRIPT" --no-git --json 2>&1)"
EXIT=$?
assert_eq "0" "$EXIT" "missing transcript root exits zero"
assert_fields <<'EOF'
transcript.sessions	0	missing root has zero compatible sessions
provenance.0.status	not_present	missing Claude root is not_present
loop_metrics.deterministic.provider_dispatches.status	unknown	missing evidence is unknown, not numeric zero
EOF

# ---------------------------------------------------------------------------
# Multi-harness corpus: one Claude repo session, one Codex linked-worktree
# session, one unrelated Codex candidate, one malformed line, and one old date.
# ---------------------------------------------------------------------------
CORPUS="$TEST_TMP/corpus"
cp -R "$REPO_ROOT/hooks/tests/fixtures/transcripts" "$CORPUS"

REPO="$TEST_TMP/repo"
WORKTREE="$TEST_TMP/repo-worktree"
OTHER_REPO="$TEST_TMP/other-repo"
mkdir -p "$REPO" "$OTHER_REPO"
git -C "$REPO" init -q -b main
git -C "$REPO" config user.email fixture@example.invalid
git -C "$REPO" config user.name Fixture
printf 'fixture\n' >"$REPO/file.txt"
git -C "$REPO" add file.txt
git -C "$REPO" commit -q -m fixture
git -C "$REPO" worktree add -q -b fixture-worktree "$WORKTREE"
git -C "$OTHER_REPO" init -q -b main

node - "$CORPUS" "$REPO" "$WORKTREE" "$OTHER_REPO" "$TEST_TMP/owned-a" "$TEST_TMP/owned-b" <<'NODE'
const fs = require('fs');
const path = require('path');
const [root, repo, worktree, other, ownedA, ownedB] = process.argv.slice(2);
const replacements = new Map([
  ['__REPO__', repo],
  ['__WORKTREE__', worktree],
  ['__OTHER_REPO__', other],
  ['__OWNED_A__', ownedA],
  ['__OWNED_B__', ownedB],
]);
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(target);
    else {
      let value = fs.readFileSync(target, 'utf8');
      for (const [from, to] of replacements) value = value.split(from).join(to);
      fs.writeFileSync(target, value);
    }
  }
}
visit(root);
NODE

OUT="$(node "$SCRIPT" --no-git --json --days 7 \
  --now 2026-07-28T12:00:00.000Z \
  --repo "$REPO" \
  --claude-root "$CORPUS/claude" \
  --codex-root "$CORPUS/codex" 2>&1)"
EXIT=$?
assert_eq "0" "$EXIT" "multi-harness collection exits zero"
assert_fields <<'EOF'
coverage.included_sessions	2	repo + linked worktree sessions included
transcript.sessions	2	compatible session count aggregates included sessions
provenance.0.candidate_count	1	one recent Claude candidate
provenance.0.included_count	1	Claude repo session included
provenance.0.attribution_confidence.canonical_worktree	1	Claude attribution uses canonical repo identity
provenance.1.candidate_count	2	Codex date pruning excludes old date
provenance.1.included_count	1	Codex linked-worktree session included
provenance.1.attribution_confidence.canonical_worktree	1	Codex attribution uses linked-worktree identity
provenance.1.excluded_count	1	unrelated Codex repo excluded
provenance.1.exclusion_reasons.different_repository	1	unrelated exclusion is explained
provenance.1.parse_error_count	1	malformed line is counted without discarding session
transcript.impl_dispatch	1	Claude implementation-shaped dispatch normalizes
transcript.review_dispatch	1	Codex review dispatch normalizes
loop_metrics.deterministic.provider_dispatches.value	2	provider dispatches counted deterministically
loop_metrics.deterministic.provider_dispatch_results.value	2	provider results counted deterministically
loop_metrics.deterministic.provider_reroutes.value	1	same-ticket provider change is one reroute
loop_metrics.deterministic.transport_failures.value	1	structured failed result is one transport failure
loop_metrics.deterministic.controller_tickets.value	1	one controller ticket fingerprint
loop_metrics.deterministic.ticket_continuations.value	1	two ticket generations produce one continuation
loop_metrics.deterministic.review_generations.value	2	two review generations retained
loop_metrics.deterministic.worktrees.created.value	2	two owned worktree creates
loop_metrics.deterministic.worktrees.removed.value	2	two owned worktree removals
loop_metrics.deterministic.worktrees.high_water_mark.value	2	paired lifecycle produces high-water two
loop_metrics.deterministic.code_ready_to_merge_ready_ms.value	300000	code-ready to merge-ready duration uses structured timestamps
loop_metrics.heuristic.user_corrections.value	1	user correction is labeled heuristic
loop_metrics.heuristic.status_reversals.value	1	status reversal is labeled heuristic
normalized_event_contract.raw_content_emitted	false	normalized contract declares aggregate-only output
EOF
for sentinel in \
  RAW_PROMPT_SENTINEL RAW_TOOL_OUTPUT_SENTINEL RAW_CODEX_PROMPT_SENTINEL \
  RAW_REASONING_SENTINEL RAW_NON_TRANSPORT_FAILURE RAW_UNRELATED_SENTINEL \
  RAW_OLD_SENTINEL
do
  assert_not_contains "$OUT" "$sentinel" "$sentinel is redacted"
done

# Direct adapter contract: both harness shapes produce valid provider_dispatch
# normalized events, and a raw text field invalidates the contract.
NORMALIZED_DOC="$TEST_TMP/normalized-event.json"
CONTRACT_OUT="$(node - "$REPO_ROOT" "$CORPUS" "$NORMALIZED_DOC" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const corpus = process.argv[3];
const document = process.argv[4];
const { scanTranscriptAdapters, validateNormalizedEvent } =
  require(path.join(root, 'scripts/lib/transcript-adapters'));
const { validateJsonSchema } = require(path.join(root, 'scripts/validate-json-schema.js'));
const schema = JSON.parse(fs.readFileSync(
  path.join(root, 'schemas/normalized-transcript-event.schema.json'),
  'utf8',
));
const scans = scanTranscriptAdapters([
  { harness: 'claude', root: path.join(corpus, 'claude') },
  { harness: 'codex', root: path.join(corpus, 'codex') },
], {
  cutoffMs: Date.parse('2026-07-21T12:00:00.000Z'),
  nowMs: Date.parse('2026-07-28T12:00:00.000Z'),
});
const events = scans.flatMap((scan) => scan.sessions.flatMap((session) => session.events));
const dispatches = events.filter((event) => event.category === 'provider_dispatch');
const poisoned = { ...dispatches[0], text: 'forbidden' };
const partialControl = {
  ...dispatches[0],
  control: {
    dispatch_kind: dispatches[0].control.dispatch_kind,
  },
};
fs.writeFileSync(document, `${JSON.stringify(dispatches[0], null, 2)}\n`);
process.stdout.write(JSON.stringify({
  harnesses: dispatches.map((event) => event.harness).sort().join(','),
  valid: dispatches.every(validateNormalizedEvent),
  schema_all: events.every((event) => validateJsonSchema(schema, event).valid),
  raw_field_rejected: !validateNormalizedEvent(poisoned),
  partial_control_rejected:
    !validateNormalizedEvent(partialControl)
    && !validateJsonSchema(schema, partialControl).valid,
}));
NODE
)"
while IFS=$'\t' read -r key expected msg; do
  [ -n "$key" ] || continue
  assert_eq "$expected" "$(printf '%s' "$CONTRACT_OUT" | json_field "$key")" "$msg"
done <<'EOF'
harnesses	claude,codex	both harnesses normalize to provider_dispatch
valid	true	normalized events satisfy runtime contract
schema_all	true	every normalized fixture event satisfies shipped JSON schema
raw_field_rejected	true	raw text is rejected by normalized contract
partial_control_rejected	true	runtime and schema reject partial nested control objects
EOF
assert_file_exists "$SCHEMA" "normalized event schema is shipped"
SCHEMA_OUT="$(node "$REPO_ROOT/scripts/validate-json-schema.js" \
  --schema "$SCHEMA" --document "$NORMALIZED_DOC" 2>&1)"
SCHEMA_EXIT=$?
assert_eq "0" "$SCHEMA_EXIT" "normalized event passes shipped JSON schema"
assert_contains "$SCHEMA_OUT" '"valid": true' "schema validator confirms normalized event"

# Bounded line reads remain visible in provenance.
OUT="$(node "$SCRIPT" --no-git --json --days 7 \
  --now 2026-07-28T12:00:00.000Z \
  --repo "$REPO" \
  --claude-root "$CORPUS/claude" \
  --codex-root "$CORPUS/codex" \
  --max-lines 3 2>&1)"
assert_fields <<'EOF'
provenance.0.bounds.line_limit_hit	1	Claude line bound is reported
provenance.1.bounds.line_limit_hit	1	Codex line bound is reported
EOF
assert_not_contains "$OUT" "RAW_REASONING_SENTINEL" "bounded output stays redacted"

# Aggregate byte budget is deterministic and records every un-read candidate.
OUT="$(node "$SCRIPT" --no-git --json --days 7 \
  --now 2026-07-28T12:00:00.000Z \
  --repo "$REPO" \
  --claude-root "$CORPUS/claude" \
  --codex-root "$CORPUS/codex" \
  --max-total-bytes 1 2>&1)"
assert_fields <<'EOF'
provenance.0.bounds.scan_budget_exceeded	1	aggregate budget skips Claude candidate
provenance.1.bounds.scan_budget_exceeded	2	aggregate budget skips both recent Codex candidates
EOF
assert_eq "scan_budget_exceeded" \
  "$(printf '%s' "$OUT" | node -e '
    const value = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const reasons = value.provenance.flatMap((entry) => Object.keys(entry.exclusion_reasons));
    process.stdout.write(reasons.includes("scan_budget_exceeded") ? "scan_budget_exceeded" : "missing");
  ')" "aggregate budget exclusion is explicit"

# A supported root with recent candidates but zero attribution must warn in JSON
# and human output. Missing roots remain not_present rather than errors.
ZERO_ROOT="$TEST_TMP/zero-root"
mkdir -p "$ZERO_ROOT/2026/07/27"
cp "$CORPUS/codex/2026/07/27/rollout-unrelated.jsonl" \
  "$ZERO_ROOT/2026/07/27/rollout-unrelated.jsonl"
OUT="$(node "$SCRIPT" --no-git --json --days 7 \
  --now 2026-07-28T12:00:00.000Z \
  --repo "$REPO" \
  --claude-root "$TEST_TMP/missing-claude" \
  --codex-root "$ZERO_ROOT" 2>&1)"
assert_fields <<'EOF'
provenance.0.status	not_present	missing Claude root is not_present
provenance.1.included_count	0	supported Codex root includes zero
EOF
assert_contains "$(field coverage.warnings.0)" "zero included" "JSON reports silent-zero warning"

HUMAN="$(node "$SCRIPT" --no-git --days 7 \
  --now 2026-07-28T12:00:00.000Z \
  --repo "$REPO" \
  --claude-root "$TEST_TMP/missing-claude" \
  --codex-root "$ZERO_ROOT" 2>&1)"
for needle_msg in \
  $'Transcript Coverage\thuman output leads with coverage' \
  $'WARNING:\thuman output renders zero-inclusion warning' \
  $'unknown (\thuman output renders insufficient evidence as unknown'
do
  needle="${needle_msg%%$'\t'*}"
  msg="${needle_msg#*$'\t'}"
  assert_contains "$HUMAN" "$needle" "$msg"
done
assert_not_contains "$HUMAN" "RAW_UNRELATED_SENTINEL" "human output is content-redacted"

# ---------------------------------------------------------------------------
# Git signals are read from --repo, never from the process cwd. The target repo
# name contains shell metacharacters to prove it remains one argv value.
# ---------------------------------------------------------------------------
GIT_CWD="$TEST_TMP/git-cwd"
GIT_INJECTED="$TEST_TMP/git-injected"
GIT_TARGET="$TEST_TMP/git-target;touch $GIT_INJECTED"
for repository in "$GIT_CWD" "$GIT_TARGET"; do
  mkdir -p "$repository"
  git -C "$repository" init -q -b main
  git -C "$repository" config user.email fixture@example.invalid
  git -C "$repository" config user.name Fixture
done
printf 'cwd\n' >"$GIT_CWD/file.txt"
git -C "$GIT_CWD" add file.txt
git -C "$GIT_CWD" commit -q -m "review round 9 qc pass"
git -C "$GIT_CWD" update-ref refs/remotes/origin/develop HEAD
printf 'target\n' >"$GIT_TARGET/file.txt"
git -C "$GIT_TARGET" add file.txt
git -C "$GIT_TARGET" commit -q -m "converged SHIP-AS-IS v2.99.1"
git -C "$GIT_TARGET" update-ref refs/remotes/origin/develop HEAD
OUT="$(
  cd "$GIT_CWD"
  node "$SCRIPT" --json --days 7 \
    --repo "$GIT_TARGET" \
    --claude-root "$TEST_TMP/missing-git-claude" \
    --codex-root "$TEST_TMP/missing-git-codex" 2>&1
)"
assert_fields <<'EOF'
git_signals.available	true	--repo git history is available
git_signals.review_rounds	0	process cwd review marker is ignored
git_signals.qc_verdicts	0	process cwd QC marker is ignored
git_signals.converged	1	queried repo convergence marker wins
git_signals.versions	1	queried repo version marker wins
EOF
assert_file_absent "$GIT_INJECTED" "--repo shell metacharacters cannot execute"

# ---------------------------------------------------------------------------
# A transport signal counts only when it is the result bound to a provider
# dispatch. An unrelated failed process in the same session is not causal.
# ---------------------------------------------------------------------------
TRANSPORT_ROOT="$TEST_TMP/transport-binding"
mkdir -p "$TRANSPORT_ROOT"
{
  printf '%s\n' '{"type":"system","sessionId":"binding","timestamp":"2026-07-27T09:00:00.000Z","cwd":"__REPO__"}'
  printf '%s\n' '{"type":"assistant","sessionId":"binding","timestamp":"2026-07-27T09:00:01.000Z","cwd":"__REPO__","message":{"role":"assistant","content":[{"type":"tool_use","id":"provider-ok","name":"Bash","input":{"command":"bash scripts/dispatch-review.sh --runner grok --ticket-id bound-ticket --generation 1"}}]}}'
  printf '%s\n' '{"type":"user","sessionId":"binding","timestamp":"2026-07-27T09:00:02.000Z","cwd":"__REPO__","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"provider-ok","status":"success","content":"{\"exit_code\":0,\"status\":\"reviewed\"}"}]}}'
  printf '%s\n' '{"type":"assistant","sessionId":"binding","timestamp":"2026-07-27T09:00:03.000Z","cwd":"__REPO__","message":{"role":"assistant","content":[{"type":"tool_use","id":"ordinary-failure","name":"Bash","input":{"command":"git status --not-a-real-option"}}]}}'
  printf '%s\n' '{"type":"user","sessionId":"binding","timestamp":"2026-07-27T09:00:04.000Z","cwd":"__REPO__","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"ordinary-failure","is_error":true,"content":"{\"exit_code\":2,\"status\":\"transport_failed\"}"}]}}'
} | sed "s|__REPO__|$REPO|g" >"$TRANSPORT_ROOT/session.jsonl"
OUT="$(node "$SCRIPT" --no-git --json --days 7 \
  --now 2026-07-28T12:00:00.000Z \
  --repo "$REPO" \
  --claude-root "$TRANSPORT_ROOT" \
  --codex-root "$TEST_TMP/missing-binding-codex" 2>&1)"
assert_fields <<'EOF'
loop_metrics.deterministic.provider_dispatch_results.value	1	one provider result is causally bound
loop_metrics.deterministic.transport_failures.status	known	complete bound result evidence supports a known zero
loop_metrics.deterministic.transport_failures.value	0	unrelated process transport signal is not a provider failure
EOF

# ---------------------------------------------------------------------------
# Repo attribution uses the whole session, while all counters use the closed
# [cutoff, now] event projection. Timestamp-less attributable events are
# excluded and make the observation incomplete.
# ---------------------------------------------------------------------------
WINDOW_ROOT="$TEST_TMP/window-projection"
mkdir -p "$WINDOW_ROOT"
{
  printf '%s\n' '{"type":"system","sessionId":"window","timestamp":"2026-07-21T12:00:00.000Z","cwd":"__REPO__"}'
  printf '%s\n' '{"type":"assistant","sessionId":"window","timestamp":"2026-07-21T11:59:59.999Z","cwd":"__REPO__","message":{"role":"assistant","content":[{"type":"tool_use","id":"before","name":"Bash","input":{"command":"bash scripts/dispatch-review.sh --runner grok"}}]}}'
  printf '%s\n' '{"type":"assistant","sessionId":"window","timestamp":"2026-07-21T12:00:00.000Z","cwd":"__REPO__","message":{"role":"assistant","content":[{"type":"tool_use","id":"cutoff","name":"Bash","input":{"command":"bash scripts/dispatch-review.sh --runner grok"}}]}}'
  printf '%s\n' '{"type":"assistant","sessionId":"window","timestamp":"2026-07-28T12:00:00.000Z","cwd":"__REPO__","message":{"role":"assistant","content":[{"type":"tool_use","id":"now","name":"Bash","input":{"command":"bash scripts/dispatch-review.sh --runner grok"}}]}}'
  printf '%s\n' '{"type":"assistant","sessionId":"window","timestamp":"2026-07-28T12:00:00.001Z","cwd":"__REPO__","message":{"role":"assistant","content":[{"type":"tool_use","id":"future","name":"Bash","input":{"command":"bash scripts/dispatch-review.sh --runner grok"}}]}}'
  printf '%s\n' '{"type":"assistant","sessionId":"window","cwd":"__REPO__","message":{"role":"assistant","content":[{"type":"tool_use","id":"timestamp-less","name":"Bash","input":{"command":"bash scripts/dispatch-review.sh --runner grok"}}]}}'
} | sed "s|__REPO__|$REPO|g" >"$WINDOW_ROOT/session.jsonl"
OUT="$(node "$SCRIPT" --no-git --json --days 7 \
  --now 2026-07-28T12:00:00.000Z \
  --repo "$REPO" \
  --claude-root "$WINDOW_ROOT" \
  --codex-root "$TEST_TMP/missing-window-codex" 2>&1)"
assert_fields <<'EOF'
coverage.included_sessions	1	whole session supplies repo attribution
coverage.metric_window.interval	closed	metric interval is documented
provenance.0.metric_projection.before_window_event_count	1	pre-cutoff event is excluded
provenance.0.metric_projection.after_window_event_count	1	future event is excluded
provenance.0.metric_projection.missing_timestamp_event_count	1	timestamp-less event is excluded
loop_metrics.deterministic.provider_dispatches.value	2	cutoff and now boundaries are both included
loop_metrics.deterministic.provider_dispatches.status	incomplete	timestamp-less event prevents a falsely exact count
EOF
assert_contains "$(field loop_metrics.deterministic.provider_dispatches.reason)" \
  "missing_timestamp" "timestamp gap is carried into metric provenance"
HUMAN_INCOMPLETE="$(node "$SCRIPT" --no-git --days 7 \
  --now 2026-07-28T12:00:00.000Z \
  --repo "$REPO" \
  --claude-root "$WINDOW_ROOT" \
  --codex-root "$TEST_TMP/missing-window-codex" 2>&1)"
assert_contains "$HUMAN_INCOMPLETE" "metric evidence: incomplete" \
  "human output labels incomplete evidence"
assert_contains "$HUMAN_INCOMPLETE" "incomplete (observed 2;" \
  "human output does not present a partial positive count as exact"

# ---------------------------------------------------------------------------
# Every bounded/invalid read mode prevents an observed absence from becoming a
# numeric zero. Table: extra args / setup → status path + reason needle.
# ---------------------------------------------------------------------------
assert_incomplete_transport() {
  local status_path="$1" status_expected="$2" reason_path="$3" reason_needle="$4" msg="$5"
  shift 5
  OUT="$(node "$SCRIPT" --no-git --json --days 7 \
    --now 2026-07-28T12:00:00.000Z \
    --repo "$REPO" \
    --claude-root "$1" \
    --codex-root "$2" \
    ${3:+$3} ${4:+$4} 2>&1)"
  assert_eq "$status_expected" "$(field "$status_path")" "$msg"
  assert_contains "$(field "$reason_path")" "$reason_needle" "${reason_needle} reason is propagated"
}

assert_incomplete_transport \
  loop_metrics.deterministic.transport_failures.status unknown \
  loop_metrics.deterministic.transport_failures.reason line_limit \
  "line truncation cannot prove zero transport failures" \
  "$TRANSPORT_ROOT" "$TEST_TMP/missing-lines-codex" --max-lines 2

assert_incomplete_transport \
  loop_metrics.deterministic.transport_failures.status unknown \
  loop_metrics.deterministic.transport_failures.reason byte_limit \
  "byte truncation cannot prove zero transport failures" \
  "$TRANSPORT_ROOT" "$TEST_TMP/missing-bytes-codex" --max-file-bytes 220

assert_incomplete_transport \
  loop_metrics.deterministic.provider_dispatches.status unknown \
  loop_metrics.deterministic.provider_dispatches.reason scan_budget_exceeded \
  "scan budget exhaustion cannot prove zero dispatches" \
  "$TRANSPORT_ROOT" "$TEST_TMP/missing-budget-codex" --max-total-bytes 1

UNREADABLE_ROOT="$TEST_TMP/unreadable-root"
printf 'not a directory\n' >"$UNREADABLE_ROOT"
assert_incomplete_transport \
  loop_metrics.deterministic.provider_dispatches.status unknown \
  loop_metrics.deterministic.provider_dispatches.reason root_unreadable \
  "unreadable root cannot prove zero dispatches" \
  "$UNREADABLE_ROOT" "$TEST_TMP/missing-unreadable-codex"

SCHEMA_ROOT="$TEST_TMP/schema-invalid"
mkdir -p "$SCHEMA_ROOT"
LONG_TOOL_NAME="$(printf 'x%.0s' {1..300})"
{
  printf '%s\n' '{"type":"system","sessionId":"schema","timestamp":"2026-07-27T09:00:00.000Z","cwd":"__REPO__"}'
  printf '%s\n' "{\"type\":\"assistant\",\"sessionId\":\"schema\",\"timestamp\":\"2026-07-27T09:00:01.000Z\",\"cwd\":\"__REPO__\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"id\":\"invalid\",\"name\":\"$LONG_TOOL_NAME\",\"input\":{}}]}}"
} | sed "s|__REPO__|$REPO|g" >"$SCHEMA_ROOT/session.jsonl"
OUT="$(node "$SCRIPT" --no-git --json --days 7 \
  --now 2026-07-28T12:00:00.000Z \
  --repo "$REPO" \
  --claude-root "$SCHEMA_ROOT" \
  --codex-root "$TEST_TMP/missing-schema-codex" 2>&1)"
assert_eq "1" "$(field provenance.0.schema_error_count)" "schema-invalid event is recorded"
assert_eq "unknown" "$(field loop_metrics.deterministic.provider_dispatches.status)" \
  "schema-invalid evidence cannot prove zero dispatches"
assert_contains "$(field loop_metrics.deterministic.provider_dispatches.reason)" \
  "schema_invalid" "schema-invalid reason is propagated"

PARSE_ROOT="$TEST_TMP/parse-incomplete"
mkdir -p "$PARSE_ROOT"
{
  printf '%s\n' "{\"type\":\"system\",\"sessionId\":\"parse\",\"timestamp\":\"2026-07-27T09:00:00.000Z\",\"cwd\":\"$REPO\"}"
  printf '%s\n' '{malformed'
} >"$PARSE_ROOT/session.jsonl"
OUT="$(node "$SCRIPT" --no-git --json --days 7 \
  --now 2026-07-28T12:00:00.000Z \
  --repo "$REPO" \
  --claude-root "$PARSE_ROOT" \
  --codex-root "$TEST_TMP/missing-parse-codex" 2>&1)"
assert_eq "1" "$(field provenance.0.parse_error_count)" "parse-incomplete row is recorded"
assert_eq "unknown" "$(field loop_metrics.deterministic.provider_dispatches.status)" \
  "parse-incomplete evidence cannot prove zero dispatches"
assert_contains "$(field loop_metrics.deterministic.provider_dispatches.reason)" \
  "parse_incomplete" "parse-incomplete reason is propagated"

# Canonical ↔ Codex mirror byte identity for sealed dual-homed surfaces.
MIRROR_PAIRS=(
  scripts/retro-review-loop.js:platforms/codex/plugin/scripts/retro-review-loop.js
  scripts/lib/retro-loop-metrics.js:platforms/codex/plugin/scripts/lib/retro-loop-metrics.js
  scripts/lib/transcript-attribution.js:platforms/codex/plugin/scripts/lib/transcript-attribution.js
  scripts/lib/transcript-adapters/common.js:platforms/codex/plugin/scripts/lib/transcript-adapters/common.js
  scripts/lib/transcript-adapters/claude.js:platforms/codex/plugin/scripts/lib/transcript-adapters/claude.js
  scripts/lib/transcript-adapters/codex.js:platforms/codex/plugin/scripts/lib/transcript-adapters/codex.js
  scripts/lib/transcript-adapters/index.js:platforms/codex/plugin/scripts/lib/transcript-adapters/index.js
  schemas/normalized-transcript-event.schema.json:platforms/codex/plugin/schemas/normalized-transcript-event.schema.json
  skills/retro/SKILL.md:platforms/codex/plugin/skills/retro/SKILL.md
  skills/retro/references/data-collection.md:platforms/codex/plugin/skills/retro/references/data-collection.md
  skills/retro/references/report-templates.md:platforms/codex/plugin/skills/retro/references/report-templates.md
)
for pair in "${MIRROR_PAIRS[@]}"; do
  left="${pair%%:*}"
  right="${pair#*:}"
  cmp -s "$REPO_ROOT/$left" "$REPO_ROOT/$right"
  assert_eq "0" "$?" "canonical/Codex mirror byte identity: $left"
done

finalize_test
