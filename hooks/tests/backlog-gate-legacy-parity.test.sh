#!/usr/bin/env bash
# backlog-gate-legacy-parity.test.sh — differential test: until a backlog opts in to the reporter
# fields (a next-id mark, or the field in required_fields), scripts/check-backlog-entries.js must
# give exactly the verdict the pre-reporter-field gate gave: same exit code, same violations
# (code, field, title, detail, allowed), same counts.
#
# The legacy gate is frozen in hooks/tests/fixtures/backlog-gate-legacy-5a2706ad.js, byte-identical
# to `git show 5a2706ad:scripts/check-backlog-entries.js` (the lane's base). It is copied, not read
# from git at run time, so the test does not depend on what the local clone has. Do not edit it.
#
# Corpus: heading, checklist and table files, each with a plain row, a row whose fields collide
# with the reporter-field names, a long row (>900 B, pointer none) and a duplicate Id; run with a
# full config, an empty config plus block mode, and no config; with an allowlist that lets every
# legacy violation through; and in --range mode over a commit deleting the colliding row. The
# control (a next-id mark) must make the two gates differ, and removing the heading, checklist or
# table normalisation from the gate must make the parity check fail.

. "$(dirname "$0")/lib.sh"

GATE="$REPO_ROOT/scripts/check-backlog-entries.js"
LEGACY_SRC="$REPO_ROOT/hooks/tests/fixtures/backlog-gate-legacy-5a2706ad.js"

install_gate() { # <root> <gate source> -> path of the installed gate (with the files it loads)
  mkdir -p "$1/scripts/lib" "$1/references"
  cp "$REPO_ROOT/references/stage-graph.json" "$1/references/"
  cp "$REPO_ROOT/scripts/resolve-project-paths.sh" "$REPO_ROOT/scripts/project-detect.js" "$1/scripts/"
  cp "$REPO_ROOT/scripts/lib/json-emit.sh" "$REPO_ROOT/scripts/lib/resolve-config.sh" "$1/scripts/lib/"
  cp "$2" "$1/scripts/check-backlog-entries.js"
  echo "$1/scripts/check-backlog-entries.js"
}
OLD="$(install_gate "$TEST_TMP/legacy" "$LEGACY_SRC")"

# Verdict shape both gates share; `level` and `range` exist only in the new gate's output.
COMPARE_JS='
const [a, b, ra, rb] = process.argv.slice(1);
const norm = (s) => {
  const j = JSON.parse(s);
  const v = j.violations.map((x) => [x.code, x.field, x.title, x.detail, x.allowed])
    .map((x) => JSON.stringify(x)).sort();
  return { exit: j.exit, new_count: j.new_count, allowed_count: j.allowed_count, entries: j.entries, v };
};
let A, B;
try { A = norm(a); B = norm(b); } catch (e) { console.log("DIFF unparsable output"); process.exit(0); }
A.rc = ra; B.rc = rb;
const sa = JSON.stringify(A), sb = JSON.stringify(B);
if (sa === sb) { console.log("SAME"); process.exit(0); }
const only = (x, y) => x.v.filter((e) => !y.v.includes(e));
console.log("DIFF rc " + ra + "/" + rb + " exit " + A.exit + "/" + B.exit +
  " legacy-only " + JSON.stringify(only(A, B)) + " new-only " + JSON.stringify(only(B, A)));
'

T230="$(python3 -c 'print("t"*230)')"; S150="$(python3 -c 'print("s"*150)')"
C230="$(python3 -c 'print("c"*230)')"; L300="$(python3 -c 'print("l"*300)')"

# --- corpus rows, one function per style; <kind> = plain | collided | long | dup ---
h_row() {
  case "$1" in
    plain) printf '%s\n' '### Plain row' '- **Id**: 0007' '- **Status**: open' '- **Trigger**: when it fires' \
      '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' '' ;;
    collided) printf '%s\n' '### Collided row' '- **Id**: 0008' '- **Status**: open' '- **Since**: last week' '- **Origin**: external' \
      '- **Reporter**: cuda' '- **Report**: ticket 12' '- **Reply**: will look' '- **Problem**: `scripts/x.js:12` broke' \
      '- **Impact**: slow' '- **Trigger**: when it fires' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' '' ;;
    long) printf '%s\n' '### Long row' '- **Status**: open' "- **Since**: $L300" "- **Trigger**: $T230" '- **Effort**: S' \
      "- **Source**: $S150" '- **Pointer**: none' "- **Context**: $C230" '' ;;
    dup) printf '%s\n' '### Duplicate id row' '- **Id**: 0007' '- **Status**: open' '- **Trigger**: when it fires' \
      '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' '' ;;
  esac
}
c_row() {
  case "$1" in
    plain) printf '%s\n' '- [ ] [Minor] Plain row' '  - Id: T-12' '  - Status: open' '  - Trigger: when it fires' \
      '  - Effort: S' '  - Source: suite' '  - Pointer: docs/plans/ok.md' ;;
    collided) printf '%s\n' '- [ ] [Minor] Collided row' '  - Id: T-13' '  - Status: open' '  - Since: last week' '  - Origin: external' \
      '  - Reporter: cuda' '  - Report: ticket 12' '  - Reply: will look' '  - Problem: `scripts/x.js:12` broke' \
      '  - Impact: slow' '  - Trigger: when it fires' '  - Effort: S' '  - Source: suite' '  - Pointer: docs/plans/ok.md' ;;
    long) printf '%s\n' '- [ ] [Minor] Long row' '  - Status: open' "  - Since: $L300" "  - Trigger: $T230" '  - Effort: S' \
      "  - Source: $S150" '  - Pointer: none' "  - Context: $C230" ;;
    dup) printf '%s\n' '- [ ] [Minor] Duplicate id row' '  - Id: T-12' '  - Status: open' '  - Trigger: when it fires' \
      '  - Effort: S' '  - Source: suite' '  - Pointer: docs/plans/ok.md' ;;
  esac
}
t_row() {
  case "$1" in
    head) printf '%s\n' '| Id | Title | Status | Trigger | Effort | Source | Pointer | Since | Origin | Reporter | Report | Reply | Problem | Impact |' \
      '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|' ;;
    plain) printf '%s\n' '| 0007 | Plain row | open | when it fires | S | suite | docs/plans/ok.md |  |  |  |  |  |  |  |' ;;
    collided) printf '%s\n' '| 0008 | Collided row | open | when it fires | S | suite | docs/plans/ok.md | last week | external | cuda | ticket 12 | will look | `x.js:12` broke | slow |' ;;
    long) printf '| 0009 | Long row | open | %s | S | %s | none | %s | self |  |  |  | %s |  |\n' "$T230" "$S150" "$L300" "$C230" ;;
    dup) printf '%s\n' '| 0007 | Duplicate id row | open | when it fires | S | suite | docs/plans/ok.md |  |  |  |  |  |  |  |' ;;
  esac
}

corpus() { # <style> <mark?> [kinds...] -> backlog text
  local style="$1" mark="$2"; shift 2
  printf '# Backlog\n\n'
  if [ -n "$mark" ]; then printf '<!-- next-id: BL-0001 -->\n\n'; fi
  if [ "$style" = table ]; then t_row head; fi
  local k; for k in "$@"; do
    case "$style" in heading) h_row "$k" ;; checklist) c_row "$k" ;; table) t_row "$k" ;; esac
  done
}

new_corpus_repo() { # <name> <style> <mark?> -> repo with the full corpus committed
  local d="$TEST_TMP/$1"
  mkdir -p "$d/docs/plans"
  git -C "$d" init -q
  git -C "$d" config user.email t@local
  git -C "$d" config user.name t
  git -C "$d" config autopilot.testIdentityGate off
  printf '# ok\n' > "$d/docs/plans/ok.md"
  corpus "$2" "$3" plain collided long dup > "$d/docs/BACKLOG.md"
  git -C "$d" add -A
  git -C "$d" commit -q -m corpus
  echo "$d"
}

write_cfg() { # <file> <full|empty> <style>
  if [ "$2" = empty ]; then printf '%s\n' '## Mode' '- mode: block' > "$1"; return; fi
  { printf '%s\n' '## Style' "- style: $3" '## Mode' '- mode: block'
    if [ "$3" = table ]; then printf '%s\n' '- id_pattern: ^\d{4}$'; fi; } > "$1"
}

parity() { # <new gate> <repo> <cfg file|-> [allowlist|-] [new-gate-only args...] -> SAME | DIFF …
  local g="$1" d="$2" c="$3" a="${4:--}"; shift 3; [ $# -gt 0 ] && shift
  local cargs=()
  if [ "$c" != - ]; then cargs=(--config "$c"); fi
  if [ "$a" != - ]; then cargs+=(--allowlist "$a"); fi
  local o n ro rn
  o="$(node "$OLD" --backlog "$d/docs/BACKLOG.md" "${cargs[@]}" 2>/dev/null)"; ro=$?
  n="$(node "$g" --backlog "$d/docs/BACKLOG.md" "${cargs[@]}" "$@" 2>/dev/null)"; rn=$?
  node -e "$COMPARE_JS" "$o" "$n" "$ro" "$rn"
}

allow_all() { # <legacy json> <style> <out file>: an allowlist listing every legacy violation
  node -e '
const crypto = require("crypto");
const [s, style, out] = process.argv.slice(1);
const by = new Map();
for (const v of JSON.parse(s).violations) {
  const fp = crypto.createHash("sha256").update(style + ":" + String(v.title || "").trim().toLowerCase(), "utf8").digest("hex");
  if (!by.has(fp)) by.set(fp, new Set());
  by.get(fp).add(v.code);
}
require("fs").writeFileSync(out, JSON.stringify({ schema: 1, entries: [...by].map(([fingerprint, c]) => ({ fingerprint, codes: [...c] })) }, null, 2) + "\n");
' "$1" "$2" "$3"
}

# ---------------------------------------------------------------------------------------------
# Parity: the corpus without opt-in, every style × config.
STYLES=(heading checklist table)
for s in "${STYLES[@]}"; do
  d="$(new_corpus_repo "corpus-$s" "$s" '')"
  write_cfg "$TEST_TMP/cfg-full-$s.md" full "$s"
  write_cfg "$TEST_TMP/cfg-empty-$s.md" empty "$s"
  assert_eq "$(parity "$GATE" "$d" "$TEST_TMP/cfg-full-$s.md")" "SAME" "parity $s, full config"
  assert_eq "$(parity "$GATE" "$d" "$TEST_TMP/cfg-empty-$s.md")" "SAME" "parity $s, empty config + block"
  assert_eq "$(parity "$GATE" "$d" -)" "SAME" "parity $s, no config"
  # Allowlist: every legacy violation listed (the colliding row's extra_content among them).
  legacy="$(node "$OLD" --backlog "$d/docs/BACKLOG.md" --config "$TEST_TMP/cfg-full-$s.md" 2>/dev/null)"
  allow_all "$legacy" "$s" "$TEST_TMP/allow-$s.json"
  # A table never had extra_content (unknown columns were ignored); heading/checklist do.
  if [ "$s" = table ]; then want='"cap_exceeded"'; else want='"extra_content"'; fi
  assert_contains "$(cat "$TEST_TMP/allow-$s.json")" "$want" "allowlist $s: the legacy verdict has $want to allow"
  assert_eq "$(node "$OLD" --backlog "$d/docs/BACKLOG.md" --config "$TEST_TMP/cfg-full-$s.md" --allowlist "$TEST_TMP/allow-$s.json" >/dev/null 2>&1; echo $?)" "0" "allowlist $s: the legacy gate passes with it"
  assert_eq "$(parity "$GATE" "$d" "$TEST_TMP/cfg-full-$s.md" "$TEST_TMP/allow-$s.json")" "SAME" "parity $s, allowlisted"
done
# The corpus is not trivially clean: the legacy gate does report each kind of row.
legacy="$(node "$OLD" --backlog "$TEST_TMP/corpus-heading/docs/BACKLOG.md" --config "$TEST_TMP/cfg-full-heading.md" 2>/dev/null)"
assert_contains "$legacy" '"code":"cap_exceeded"' "corpus: the long row is over the 900 B cap"
assert_contains "$legacy" '"code":"pointer_required"' "corpus: the long row needs a pointer"
assert_contains "$legacy" '"title":"Collided row"' "corpus: the colliding row is reported"
legacy="$(node "$OLD" --backlog "$TEST_TMP/corpus-checklist/docs/BACKLOG.md" --config "$TEST_TMP/cfg-full-checklist.md" 2>/dev/null)"
assert_contains "$legacy" '"code":"duplicate_id"' "corpus: the checklist duplicate Id is reported"

# --range: delete the colliding row (it has Report/Reply) in a commit; the new gate's range verdict
# equals the legacy gate's verdict on the pushed file (it had no range rule to fire).
for s in "${STYLES[@]}"; do
  d="$TEST_TMP/corpus-$s"
  corpus "$s" '' plain long dup > "$d/docs/BACKLOG.md"
  git -C "$d" add -A
  git -C "$d" commit -q -m "drop the colliding row"
  assert_eq "$(parity "$GATE" "$d" "$TEST_TMP/cfg-full-$s.md" - --range HEAD~1..HEAD)" "SAME" "parity $s, --range over the row deletion"
done

# Control: the same corpus with a next-id mark has opted in, and the gates must differ.
for s in "${STYLES[@]}"; do
  d="$(new_corpus_repo "marked-$s" "$s" mark)"
  assert_contains "$(parity "$GATE" "$d" "$TEST_TMP/cfg-full-$s.md")" "DIFF" "control $s: with a next-id mark the reporter fields are read"
done

# Control for --range: the range rule keys rows by Id, so a collided row without one is invisible to it
# (BL-0132: the heading and checklist rows had none, leaving this comparison vacuous for them). With the
# Id and a next-id mark, deleting the unanswered row must raise peer_report_lost in the new gate.
for s in "${STYLES[@]}"; do
  d="$TEST_TMP/marked-$s"
  corpus "$s" mark plain long dup > "$d/docs/BACKLOG.md"
  git -C "$d" add -A
  git -C "$d" commit -q -m "drop the colliding row"
  out="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --config "$TEST_TMP/cfg-full-$s.md" --range HEAD~1..HEAD 2>/dev/null)"
  assert_contains "$out" '"code":"peer_report_lost"' "control $s: with a next-id mark, deleting the colliding row is seen by --range"
done

# ---------------------------------------------------------------------------------------------
# Mutations: removing one style's normalisation must break that style's parity.
mutant() { # <name> <sed expr> -> mutated gate (fails the test if sed did not bite)
  local m; m="$(install_gate "$TEST_TMP/mut-$1" "$GATE")"
  sed -i "$2" "$m"
  if cmp -s "$GATE" "$m"; then fail "mutation $1 did not apply (pattern drifted)"; fi
  echo "$m"
}
any_diff() { # <gate> <style> -> DIFF if any of the style's no-opt-in comparisons differ
  local r
  r="$(parity "$1" "$TEST_TMP/corpus-$2" "$TEST_TMP/cfg-full-$2.md"; git -C "$TEST_TMP/corpus-$2" checkout -q HEAD~1 -- docs/BACKLOG.md; parity "$1" "$TEST_TMP/corpus-$2" "$TEST_TMP/cfg-full-$2.md"; git -C "$TEST_TMP/corpus-$2" checkout -q HEAD -- docs/BACKLOG.md)"
  case "$r" in *DIFF*) echo DIFF ;; *) echo SAME ;; esac
}
m="$(mutant heading 's|    const fl = gatedFieldLine(line, cfg); // heading|    const fl = fieldLine(line); // heading|')"
assert_eq "$(any_diff "$m" heading)" "DIFF" "heading mutation: without the heading normalisation parity fails (the suite can tell)"
m="$(mutant checklist 's|    const fl = gatedFieldLine(line, cfg); // checklist|    const fl = fieldLine(line); // checklist|')"
assert_eq "$(any_diff "$m" checklist)" "DIFF" "checklist mutation: without the checklist normalisation parity fails (the suite can tell)"
m="$(mutant table 's|^        if (NEW_FIELDS.includes(f) \&\& !fieldOptedIn(ocfg, f)) continue;$|        ;|')"
assert_eq "$(any_diff "$m" table)" "DIFF" "table mutation: without the table normalisation parity fails (the suite can tell)"

finalize_test
