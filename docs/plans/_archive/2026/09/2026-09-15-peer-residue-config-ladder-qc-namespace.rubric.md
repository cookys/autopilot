# Rubric — 2026-09-15-peer-residue-config-ladder-qc-namespace.md

> Source plan: docs/plans/2026-09-15-peer-residue-config-ladder-qc-namespace.md

R1: `resolve_config_ladder` tier 3 fires only when realpath(git toplevel of $PWD) == realpath(REPO_ROOT); a foreign git repo with no `.claude/<basename>` resolves `source: template` and the template's values.
R2: Running from a subdirectory of the autopilot repo still resolves tier 3 (`source: project-repo`); running outside any git checkout resolves template.
R3: `resolve-doa.sh`'s own third tier carries the same gate; its ladder is otherwise unchanged (no migration to the helper).
R4: The three helper consumers (`resolve-qc-gate.sh`, `resolve-worktree-teardown.sh`, `resolve-review-loop.sh`) are unedited except comments; their existing suites stay green.
R5: Every ladder assertion that pins the new gate is recorded red against the base commit before the change (the red is in the test's own comment or the run summary); preservation guards are labelled as such and are green at base.
R6: `qc-panel.js` default `--out` is `docs/projects/<proj>/tree/panel/<node>`, `--run-id <id>` appends one more validated component, explicit `--out` wins, and the chosen `out_dir` is emitted in the summary json.
R7: Two qc-panel runs with different `--node` on one project write to disjoint directories; `--run-id` with `..` or a slash is refused with exit 2.
R8: `dispatch-foreman.sh`'s brief contains a grep-able instruction that qc-panel output must go under the run dir (`--out`/`--run-id`), pinned by a string assertion.
R9: `references/hetero-dispatch.md` freezes the wrapper commit subject format and states it is an identifier, not integration evidence; points at `check-containment.js` / `check-inputs-landed.js`.
R10: `check-hands-commit.js --expect-wrapper-subject` rejects a tip subject not matching `^dispatch-hetero\([^)]+\): edits on \S+$`; without the flag behaviour is byte-identical to before; `dispatch-hetero.sh` passes the flag on its own commit.
R11: No file outside the sealed `output_paths` changes; codex mirrors of every touched `scripts/**` and `references/**` file are byte-identical (`sync-codex-plugin-skills.sh --check`).
R12: `check-js-syntax.js` and `check-reference-sizes.js` are clean.
