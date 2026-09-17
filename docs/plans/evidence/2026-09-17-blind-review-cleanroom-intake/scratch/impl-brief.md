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
   (adapter + `step()` shape), readiness gate ~`:1825`; `scripts/resolve-review-loop.sh:2113-2132`;
   `scripts/dispatch-review.sh` `review_seat_tier` (~`:303`).
4. Tests: `implementation-campaign-routing.test.sh` ~`:3200-3330` (blind-incompat fixture),
   `implementation-campaign-state.test.sh` (grep `blind`), `resolve-review-loop-qc-panel-rejection.test.sh`
   (the eight ⚠ asserts), `dispatch-review.test.sh` parity block ~`:1097-1143`,
   `cleanroom-launch.test.sh` (host-gated idiom).

## Product (plan §1 normative)
1. `final-panel-qualification.js`: `REVIEW_SEAT_TIERS`, `reviewSeatTier()`, deprecated aliases kept
   and equal to the packet tier.
2. `campaign-intake.js`: blind block → tier switch; `none` → existing code, new message tail
   ("… or use a cleanroom-tier runner"); `cleanroom` → `adapters.cleanroomProbe || defaultCleanroomProbe`
   once per distinct runner. Decision set is CLOSED: `ready | rejected | unknown`; `unknown` means ONLY
   "adapter absent" = no injected adapter AND no launcher on disk to spawn (spawnSync ENOENT, status
   null) → `step('cleanroom_probe','unknown',{ enforcement:'shadow', reason:'launcher not present at
   <path>' })`, admitted in shadow; right after `missionMode` is computed (~`:1481-1483`), an ENFORCED
   intake with an unknown cleanroom_probe step is refused `final_panel_seat_cleanroom_unavailable`
   ("enforced intake requires a probe decision; launcher not present at <path>"). Any other value →
   `cleanroom_probe_adapter_invalid` via `requireDecision`. `rejected` →
   `final_panel_seat_cleanroom_unavailable` with the reason verbatim, before qualification/claim/spend;
   `ready` → `step('cleanroom_probe','ready',{ runner, exit_status, launcher, deny_paths, launcher_json })`
   (`launcher` = resolved absolute path that answered).
   `defaultCleanroomProbe(input, { launcher, timeoutMs, bwrap })` (export it): `spawnSync(launcher,
   ['--preflight', '--deny-path', …, ['--bwrap', bwrap]], { cwd: repo, env: { PATH, HOME }, timeout:
   timeoutMs, killSignal: 'SIGKILL' })` — ONE process, no coreutils `timeout`. Deny list = resolved
   `repo`, `git -C repo rev-parse --git-common-dir` (omit if git fails), `process.env.HOME` (omit if
   unset/empty), `dirname(contractPath)`; drop duplicates and any `/`. `launcher` default
   `<module dir>/../../scripts/lib/cleanroom-launch.sh` (env `AUTOPILOT_CLEANROOM_LAUNCHER` overrides),
   `timeoutMs` 60000, `bwrap` env `AUTOPILOT_CLEANROOM_BWRAP`. Outcome → decision, exhaustive:
   exit 0 + one parseable JSON line → `ready`; exit 0 without → `rejected` "launcher emitted no launch
   line"; `ETIMEDOUT` → `rejected` "probe timed out after <n> s, no diagnostic"; non-zero exit →
   `rejected` "exit <n>: <first stderr line>" | "exit <n>: no diagnostic"; ENOENT on the launcher →
   `unknown` (above); other spawn error → `rejected` "spawn error <code>". `launcher_json` null when absent.
3. `resolve-review-loop.sh:2113-2132`: `review_seat_tier` copy; `none` ⚠ keeps refusal text (new
   tail); `cleanroom` → advisory line into `capability_warnings[]`; no probe.
4. Mirrors: `sync-codex-plugin-skills.sh` then `--check`.

## Tests (§2 normative; RED blocks `# RED at base <BASE>: <observed message>`)
Routing: grok seat → blind_incompatible (preservation); codex + probe `rejected` →
`cleanroom_unavailable`, impl/review calls 0; codex + probe `ready` + qualified → admitted with
`cleanroom_probe` step; two codex seats → probe called once; adapter returning `unknown` →
`cleanroom_probe_adapter_invalid`; REAL `defaultCleanroomProbe` with stub launchers (no bwrap): exit-0
stub printing a JSON line → `ready` + parsed `launcher_json`; exit-2 stub with one stderr line →
`rejected` "exit 2: <line>"; sleeping stub with `timeoutMs: 500` → `rejected` naming the timeout; `launcher` = nonexistent path → `unknown` step,
admitted in shadow, refused under `enforce`; no-git + no-HOME fixture → well-formed argv, `deny_paths`
recorded without `/`. State: re-target two pins, one step
shape. qc-panel-rejection: refusal ⚠ for `none`, advisory for codex. dispatch-review parity: JS
`reviewSeatTier` == shell for every runner in `schemas/review-loop-contract.schema.json`
`properties.reviewer_runner.enum` minus `auto`, READ FROM THE SCHEMA at test time (no hard-coded
list); resolver mirror agrees for EVERY enum member (fixture config with each runner as a qc seat in
turn: advisory for cleanroom, refusal ⚠ for none, neither for packet). cleanroom-launch
(host-gated): real `defaultCleanroomProbe` `ready` here, `rejected` with `AUTOPILOT_CLEANROOM_BWRAP=/nonexistent`;
plus assert `HOME=DENIED` in suite (a)'s stub output (the probe line exists, the assertion is missing).
Run each suite at base BEFORE edits; quote messages; never weaken an assertion.

## Docs
- `references/blind-dispatch.md` "Cleanroom tier": add "Intake probe (v2.36.63)" + the credential
  recovery sentence. Mirror.
- `skills/l5/references/hetero-impl-loop.md` step 6b: name both tiers and the intake probe. Mirror.
- `docs/BACKLOG.md` redesign row Context EXACTLY: `packet (tree + git diff + spec, deny-list);
  packet/cleanroom tiers; intake canary; verify-once; parallel seats. Shipped: 1a-A v2.36.59, 1a-B
  v2.36.61, 1b-A v2.36.62, 1b-B v2.36.63. Open: deny-list config, cut 2. Detail in the pointer.`
  (234 bytes; Status stays the literal `open`). Do NOT touch pins, `.claude/*`, `CHANGELOG.md`, version manifests.

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
