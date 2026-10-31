#!/usr/bin/env bash
# layout-lint.test.sh - scripts/layout-lint.js + scripts/lib/repo-layout.js, with negative controls.
# Runs in a scratch git repo with its own registry file (--registry); the real registry is only read.
# Every red case has a green twin, and one mutation proves the allowlist control can go green wrongly.
. "$(dirname "$0")/lib.sh"

LINT="${LAYOUT_LINT_UNDER_TEST:-$REPO_ROOT/scripts/layout-lint.js}"
LAYOUT="$REPO_ROOT/scripts/lib/repo-layout.js"

export GIT_AUTHOR_NAME=ll GIT_AUTHOR_EMAIL=ll@example.com GIT_COMMITTER_NAME=ll GIT_COMMITTER_EMAIL=ll@example.com
R="$TEST_TMP/repo"
git init -q "$R"
git -C "$R" config core.hooksPath /dev/null
git -C "$R" config commit.gpgsign false
mkdir -p "$R/src" "$R/docs/plans/evidence/run1" "$R/docs/guide" "$R/tools/migrate" "$R/hooks"
echo "# r" > "$R/README.md"
echo "x" > "$R/src/a.js"
echo "# plan" > "$R/docs/plans/p.md"
echo "# guide" > "$R/docs/guide/g.md"
echo "e" > "$R/docs/plans/evidence/run1/out.md"
echo "m" > "$R/tools/migrate/m.js"
echo "h" > "$R/hooks/h.js"
git -C "$R" add -A
git -C "$R" commit -q -m base
BASE="$(git -C "$R" rev-parse HEAD)"
reset_repo() { git -C "$R" reset -q --hard "$BASE"; git -C "$R" clean -qfd; }

# registry builder: start from the real default registry, apply a JS statement over `d`, set paths/exceptions empty.
mkreg() { # <out> <js statement over d>
  node -e '
    const { DEFAULT_REGISTRY } = require(process.argv[1]);
    const d = JSON.parse(JSON.stringify(DEFAULT_REGISTRY));
    d.paths = {}; d.exceptions = [];
    d.allowlists.top_dirs = ["src","docs","tools","hooks"].map((n) => ({ name: n, purpose: "fixture" }));
    d.allowlists.root_files = [{ name: "README.md", purpose: "fixture" }];
    eval(process.argv[3]);
    require("fs").writeFileSync(process.argv[2], JSON.stringify(d, null, 2));
  ' "$LAYOUT" "$1" "$2"
}
lint() { # <registry> [lint script]
  (cd "$R" && node "${2:-$LINT}" --repo-root "$R" --registry "$1" 2>&1)
}

REG="$TEST_TMP/reg-bootstrap.json"; mkreg "$REG" ''

# ── control: the clean fixture is green ──
OUT="$(lint "$REG")"; assert_eq "$?" "0" "control: clean fixture at bootstrap passes"
assert_contains "$OUT" "clean at stage bootstrap" "control: names the stage"

# ── (a) a stray root file ──
echo "junk" > "$R/notes.txt"; git -C "$R" add notes.txt
OUT="$(lint "$REG")"; assert_eq "$?" "1" "(a) stray root file is red"
assert_contains "$OUT" "notes.txt" "(a) names the file"
assert_contains "$OUT" "allowlist:root_files" "(a) names the rule"
reset_repo
echo "junk" > "$R/notes.txt"   # untracked only
OUT="$(lint "$REG")"; assert_eq "$?" "0" "(a) twin: the same file untracked is not judged"
reset_repo

# ── (b) an unregistered top-level directory ──
mkdir -p "$R/weird"; echo "w" > "$R/weird/x.js"; git -C "$R" add -A
OUT="$(lint "$REG")"; assert_eq "$?" "1" "(b) unregistered top-level directory is red"
assert_contains "$OUT" "allowlist:top_dirs" "(b) names the rule"
assert_contains "$OUT" 'top-level directory "weird/"' "(b) names the directory"
reset_repo

# ── (c) tools/ subdirectory other than migrate, and a file directly under tools/ ──
mkdir -p "$R/tools/gates"; echo "g" > "$R/tools/gates/x.js"; git -C "$R" add -A
OUT="$(lint "$REG")"; assert_eq "$?" "1" "(c) tools/gates/x.js is red"
assert_contains "$OUT" "allowlist:tools_subdirs" "(c) names the rule"
assert_contains "$OUT" "tools/gates/x.js" "(c) names the file"
reset_repo
echo "t" > "$R/tools/loose.js"; git -C "$R" add -A
OUT="$(lint "$REG")"; assert_eq "$?" "1" "(c) a file directly under tools/ is red"
reset_repo
mkreg "$TEST_TMP/reg-gates.json" 'd.allowlists.tools_subdirs.push({ name: "gates", purpose: "fixture" })'
mkdir -p "$R/tools/gates"; echo "g" > "$R/tools/gates/x.js"; git -C "$R" add -A
OUT="$(lint "$TEST_TMP/reg-gates.json")"; assert_eq "$?" "0" "(c) twin: once the registry opens gates/ it is green"
reset_repo

# ── (d) exception that is a glob / a directory ──
mkreg "$TEST_TMP/reg-glob.json" 'd.exceptions = [{ path: "docs/plans/*.md", rule: 6, reason: "glob" }]'
OUT="$(lint "$TEST_TMP/reg-glob.json")"; assert_eq "$?" "2" "(d) glob exception is a registry error (exit 2)"
assert_contains "$OUT" "glob" "(d) says why"
mkreg "$TEST_TMP/reg-dirslash.json" 'd.exceptions = [{ path: "docs/plans/", rule: 6, reason: "dir" }]'
OUT="$(lint "$TEST_TMP/reg-dirslash.json")"; assert_eq "$?" "2" "(d) directory exception with slash is exit 2"
mkreg "$TEST_TMP/reg-dir.json" 'd.exceptions = [{ path: "docs/plans", rule: 6, reason: "dir" }]'
OUT="$(lint "$TEST_TMP/reg-dir.json")"; assert_eq "$?" "2" "(d) existing directory without slash is exit 2"

# ── (e) exception without a reason ──
mkreg "$TEST_TMP/reg-noreason.json" 'd.stage = "P1"; d.exceptions = [{ path: "docs/plans/p.md", rule: 6 }]'
OUT="$(lint "$TEST_TMP/reg-noreason.json")"; assert_eq "$?" "2" "(e) exception without reason is exit 2"
assert_contains "$OUT" "reason" "(e) says why"
mkreg "$TEST_TMP/reg-blankreason.json" 'd.stage = "P1"; d.exceptions = [{ path: "docs/plans/p.md", rule: 6, reason: "  " }]'
OUT="$(lint "$TEST_TMP/reg-blankreason.json")"; assert_eq "$?" "2" "(e) blank reason is exit 2"
mkreg "$TEST_TMP/reg-okexc.json" 'd.stage = "P1"; d.exceptions = [{ path: "docs/plans/p.md", rule: 6, reason: "pinned for the fixture" }]'
OUT="$(lint "$TEST_TMP/reg-okexc.json")"; assert_eq "$?" "0" "(e) twin: exact file, rule and reason is honoured at P1"
mkreg "$TEST_TMP/reg-wrongrule.json" 'd.stage = "P1"; d.exceptions = [{ path: "docs/plans/p.md", rule: 7, reason: "wrong rule" }]'
OUT="$(lint "$TEST_TMP/reg-wrongrule.json")"; assert_eq "$?" "1" "(e) an exception for another rule does not exempt"
mkreg "$TEST_TMP/reg-stale.json" 'd.exceptions = [{ path: "docs/gone.md", rule: 7, reason: "no such file" }]'
OUT="$(lint "$TEST_TMP/reg-stale.json")"; assert_eq "$?" "1" "(e) an exception naming an untracked file is red (stale)"
mkreg "$TEST_TMP/reg-extra.json" 'd.exceptions = [{ path: "docs/guide/g.md", rule: 7, reason: "x", glob: true }]'
OUT="$(lint "$TEST_TMP/reg-extra.json")"; assert_eq "$?" "2" "(e) an exception with an unknown field is exit 2"

# ── (f) unrecognised stage; other registry faults ──
mkreg "$TEST_TMP/reg-badstage.json" 'd.stage = "P9"'
OUT="$(lint "$TEST_TMP/reg-badstage.json")"; assert_eq "$?" "2" "(f) unknown stage value is exit 2"
assert_contains "$OUT" "P9" "(f) names the bad value"
OUT="$(lint "$TEST_TMP/missing.json")"; assert_eq "$?" "2" "(f) missing registry file is exit 2"
printf '{ not json' > "$TEST_TMP/broken.json"
OUT="$(lint "$TEST_TMP/broken.json")"; assert_eq "$?" "2" "(f) unparseable registry is exit 2"
mkreg "$TEST_TMP/reg-nochecker.json" 'd.stage = "P4"'
OUT="$(lint "$TEST_TMP/reg-nochecker.json")"; assert_eq "$?" "2" "(f) an active rule with no checker is exit 2"
assert_contains "$OUT" "no checker" "(f) says why"

# ── (g) staging: P1 rules do not fire at bootstrap, and fire at P1 with work records before docs ──
OUT="$(lint "$REG")"; assert_eq "$?" "0" "(g) bootstrap: a plan md under docs/plans is not judged"
mkreg "$TEST_TMP/reg-p1.json" 'd.stage = "P1"'
OUT="$(lint "$TEST_TMP/reg-p1.json")"; assert_eq "$?" "1" "(g) P1: the same fixture is red"
assert_contains "$OUT" "docs/plans/p.md" "(g) P1: names the plan"
assert_contains "$OUT" "rule #6 work-records" "(g) P1: the plan hits rule #6, not #7 (work records before docs)"
assert_contains "$OUT" "belongs to project/" "(g) P1: says it belongs to project/"
assert_not_contains "$OUT" "docs/guide/g.md" "(g) P1: docs/guide stays green"
assert_not_contains "$OUT" "evidence/run1/out.md" "(g) P1: evidence waits for P2"
git -C "$R" mv docs/plans/p.md docs/loose.md 2>/dev/null; git -C "$R" add -A
OUT="$(lint "$TEST_TMP/reg-p1.json")"; assert_eq "$?" "1" "(g) P1: a loose md directly under docs/ is red"
assert_contains "$OUT" "rule #7 reader-docs" "(g) P1: it hits rule #7"
reset_repo
mkreg "$TEST_TMP/reg-p2.json" 'd.stage = "P2"'
OUT="$(lint "$TEST_TMP/reg-p2.json")"; assert_contains "$OUT" "rule #8 machine-records" "(g) P2: evidence hits rule #8"
reset_repo

# ── path keys must point at something tracked ──
mkreg "$TEST_TMP/reg-path-ok.json" 'd.paths = { plans_dir: "docs/plans", hooks_dir: "hooks" }'
OUT="$(lint "$TEST_TMP/reg-path-ok.json")"; assert_eq "$?" "0" "paths twin: keys that exist are green"
mkreg "$TEST_TMP/reg-path-bad.json" 'd.paths = { plans_dir: "docs/nowhere" }'
OUT="$(lint "$TEST_TMP/reg-path-bad.json")"; assert_eq "$?" "1" "paths: a key pointing at nothing is red"
assert_contains "$OUT" "paths.plans_dir" "paths: names the key"

# ── the allowlist control can really go green wrongly: mutate the lint, the stray root file passes ──
MUT="$TEST_TMP/mut"; mkdir -p "$MUT/scripts/lib"
cp "$REPO_ROOT/scripts/layout-lint.js" "$MUT/scripts/"; cp "$LAYOUT" "$MUT/scripts/lib/"
node -e '
  const fs = require("fs"); const f = process.argv[1];
  const s = fs.readFileSync(f, "utf8");
  const t = s.replace("if (!rootFiles.has(f)) bad(", "if (false) bad(");
  if (t === s) { process.stderr.write("mutation did not apply\n"); process.exit(3); }
  fs.writeFileSync(f, t);
' "$MUT/scripts/layout-lint.js"
assert_eq "$?" "0" "mutation: root-file check switched off in the copy"
echo "junk" > "$R/notes.txt"; git -C "$R" add notes.txt
OUT="$(lint "$REG" "$MUT/scripts/layout-lint.js")"; assert_eq "$?" "0" "mutation: with the check off the stray root file passes (so (a) is a real control)"
OUT="$(lint "$REG")"; assert_eq "$?" "1" "mutation twin: the real lint still reds it"
reset_repo

# ── repo-layout CLI ──
OUT="$(node "$LAYOUT" stage 2>&1)"; assert_eq "$?" "0" "cli: stage exits 0"
assert_eq "$OUT" "$(node -e 'process.stdout.write(require(process.argv[1]).DEFAULT_REGISTRY.stage)' "$LAYOUT")" "cli: stage prints the registry stage"
OUT="$(node "$LAYOUT" path hooks_json 2>&1)"; assert_eq "$OUT" "hooks/hooks.json" "cli: path prints the path"
OUT="$(node "$LAYOUT" path no_such_key 2>&1)"; assert_eq "$?" "2" "cli: unknown key exits 2"
assert_contains "$OUT" "unknown path key" "cli: unknown key says so"
OUT="$(node "$LAYOUT" --json 2>&1)"; assert_eq "$?" "0" "cli: --json exits 0"
assert_contains "$OUT" '"stages"' "cli: --json carries the stage list"
OUT="$(REPO_LAYOUT_REGISTRY="$TEST_TMP/reg-p1.json" node "$LAYOUT" stage 2>&1)"; assert_eq "$OUT" "P1" "cli: REPO_LAYOUT_REGISTRY overrides the registry"
OUT="$(REPO_LAYOUT_REGISTRY="$TEST_TMP/reg-badstage.json" node "$LAYOUT" stage 2>&1)"; assert_eq "$?" "2" "cli: an invalid registry exits 2"
node -e '
  const L = require(process.argv[1]);
  const a = L.rules({ activeOnly: true }).length, b = L.rules().length;
  if (a > b || b !== 8) { console.error("rule counts off", a, b); process.exit(1); }
  if (L.allowlists().tools_subdirs.map((e) => e.name).join() !== "migrate") process.exit(1);
  try { L.path("nope"); process.exit(1); } catch (e) { /* expected throw */ }
' "$LAYOUT"
assert_eq "$?" "0" "api: 8 rules, tools/ opens only migrate, unknown key throws"

# ── data files that cannot read the registry: sync-manifest triggers and serial-suites entries ──
mkdir -p "$R/scripts" "$R/hooks/tests/lib"
echo "t" > "$R/hooks/tests/a.test.sh"; echo "s" > "$R/scripts/s.js"
printf '%s\n' '# comment' 'hooks/tests/a.test.sh  # trailing' > "$R/hooks/tests/lib/serial-suites.txt"
write_manifest() { # <trigger json array>
  printf '{"rituals":[{"id":"r1","trigger":%s}]}\n' "$1" > "$R/scripts/sync-manifest.json"
  git -C "$R" add -A
}
write_manifest '["scripts/", "hooks/tests/a.test.sh", "skills/", "*.js"]'
DATA_PATHS='d.allowlists.top_dirs.push({ name: "scripts", purpose: "fixture" }, { name: "skills", purpose: "fixture" }); d.paths = { plans_dir: "docs/plans", hooks_dir: "hooks", hook_tests_dir: "hooks/tests", serial_suites: "hooks/tests/lib/serial-suites.txt", scripts_dir: "scripts", sync_manifest: "scripts/sync-manifest.json" }'
mkreg "$TEST_TMP/reg-data.json" "$DATA_PATHS"
OUT="$(lint "$TEST_TMP/reg-data.json")"; assert_eq "$?" "1" "data: skills/ names no tracked file, so the control is red for that entry"
assert_contains "$OUT" '"skills/" matches no tracked file' "data: names the dead trigger"
mkdir -p "$R/skills"; echo "k" > "$R/skills/k.md"; git -C "$R" add -A
OUT="$(lint "$TEST_TMP/reg-data.json")"; assert_eq "$?" "0" "data twin: triggers that hit tracked files, outside governed areas and a suffix entry, are green"
write_manifest '["scripts/", "docs/gone/x.md"]'
OUT="$(lint "$TEST_TMP/reg-data.json")"; assert_eq "$?" "1" "data: a trigger pointing at a nonexistent path is red"
assert_contains "$OUT" "sync-manifest:trigger" "data: names the rule"
assert_contains "$OUT" '"docs/gone/x.md"' "data: names the entry"
mkdir -p "$R/docs/old"; echo "o" > "$R/docs/old/x.md"
write_manifest '["docs/old/x.md"]'
OUT="$(lint "$TEST_TMP/reg-data.json")"; assert_eq "$?" "1" "data: a trigger that hits a file but sits under no registry path is red"
assert_contains "$OUT" "is not under any path in the registry" "data: says it is under no registry path"
mkreg "$TEST_TMP/reg-data-docs.json" "$DATA_PATHS; d.paths.old_docs = \"docs/old\""
OUT="$(lint "$TEST_TMP/reg-data-docs.json")"; assert_eq "$?" "0" "data twin: once a registry path covers it the same trigger is green"
write_manifest '["scripts/"]'
printf '%s\n' 'hooks/tests/a.test.sh' 'hooks/tests/missing.test.sh' > "$R/hooks/tests/lib/serial-suites.txt"; git -C "$R" add -A
OUT="$(lint "$TEST_TMP/reg-data.json")"; assert_eq "$?" "1" "data: a serial-suites entry naming no tracked file is red"
assert_contains "$OUT" "[serial-suites]" "data: names the rule"
assert_contains "$OUT" "hooks/tests/missing.test.sh" "data: names the entry"
printf '%s\n' 'hooks/tests/a.test.sh' > "$R/hooks/tests/lib/serial-suites.txt"; git -C "$R" add -A
OUT="$(lint "$TEST_TMP/reg-data.json")"; assert_eq "$?" "0" "data twin: a serial-suites file whose entries all exist is green"
# relay2 g1: the prefix check is one way. A trigger that is a directory ABOVE a registry value (docs/ over docs/plans)
# is not under any registry path, so it is red; before the fix the reverse containment let it through.
write_manifest '["docs/"]'
OUT="$(lint "$TEST_TMP/reg-data.json")"; assert_eq "$?" "1" "data: a directory trigger above a registry value (docs/ over docs/plans) is red"
assert_contains "$OUT" '"docs/" is not under any path in the registry' "data: names the upper-directory trigger"
write_manifest '["docs/old/x.md"]'
mkreg "$TEST_TMP/reg-data-docs-root.json" "$DATA_PATHS; d.paths.docs_dir = \"docs\""
OUT="$(lint "$TEST_TMP/reg-data-docs-root.json")"; assert_eq "$?" "0" "data twin: with docs_dir in the registry the same docs/ subtree is covered and green"
write_manifest '["scripts/"]'
# relay2 g1: a serial-suites file that is tracked but unreadable is a clean exit 2, not a stack trace.
rm -f "$R/hooks/tests/lib/serial-suites.txt"
OUT="$(lint "$TEST_TMP/reg-data.json")"; assert_eq "$?" "2" "data: a tracked serial-suites file missing on disk exits 2"
assert_contains "$OUT" "cannot read hooks/tests/lib/serial-suites.txt" "data: says which file could not be read"
assert_not_contains "$OUT" "node:internal" "data: no stack trace"
printf '%s\n' 'hooks/tests/a.test.sh' > "$R/hooks/tests/lib/serial-suites.txt"; git -C "$R" add -A
OUT="$(lint "$TEST_TMP/reg-data.json")"; assert_eq "$?" "0" "data twin: the file back on disk is green again"
reset_repo

# ── the real repo at its current stage ──
OUT="$(cd "$REPO_ROOT" && node "$LINT" 2>&1)"; assert_eq "$?" "0" "real repo: layout-lint is clean at its current stage"

finalize_test
