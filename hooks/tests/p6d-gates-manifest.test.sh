#!/usr/bin/env bash
# KR2 pre-commit manifest gate (plan R2' P1/P2, GO recorded 2026-08-21):
# (1) equivalence corpus — check-disjointness --staged must agree with the
#     proven --range comparator on identical path sets (one matcher, two inputs);
# (2) in-situ wrapper interception — dispatch-hetero's edit-only capture path
#     (`git add -A`) refuses to CREATE the commit when staged paths escape the
#     contract allowlist (the exact P6D broad-staging shape).
. "$(dirname "$0")/lib.sh"
enable_legacy_scorecard_test_projection

CDJ="$REPO_ROOT/scripts/check-disjointness.sh"

# ── part 1: equivalence corpus ──
CORPUS="$TEST_TMP/corpus"; mkdir -p "$CORPUS"
git -C "$CORPUS" init -q -b main
git -C "$CORPUS" config user.email t@t; git -C "$CORPUS" config user.name t
mkdir -p "$CORPUS/a" "$CORPUS/secret"
printf 'x\n' > "$CORPUS/a/one.txt"; printf 'x\n' > "$CORPUS/a/two.txt"; printf 's\n' > "$CORPUS/secret/k.txt"
git -C "$CORPUS" add -A && git -C "$CORPUS" commit -qm base
BASE=$(git -C "$CORPUS" rev-parse HEAD)
ALLOW="$TEST_TMP/allow.txt"; printf 'a/\n' > "$ALLOW"
DENY="$TEST_TMP/deny.txt"; printf 'secret/.*\n' > "$DENY"

# case runner: apply mutation fn, compare staged verdict vs post-commit verdict
corpus_case() {
  local name="$1"; shift
  git -C "$CORPUS" reset -q --hard "$BASE"; git -C "$CORPUS" clean -qfd
  "$@"                                  # mutate worktree
  git -C "$CORPUS" add -A
  local staged_rc range_rc
  "$CDJ" validate --staged --repo "$CORPUS" --no-default-deny --allow-file "$ALLOW" --deny-file "$DENY" >/dev/null 2>&1 && staged_rc=0 || staged_rc=$?
  git -C "$CORPUS" -c commit.gpgsign=false commit -qm "$name" --no-verify
  "$CDJ" validate --range "$BASE..$(git -C "$CORPUS" rev-parse HEAD)" --repo "$CORPUS" --no-default-deny --allow-file "$ALLOW" --deny-file "$DENY" >/dev/null 2>&1 && range_rc=0 || range_rc=$?
  assert_eq "$staged_rc" "$range_rc" "equivalence[$name]: staged verdict == post-commit verdict (staged=$staged_rc range=$range_rc)"
  printf '%s' "$staged_rc"
}

RC=$(corpus_case "subset-full" bash -c "printf 'e\n' >> '$CORPUS/a/one.txt'; printf 'e\n' >> '$CORPUS/a/two.txt'")
assert_eq "$RC" "0" "full in-allowlist edit passes"
RC=$(corpus_case "subset-partial" bash -c "printf 'e\n' >> '$CORPUS/a/one.txt'")
assert_eq "$RC" "0" "partial subset (4-of-6 analogue) passes"
RC=$(corpus_case "extra-symlinks" bash -c "printf 'e\n' >> '$CORPUS/a/one.txt'; ln -s /tmp '$CORPUS/venv-link'; ln -s /tmp '$CORPUS/nm-link'")
assert_neq "0" "$RC" "P6D shape: two stray symlinks fail (both views)"
RC=$(corpus_case "rename-out" bash -c "git -C '$CORPUS' mv a/one.txt escaped.txt")
assert_neq "0" "$RC" "rename to outside allowlist fails (rename = delete+add)"
RC=$(corpus_case "delete-allowed" bash -c "git -C '$CORPUS' rm -q a/two.txt")
assert_eq "$RC" "0" "deletion of an allowed path passes"
RC=$(corpus_case "deny-hit" bash -c "printf 'e\n' >> '$CORPUS/secret/k.txt'")
assert_neq "0" "$RC" "deny hit fails (both views)"

# ── part 2: in-situ wrapper interception ──
ENGINE_SCORES_DIR="$TEST_TMP/engine-scores"; ENGINE_CAPS_DIR="$TEST_TMP/engine-caps"
mkdir -p "$ENGINE_SCORES_DIR" "$ENGINE_CAPS_DIR"
ENGINE_ROW='{"engine":"gpt-5.3-codex-spark","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}'
RUNTIME_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ENGINE_EVENT="{\"schema_version\":1,\"observed_at\":\"$RUNTIME_UTC\",\"runner\":\"codex\",\"model\":\"gpt-5.3-codex-spark\",\"role\":\"implementer\",\"effort\":\"high\",\"endpoint\":null,\"runner_version\":\"v1.0.0\",\"capability\":{\"quota\":{\"status\":\"available\",\"confidence\":\"high\",\"ttl_seconds\":3600,\"reset_at\":null,\"evidence\":\"test\"}}}"
printf '%s\n' "$ENGINE_ROW" > "$TEST_TMP/engine-row.json"
printf '%s\n' "$ENGINE_EVENT" > "$TEST_TMP/engine-event.json"
ENGINE_SCORECARD_DIR="$ENGINE_SCORES_DIR" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$TEST_TMP/engine-row.json" >/dev/null || fail "scorecard seed"
ENGINE_CAPABILITY_DIR="$ENGINE_CAPS_DIR" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$TEST_TMP/engine-event.json" >/dev/null || fail "capability seed"

MINI="$TEST_TMP/mini"; mkdir -p "$MINI"
git -C "$MINI" init -q -b main; git -C "$MINI" config user.email t@t; git -C "$MINI" config user.name t
mkdir -p "$MINI/docs/plans"
printf 'seed\n' > "$MINI/seed.txt"
printf '# Unit spec\nfixture\n' > "$MINI/docs/plans/spec.md"
git -C "$MINI" add -A; git -C "$MINI" commit -qm dep
DEP_SHA=$(git -C "$MINI" rev-parse HEAD)
printf 'seed2\n' >> "$MINI/seed.txt"
mkdir -p "$MINI/.claude"
printf '# Review Loop Config\n- implementer_engine: gpt-5.3-codex-spark\n- implementer_runner: codex\n' > "$MINI/.claude/review-loop-config.md"
git -C "$MINI" add -A; git -C "$MINI" commit -qm seed
BASE_SHA=$(git -C "$MINI" rev-parse HEAD)

# stub: edit-only worker — writes an allowed file AND two stray symlinks, NO commit
STUB="$TEST_TMP/stub-codex"
cat > "$STUB" <<'EOF_STUB'
#!/usr/bin/env bash
case "$*" in
  *"exec --help"*) printf -- '--dangerously-bypass-approvals-and-sandbox\n--dangerously-bypass-hook-trust\n'; exit 0 ;;
  *"--version"*)   echo "codex-cli 9.9.9 (test stub)"; exit 0 ;;
esac
printf 'done\n' > done.txt
ln -s /tmp .venv
ln -s /tmp node_modules
exit 0
EOF_STUB
chmod +x "$STUB"

CONTRACT="$TEST_TMP/contract.json"
cat > "$CONTRACT" <<EOF_C
{
  "schema": 1,
  "unit_id": "p6d-manifest-unit",
  "role": "implementer",
  "goal": "fixture",
  "spec": {"path": "docs/plans/spec.md", "section": "Unit spec"},
  "base_sha": "$BASE_SHA",
  "depends_on": ["$DEP_SHA"],
  "scope": {"allow_paths": ["done.txt"], "deny_paths": ["secret/**"], "max_files": 4, "max_diff_lines": 50},
  "go": {"required_paths": ["docs/plans/spec.md"], "required_engine_role": "implementer", "required_red_command": ["bash", "-n", "docs/plans/spec.md"]},
  "no_go": {"on_missing_spec": "stop", "on_dirty_base": "stop", "on_unknown_engine": "stop", "on_quota_unavailable": "stop", "on_scope_violation": "stop", "on_budget_exceeded": "stop", "on_clarification_needed": "stop", "forbidden_actions": ["push", "merge", "network", "dependency-change"]},
  "output": {"kind": "commit", "paths": ["done.txt"]},
  "acceptance": [{"argv": ["true"], "exit": 0}],
  "budget": {"wall_seconds": 120, "max_attempts": 1, "max_context_files": 4}
}
EOF_C

CASE_TMP="$TEST_TMP/case-insitu"; mkdir -p "$CASE_TMP"
printf 'Do the needful.\n' > "$TEST_TMP/prompt.txt"
OUT=$(
  cd "$MINI" || exit 9
  ENGINE_SCORECARD_DIR="$ENGINE_SCORES_DIR" ENGINE_CAPABILITY_DIR="$ENGINE_CAPS_DIR" \
  AUTOPILOT_DISPATCH_MANIFEST=0 DISPATCH_QUIET=1 \
  TMPDIR="$CASE_TMP" \
  "$REPO_ROOT/scripts/dispatch-hetero.sh" \
    --branch p6d-m1 --prompt-file "$TEST_TMP/prompt.txt" \
    --runner codex --model gpt-5.3-codex-spark --codex-bin "$STUB" \
    --strict-contract --contract-file "$CONTRACT" 2>&1
)
RC=$?
JSON=$(echo "$OUT" | grep '^{' | tail -n 1)
assert_neq "0" "$RC" "in-situ: run exits nonzero"
assert_contains "$JSON" '"status": "boundary_rejected"' "in-situ: status boundary_rejected"
assert_contains "$JSON" "pre-commit manifest gate" "in-situ: refusal names the PRE-COMMIT gate (not postcheck)"
assert_contains "$JSON" "commit NOT created" "in-situ: explanation-first refusal"
WT_PATH=$(echo "$JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).worktree||'')}catch(e){console.log('')}})")
if [ -n "$WT_PATH" ] && [ -d "$WT_PATH" ]; then
  assert_eq "$(git -C "$WT_PATH" rev-parse HEAD)" "$BASE_SHA" "in-situ: NO commit was created (HEAD == base)"
  assert_contains "$(git -C "$WT_PATH" diff --cached --name-only | sort | tr '\n' ' ')" ".venv" "in-situ: extras remain staged for in-place repair"
else
  fail "in-situ: worktree path missing from envelope ($JSON)"
fi

finalize_test
