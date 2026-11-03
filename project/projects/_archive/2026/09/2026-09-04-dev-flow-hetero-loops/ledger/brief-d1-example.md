# D1 — topology roles + resolver knob transition table

Deliverable D1 of the plan (§4 row D1; contracts in §2.5 and the first two rows of §3). Suggested cuts,
each one hands dispatch on its own `cut/D1-<n>` branch, integrated ff-only into your worktree branch
after its acceptance is green:

## Cut 1 — `scripts/resolve-dispatch-topology.js` roles
Extend the existing resolver (currently derives `implementer_ladder`, `claude_fallback_ladder`,
`candidates_to_qualify`, `judge`; facts via `engine-scorecard.js current --role implementer` and
`seat-status`). Add:
- `--role implementer|plan_reviewer|reviewer|consult|discuss` (repeatable or comma list; default all).
- `--exclude-seats <engine/effort@runner,…>` and `--asking-family <family>` (default `anthropic`).
- New top-level keys in the topology JSON, all derived per role from qualified, non-demoted, unexpired
  scorecard rows through `seat-status` (never `ladder`/`report`): `reviewer_ladder` (ordered like the
  implementer ladder), `consult_ladder` (ordered: family different from `--asking-family` first, then
  latency, then cost rank), `discuss_ladder` (same ordering), `plan_review_panel` (at most 3 seats, distinct
  families, chair = highest effort rank first; seats derive from `reviewer` rows for the chair and from
  `reviewer` or `consult` rows for the others; a seat whose runner is not one of codex, agy, grok, cc-shim,
  anthropic-compatible, claude-native, qoderclicn, cursor is never placed in the panel). Each seat object
  carries `engine`, `effort`, `runner`, `family`, `endpoint` (from endpoints env when known, else empty),
  `baseline_event_id`, `role_source`.
- Runner token normalisation: a scorecard runner `codex-cli` is the same runner as `codex` (sol's reviewer
  row, event 141, is recorded that way); apply the alias when matching and emit `codex` in output.
- `--exclude-seats` removes matching `engine/effort@runner` tuples from every ladder and the panel.
- Family detection: reuse the family rules already used by `resolve-review-loop.sh` (`family_of`) — copy
  the mapping into the script as a small table (openai, anthropic, google, xai, minimax, zhipu, moonshot,
  alibaba); do not shell out to bash for it.
- `--check` keeps working (diff ignores `generated_at`). `--help` documents every flag.
Tests in `hooks/tests/resolve-dispatch-topology.test.sh` (existing harness: fake `agy` on PATH, fixture
scorecard rows via `write_scorecard_row`, `ENGINE_SCORECARD_DIR`): reviewer/consult/discuss rows produce
the ladders; panel has distinct families and ≤3 seats; `codex-cli` row surfaces as `codex`; a `kimi`-runner
reviewer row never enters the panel but does enter `reviewer_ladder`; `--exclude-seats` removes a seat;
`--asking-family openai` moves an openai seat behind a minimax seat; zero rows ⇒ empty arrays, exit 0.

## Cut 2 — `scripts/resolve-review-loop.sh` transition table + schema + template
Implement the §2.5 knob transition table for `plan_review`, `hetero_review` (new field), `consult_dispatch`:
- Accepted values become `auto|on|off` for all three; `auto` is the new default for all three (`DEF_*`).
  `hetero_review` is the per-phase code-review loop switch; its explicit tuple is the existing `reviewer_*`
  tuple.
- `auto` reads the topology file (`AUTOPILOT_TOPOLOGY_FILE`, default `~/.autopilot/topology.json`) the
  same way the `implementer_ladder: auto` block does. With ≥1 seat for the role: `plan_review` expands
  `plan_reviewer_*` from `plan_review_panel[0]` and `plan_deep_reviewer_*` from `plan_review_panel[1]`
  when present; `hetero_review` leaves `reviewer_*` as configured and only records provenance;
  `consult_dispatch` expands `consult_*` from the first `consult_ladder` seat after excluding every seat of
  the resolved `qc_panel` (build the exclusion list from `qc_panel`/`qc_panel_runners`/`qc_panel_efforts`
  and pass it to the topology resolver's `--exclude-seats`, or filter the cached JSON in-script — pick
  one and test it). With an absent file, malformed JSON, or zero seats for the role: native fallback —
  tuple `opus / high @ claude-native` for plan and hetero review, `sonnet / high @ claude-native` for
  consult — plus a `capability_warnings` line naming the knob and the cause; the knob's effective value
  stays `auto` (never rewritten to `off`).
- New output fields `plan_review_resolved_from`, `hetero_review_resolved_from`, `consult_resolved_from`
  with values `explicit|topology|native-fallback|off`, also readable via `--field`.
- `on` keeps the existing requires-full-tuple validation and exit-3 message shape (`plan_review=on requires
  …`); add the same for `hetero_review=on` (requires `reviewer_engine`, `reviewer_runner`,
  `reviewer_effort`) and keep `consult_dispatch=on` as is. `off` is unchanged except that `--field
  <knob>_resolved_from` prints `off`.
- Invalid value (anything else, e.g. a misspelled `auto`) ⇒ existing `invalid <knob> (must be auto|on|off)`
  message, exit 3, evaluated before any stage selection — never treated as `off`.
- Knob absent from the config file ⇒ exactly the `auto` behaviour (template default); add a fixture that runs
  the resolver against a pre-template config file with all three knobs missing.
- `auto` where every topology seat for the role is filtered out (unsupported runner for the plan panel, or
  a seat excluded by the qc roster) ⇒ the same native fallback as zero seats.
- `schemas/review-loop-contract.schema.json`: add `hetero_review` and the three `*_resolved_from`
  fields to the properties and to `x-field-order` next to their siblings; `node scripts/check-contract-schema.js`
  must pass; `node scripts/validate-json-schema.js` if it covers this schema.
- `project-config-template/review-loop-config.md`: settings lines `plan_review: auto`, `hetero_review: auto`,
  `consult_dispatch: auto`; one table row per knob describing the four transitions in one sentence each.
- The dogfood `.claude/review-loop-config.md` is NOT edited by you; the defaults apply to it. Any test
  pinned to the old defaults (`plan_review` `off`, `consult_dispatch` `off`) is updated to the new defaults
  with a one-line comment naming this plan.
Tests in `hooks/tests/resolve-review-loop.test.sh`: for each knob, the matrix `auto|on|off` × topology
`present-with-seats|present-zero-seats|malformed-json|absent`; `on` with an incomplete tuple ⇒ exit 3;
`plan_reviewer_runner: bogus` ⇒ exit 3; consult exclusion: a topology whose first consult seat equals a
`qc_panel` seat resolves to the next seat; `--field plan_review_resolved_from` prints the right token in
every cell. Keep the suite under `AUTOPILOT_TEST_SUITE_TIMEOUT_SECS=1200`.

## Cut 3 — docs wiring for the topology flags
`docs/scripts-inventory.md` row for `resolve-dispatch-topology.js` gains the roles/flags (index-entry
shape, no history); `project-config-template/review-loop-config.md` § Gotchas gets one paragraph on the
native fallback; `references/hetero-dispatch.md` § Implementer ladder gets one sentence pointing at the
review/consult ladders. `node scripts/check-claude-md-inventory.js` and `node scripts/doc-drift-gate.js`
green.

## DONE
`bash hooks/tests/resolve-dispatch-topology.test.sh && AUTOPILOT_TEST_SUITE_TIMEOUT_SECS=1200 bash hooks/tests/resolve-review-loop.test.sh && node scripts/check-contract-schema.js && node scripts/check-js-syntax.js && bash scripts/check-canonical-invariants.sh && node scripts/check-claude-md-inventory.js && node scripts/doc-drift-gate.js && bash scripts/sync-codex-plugin-skills.sh --check`
all green; on this host `node scripts/resolve-dispatch-topology.js --role plan_reviewer --json` yields ≥2
seats of distinct families and `bash scripts/resolve-review-loop.sh --field plan_review_resolved_from`
prints `topology`. Ledger file `docs/projects/2026-09-04-dev-flow-hetero-loops/ledger/D1.md`.
