# Implementation brief — blind-review-cleanroom-intake-2026-09-17 (cut 1b-B)

ONE managed deliverable. The harness commits; never push, never `git stash`, never touch files
outside the sealed `output_paths`, never run a real reviewer model. Engine/intake suites inject the
probe adapter (stubs); the REAL launcher preflight runs only in the host-gated isolation suite.
Base for RED evidence and byte-identity: `<BASE>`.

## Read first
1. `docs/plans/2026-09-17-blind-review-cleanroom-intake.md` — §1 items 1–6 NORMATIVE; §2.5, §2.6,
   §4, §4.1. The plan wins over this brief.
2. The `.rubric.md` (R1–R8); `docs/plans/2026-09-17-blind-review-cleanroom-launcher.md` §1.3 (launcher
   preflight contract) and `scripts/lib/cleanroom-launch.sh` header.
3. `src/engine/final-panel-qualification.js` (whole file); `src/engine/campaign-intake.js`
   `runCampaignIntake` blind block ~`:1416-1447`, `defaultReadiness`/`defaultContextGate` ~`:208-260`
   (adapter + `step()` shape), readiness gate ~`:1825`; `scripts/resolve-review-loop.sh:2113-2133`;
   `scripts/dispatch-review.sh` `review_seat_tier` (~`:303`).
4. Tests: `implementation-campaign-routing.test.sh` ~`:3200-3330` (blind-incompat fixture),
   `implementation-campaign-state.test.sh` (grep `blind`), `resolve-review-loop-qc-panel-rejection.test.sh`
   (the eight ⚠ asserts), `dispatch-review.test.sh` parity block ~`:1091-1125`,
   `cleanroom-launch.test.sh` (host-gated idiom).

## Product (plan §1 normative)
1. `final-panel-qualification.js`: `REVIEW_SEAT_TIERS`, `reviewSeatTier()`, deprecated aliases kept
   and equal to the packet tier.
2. `campaign-intake.js`: blind block → tier switch; `none` → existing code, new message tail;
   `cleanroom` → `adapters.cleanroomProbe || defaultCleanroomProbe` once per distinct runner;
   `rejected` → `final_panel_seat_cleanroom_unavailable` (launcher stderr line + exit in reason)
   before qualification/claim/spend; `ready` → `step('cleanroom_probe', …)` with runner/exit/launcher
   JSON; `unknown` admits only in shadow. `defaultCleanroomProbe`: `timeout 60 cleanroom-launch.sh
   --preflight --deny-path <repo> --deny-path <git common dir> --deny-path <HOME> --deny-path
   <contract dir>`, cwd repo, env `PATH`+`HOME` only.
3. `resolve-review-loop.sh:2113-2133`: `review_seat_tier` copy; `none` ⚠ keeps refusal text (new
   tail); `cleanroom` → advisory line into `capability_warnings[]`; no probe.
4. Mirrors: `sync-codex-plugin-skills.sh` then `--check`.

## Tests (§2 normative; RED blocks `# RED at base <BASE>: <observed message>`)
Routing: grok seat → blind_incompatible (preservation); codex + probe `rejected` →
`cleanroom_unavailable`, impl/review calls 0; codex + probe `ready` + qualified → admitted with
`cleanroom_probe` step; two codex seats → probe called once. State: re-target two pins, one step
shape. qc-panel-rejection: refusal ⚠ for `none`, advisory for codex. dispatch-review parity: JS
`reviewSeatTier` == shell for every contract runner; resolver mirror agrees. cleanroom-launch
(host-gated): real `defaultCleanroomProbe` `ready` here, `rejected` with `AUTOPILOT_CLEANROOM_BWRAP=/nonexistent`.
Run each suite at base BEFORE edits; quote messages; never weaken an assertion.

## Docs
- `references/blind-dispatch.md` "Cleanroom tier": add "Intake probe (v2.36.63)" + the credential
  recovery sentence. Mirror.
- `skills/l5/references/hetero-impl-loop.md` step 6b: name both tiers and the intake probe. Mirror.
- `docs/BACKLOG.md` redesign row Context EXACTLY: `packet (tree + git diff + spec, deny-list);
  packet/cleanroom tiers; intake canary; verify-once; parallel seats. 1a-A (v2.36.59), 1a-B (v2.36.61),
  1b-A launcher (v2.36.62), 1b-B intake probe (v2.36.63) shipped; deny-list config, 2 open. Detail in
  the pointer.` (Status `open`). Do NOT touch pins, `.claude/*`, `CHANGELOG.md`, version manifests.

## Verify (§4.1; one at a time, foreground, all exit 0)
```
bash hooks/tests/implementation-campaign-routing.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/resolve-review-loop-qc-panel-rejection.test.sh
bash hooks/tests/dispatch-review.test.sh
AUTOPILOT_HOST_ISOLATION=1 bash hooks/tests/cleanroom-launch.test.sh
bash hooks/tests/qc-panel-honesty.test.sh
bash hooks/tests/implementation-campaign-dogfood.test.sh
bash hooks/tests/resolve-review-loop.test.sh
node scripts/check-js-syntax.js
node scripts/check-contract-schema.js
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
git diff --stat <BASE> -- src/engine/autopilot-engine.js src/runners scripts/dispatch-review.sh scripts/lib schemas bin  # empty
```

## Sealed output_paths (ONLY files you may change)
```
src/engine/final-panel-qualification.js
platforms/codex/plugin/src/engine/final-panel-qualification.js
src/engine/campaign-intake.js
platforms/codex/plugin/src/engine/campaign-intake.js
scripts/resolve-review-loop.sh
platforms/codex/plugin/scripts/resolve-review-loop.sh
hooks/tests/implementation-campaign-routing.test.sh
hooks/tests/implementation-campaign-state.test.sh
hooks/tests/resolve-review-loop-qc-panel-rejection.test.sh
hooks/tests/dispatch-review.test.sh
hooks/tests/cleanroom-launch.test.sh
references/blind-dispatch.md
platforms/codex/plugin/references/blind-dispatch.md
skills/l5/references/hetero-impl-loop.md
platforms/codex/plugin/skills/l5/references/hetero-impl-loop.md
docs/BACKLOG.md
```
Finish with a clean tree; report RED-at-base messages and suite counts.
