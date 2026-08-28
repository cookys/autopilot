#!/usr/bin/env bash
# resolve-review-loop-consult-discuss-gate.test.sh — D7 acceptance surface
# (docs/plans/2026-08-28-consult-discuss-qualification.md, D7 "the keystone").
#
# Covers the plan's case matrix: (i)-(iii), (iv)/(iv-b), (v)-(vii), (vii-a/b/c),
# (viii) positive coupling, (ix)-(xiv) strict-path negatives, (xv)/(xvi)
# listed-runner clause, (xvii)-(xx) applicability-scope contract, and the
# mutation control (delete the gate -> (ii)/(iii)/(viii)-negative all flip to
# admit). Consult role gets full depth; discuss gets a role-parametrization
# smoke (the gate code — computeSeatProjectionStrict / _try_qualification_row
# — is role-agnostic, so discuss's job is proving the SAME code path serves
# it, not re-deriving every branch independently).
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"
FIXTURE_JS="$REPO_ROOT/hooks/tests/lib/consult-discuss-genuine-row-fixture.js"
export REPO_ROOT

json_get() { # json key -> raw json value
  local json="$1" key="$2"
  export JSON_VALUE="$json"
  node - "$key" <<'NODE'
const payload = process.env.JSON_VALUE || '';
const key = process.argv[2];
if (!payload) process.exit(0);
const parsed = JSON.parse(payload);
const value = parsed && parsed[key];
if (value === undefined) process.exit(0);
process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
NODE
  unset JSON_VALUE
}

# ── shared fixture helpers ──────────────────────────────────────────────────
mk_cfg() { # role engine runner effort switch -> path
  local role="$1" engine="$2" runner="$3" effort="$4" switch="$5"
  local f="$TEST_TMP/cfg-$role-$engine-$runner-$switch-$RANDOM.md"
  {
    echo "- ${role}_engine: ${engine}"
    echo "- ${role}_runner: ${runner}"
    echo "- ${role}_effort: ${effort}"
    echo "- ${role}_dispatch: ${switch}"
  } > "$f"
  echo "$f"
}

mk_override() { # engine runner role expires -> path
  local engine="$1" runner="$2" role="$3" expires="$4"
  local f="$TEST_TMP/override-$role-$RANDOM.json"
  cat > "$f" <<EOF
{"schema":1,"overrides":[{"engine":"${engine}","runner":"${runner}","role":"${role}","reason":"D7 gate test fixture","operator":"cookys","expires":"${expires}"}]}
EOF
  echo "$f"
}

# mk_row role engine runner [extra fixture args...] -> writes the qualification-
# evidence.jsonl anchor row (side effect) and records the matching scorecard
# row via the REAL `engine-scorecard.js record` CLI (side effect). Both the
# evidence and the scorecard row are GENUINELY GRADED by node
# consult-discuss-genuine-row-fixture.js — see that file's header.
mk_row() {
  local role="$1" engine="$2" runner="$3"; shift 3
  local row
  row="$(node "$FIXTURE_JS" "$role" --engine "$engine" --runner "$runner" "$@")" || {
    echo "mk_row: fixture generation failed" >&2; return 1
  }
  printf '%s\n' "$row" | node "$REPO_ROOT/scripts/engine-scorecard.js" record >/dev/null || {
    echo "mk_row: engine-scorecard.js record failed" >&2; return 1
  }
}

scope_file() { # role -> path (frozen production scope)
  local role="$1"
  local f="$TEST_TMP/scope-$role.json"
  node "$REPO_ROOT/scripts/lib/qualification-applicability-scope.js" write-scope --role "$role" --out "$f" >/dev/null 2>&1
  echo "$f"
}

now_iso() { date -u +%Y-%m-%dT%H:%M:%S.000Z; }

strike() { # engine runner role class [predicate] dedup
  local engine="$1" runner="$2" role="$3" class="$4" predicate="$5" dedup="$6"
  local args=(--engine "$engine" --runner "$runner" --role "$role" --class "$class" \
    --cause-class engine_output --writer conformance_audit --dedup-key "$dedup" \
    --detector-id test-detector --detector-version v1 \
    --artifact-sha256 "$(printf '%s' "$dedup" | sha256sum | cut -d' ' -f1)" \
    --receipt-ref "receipt-$dedup" --now "$(now_iso)")
  if [ -n "$predicate" ]; then args+=(--predicate-id "$predicate"); fi
  node "$REPO_ROOT/scripts/engine-capability-state.js" strike-seat "${args[@]}" >/dev/null
}

# Each test case gets ITS OWN isolated store pair so cases never bleed
# strikes/rows into each other's baseline. lib.sh's default ENGINE_CAPABILITY_DIR/
# ENGINE_SCORECARD_DIR are per-FILE, not per-case; override per case.
fresh_stores() { # -> sets ENGINE_CAPABILITY_DIR / ENGINE_SCORECARD_DIR
  local tag="$1"
  export ENGINE_CAPABILITY_DIR="$TEST_TMP/cap-$tag"
  export ENGINE_SCORECARD_DIR="$TEST_TMP/sc-$tag"
  mkdir -p "$ENGINE_CAPABILITY_DIR" "$ENGINE_SCORECARD_DIR"
}

# ═══════════════════════════════════════════════════════════════════════════
# (i) switch off + no evidence => resolves clean, no pre-existing key changes
# ═══════════════════════════════════════════════════════════════════════════
fresh_stores "case-i"
CFG_I="$(mk_cfg consult unqualified-engine cc-shim high off)"
OUT_I="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_I" bash "$SCRIPT" 2>/dev/null)"; RC_I=$?
assert_eq "0" "$RC_I" "(i) switch off + no evidence resolves clean"
assert_eq "off" "$(json_get "$OUT_I" consult_dispatch)" "(i) consult_dispatch off in output"

# ═══════════════════════════════════════════════════════════════════════════
# (ii) switch on + no evidence + no override => exit 3, for a NON-cursor
# runner too — the vacuum this plan closes.
# ═══════════════════════════════════════════════════════════════════════════
fresh_stores "case-ii"
CFG_II="$(mk_cfg consult unqualified-engine cc-shim high on)"
ERR_II="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_II" bash "$SCRIPT" 2>&1 >/dev/null)"
RC_II="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_II" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_II" "(ii) switch on + no evidence + no override exits 3 (non-cursor runner)"
assert_contains "$ERR_II" "consult seat" "(ii) error names the seat"

# ═══════════════════════════════════════════════════════════════════════════
# (iii) switch on + a qualification row for a DIFFERENT role => exit 3
# ═══════════════════════════════════════════════════════════════════════════
fresh_stores "case-iii"
mk_row discuss eng-iii cc-shim
CFG_III="$(mk_cfg consult eng-iii cc-shim high on)"
RC_III="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_III" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_III" "(iii) row for a different role does not admit consult"

# ═══════════════════════════════════════════════════════════════════════════
# (iv) switch on + matching UNEXPIRED override => admitted, recorded in
# override_admitted_seats, stderr warns evidence-free.
# ═══════════════════════════════════════════════════════════════════════════
fresh_stores "case-iv"
OVR_IV="$(mk_override eng-iv cc-shim consult "2099-01-01")"
CFG_IV="$(mk_cfg consult eng-iv cc-shim high on)"
OUT_IV="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR_IV" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_IV" bash "$SCRIPT" 2>"$TEST_TMP/iv.err")"; RC_IV=$?
assert_eq "0" "$RC_IV" "(iv) matching unexpired override admits"
assert_contains "$(json_get "$OUT_IV" override_admitted_seats)" "consult" "(iv) override_admitted_seats records the consult seat"
assert_contains "$(cat "$TEST_TMP/iv.err")" "EVIDENCE-FREE" "(iv) stderr warns evidence-free admission"

# ═══════════════════════════════════════════════════════════════════════════
# (iv-b) switch on + matching but EXPIRED override => exit 3 (override
# expiry stays ENFORCED — untouched by D7).
# ═══════════════════════════════════════════════════════════════════════════
fresh_stores "case-ivb"
OVR_IVB="$(mk_override eng-ivb cc-shim consult "2020-01-01")"
CFG_IVB="$(mk_cfg consult eng-ivb cc-shim high on)"
RC_IVB="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR_IVB" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_IVB" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_IVB" "(iv-b) matching but EXPIRED override exits 3"

# ═══════════════════════════════════════════════════════════════════════════
# (v) switch on + matching in-date row, standing not demoted => admitted
# silently (no stderr warning).
# ═══════════════════════════════════════════════════════════════════════════
fresh_stores "case-v"
mk_row consult eng-v cc-shim
CFG_V="$(mk_cfg consult eng-v cc-shim high on)"
OUT_V="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_V" bash "$SCRIPT" 2>"$TEST_TMP/v.err")"; RC_V=$?
assert_eq "0" "$RC_V" "(v) matching in-date row admits"
assert_eq "on" "$(json_get "$OUT_V" consult_dispatch)" "(v) consult_dispatch on in output"
assert_not_contains "$(cat "$TEST_TMP/v.err")" "⚠" "(v) admitted SILENTLY — no warning glyph on stderr"

# ═══════════════════════════════════════════════════════════════════════════
# (vi) switch on + calendar-expired row, standing not demoted => admitted
# WITH a stderr expiry warning naming the date.
# ═══════════════════════════════════════════════════════════════════════════
fresh_stores "case-vi"
mk_row consult eng-vi cc-shim --issued-at "2020-01-01T00:00:00.000Z" --expires-at "2020-01-20T00:00:00.000Z"
CFG_VI="$(mk_cfg consult eng-vi cc-shim high on)"
OUT_VI="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_VI" bash "$SCRIPT" 2>"$TEST_TMP/vi.err")"; RC_VI=$?
assert_eq "0" "$RC_VI" "(vi) calendar-expired-but-standing row ADMITS"
assert_contains "$(cat "$TEST_TMP/vi.err")" "expiry" "(vi) admits WITH a stderr expiry warning"

# ═══════════════════════════════════════════════════════════════════════════
# (vii) switch on + in-date row whose standing is requalify_required (via a
# critical strike) => exit 3.
# ═══════════════════════════════════════════════════════════════════════════
fresh_stores "case-vii"
mk_row consult eng-vii cc-shim
strike eng-vii cc-shim consult critical_reexam_trigger security_canary_disclosure "vii-crit"
CFG_VII="$(mk_cfg consult eng-vii cc-shim high on)"
RC_VII="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_VII" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_VII" "(vii) demoted (requalify_required) standing refuses however recent the row"

# ═══════════════════════════════════════════════════════════════════════════
# (vii-a)/(vii-b)/(vii-c) — the three strike-standing branches (finding [1]
# PARTIAL OVERRULE: D7 reads the shipped projection honestly).
# ═══════════════════════════════════════════════════════════════════════════
fresh_stores "case-viia"
mk_row consult eng-viia cc-shim
strike eng-viia cc-shim consult ordinary_strike "" "viia-1"
strike eng-viia cc-shim consult ordinary_strike "" "viia-2"
strike eng-viia cc-shim consult ordinary_strike "" "viia-3"
CFG_VIIA="$(mk_cfg consult eng-viia cc-shim high on)"
OUT_VIIA="$(unset AUTOPILOT_STRIKE_ENFORCEMENT; REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_VIIA" bash "$SCRIPT" 2>"$TEST_TMP/viia.err")"; RC_VIIA=$?
assert_eq "0" "$RC_VIIA" "(vii-a) ordinary strikes at threshold, enforcement UNSET, ADMITS (shadow-first default)"
assert_contains "$(cat "$TEST_TMP/viia.err")" "would_requalify" "(vii-a) stderr names would_requalify"

OUT_VIIA_SHADOW="$(AUTOPILOT_STRIKE_ENFORCEMENT=shadow REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_VIIA" bash "$SCRIPT" 2>/dev/null)"; RC_VIIA_SHADOW=$?
assert_eq "0" "$RC_VIIA_SHADOW" "(vii-a) ordinary strikes at threshold, enforcement EXPLICITLY shadow, ADMITS"

fresh_stores "case-viib"
mk_row consult eng-viib cc-shim
strike eng-viib cc-shim consult ordinary_strike "" "viib-1"
strike eng-viib cc-shim consult ordinary_strike "" "viib-2"
strike eng-viib cc-shim consult ordinary_strike "" "viib-3"
CFG_VIIB="$(mk_cfg consult eng-viib cc-shim high on)"
RC_VIIB="$(AUTOPILOT_STRIKE_ENFORCEMENT=enforce REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_VIIB" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_VIIB" "(vii-b) SAME ordinary strikes, AUTOPILOT_STRIKE_ENFORCEMENT=enforce, exits 3"

fresh_stores "case-viic"
mk_row consult eng-viic cc-shim
strike eng-viic cc-shim consult critical_reexam_trigger security_canary_disclosure "viic-crit"
CFG_VIIC="$(mk_cfg consult eng-viic cc-shim high on)"
RC_VIIC_UNSET="$(unset AUTOPILOT_STRIKE_ENFORCEMENT; REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_VIIC" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_VIIC_UNSET" "(vii-c) critical_reexam_trigger refuses with enforcement UNSET"
RC_VIIC_ENFORCE="$(AUTOPILOT_STRIKE_ENFORCEMENT=enforce REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_VIIC" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_VIIC_ENFORCE" "(vii-c) critical_reexam_trigger refuses with enforcement=enforce too — regardless of the variable"

# ═══════════════════════════════════════════════════════════════════════════
# (viii) THE positive coupling case — the only direct proof of KR4. A row
# actually emitted by the shared D1/D2 grader + capability-evidence writer
# flips an otherwise-refused resolve to admitted; the SAME resolve with the
# row removed exits 3.
# ═══════════════════════════════════════════════════════════════════════════
fresh_stores "case-viii"
CFG_VIII="$(mk_cfg consult eng-viii cc-shim high on)"
RC_VIII_BEFORE="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_VIII" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_VIII_BEFORE" "(viii) negative half: before the row exists, the seat is refused"
mk_row consult eng-viii cc-shim
RC_VIII_AFTER="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_VIII" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "0" "$RC_VIII_AFTER" "(viii) positive half: a row EMITTED BY THE REAL D1/D2 GRADER PIPELINE flips the SAME resolve to admitted"
# and removing it again (simulating a fresh store) refuses again — same seat,
# same resolver, only the evidence changed.
fresh_stores "case-viii-removed"
RC_VIII_REMOVED="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_VIII" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_VIII_REMOVED" "(viii) removing the row (fresh store) refuses again"

# ═══════════════════════════════════════════════════════════════════════════
# (ix) capability (qualification-evidence) store ABSENT => exit 3 naming the
# store path — even though a well-formed, otherwise-valid scorecard row
# exists for this exact seat.
# ═══════════════════════════════════════════════════════════════════════════
fresh_stores "case-ix"
mk_row consult eng-ix cc-shim
rm -f "$ENGINE_CAPABILITY_DIR/qualification-evidence.jsonl"
CFG_IX="$(mk_cfg consult eng-ix cc-shim high on)"
ERR_IX="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_IX" bash "$SCRIPT" 2>&1 >/dev/null)"
RC_IX="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_IX" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_IX" "(ix) absent qualification-evidence store refuses"
assert_contains "$ERR_IX" "qualification-evidence store is absent" "(ix) error names the store path"

# ═══════════════════════════════════════════════════════════════════════════
# (x) qualification-evidence store present but MALFORMED (truncated JSON)
# => exit 3, never a silent treat-as-empty-then-refuse-for-the-wrong-reason.
# ═══════════════════════════════════════════════════════════════════════════
fresh_stores "case-x"
mk_row consult eng-x cc-shim
printf '{"event_id":1,"produ' >> "$ENGINE_CAPABILITY_DIR/qualification-evidence.jsonl"
CFG_X="$(mk_cfg consult eng-x cc-shim high on)"
ERR_X="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_X" bash "$SCRIPT" 2>&1 >/dev/null)"
RC_X="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_X" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_X" "(x) malformed (truncated) qualification-evidence store refuses"
assert_contains "$ERR_X" "malformed capability evidence" "(x) error names the malformed store, not a silent empty-treat"

# ═══════════════════════════════════════════════════════════════════════════
# (xi) FORGERY — a hand-authored, schema-plausible, valid-JSON row (with no
# real qualifier evidence_store anchor at all) fails validateRecordRow.
# ═══════════════════════════════════════════════════════════════════════════
fresh_stores "case-xi"
FORGED_ROW='{"engine":"eng-xi","model":"eng-xi","runner":"cc-shim","family":"test-family","role":"consult","model_version":"1.0","version_source":"operator-asserted","corpus_version":"consult-v1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-08-28","quality":{"corpus_pass":"20/20"},"capability_score":1.0,"cost":{"source":"unknown"},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-08-28","expires":"2099-01-01"}'
printf '%s\n' "$FORGED_ROW" | node "$REPO_ROOT/scripts/engine-scorecard.js" record >/dev/null 2>&1
CFG_XI="$(mk_cfg consult eng-xi cc-shim high on)"
RC_XI="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XI" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_XI" "(xi) forgery (no evidence block at all, hand-typed pass) is refused"

# ═══════════════════════════════════════════════════════════════════════════
# (xii) a row whose qualification-evidence anchor is MISSING, and one whose
# anchor is MISMATCHED => exit 3 each.
#
# Adversarial-QC finding: piping the corrupted row through `engine-scorecard.js
# record` is NON-BINDING evidence. validateRecordRow's own embedded-evidence
# branch calls the exact same verifyEvidenceStoreAnchor() the read-time strict
# path (seat-status --require-evidence) calls — so `record` rejects the write
# and the row never lands in scorecard.jsonl at all. The resolver's exit 3
# then proves only "no row" (indistinguishable from cases ii/iii), never that
# the STRICT READ path independently caught the anchor defect. Fix: write the
# corrupted row directly into the store bytes (bypassing `record` /
# validateRecordRow entirely), assert the row is actually present in the
# store, THEN assert the strict read rejects it with the anchor-specific
# error — the only way to bind this to read-time verification.
write_raw_scorecard_row() { # <row-json> -> appends with an explicit event_id, no validation
  local row="$1"
  printf '%s' "$row" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);r.event_id=1;process.stdout.write(JSON.stringify(r)+"\n");})' \
    >> "$ENGINE_SCORECARD_DIR/scorecard.jsonl"
}

fresh_stores "case-xii-missing"
ROW_XII_MISSING="$(node "$FIXTURE_JS" consult --engine eng-xii-missing --runner cc-shim)"
ROW_XII_NOANCHOR="$(printf '%s' "$ROW_XII_MISSING" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);delete r.evidence_store;process.stdout.write(JSON.stringify(r));})')"
write_raw_scorecard_row "$ROW_XII_NOANCHOR"
assert_contains "$(cat "$ENGINE_SCORECARD_DIR/scorecard.jsonl")" '"engine":"eng-xii-missing"' \
  "(xii) missing-anchor row is genuinely PRESENT in the store (proves the read path, not row-absence, produces the refusal)"
CFG_XII_MISSING="$(mk_cfg consult eng-xii-missing cc-shim high on)"
ERR_XII_MISSING="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XII_MISSING" bash "$SCRIPT" 2>&1 >/dev/null)"
RC_XII_MISSING="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XII_MISSING" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_XII_MISSING" "(xii) missing evidence_store anchor refuses"
assert_contains "$ERR_XII_MISSING" "lacks a qualifier store anchor" "(xii) missing-anchor refusal names the specific strict-read anchor failure"

fresh_stores "case-xii-mismatch"
ROW_XII_MISMATCH_SRC="$(node "$FIXTURE_JS" consult --engine eng-xii-mismatch --runner cc-shim)"
ROW_XII_MISMATCH="$(printf '%s' "$ROW_XII_MISMATCH_SRC" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);r.evidence_store.transcript_hash="0".repeat(64);process.stdout.write(JSON.stringify(r));})')"
write_raw_scorecard_row "$ROW_XII_MISMATCH"
assert_contains "$(cat "$ENGINE_SCORECARD_DIR/scorecard.jsonl")" '"engine":"eng-xii-mismatch"' \
  "(xii) mismatched-anchor row is genuinely PRESENT in the store (proves the read path, not row-absence, produces the refusal)"
CFG_XII_MISMATCH="$(mk_cfg consult eng-xii-mismatch cc-shim high on)"
ERR_XII_MISMATCH="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XII_MISMATCH" bash "$SCRIPT" 2>&1 >/dev/null)"
RC_XII_MISMATCH="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XII_MISMATCH" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_XII_MISMATCH" "(xii) mismatched evidence_store anchor (wrong transcript_hash) refuses"
assert_contains "$ERR_XII_MISMATCH" "anchor is missing or mismatched" "(xii) mismatch refusal names the specific strict-read anchor-binding failure"

# ═══════════════════════════════════════════════════════════════════════════
# (xii-c) a row with a SYNTACTICALLY VALID `evidence` block (genuinely
# compiles, anchor intact and correctly bound) that fails one of
# validateRecordRow's DEEPER field-binding checks — a scorecard field that
# must mirror its own evidence but doesn't (e.g. corpus_version).
#
# Adversarial-QC finding [7]: case (xi)'s forged row carries no `evidence`
# key at all, so it is dropped at `if (!clone.evidence) continue;` in
# computeSeatProjectionStrict — BEFORE validateRecordRow's evidence-block
# checks ever matter to the outcome. That made validateRecordRow(clone)
# itself a no-op for that case: deleting the call entirely still leaves case
# (xi) green (row has no evidence -> still skipped by the `!clone.evidence`
# check alone). This case closes that gap: it has a real `evidence` block
# (so it does NOT get dropped by `!clone.evidence`) and a real, correctly-
# bound `evidence_store` anchor (so it is NOT case xii's anchor failure) —
# the ONLY thing wrong with it is a field-binding mismatch that only
# validateRecordRow's deeper checks (not the anchor check, not the
# `!clone.evidence` skip) can catch. Written directly into the store,
# bypassing `record`, same technique as case (xii).
# ═══════════════════════════════════════════════════════════════════════════
fresh_stores "case-xii-c-field-binding"
ROW_XIIC_SRC="$(node "$FIXTURE_JS" consult --engine eng-xiic --runner cc-shim)"
ROW_XIIC_BAD_BINDING="$(printf '%s' "$ROW_XIIC_SRC" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);r.corpus_version="tampered-corpus-version-mismatch";process.stdout.write(JSON.stringify(r));})')"
write_raw_scorecard_row "$ROW_XIIC_BAD_BINDING"
assert_contains "$(cat "$ENGINE_SCORECARD_DIR/scorecard.jsonl")" '"engine":"eng-xiic"' \
  "(xii-c) field-binding-mismatch row is genuinely PRESENT in the store (proves the read path, not row-absence, produces the refusal)"
CFG_XIIC="$(mk_cfg consult eng-xiic cc-shim high on)"
ERR_XIIC="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XIIC" bash "$SCRIPT" 2>&1 >/dev/null)"
RC_XIIC="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XIIC" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_XIIC" "(xii-c) a valid-evidence row with a tampered corpus_version field binding refuses"
assert_contains "$ERR_XIIC" "corpus_version does not match capability evidence" "(xii-c) refusal names the specific field-binding failure validateRecordRow's deeper check caught"

# ═══════════════════════════════════════════════════════════════════════════
# (xiii) a malformed line UNRELATED to the candidate seat => exit 3 under
# strict parse, never silently skipped into a different verdict.
# ═══════════════════════════════════════════════════════════════════════════
fresh_stores "case-xiii"
mk_row consult eng-xiii cc-shim
printf 'not-json-at-all\n' >> "$ENGINE_SCORECARD_DIR/scorecard.jsonl"
CFG_XIII="$(mk_cfg consult eng-xiii cc-shim high on)"
ERR_XIII="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XIII" bash "$SCRIPT" 2>&1 >/dev/null)"
RC_XIII="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XIII" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_XIII" "(xiii) an UNRELATED malformed scorecard line refuses under strict parse"
assert_contains "$ERR_XIII" "strict qualification-evidence read failed" "(xiii) resolver surfaces the strict-parse failure, not a silent skip"

# ═══════════════════════════════════════════════════════════════════════════
# (xiv) unreadable scorecard / qualification-evidence stores each refuse;
# present-but-unreadable strikes.jsonl refuses; ABSENT strikes.jsonl beside a
# valid ledger ADMITS (valid empty history). Re-run with the switch OFF
# against the SAME unreadable stores: resolve still succeeds — the off-path
# performs no store read at all.
# ═══════════════════════════════════════════════════════════════════════════
fresh_stores "case-xiv-scorecard-unreadable"
mk_row consult eng-xiv-a cc-shim
chmod 000 "$ENGINE_SCORECARD_DIR/scorecard.jsonl"
CFG_XIVA="$(mk_cfg consult eng-xiv-a cc-shim high on)"
RC_XIVA="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XIVA" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_XIVA" "(xiv) unreadable scorecard store refuses"
CFG_XIVA_OFF="$(mk_cfg consult eng-xiv-a cc-shim high off)"
RC_XIVA_OFF="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XIVA_OFF" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "0" "$RC_XIVA_OFF" "(xiv) SAME unreadable scorecard store, switch OFF: resolve still succeeds (no store read at all)"
chmod 644 "$ENGINE_SCORECARD_DIR/scorecard.jsonl"

fresh_stores "case-xiv-capability-unreadable"
mk_row consult eng-xiv-b cc-shim
chmod 000 "$ENGINE_CAPABILITY_DIR/qualification-evidence.jsonl"
CFG_XIVB="$(mk_cfg consult eng-xiv-b cc-shim high on)"
RC_XIVB="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XIVB" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_XIVB" "(xiv) unreadable qualification-evidence store refuses"
CFG_XIVB_OFF="$(mk_cfg consult eng-xiv-b cc-shim high off)"
RC_XIVB_OFF="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XIVB_OFF" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "0" "$RC_XIVB_OFF" "(xiv) SAME unreadable qualification-evidence store, switch OFF: resolve still succeeds"
chmod 644 "$ENGINE_CAPABILITY_DIR/qualification-evidence.jsonl"

# ═══════════════════════════════════════════════════════════════════════════
# (xiv-fifo) adversarial-QC finding [8]: the two "no store read at all" OFF-
# path assertions above (RC_XIVA_OFF / RC_XIVB_OFF) are asserted only as
# exit-0-despite-chmod-000-store. A regression that adds a swallowed read
# (try/catch around a permission-denied open, result discarded either way)
# would still exit 0 there — invisible. Bind it: replace the store file with
# a named pipe (no writer ever attaches). A blocking read() against a FIFO
# with no writer HANGS — so ONLY the absence of any read attempt lets this
# complete promptly; any read (even one whose result is later discarded)
# hangs until `timeout` kills it, flipping the exit code away from a fast 0.
# ═══════════════════════════════════════════════════════════════════════════
fresh_stores "case-xiv-scorecard-off-fifo"
mk_row consult eng-xiv-fifo-a cc-shim
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl"
mkfifo "$ENGINE_SCORECARD_DIR/scorecard.jsonl"
CFG_XIVA_FIFO_OFF="$(mk_cfg consult eng-xiv-fifo-a cc-shim high off)"
RC_XIVA_FIFO_OFF="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XIVA_FIFO_OFF" timeout 5s bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "0" "$RC_XIVA_FIFO_OFF" "(xiv-fifo) switch OFF over a scorecard store that would HANG any real read completes promptly (proves zero read attempts, not just a swallowed error)"
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl"

fresh_stores "case-xiv-capability-off-fifo"
mk_row consult eng-xiv-fifo-b cc-shim
rm -f "$ENGINE_CAPABILITY_DIR/qualification-evidence.jsonl"
mkfifo "$ENGINE_CAPABILITY_DIR/qualification-evidence.jsonl"
CFG_XIVB_FIFO_OFF="$(mk_cfg consult eng-xiv-fifo-b cc-shim high off)"
RC_XIVB_FIFO_OFF="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XIVB_FIFO_OFF" timeout 5s bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "0" "$RC_XIVB_FIFO_OFF" "(xiv-fifo) switch OFF over a qualification-evidence store that would HANG any real read completes promptly (proves zero read attempts, not just a swallowed error)"
rm -f "$ENGINE_CAPABILITY_DIR/qualification-evidence.jsonl"

fresh_stores "case-xiv-strikes-unreadable"
mk_row consult eng-xiv-c cc-shim
strike eng-xiv-c cc-shim consult ordinary_strike "" "xiv-c-1"
chmod 000 "$ENGINE_CAPABILITY_DIR/strikes.jsonl"
CFG_XIVC="$(mk_cfg consult eng-xiv-c cc-shim high on)"
RC_XIVC="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XIVC" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_XIVC" "(xiv) present-but-UNREADABLE strikes.jsonl refuses"
chmod 644 "$ENGINE_CAPABILITY_DIR/strikes.jsonl"

fresh_stores "case-xiv-strikes-absent"
mk_row consult eng-xiv-d cc-shim
rm -f "$ENGINE_CAPABILITY_DIR/strikes.jsonl"
assert_file_absent "$ENGINE_CAPABILITY_DIR/strikes.jsonl" "(xiv) strikes.jsonl is genuinely absent (no atomic-create machinery ran)"
CFG_XIVD="$(mk_cfg consult eng-xiv-d cc-shim high on)"
RC_XIVD="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XIVD" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "0" "$RC_XIVD" "(xiv) ABSENT strikes.jsonl beside a valid ledger ADMITS (valid empty strike history)"

# ═══════════════════════════════════════════════════════════════════════════
# (xv)/(xvi) — the listed-runner clause: cursor consult seat + valid
# non-demoted row + no override: switch on => admitted; switch off => exit 3.
# ═══════════════════════════════════════════════════════════════════════════
fresh_stores "case-xv"
mk_row consult eng-xv cursor
CFG_XV_ON="$(mk_cfg consult eng-xv cursor high on)"
RC_XV_ON="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XV_ON" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "0" "$RC_XV_ON" "(xv) cursor consult seat + valid row + no override, switch ON: admitted"
CFG_XVI_OFF="$(mk_cfg consult eng-xv cursor high off)"
RC_XVI_OFF="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XVI_OFF" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_XVI_OFF" "(xvi) SAME cursor seat + row, switch OFF: exit 3 (row not read, override-only path)"

# ═══════════════════════════════════════════════════════════════════════════
# (xvii)-(xx) — the applicability-scope contract.
# ═══════════════════════════════════════════════════════════════════════════
# (xvii) row emitted under the frozen scope + resolver-derived scope =>
# admitted, end to end from a D1/D2-emitted row. This is case (v)/(viii)
# re-read under the scope lens — restated here as its own named case.
fresh_stores "case-xvii"
mk_row consult eng-xvii cc-shim
CFG_XVII="$(mk_cfg consult eng-xvii cc-shim high on)"
RC_XVII="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XVII" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "0" "$RC_XVII" "(xvii) row emitted under the frozen scope + resolver-derived scope: admitted"

# (xviii) row emitted under a DIFFERENT scope => exit 3 (scope mismatch).
fresh_stores "case-xviii"
DIFFERENT_SCOPE="$TEST_TMP/different-scope.json"
printf '{"task_classes":["something-else"],"domains":["cross-cutting"],"languages":["en"],"tool_surface":["read_only"]}' > "$DIFFERENT_SCOPE"
mk_row consult eng-xviii cc-shim --scope-file "$DIFFERENT_SCOPE"
CFG_XVIII="$(mk_cfg consult eng-xviii cc-shim high on)"
RC_XVIII="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XVIII" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_XVIII" "(xviii) row emitted under a DIFFERENT scope: exit 3, not silent admission"

# (xix) manifest unreadable so the scope cannot be derived => exit 3, never a
# skipped check — even with a valid row AND a valid override both present.
fresh_stores "case-xix"
mk_row consult eng-xix cc-shim
OVR_XIX="$(mk_override eng-xix cc-shim consult "2099-01-01")"
CFG_XIX="$(mk_cfg consult eng-xix cc-shim high on)"
CONSULT_CORPUS="$REPO_ROOT/evals/consult-capability-evidence-corpus.json"
cp "$CONSULT_CORPUS" "$TEST_TMP/consult-corpus-backup.json"
chmod 000 "$CONSULT_CORPUS"
ERR_XIX="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR_XIX" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XIX" bash "$SCRIPT" 2>&1 >/dev/null)"
RC_XIX="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR_XIX" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XIX" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
chmod 644 "$CONSULT_CORPUS"
cp "$TEST_TMP/consult-corpus-backup.json" "$CONSULT_CORPUS"
assert_eq "3" "$RC_XIX" "(xix) unreadable applicability-scope manifest exits 3 EVEN WITH a valid row and a valid override present"
assert_contains "$ERR_XIX" "applicability-scope manifest could not be derived" "(xix) error names the scope-derivation failure"

# (xx) an operator-supplied --scorecard-scope-file pointing at a WIDER scope
# does not change the gate's decision — D7 never reads it.
fresh_stores "case-xx"
mk_row consult eng-xx cc-shim --scope-file "$DIFFERENT_SCOPE"
CFG_XX="$(mk_cfg consult eng-xx cc-shim high on)"
WIDE_SCOPE_ARG="$TEST_TMP/wide-scope.json"
printf '{"task_classes":["consult","something-else"],"domains":["cross-cutting"],"languages":["en"],"tool_surface":["read_only"]}' > "$WIDE_SCOPE_ARG"
IDENTITY_ARG="$TEST_TMP/identity-unused.json"
printf '{"engine":"eng-xx"}' > "$IDENTITY_ARG"
RC_XX="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_XX" bash "$SCRIPT" --scorecard-scope-file "$WIDE_SCOPE_ARG" --scorecard-identity-file "$IDENTITY_ARG" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_XX" "(xx) a caller-supplied --scorecard-scope-file (even a WIDER one) does not admit a scope-mismatched row — D7 never reads it"

# ═══════════════════════════════════════════════════════════════════════════
# Mutation control: delete the gate (pinned pre-D7 resolve-review-loop.sh,
# git commit 8597a4b4, the D5 tip immediately before D7 landed) => (ii),
# (iii), and (viii)'s negative half all go GREEN (admit) on the identical
# fixtures that this file's own (ii)/(iii)/(viii) cases refuse.
# ═══════════════════════════════════════════════════════════════════════════
OLD_FIXTURE_SCRIPT="$REPO_ROOT/hooks/tests/fixtures/pre-d7-resolve-review-loop.sh"
if [ ! -s "$OLD_FIXTURE_SCRIPT" ]; then
  echo "FATAL: pinned pre-D7 baseline fixture missing or empty: $OLD_FIXTURE_SCRIPT" >&2
  exit 1
fi
OLD_ROOT="$TEST_TMP/pre-d7-baseline"
mkdir -p "$OLD_ROOT"
cp -R "$REPO_ROOT/scripts" "$OLD_ROOT/scripts"
cp -R "$REPO_ROOT/src" "$OLD_ROOT/src"
cp "$OLD_FIXTURE_SCRIPT" "$OLD_ROOT/scripts/resolve-review-loop.sh"
chmod +x "$OLD_ROOT/scripts/resolve-review-loop.sh"
OLD_SCRIPT="$OLD_ROOT/scripts/resolve-review-loop.sh"

fresh_stores "case-mutation-ii"
CFG_MUT_II="$(mk_cfg consult unqualified-engine cc-shim high on)"
RC_MUT_II="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_MUT_II" bash "$OLD_SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "0" "$RC_MUT_II" "MUTATION CONTROL: gate deleted, (ii)'s no-evidence-no-override fixture now ADMITS (proves the gate was load-bearing)"

fresh_stores "case-mutation-iii"
mk_row discuss eng-mut-iii cc-shim
CFG_MUT_III="$(mk_cfg consult eng-mut-iii cc-shim high on)"
RC_MUT_III="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_MUT_III" bash "$OLD_SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "0" "$RC_MUT_III" "MUTATION CONTROL: gate deleted, (iii)'s wrong-role-row fixture now ADMITS"

fresh_stores "case-mutation-viii"
CFG_MUT_VIII="$(mk_cfg consult eng-mut-viii cc-shim high on)"
RC_MUT_VIII="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_MUT_VIII" bash "$OLD_SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "0" "$RC_MUT_VIII" "MUTATION CONTROL: gate deleted, (viii)'s negative half (no row at all) now ADMITS"

# ═══════════════════════════════════════════════════════════════════════════
# discuss role smoke — proves the SAME gate code is genuinely role-
# parametrized, not consult-only. Cases (i)/(ii)/(v)/(viii) re-run for discuss.
# ═══════════════════════════════════════════════════════════════════════════
fresh_stores "discuss-i"
CFG_D_I="$(mk_cfg discuss unqualified-engine cc-shim high off)"
RC_D_I="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_D_I" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "0" "$RC_D_I" "(discuss i) switch off + no evidence resolves clean"

fresh_stores "discuss-ii"
CFG_D_II="$(mk_cfg discuss unqualified-engine cc-shim high on)"
RC_D_II="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_D_II" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_D_II" "(discuss ii) switch on + no evidence + no override exits 3"

fresh_stores "discuss-v"
mk_row discuss eng-d-v cc-shim
CFG_D_V="$(mk_cfg discuss eng-d-v cc-shim high on)"
RC_D_V="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_D_V" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "0" "$RC_D_V" "(discuss v) matching in-date row admits"

fresh_stores "discuss-viii-before"
CFG_D_VIII="$(mk_cfg discuss eng-d-viii cc-shim high on)"
RC_D_VIII_BEFORE="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_D_VIII" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$RC_D_VIII_BEFORE" "(discuss viii) negative half: before the row exists, refused"
fresh_stores "discuss-viii-after"
mk_row discuss eng-d-viii cc-shim
RC_D_VIII_AFTER="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_D_VIII" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "0" "$RC_D_VIII_AFTER" "(discuss viii) positive half: a genuinely-graded discuss row admits"

finalize_test
