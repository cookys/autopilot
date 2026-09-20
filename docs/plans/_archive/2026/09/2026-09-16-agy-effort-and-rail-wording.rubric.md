# Rubric — 2026-09-16-agy-effort-and-rail-wording.md

> Source plan: docs/plans/2026-09-16-agy-effort-and-rail-wording.md

R1: `agy_effort_for_model <resolved-model> <effort>` in `scripts/lib/agy-model-alias.sh` prints the id's tier when the resolved id ends in `-low|-medium|-high`, otherwise `agy_effort_clamp <effort>`; it never prints an empty or non-`low|medium|high` value.
R2: The agy exec sites of `dispatch-hetero.sh`, `dispatch-review.sh`, and `dispatch-author.sh` pass `--effort "$(agy_effort_for_model "$MODEL" "$EFFORT")"` with the RESOLVED model; a `gemini-flash-medium` alias under the default effort reaches the agy stub as `--effort medium` (RED at base: `high`), and `gemini-flash-high` with `--effort low` reaches it as `--effort high`.
R3: When the fold changes the value, the rail writes exactly one stderr note naming the requested effort, the folded tier, and that the model id encodes the tier; when it does not change the value, no note is written.
R4: Non-agy runners and non-suffixed agy ids are byte-identical in the argv they receive (`grok`, `codex`, `cc-shim` cases in the three suites unchanged; a non-suffixed agy id under `xhigh` still receives `high`).
R5: `strict_l5_provider_roster_incomplete` for the missing verification-author seat keeps its code and its message now contains `verification_author_present: true` and names `.claude/review-loop-config.md`.
R6: `status readiness` whose strict bootstrap throws writes one stderr line beginning `readiness: strict bootstrap unavailable` that includes the thrown code or message, still exits 0, and emits the same provider-less receipt as before; a successful bootstrap writes no such line.
R7: The `--probe` flag semantics (bounded live spend, per-seat transport/live probes) are unchanged and documented on the `status` usage line of `bin/autopilot.js`.
R8: The dirty-tree refusal reason still begins `dirty: repository has uncommitted changes` and now ends with a remedy naming `--cwd` and a clean checkout/worktree; the rejection code `campaign_repo_precondition_failed` is unchanged.
R9: Every change-pinning assertion is recorded RED against the base sha in its test header; preservation guards are labelled and green at base; tests drive stubs only (no live agy, codex, or endpoint spend).
R10: No file outside the sealed `output_paths` changes; every touched `scripts/**`, `src/**`, `bin/**` file has a byte-identical codex mirror (`sync-codex-plugin-skills.sh --check`); `check-js-syntax.js` clean; the listed suites green; `check-backlog-entries.js` exit 0 after the three Context edits.
