#!/usr/bin/env bash
# distill-consolidate.sh — slug normalization, migrate, and PROACTIVE compare.
# The consolidate engine's value hinges on three deterministic guarantees:
#   1. normalize-slug converges independent namings of the same procedure to ONE machine-stable
#      slug (the precondition that makes the engine fire) WITHOUT collapsing distinct procedures.
#   2. migrate renames existing dirs to normalized slugs, and STOPS (never auto-merges) when two
#      existing dirs normalize to the same target — a real consolidation case.
#   3. compare detects divergence PROACTIVELY (no merge-conflict state) against the pack's @{u}.
. "$(dirname "$0")/lib.sh"

S="$REPO_ROOT/scripts/distill-consolidate.sh"
assert_file_exists "$S" "script present"

git_id() { git -C "$1" config user.email t@t; git -C "$1" config user.name t; }
mkrepo() { local d="$TEST_TMP/$1"; mkdir -p "$d"; git -C "$d" init -q; git_id "$d"; echo "$d"; }
norm() { bash "$S" normalize-slug "$1"; }

# ── 1. normalize-slug ────────────────────────────────────────────────────────
# convergence: fix / ensure / order-moved verb all collapse to one slug
assert_eq "$(norm fix-git-identity)"    "git-identity" "drops leading 'fix'"
assert_eq "$(norm git-identity-fix)"    "git-identity" "drops trailing 'fix' (order divergence)"
assert_eq "$(norm ensure-git-identity)" "git-identity" "drops 'ensure'"
assert_eq "$(norm FIX-Git-Identity)"    "git-identity" "lowercases"
assert_eq "$(norm git_identity_fix)"    "git-identity" "splits on underscore"
# order preserved (no sort) — readability kept for non-stopword slugs
assert_eq "$(norm remote-dev-handoff)"  "remote-dev-handoff" "preserves token order (no sort)"
# antonym safety: a stopword must never collapse an antonym pair
assert_eq "$(norm add-user)"            "add-user"    "'add' is NOT a stopword (antonym-safe)"
assert_eq "$(norm remove-user)"         "remove-user" "'remove' distinct from add-user"
assert_neq "$(norm add-user)" "$(norm remove-user)" "antonyms stay distinct"
# all-stopword slug → fall back to lowercased original, never empty
assert_eq "$(norm fix-setup)"           "fix-setup"   "all-stopword slug falls back, never empty"
# usage guard
bash "$S" normalize-slug >/dev/null 2>&1; assert_exit_code "$?" 2 "normalize-slug w/o arg → exit 2"

# ── 2. migrate ───────────────────────────────────────────────────────────────
pack="$(mkrepo packm)"
mkdir -p "$pack/skills/fix-git-identity" "$pack/skills/remote-dev-handoff"
# real frontmatter so the name: rewrite can be asserted
printf 'name: fix-git-identity\ndescription: x\n\nbody\n' > "$pack/skills/fix-git-identity/SKILL.md"
printf 'name: remote-dev-handoff\ndescription: y\n\nbody\n' > "$pack/skills/remote-dev-handoff/SKILL.md"
git -C "$pack" add -A; git -C "$pack" commit -qm init
out="$(bash "$S" migrate "$pack")"
assert_contains "$out" '"fix-git-identity=>git-identity"' "migrate renames fix-git-identity"
assert_eq "$([ -d "$pack/skills/git-identity" ] && echo yes)" "yes" "git-identity dir exists after migrate"
assert_eq "$([ -d "$pack/skills/remote-dev-handoff" ] && echo yes)" "yes" "already-normal dir untouched"
# frontmatter name: must be rewritten to match the normalized slug (identity convergence, not just dir)
assert_eq "$(sed -n 's/^name:[[:space:]]*//p' "$pack/skills/git-identity/SKILL.md" | head -1)" "git-identity" "frontmatter name: rewritten to normalized slug"
assert_contains "$out" '"fix-git-identity=>git-identity"' "name_fixed reported"
assert_eq "$(grep -c '^description: x' "$pack/skills/git-identity/SKILL.md")" "1" "rest of SKILL.md preserved"
git -C "$pack" commit -qm mv
out="$(bash "$S" migrate "$pack")"
assert_contains "$out" "already normalized" "migrate is idempotent (dir + name)"
# collision: two existing dirs → same normalized slug → STOP, exit 1, nothing moved
coll="$(mkrepo packc)"
mkdir -p "$coll/skills/fix-git-identity" "$coll/skills/git-identity-fix"
echo a > "$coll/skills/fix-git-identity/SKILL.md"; echo b > "$coll/skills/git-identity-fix/SKILL.md"
git -C "$coll" add -A; git -C "$coll" commit -qm init
bash "$S" migrate "$coll" >/dev/null 2>&1; assert_exit_code "$?" 1 "migrate collision → exit 1"
err="$(bash "$S" migrate "$coll" 2>&1 >/dev/null)"
assert_contains "$err" '"collisions"' "collision reported"
assert_eq "$([ -d "$coll/skills/fix-git-identity" ] && echo yes)" "yes" "collision → nothing moved"

# ── 3. compare (proactive, against @{u}) ─────────────────────────────────────
bare="$TEST_TMP/remote.git"; git init -q --bare "$bare"
A="$TEST_TMP/A"; git clone -q "$bare" "$A" 2>/dev/null; git_id "$A"
mkdir -p "$A/skills/foo"; echo "v-A" > "$A/skills/foo/SKILL.md"
git -C "$A" add -A; git -C "$A" commit -qm init
git -C "$A" push -q -u origin "$(git -C "$A" rev-parse --abbrev-ref HEAD)"
assert_contains "$(bash "$S" compare foo "$A")" '"status":"identical"' "just-pushed slug is identical"
# new local-only slug → absent-theirs
mkdir -p "$A/skills/bar"; echo new > "$A/skills/bar/SKILL.md"
assert_contains "$(bash "$S" compare bar "$A")" '"status":"absent-theirs"' "local-only slug → absent-theirs"
# second clone diverges foo and pushes → A sees divergent
B="$TEST_TMP/B"; git clone -q "$bare" "$B" 2>/dev/null; git_id "$B"
git -C "$B" branch --set-upstream-to "origin/$(git -C "$B" rev-parse --abbrev-ref HEAD)" >/dev/null 2>&1
echo "B-change" >> "$B/skills/foo/SKILL.md"; git -C "$B" add -A; git -C "$B" commit -qm b; git -C "$B" push -q
assert_contains "$(bash "$S" compare foo "$A")" '"status":"divergent"' "peer-pushed change → divergent"
# absent-mine: upstream has foo, local deleted it
rm -rf "$B/skills/foo"
assert_contains "$(bash "$S" compare foo "$B")" '"status":"absent-mine"' "deleted-locally, upstream has it → absent-mine"
# guards
nu="$(mkrepo noup)"; bash "$S" compare foo "$nu" >/dev/null 2>&1; assert_exit_code "$?" 1 "no-upstream → exit 1"
mkdir -p "$TEST_TMP/plain"; bash "$S" compare foo "$TEST_TMP/plain" >/dev/null 2>&1; assert_exit_code "$?" 1 "non-git dir → exit 1"
bash "$S" compare >/dev/null 2>&1; assert_exit_code "$?" 2 "compare w/o slug → exit 2"

finalize_test
