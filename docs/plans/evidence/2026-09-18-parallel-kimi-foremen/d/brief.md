# Brief D — unit name for this run: `terminal-d` (repair: `terminal-d-r2`)

# Brief D — a managed campaign whose hand fails acceptance must reach a durable terminal disposition, not die at the journal

BACKLOG rows: "Managed rail: acceptance_failed cannot be journaled — terminal journal says
MUTATION_FAILURE_EVIDENCE_REQUIRED" (fired 2026-09-16 and again 2026-09-18) and, same family, "A managed campaign whose
wall expires leaves no terminal summary and no journal disposition". Evidence of the 2026-09-18 case:
`docs/plans/evidence/2026-09-18-blind-review-panel-station/impl-run1-acceptance-failed-session-env.json` — the
dispatch-hetero envelope came back `acceptance_failed` (a verify command exited 1 after the hand's commit), the engine's
failure terminalization (`src/engine/autopilot-engine.js` ~:2815-2870: builds `implementation_campaign_failure`
receipt, appends `MUTATION_FAILED` with `failure_receipt_digest` + `artifactReference {kind:'campaign_terminal',
digest, repair_lineage?}`) was REFUSED by the reducer (`src/engine/implementation-campaign.js` ~:950-962:
`output_artifact_digest` must equal `canonicalDigest({kind:'campaign_terminal', digest})`) → run result
`{"status":"blocked","phase":"campaign_terminal_journal","reason":"MUTATION_FAILURE_EVIDENCE_REQUIRED"}`, the journal
still holds `live_lease`, `--resume` is refused, and the operator has only `campaign terminalize`.

Depth-0 hypothesis (verify, do not assume): `campaign-intake.js` ~:560 derives `output_artifact_digest =
canonicalDigest(artifactReference)` and `normalizeCampaignArtifactReference` (`implementation-campaign.js` ~:265-295)
KEEPS `repair_lineage` on a `campaign_terminal` reference, so whenever the controller attaches a repair lineage the
digest covers `{kind, digest, repair_lineage}` while the reducer recomputes `{kind, digest}` — a guaranteed mismatch.
If the RED reproduction shows a different cause, fix the real one and say so in the report.

## Product
1. Reproduce first (RED): an engine-suite case where the injected implementation dispatcher returns
   `status: 'acceptance_failed'` with a hand commit present (copy an existing managed-loop case that injects the
   dispatcher) — at base the run result is `blocked / campaign_terminal_journal / MUTATION_FAILURE_EVIDENCE_REQUIRED`.
2. Fix so the terminal journal ACCEPTS the controller's own digest-bound `MUTATION_FAILED`: reducer and appender must
   agree on exactly what the output digest covers (bind the reference the same way on both sides; do not weaken the
   evidence rule — the digest must still be the failure receipt's digest and `possibly_effectful: true`). After the
   fix the run result is a terminal receipt (`status` names the acceptance failure, `phase` is the terminal journal
   phase the rail already uses for a journaled stop), the journal's last event is `MUTATION_FAILED` with
   `live_lease: null`, the summary JSON on stdout is complete (never 0 bytes), and `node bin/autopilot.js campaign
   inspect --campaign-id <id>` shows the terminal phase.
3. Wall expiry (second row) — ONLY if it is the same code path: when `WALL_BUDGET_EXCEEDED` fires inside the loop, the
   run must still terminalize through the same journal path and write the summary JSON. If it is a different path,
   leave it and name it under "Not done" in the report.
4. Keep every other reducer rule byte-identical (BOUNDARY_REJECTED, TERMINAL_STOP, the durable waits). Codex mirrors
   of every touched `src/engine/*.js` via `bash scripts/sync-codex-plugin-skills.sh` (same commit).

## Tests (RED-first: run each new case against the unmodified code, record the exact observed output in a
`# RED at <base sha>: …` comment beside the assertion; never weaken an existing assertion)
- `hooks/tests/autopilot-engine.test.sh`: the acceptance_failed case of item 1 (RED at base: the blocked result above;
  GREEN: terminal receipt + `MUTATION_FAILED` journaled + `live_lease === null`).
- `hooks/tests/implementation-campaign-state.test.sh` (reducer): a `MUTATION_FAILED` event whose artifact reference
  carries `repair_lineage` is ACCEPTED when its digest is the controller's own binding, and one with a wrong digest is
  still refused `MUTATION_FAILURE_EVIDENCE_REQUIRED` (the evidence rule is not weakened — pin both).

## Verify (foreground, all exit 0)
```
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/implementation-campaign-routing.test.sh
bash hooks/tests/implementation-campaign-receipt.test.sh
bash hooks/tests/campaign-terminalize.test.sh
bash hooks/tests/mission-runtime-v2.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
```

## Allowed files
`src/engine/autopilot-engine.js`, `src/engine/implementation-campaign.js`, `src/engine/campaign-intake.js` (+ their codex
twins via the sync script), `hooks/tests/autopilot-engine.test.sh`, `hooks/tests/implementation-campaign-state.test.sh`.
Nothing else; nothing created. Do not touch schemas, `bin/autopilot.js`, or `campaign-composition.js`.

## How you work (foreman rules — identical for every run)
- You ORCHESTRATE. You never edit code yourself, never merge, never push, never checkout. All product work is done by
  ONE hand you dispatch; you verify by git artifacts (`git -C <wt> diff --stat`, the hand's result JSON), never by its
  self-report. Depth 0 (the dispatcher) reaches the verdict from git after you finish.
- Hand dispatch (exact form; <unit> is the unit name given at the top of this brief — globally unique, the dispatch
  run manifests live in one shared directory; keep every other flag):
  `<rail>/dispatch-hetero.sh --branch hands/<run_id>/<unit> --base <base_sha> --ledger <run_dir>/hands.ledger --run-id <unit> --stage implement --runner cursor --model cursor-grok-4.6-low --effort low --timeout 40m --prompt-file <run_dir>/hand-<unit>.md`
  Write `<run_dir>/hand-<unit>.md` first: paste the "Product", "Tests", "Verify" and "Allowed files" sections below
  VERBATIM plus: "Commit ONE commit on the branch you are on; do not touch other files; do not run sync scripts on
  the codex mirror by hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the mirror in
  the same commit; run every verify command in the foreground before committing."
  Then wait: `node <rail>/wait-dispatch-results.js --ledger <run_dir>/hands.ledger --expect <unit>.implement`
  (never a shell sleep loop).
- Review (decorrelated family, required before you report done): produce the diff with
  `git -C <your worktree> diff <base_sha>..hands/<run_id>/<unit> > <run_dir>/<unit>.diff` and run
  `<rail>/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file <run_dir>/<unit>.diff --spec-file <run_dir>/hand-<unit>.md > <run_dir>/<unit>.review.json`.
  If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings you judge real, dispatch ONE repair hand on branch
  `hands/<run_id>/<unit>-r2` with `--base <head of hands/<run_id>/<unit>>` and a prompt listing the findings verbatim;
  re-review the delta. At most one repair round; then report.
- Budget: 40 Bash calls. Plan them: write prompt (1), dispatch (1), wait (1), diff/stat (2), review (1), read verdict
  (1), optional repair (4), report (1). Do NOT read large files into your context; use `head`/`grep -n`.
- REPORT.md must name: hand branch(es) and head sha(s), `diff --stat` vs base, the review verdict and the findings you
  accepted/refuted with one line why, the verify commands' tails, and anything NOT done.
