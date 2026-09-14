Implement docs/plans/2026-09-15-peer-residue-config-ladder-qc-namespace.md (read it first: §1 config ladder, §2 qc-panel namespace, §3 wrapper commit subject, §4 out of scope, §5 acceptance). You edit files only; the harness commits. No version bump, no CHANGELOG edit, no `git stash`, no push.

Every path you create or modify MUST be one of these (the contract's output_paths; anything else rejects the round; nothing is created):
scripts/lib/resolve-config.sh
platforms/codex/plugin/scripts/lib/resolve-config.sh
scripts/resolve-doa.sh
platforms/codex/plugin/scripts/resolve-doa.sh
scripts/resolve-review-loop.sh
platforms/codex/plugin/scripts/resolve-review-loop.sh
scripts/qc-panel.js
platforms/codex/plugin/scripts/qc-panel.js
scripts/dispatch-foreman.sh
platforms/codex/plugin/scripts/dispatch-foreman.sh
scripts/dispatch-hetero.sh
platforms/codex/plugin/scripts/dispatch-hetero.sh
scripts/check-hands-commit.js
platforms/codex/plugin/scripts/check-hands-commit.js
references/hetero-dispatch.md
platforms/codex/plugin/references/hetero-dispatch.md
hooks/tests/resolve-config.test.sh
hooks/tests/resolve-doa.test.sh
hooks/tests/qc-panel.test.sh
hooks/tests/dispatch-foreman.test.sh
hooks/tests/check-hands-commit.test.sh

Mirrors: never hand-edit platforms/codex/plugin/**; run `bash scripts/sync-codex-plugin-skills.sh` after editing scripts/** or references/**.

## §1 — scripts/lib/resolve-config.sh (+ resolve-doa.sh parity)
In `resolve_config_ladder`, tier 3 (`$REPO_ROOT/.claude/${basename}`, currently lines ~45–47) must fire ONLY when the git toplevel of `$PWD` is the same directory as `$REPO_ROOT`. Compute both with `git -C "$PWD" rev-parse --show-toplevel` and `realpath`/`readlink -f` (or `cd … && pwd -P`); if `$PWD` is not inside a git checkout, or the two differ, skip tier 3 and fall through to tier 4 (template) / the consumer's built-in default. Keep the `SOURCE="project-repo"` label (it is now truly the project's repo). Keep the helper's "caller-scope $PWD and $REPO_ROOT" contract; do not add parameters. Header comment: tier 3 is dogfood-only, and why (an installed plugin ships `.claude/`; a foreign repo must never inherit the roster or `stale_reaper_age_days: 14`).
`scripts/resolve-doa.sh` (~lines 148–155): its own third tier `PROJECT_CONFIG="$REPO_ROOT/.claude/doa-config.md"` gets the same gate (toplevel of $PWD == REPO_ROOT), else PROJECT_CONFIG stays unset/empty so the code-embedded presets answer. Keep its ladder; do not migrate it to the helper.
`scripts/resolve-review-loop.sh` ~lines 1940–1948 (the `brain_seat_identity_file` guard): comment only — say the helper now refuses cross-repo tier 3, so this guard is defence in depth, not the only wall. No behaviour change there.
Tests — hooks/tests/resolve-config.test.sh (use `. "$(dirname "$0")/lib.sh"`, `assert_eq <actual> <expected> <msg>`, `assert_contains`, end with `finalize_test`; look at how the file already builds fixtures):
 (a) CHANGE-PINNING, must be RED at base: a fresh foreign git repo under $TEST_TMP with NO `.claude/` — run `resolve-worktree-teardown.sh` and `resolve-review-loop.sh --field source` (or equivalent) with cwd = that repo → `source` is `template`, `stale_reaper_age_days` equals the template's `0`, `implementer_engine` equals the template's value, NOT autopilot's `.claude/` value.
 (b) PRESERVATION GUARD (green at base, label it so in a comment): cwd = a SUBDIRECTORY of the autopilot repo (e.g. `$REPO_ROOT/scripts`) → tier 3 still fires, `source: project-repo`.
 (c) CHANGE-PINNING, RED at base: cwd = a non-git directory under $TEST_TMP → `template`.
 hooks/tests/resolve-doa.test.sh: the foreign-repo negative (RED at base): with a `$REPO_ROOT/.claude/doa-config.md` fixture present ONLY via override of REPO_ROOT (or by creating the file in a copied plugin tree under $TEST_TMP — do not write into the real repo's .claude/), a foreign cwd resolves the preset, not the file.
 Record each red: before editing the helper, run the new assertions once and paste the FAIL lines into the test file's header comment (`# RED at base <sha>: …`).

## §2 — scripts/qc-panel.js + scripts/dispatch-foreman.sh
qc-panel.js (~lines 190–199): default `--out` becomes `path.join(repoRoot,'docs','projects',proj,'tree','panel',nodeId)`; new optional `--run-id <id>` validated with the existing `validatePathComponent(name,'--run-id')` (it already rejects `..`, `/`, `\` and exits 2), appended as one more component when given. Explicit `--out` wins unchanged. Print `qc-panel.js: out_dir=<abs>` on stderr and add `out_dir` to the summary json the script already writes (find the object that carries the verdict/seat summary and add the field; keep the existing key order). Update the usage text.
dispatch-foreman.sh: in the brief text the script writes for the foreman (search for the protocol heredoc that names `dispatch-hetero.sh --branch hands/$RUN_ID/<unit>`), add one line: any `scripts/qc-panel.js` the foreman runs MUST pass `--out "$RUN_DIR/panel/<node>"` — `--out` rooted at `$RUN_DIR` is the only accepted form; `--run-id` is an optional extra component, never a substitute for `--out`.
Tests — hooks/tests/qc-panel.test.sh (RED at base for the first two): two runs with the same `--proj` and different `--node` write to two directories and the first's files are untouched by the second; `--run-id 'x/..'` (and a value with `/`) exits 2 with a message naming `--run-id`; explicit `--out` unchanged (preservation guard, label it). hooks/tests/dispatch-foreman.test.sh: ONE string assertion that the generated brief contains the literal `--out "$RUN_DIR/panel/` (assert on the brief file the script writes; the suite has pre-existing unrelated failures after its case 3 — do not try to fix those, put the assertion where the brief is first available, before case 3 if possible).

## §3 — references/hetero-dispatch.md + scripts/check-hands-commit.js + dispatch-hetero.sh
references/hetero-dispatch.md § Outcome states: add a paragraph (≤ 700 bytes; record `wc -c` before/after in your final note) titled "Wrapper commit subject" that freezes the exact format `dispatch-hetero(<runner label>): edits on <branch>` (the string dispatch-hetero.sh:~3487 commits with), says it is an IDENTIFIER of the wrapper commit and NEVER evidence of integration, and that landed/not-landed is answered by `scripts/check-containment.js` / `scripts/check-inputs-landed.js`, not by grepping subjects.
check-hands-commit.js: new opt-in flag `--expect-wrapper-subject`. When present, read the tip commit subject of `--base..--head` (`git log -1 --format=%s <head>`) and reject (same failure shape/exit the script already uses for a rejected range) unless it matches `^dispatch-hetero\([^)]+\): edits on \S+$`. Without the flag, behaviour is byte-identical. Usage text updated.
dispatch-hetero.sh ~line 3641 (the `check-hands-commit.js --repo "$WT" --base … --head …` invocation): append `--expect-wrapper-subject` — the rail authored that commit itself, so the check is a self-consistency assertion.
Tests — hooks/tests/check-hands-commit.test.sh: with the flag, a range whose tip subject is `dispatch-hetero(agy): edits on feat/x` passes and one whose tip is `feat(x): …` fails (RED at base: the flag does not exist yet, so the failing case passes today); without the flag the `feat(x)` tip still passes (preservation guard).

## Verification you must leave green
bash hooks/tests/resolve-config.test.sh; bash hooks/tests/resolve-doa.test.sh; bash hooks/tests/resolve-review-loop.test.sh; bash hooks/tests/resolve-worktree-teardown.test.sh; bash hooks/tests/qc-gate.test.sh; bash hooks/tests/qc-panel.test.sh; bash hooks/tests/check-hands-commit.test.sh; node scripts/check-js-syntax.js; bash scripts/sync-codex-plugin-skills.sh --check; node scripts/check-reference-sizes.js. Run suites one at a time. dispatch-foreman.test.sh: only your new assertion must be green; the suite's pre-existing 40 failures are a known separate defect.
Final note (stdout, not a file): list every red you recorded with the base sha, the `wc -c` of hetero-dispatch.md before/after, and the exact commands you ran green.
