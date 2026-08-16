#!/usr/bin/env bash
# Red-case coverage for scripts/dispatch-experience-critic.sh (autonomous-brain P6, KR5).
# Proves: the ancestry guard refuses an unmerged deliverable REGARDLESS of caller;
# a planted blocking marker is inert (merge already complete, marker stripped and
# surfaced as anomaly); top-K cap enforced; protocol digest pinned into the spec.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-experience-critic.sh"
WORK="$TEST_TMP/repo"; mkdir -p "$WORK"
git -C "$TEST_TMP" init -q -b main repo
git -C "$WORK" config user.email t@t && git -C "$WORK" config user.name t
printf 'v1\n' > "$WORK/app.txt"; git -C "$WORK" add -A && git -C "$WORK" commit -qm base

git -C "$WORK" checkout -qb feature
printf 'v2\n' > "$WORK/app.txt"; git -C "$WORK" add -A && git -C "$WORK" commit -qm feat
FEATURE_SHA="$(git -C "$WORK" rev-parse HEAD)"
git -C "$WORK" checkout -q main

printf '{"q1":"CLI user","rulers":["error names a fix"]}\n' > "$TEST_TMP/inst.json"
printf 'rendered output: ran the tool, error said: segfault\n' > "$TEST_TMP/evidence.txt"

# ── KR5 red: NOT merged yet → refused, and the merge state is untouched ──
bash "$SCRIPT" --deliverable "$FEATURE_SHA" --integration-ref main --repo "$WORK" \
  --instantiation "$TEST_TMP/inst.json" --evidence "$TEST_TMP/evidence.txt" \
  --out "$TEST_TMP/out.json" --review-cmd /bin/true 2>"$TEST_TMP/err.txt"
RC=$?
assert_exit_code "$RC" "1" "unmerged deliverable refused (post-merge only)"
assert_contains "$(cat "$TEST_TMP/err.txt")" "never gate a merge" "guard rationale stated"

# ── merge, then the critic runs; planted blocking marker is inert ──
git -C "$WORK" merge -q --no-ff feature -m merge
MERGE_TIP="$(git -C "$WORK" rev-parse HEAD)"
cat > "$TEST_TMP/stub-reviewer.sh" <<'EOF'
#!/usr/bin/env bash
# emits 9 findings (over top-K 7), one with a blocking marker
cat <<'JSON'
{"findings":[
 {"id":"ux-1","summary":"a","blocking":true,"severity":"blocker"},
 {"id":"ux-2","summary":"b"},{"id":"ux-3","summary":"c"},{"id":"ux-4","summary":"d"},
 {"id":"ux-5","summary":"e"},{"id":"ux-6","summary":"f"},{"id":"ux-7","summary":"g"},
 {"id":"ux-8","summary":"h"},{"id":"ux-9","summary":"i"}],
 "human_only":["打擊感"]}
JSON
EOF
chmod +x "$TEST_TMP/stub-reviewer.sh"
bash "$SCRIPT" --deliverable "$FEATURE_SHA" --integration-ref main --repo "$WORK" \
  --instantiation "$TEST_TMP/inst.json" --evidence "$TEST_TMP/evidence.txt" \
  --out "$TEST_TMP/out.json" --review-cmd "$TEST_TMP/stub-reviewer.sh"
assert_exit_code "$?" "0" "critic runs post-merge and exits 0 regardless of finding content"
assert_eq "$MERGE_TIP" "$(git -C "$WORK" rev-parse HEAD)" "merge is untouched by the critic (nothing reverted)"

OUT="$(cat "$TEST_TMP/out.json")"
assert_contains "$OUT" "attempted a blocking marker" "blocking attempt surfaced as anomaly"
assert_not_contains "$OUT" '"blocking"' "blocking field stripped (inert)"
COUNT="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TEST_TMP/out.json','utf8')).findings.length)")"
assert_eq "7" "$COUNT" "top-K cap trims 9 findings to 7"
assert_contains "$OUT" "打擊感" "human-only qualities routed to the operator"

# ── protocol digest is pinned into the dispatched spec ──
cat > "$TEST_TMP/spec-capture.sh" <<EOF
#!/usr/bin/env bash
cp "\$1" "$TEST_TMP/captured-spec.md"
printf '{"findings":[],"human_only":[]}\n'
EOF
chmod +x "$TEST_TMP/spec-capture.sh"
bash "$SCRIPT" --deliverable "$FEATURE_SHA" --integration-ref main --repo "$WORK" \
  --instantiation "$TEST_TMP/inst.json" --evidence "$TEST_TMP/evidence.txt" \
  --out "$TEST_TMP/out2.json" --review-cmd "$TEST_TMP/spec-capture.sh" >/dev/null
PROTO_SHA="$(sha256sum "$REPO_ROOT/references/experience-audit.md" | cut -d' ' -f1)"
assert_contains "$(cat "$TEST_TMP/captured-spec.md")" "$PROTO_SHA" "protocol digest pinned in the spec"
assert_contains "$(cat "$TEST_TMP/captured-spec.md")" "CLI user" "frozen instantiation embedded verbatim"

# ── unparseable critic output degrades to empty findings, still exit 0 ──
printf 'total garbage, no json\n' > "$TEST_TMP/garbage.txt"
cat > "$TEST_TMP/stub-garbage.sh" <<'EOF'
#!/usr/bin/env bash
echo "not json at all"
EOF
chmod +x "$TEST_TMP/stub-garbage.sh"
bash "$SCRIPT" --deliverable "$FEATURE_SHA" --integration-ref main --repo "$WORK" \
  --instantiation "$TEST_TMP/inst.json" --evidence "$TEST_TMP/evidence.txt" \
  --out "$TEST_TMP/out3.json" --review-cmd "$TEST_TMP/stub-garbage.sh" >/dev/null
assert_exit_code "$?" "0" "unparseable output is not a failure (non-blocking)"
assert_contains "$(cat "$TEST_TMP/out3.json")" '"parse_error": true' "parse failure honestly flagged"

finalize_test
