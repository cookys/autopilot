# Hand task — unit `terminal-d`: acceptance_failed must reach a durable terminal disposition

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

Depth-0 hypothesis (verify, do not assume): `campaign-intake.js` ~:560 derives `output_artifact_digest =
canonicalDigest(artifactReference)` and `normalizeCampaignArtifactReference` (`implementation-campaign.js` ~:265-295)
KEEPS `repair_lineage` on a `campaign_terminal` reference, so whenever the controller attaches a repair lineage the
digest covers `{kind, digest, repair_lineage}` while the reducer recomputes `{kind, digest}` — a guaranteed mismatch.
If the RED reproduction shows a different cause, fix the real one and say so in your notes.

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

## Hand rules
Commit ONE commit on the branch you are on; do not touch other files; do not run sync scripts on
the codex mirror by hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the mirror in
the same commit; run every verify command in the foreground before committing.
Base sha: dec4a01b423e9749a1f9a84a4a4f8c316f2e56b6
