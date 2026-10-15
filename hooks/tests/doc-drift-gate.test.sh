#!/usr/bin/env bash
# hooks/tests/doc-drift-gate.test.sh — integration tests for doc-drift-gate.js

set -uo pipefail

. "$(dirname "$0")/lib.sh"

# Paths to script under test
GATE_JS="$REPO_ROOT/scripts/doc-drift-gate.js"

# Create a temporary sandbox repo directory inside TEST_TMP
SANDBOX="$TEST_TMP/sandbox"
mkdir -p "$SANDBOX"

# Helper to run gate on sandbox
run_gate() {
  local out
  local exit_code=0
  out=$(node "$GATE_JS" "$@" 2>&1) || exit_code=$?
  __GATE_OUT="$out"
  __GATE_EXIT="$exit_code"
}

# 1. Empty sandbox (no markdown files) should pass
echo "Testing empty sandbox..."
run_gate "$SANDBOX"
assert_exit_code "$__GATE_EXIT" 0 "empty directory passes"
assert_contains "$__GATE_OUT" "0 md files" "reports 0 md files"
assert_contains "$__GATE_OUT" "baseline doc-drift checks green" "reports baseline green"

# 2. Markdown file with good links and balanced fences should pass
echo "Testing good markdown file..."
mkdir -p "$SANDBOX/docs"
cat > "$SANDBOX/docs/good.md" <<'EOF'
# Good Doc
See [another doc](sibling.md).
See [anchor link](#anchor-only).
See [https link](https://google.com).
See [GH convention](/pull/123).
See [directory link](dir/).
See [placeholder link](<some-place>).

```javascript
const x = 1;
```
EOF
echo "# Sibling" > "$SANDBOX/docs/sibling.md"
mkdir -p "$SANDBOX/docs/dir"

run_gate "$SANDBOX"
assert_exit_code "$__GATE_EXIT" 0 "good markdown passes"
assert_contains "$__GATE_OUT" "2 md files" "reports 2 md files (good.md and sibling.md)"
assert_contains "$__GATE_OUT" "[PASS] links" "links check passes"
assert_contains "$__GATE_OUT" "[PASS] fences" "fences check passes"

# 3. Markdown file with broken links should fail (exit 1)
echo "Testing broken link..."
cat > "$SANDBOX/docs/broken_link.md" <<'EOF'
# Broken Link Doc
Here is a [broken link](ghost.md).
EOF

run_gate "$SANDBOX"
assert_exit_code "$__GATE_EXIT" 1 "broken link fails"
assert_contains "$__GATE_OUT" "[FAIL] links" "links check fails"
assert_contains "$__GATE_OUT" "ghost.md" "reports the missing target filename"
assert_contains "$__GATE_OUT" "broken_link.md: ghost.md" "reports path and link target"

# Cleanup broken link for next test
rm "$SANDBOX/docs/broken_link.md"

# 4. Markdown file with unbalanced code fences should fail (exit 1)
echo "Testing unbalanced code fences..."
cat > "$SANDBOX/docs/unbalanced_fence.md" <<'EOF'
# Unbalanced Fence
```javascript
const x = 2;
EOF

run_gate "$SANDBOX"
assert_exit_code "$__GATE_EXIT" 1 "unbalanced fence fails"
assert_contains "$__GATE_OUT" "[FAIL] fences" "fences check fails"
assert_contains "$__GATE_OUT" "unbalanced_fence.md: 1 fence lines (odd" "reports the unbalanced fence"

# Cleanup unbalanced fence for next test
rm "$SANDBOX/docs/unbalanced_fence.md"

# 5. Testing CLI excludes `--exclude`
echo "Testing custom exclude..."
mkdir -p "$SANDBOX/docs/ignored_subdir"
cat > "$SANDBOX/docs/ignored_subdir/bad_link.md" <<'EOF'
[broken](does-not-exist.md)
EOF

# Should fail without exclude
run_gate "$SANDBOX"
assert_exit_code "$__GATE_EXIT" 1 "fails on bad_link.md without exclude"

# Should pass with exclude
run_gate "--exclude" "ignored_subdir" "$SANDBOX"
assert_exit_code "$__GATE_EXIT" 0 "passes when bad_link.md is excluded"

# Cleanup
rm -rf "$SANDBOX/docs/ignored_subdir"

# 6. Generated Codex plugin payload is excluded by default. Canonical sources
# are checked at their source paths; the generated package payload is checked by
# codex-plugin-package.test.sh because its relative links resolve from a
# different package root.
echo "Testing generated Codex plugin exclude..."
mkdir -p "$SANDBOX/platforms/codex/plugin/skills/generated"
cat > "$SANDBOX/platforms/codex/plugin/skills/generated/bad_link.md" <<'EOF'
[broken](does-not-exist.md)
```
```
EOF

run_gate "$SANDBOX"
assert_exit_code "$__GATE_EXIT" 0 "generated Codex plugin payload is excluded by default"

# Cleanup
rm -rf "$SANDBOX/platforms"

# 7. Testing CRLF normalization
# Create a markdown file with CRLF line endings and unbalanced code fences.
# Make sure CRLF is normalized to LF and checked correctly.
# If CRLF is normalized, the line splits by \n work correctly and count is accurate.
echo "Testing CRLF line endings..."
printf "# CRLF Doc\r\n\`\`\`javascript\r\nconst x = 3;\r\n\`\`\`\r\n" > "$SANDBOX/docs/crlf.md"

run_gate "$SANDBOX"
assert_exit_code "$__GATE_EXIT" 0 "CRLF doc with balanced fences passes"

# Now unbalanced CRLF
printf "# CRLF Doc\r\n\`\`\`javascript\r\nconst x = 3;\r\n" > "$SANDBOX/docs/crlf.md"
run_gate "$SANDBOX"
assert_exit_code "$__GATE_EXIT" 1 "CRLF doc with unbalanced fences fails"

# Cleanup CRLF doc
rm "$SANDBOX/docs/crlf.md"

# 7b. Only the listed verbatim consult transcripts under docs/plans/evidence/ are excluded
# (by whole relative path prefix); every other file there, and look-alike paths, stay scanned.
echo "Testing frozen consult-transcript exclusion..."
EV="$TEST_TMP/ev-sandbox"
FROZEN="docs/plans/evidence/2026-09-16-blind-review-redesign"
mkdir -p "$EV/$FROZEN" "$EV/docs/plans/sub/evidence/y"
printf '# Frozen\nSee [gone](ghost.md).\n' > "$EV/$FROZEN/consult-gpt-6-astra.md"
run_gate "$EV"
assert_exit_code "$__GATE_EXIT" 0 "listed consult transcript with a broken link is not scanned"
printf '# Live\nSee [gone](ghost.md).\n' > "$EV/$FROZEN/other.md"
run_gate "$EV"
assert_exit_code "$__GATE_EXIT" 1 "non-excluded file under docs/plans/evidence/ with a broken link fails"
rm "$EV/$FROZEN/other.md"
printf '# Live\nSee [gone](ghost.md).\n' > "$EV/$FROZEN/consult-gpt-6-astra.md.bak.md"
run_gate "$EV"
assert_exit_code "$__GATE_EXIT" 1 "exclusion is a whole-path match, not a substring/prefix of the name"
rm "$EV/$FROZEN/consult-gpt-6-astra.md.bak.md"
printf '# Live\nSee [gone](ghost.md).\n' > "$EV/docs/plans/sub/evidence/y/live.md"
run_gate "$EV"
assert_exit_code "$__GATE_EXIT" 1 "broken link under docs/plans/sub/evidence/ still fails"
rm "$EV/docs/plans/sub/evidence/y/live.md"
printf '# Live\nSee [gone](ghost.md).\n' > "$EV/docs/plans/live.md"
run_gate "$EV"
assert_exit_code "$__GATE_EXIT" 1 "broken link elsewhere in docs/plans/ still fails"
# a path-like exclude matches from the scan root or the repo root, not as a substring deeper down
mkdir -p "$EV/nested/docs/plans/evidence/2026-09-16-blind-review-redesign"
rm "$EV/docs/plans/live.md"
printf '# Live\nSee [gone](ghost.md).\n' > "$EV/nested/$FROZEN/consult-gpt-6-astra.md"
run_gate "$EV"
assert_exit_code "$__GATE_EXIT" 1 "same relative path under another prefix is still scanned"
# default path excludes still apply when the scan root is a subdirectory of the repo root
rm "$EV/nested/$FROZEN/consult-gpt-6-astra.md"
run_gate "$EV/docs" --repo-root "$EV"
assert_exit_code "$__GATE_EXIT" 0 "subdirectory scan root still honours path-prefix default excludes"
printf '# Live\nSee [gone](ghost.md).\n' > "$EV/$FROZEN/other.md"
run_gate "$EV/docs" --repo-root "$EV"
assert_exit_code "$__GATE_EXIT" 1 "subdirectory scan root still scans non-excluded evidence files"
rm "$EV/$FROZEN/other.md"

# a bare-name exclude (.git) matches whole path segments only, never ".github"
mkdir -p "$EV/.github" "$EV/.git/x"
printf '# Live\nSee [gone](ghost.md).\n' > "$EV/.github/live.md"
printf '# Hidden\nSee [gone](ghost.md).\n' > "$EV/.git/x/hidden.md"
run_gate "$EV"
assert_exit_code "$__GATE_EXIT" 1 ".github is still scanned (.git exclude is not a substring match)"
assert_contains "$__GATE_OUT" ".github/live.md" ".github file is the reported failure"
assert_not_contains "$__GATE_OUT" ".git/x/hidden.md" ".git directory itself stays excluded"
rm -r "$EV/.github" "$EV/.git"

# 7b. Sealed docs: a plan/rubric whose bytes a docs/mission-*-sources.json pins by sha256 is a
# frozen record (editing it to fix a link breaks next-touch-validation - 13976b30). The gate
# must not judge it; an ordinary doc with the same broken link must still be reported, so this
# cannot pass by the gate being switched off.
echo "Testing sealed docs..."
SD="$TEST_TMP/sealed-docs"
mkdir -p "$SD/docs/plans"
printf '# Sealed plan\nSee [gone](ghost.md).\n' > "$SD/docs/plans/sealed.md"
printf '# Sealed rubric\nSee [gone](ghost.md).\n' > "$SD/docs/plans/sealed.rubric.md"
printf '# Unsealed (sha absent)\nSee [gone](ghost.md).\n' > "$SD/docs/plans/nosha.md"
printf '# Ordinary\nSee [gone](ghost.md).\n' > "$SD/docs/plans/ordinary.md"
PSHA="$(sha256sum "$SD/docs/plans/sealed.md" | cut -d' ' -f1)"
RSHA="$(sha256sum "$SD/docs/plans/sealed.rubric.md" | cut -d' ' -f1)"
printf '{"sources":[{"plan_path":"plans/sealed.md","plan_sha256":"%s","rubric_path":"plans/sealed.rubric.md","rubric_sha256":"%s"},{"plan_path":"plans/nosha.md"}]}\n' "$PSHA" "$RSHA" > "$SD/docs/mission-x-sources.json"
run_gate "$SD/docs" --repo-root "$SD"
assert_exit_code "$__GATE_EXIT" 1 "ordinary doc with a broken link still fails the gate"
assert_contains "$__GATE_OUT" "ordinary.md" "control: the non-sealed broken link IS reported"
assert_contains "$__GATE_OUT" "nosha.md" "a manifest path with no sha256 is not sealed, still checked"
assert_not_contains "$__GATE_OUT" "sealed.md" "a sha256-sealed plan's broken link is not reported"
assert_not_contains "$__GATE_OUT" "sealed.rubric.md" "a sha256-sealed rubric's broken link is not reported"

# The shared list also covers execution graphs that carry graph_digest (BL-0130), and nothing else.
printf '{"graph_digest":"%s","nodes":[]}\n' "$PSHA" > "$SD/docs/mission-x-execution-graph.json"
printf '{"nodes":[]}\n' > "$SD/docs/mission-y-execution-graph.json"
SEALED_LIST="$(node -e 'console.log([...require(process.argv[1]).sealedDocFiles(process.argv[2])].sort().join(","))' "$REPO_ROOT/scripts/lib/sealed-docs.js" "$SD")"
assert_eq "$SEALED_LIST" "docs/mission-x-execution-graph.json,docs/plans/sealed.md,docs/plans/sealed.rubric.md" \
  "sealedDocFiles: sha-bound plan+rubric and graph_digest graph; not nosha plan or digest-less graph"

# BL-0133: graphs pinned by a paired *-task-authority.json (mission_graph_digest) and the
# spec_path of a *.seal.json (eval rubrics/corpora) are sealed too. Negative controls: a graph
# whose authority has no mission_graph_digest, an unpaired graph, and a plain doc stay unlisted.
mkdir -p "$SD/evals"
printf '{"nodes":[]}\n' > "$SD/docs/mission-z-execution-graph.json"
printf '{"mission_graph_digest":"%s"}\n' "$PSHA" > "$SD/docs/mission-z-task-authority.json"
printf '{"nodes":[]}\n' > "$SD/docs/mission-w-execution-graph.json"
printf '{"authority_status":"shadow"}\n' > "$SD/docs/mission-w-task-authority.json"
printf '# rubric\n' > "$SD/evals/r-rubric.md"
printf '# plain\n' > "$SD/evals/plain.md"
printf '{"spec_sha256":"%s","spec_path":"evals/r-rubric.md"}\n' "$PSHA" > "$SD/evals/r-rubric.seal.json"
SEALED_LIST="$(node -e 'console.log([...require(process.argv[1]).sealedDocFiles(process.argv[2])].sort().join(","))' "$REPO_ROOT/scripts/lib/sealed-docs.js" "$SD")"
assert_eq "$SEALED_LIST" "docs/mission-x-execution-graph.json,docs/mission-z-execution-graph.json,docs/plans/sealed.md,docs/plans/sealed.rubric.md,evals/r-rubric.md" \
  "sealedDocFiles: task-authority-paired graph and seal.json spec_path added; digest-less authority, unpaired graph, plain doc not listed"

# 8. Testing invalid command arguments/usage errors (exit 2)
echo "Testing invalid usage..."
run_gate "--exclude" # missing arg
assert_exit_code "$__GATE_EXIT" 2 "missing exclude arg exits with 2"

run_gate "/path/does/not/exist"
assert_exit_code "$__GATE_EXIT" 2 "non-existent path exits with 2"

finalize_test
