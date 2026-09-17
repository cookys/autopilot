# Blind review redesign — cut 1b-B: intake probes the cleanroom boundary, the JS/resolver learn seat tiers, codex returns to the panel

> Status: draft for plan hetero loop · Size: L · Base: `d7912c7e` (v2.36.62 shipped, 1b-A merge `94d44940`) · Parent:
> `docs/plans/2026-09-16-blind-review-packet.md` §7 item 3; sibling `docs/plans/2026-09-17-blind-review-cleanroom-launcher.md`
> (1b-A: launcher + `dispatch-review.sh` tiers, shipped). Evidence dir:
> `docs/plans/evidence/2026-09-17-blind-review-cleanroom-intake/`.

## 0. What is actually true today (verified 2026-09-17 at base `d7912c7e`)

- `scripts/dispatch-review.sh` now resolves seat tiers (`review_seat_tier`: `packet` =
  `anthropic-compatible cc-shim claude-native qoderclicn`, `cleanroom` = `codex`, `none` = rest) and,
  under `AUTOPILOT_BLIND_DISCOVERY=1`, runs a cleanroom seat through
  `scripts/lib/cleanroom-launch.sh` after four fail-closed preconditions, one of which is the
  launcher's own `--preflight --deny-path <packet dir>` (1b-A §1.2). The launcher's preflight mode
  needs no packet, prompt, credential or binary: `--preflight --deny-path <p>… [--bwrap] [--seat-root]`,
  exit 0 green / 2 runtime missing or cannot start / 3 a deny path readable or a host path in the
  sandbox argv, one JSON line `{ artifact_type: "cleanroom_launch", profile: "preflight", … }`.
- The JS side still has the OLD allow-list: `src/engine/final-panel-qualification.js`
  `BLIND_DISCOVERY_CAPABLE_RUNNERS = [anthropic-compatible, cc-shim, claude-native, qoderclicn]`;
  `src/engine/campaign-intake.js` `runCampaignIntake` (~`:1416-1447`) refuses any qc seat outside it
  BEFORE the qualification check with `final_panel_seat_blind_incompatible` and the message
  `… cannot execute a managed blind-discovery review (runner is not in the enforceable no-tools set
  …); replace it with a blind-capable seat or complete the codex containment qualification — pins
  and overrides do not bypass containment`; `scripts/resolve-review-loop.sh:2113-2132` mirrors the
  set as a `--check-scorecard` ⚠ (`capability_warnings[]`); the parity test in
  `hooks/tests/dispatch-review.test.sh` (~`:1097-1143`) proves the shell rail and the JS set agree.
  Tests pinning the code/message: `implementation-campaign-routing.test.sh` (fixture at ~`:3302`
  uses a `codex` qc seat as the incompatible one), `implementation-campaign-state.test.sh` (2 hits),
  `resolve-review-loop-qc-panel-rejection.test.sh` (8 hits on the ⚠ text).
- So today a codex seat is refused at intake even though the runner rail can now contain it. The
  operator pin for `qc_panel[0]` is `claude-fable-5-1/claude-native` (temporary packet-tier seat);
  the intended seat is `gpt-5.6-sol/codex max`. codex quota returns 2026-09-19 16:26.
- Intake adapters follow one shape: `adapters.<name> || default<Name>`, each returning a decision
  (`ready|unknown|rejected`) that becomes a `step` in the intake receipt (`readiness` at ~`:1825`,
  `contextGate`, `occupancy`). Intake has `repo` and `contractPath` in scope when it runs the gates.

## 1. Ruling and shape

1. **One tier table, in JS, mirrored by shell parity.** `src/engine/final-panel-qualification.js`
   replaces `BLIND_DISCOVERY_CAPABLE_RUNNERS` / `isBlindDiscoveryCapableRunner` with
   `REVIEW_SEAT_TIERS = Object.freeze({ packet: [...four], cleanroom: ['codex'] })`,
   `reviewSeatTier(runner)` → `'packet'|'cleanroom'|'none'`, and keeps the old two exports as
   deprecated aliases (`BLIND_DISCOVERY_CAPABLE_RUNNERS` = the packet tier, `isBlindDiscoveryCapableRunner`
   = tier !== 'none') so nothing outside this cut breaks; the shell `review_seat_tier` in
   `dispatch-review.sh` and the resolver's mirror are proven equal to it by the parity test (§2).
2. **Intake: `none` refuses as today; `cleanroom` is probed, not trusted.** In `runCampaignIntake`,
   for each qc seat: tier `none` → the existing `final_panel_seat_blind_incompatible` rejection with
   the message's tail changed from "complete the codex containment qualification" to "or use a
   cleanroom-tier runner"; tier `cleanroom` → a new adapter `adapters.cleanroomProbe ||
   defaultCleanroomProbe` is called ONCE per distinct cleanroom runner (not per seat) with
   `{ runner, repo, contractPath, roster }` and must return a decision: `ready` (probe green),
   `rejected` (probe exit 2/3 or launcher missing), `unknown` only when `adapters.cleanroomProbe` is
   absent AND the intake is not enforced (shadow), mirroring `defaultReadiness`. `rejected` →
   `final_panel_seat_cleanroom_unavailable` with the launcher's first stderr line and exit code in
   the reason; the seat is refused BEFORE the qualification check, before any claim or spend, and the
   probe result is a `step('cleanroom_probe', …)` in the intake receipt carrying `runner`,
   `exit_status`, `launcher_json` (the launcher's one line, parsed) — a step, not a receipt or
   attestation (ADR-0001). `defaultCleanroomProbe` shells out to
   `scripts/lib/cleanroom-launch.sh --preflight --deny-path <repo> --deny-path <git common dir>
   --deny-path <operator HOME> --deny-path <contractPath's directory>` with a 60 s `timeout`, cwd =
   repo, env scrubbed to `PATH`/`HOME`; it is the only place intake spawns a process for a review seat.
   `packet` seats are untouched. Order: tier/probe → qualification (`finalPanelSeatQualified`) → the
   rest, exactly where the blind block sits today.
3. **Resolver: the ⚠ becomes a tier lookup.** `resolve-review-loop.sh:2113-2132`: the literal
   four-runner `case` becomes `review_seat_tier` (a copy of the same function, parity-tested);
   `none` keeps the existing ⚠ text minus the codex-qualification tail; `cleanroom` emits a NEW
   advisory line `qc_panel[i] seat (<model>/<runner>) is a cleanroom-tier seat — intake probes the
   isolation boundary before any spend (bwrap required on this host)` into `capability_warnings[]`
   (advisory, not a refusal; the resolver runs no probe — "the resolver reports, intake decides",
   both consults).
4. **Engine: nothing.** `performFinalPanel` already dispatches whatever intake admitted; the runner
   rail decides tier at launch. No `autopilot-engine.js` change.
5. **Codex back on the panel — an operator step, recorded, after quota returns.** This cut ships the
   mechanism; the pin swap (`engine-capability-state.js pin-seat --role qc_panel --engine gpt-5.6-sol
   --runner codex --effort max …` + `.claude/review-loop-config.md` `qc_panel[0]`) is done by depth-0
   at closeout ONLY if a live `cleanroom-launch.sh --profile codex` run against a real packet has
   returned a parsed verdict on this host (§5); otherwise the pin stays and the swap is a BACKLOG row
   with the probe evidence as its pointer. Pins never override a failed probe (ruling from both
   consults: "pins establish selection, they cannot override failed isolation").
6. **Token-refresh decisions from 1b-A §3.** The launcher copies `auth.json` into a throwaway HOME;
   this cut adds to `defaultCleanroomProbe` nothing about credentials (preflight needs none), but the
   plan RULES: a near-expiry `auth.json` is NOT a preflight refusal in this cut (no reliable field
   contract across codex versions); the recovery path is documented in `references/blind-dispatch.md`
   ("if a seat refresh invalidates the host credential: `codex login` on the host; the seat HOME is
   gone by construction"). Revisit when a provider is observed rotating on refresh.

## 2. Changes by file

- `src/engine/final-panel-qualification.js` (+ mirror): §1.1.
- `src/engine/campaign-intake.js` (+ mirror): §1.2 — the blind block becomes the tier switch + probe;
  `defaultCleanroomProbe`; new rejection code; `step('cleanroom_probe')`.
- `scripts/resolve-review-loop.sh` (+ mirror): §1.3.
- `schemas/…`: NONE expected — verify that the intake receipt `steps[]` schema (if closed) admits a
  `cleanroom_probe` step name; if it enumerates step owners, add it (+ mirror). (Re-verify at base.)
- Tests (RED-first, `# RED at base d7912c7e: <observed>`; stubs only — the probe adapter is
  injected in every engine/intake suite, the REAL launcher runs only in the host-gated suite):
  - `hooks/tests/implementation-campaign-routing.test.sh`: the fixture at ~`:3302` (codex seat →
    `final_panel_seat_blind_incompatible`) becomes TWO cases: `grok` seat → still
    `final_panel_seat_blind_incompatible` (preservation of the code, new message tail); `codex` seat
    with an injected `cleanroomProbe` returning `rejected` (exit 2, `bwrap not found`) →
    `final_panel_seat_cleanroom_unavailable`, `implCalls === 0`, `reviewCalls === 0`, reason carries
    the stderr line (RED at base: blind_incompatible); `codex` seat with the probe returning `ready`
    and a qualified tuple → intake admits and the receipt has a `cleanroom_probe` step with
    `runner: 'codex'` (RED at base: refused); two codex seats → the probe adapter is called ONCE.
  - `hooks/tests/implementation-campaign-state.test.sh`: its two blind pins re-targeted to a
    `none`-tier runner (preservation) + one `cleanroom_probe` step-shape assertion.
  - `hooks/tests/resolve-review-loop-qc-panel-rejection.test.sh`: the eight ⚠ assertions keep the
    `none` case (with the new tail) and gain the cleanroom advisory line for a codex seat (RED at
    base: codex produced the refusal ⚠).
  - `hooks/tests/dispatch-review.test.sh` parity block (~`:1097-1143`): extended to assert the JS
    `reviewSeatTier` equals the shell `review_seat_tier` for every runner in the contract's runner
    enum (both `packet` and `cleanroom` members reach the right rail; `none` refused), and that the
    resolver's mirror agrees (`--check-scorecard` on a fixture config with one seat per tier).
  - `hooks/tests/cleanroom-launch.test.sh` (host-gated, from 1b-A): one added case — the REAL
    `defaultCleanroomProbe` (exported for the test) returns `ready` on this host and `rejected` with
    `AUTOPILOT_CLEANROOM_BWRAP=/nonexistent`; plus the 1b-A second-review carry-in: suite (a) asserts
    `HOME=DENIED` in the stub's output (the probe already reads the operator HOME; only the assertion
    is missing).
- Docs: `references/blind-dispatch.md` (+ mirror) "Cleanroom tier" section gains "Intake probe
  (v2.36.63)" + the credential recovery sentence; `skills/l5/references/hetero-impl-loop.md` (+ mirror)
  step 6b: the ⚠ sentence now names both tiers and the intake probe; `docs/BACKLOG.md` redesign row
  Context → `… 1b-A launcher (v2.36.62), 1b-B intake probe (v2.36.63) shipped; deny-list config, 2
  open. Detail in the pointer.`

### 2.5 Sealed `output_paths` (exact; re-check mirrors at base)

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

Nothing created. `max_changed_files` sealed at 18 (> 16) — defect (3).

### 2.6 Global constraints (verbatim into the dispatch)

- Intake decides, the resolver reports, the engine dispatches: no probe in the resolver, no tier
  logic in `autopilot-engine.js`, no new receipt/attestation type — the probe is a `step`.
- A cleanroom seat is admitted only on a probe decision `ready` from the injected or default
  adapter; `unknown` admits only in shadow mode; a pin or override never bypasses `rejected`.
- The probe spawns exactly one process per distinct cleanroom runner per intake, with a 60 s cap,
  and never a model.
- `dispatch-review.sh`, `cleanroom-launch.sh`, `review.js`, `review-packet.js`, `bin/autopilot.js`,
  schemas (unless §2 says otherwise after re-verification) byte-identical to base.
- Deprecated JS aliases stay exported this cut; nothing else in the repo calls them after the change
  (grep in scope-integrity).

## 3. Out of scope

- Configurable deny-list (own cut). Cut 2 (verify-once, concurrent seats, standby, panel snapshot).
- `dispatch-review.sh` hygiene from the 1b-A second review (`_pf_err` never unlinked; the legacy non-zero
  block unreachable on the blind path) — BACKLOG row; this cut keeps the runner rail byte-identical.
- Other cleanroom profiles. Proxy/CA pass-through (1b-A follow-up). Near-expiry credential refusal.
- The pin swap itself when no live verdict exists yet (§1.5 makes it conditional).

## 4. Acceptance

| id | criterion | evidence |
|----|-----------|----------|
| `tier-table` | one JS tier table; deprecated aliases equal to it; shell `review_seat_tier` and the resolver mirror agree for every runner in the contract enum | dispatch-review parity block |
| `intake-probe` | `none` seat → `final_panel_seat_blind_incompatible` (new tail); cleanroom seat → probe called once per runner; `rejected` → `final_panel_seat_cleanroom_unavailable` before any claim/spend with the launcher's stderr line; `ready` → admitted with a `cleanroom_probe` step; `unknown` admits only in shadow | routing + state suites |
| `resolver-advisory` | codex qc seat yields the cleanroom advisory line, not a refusal ⚠; `none` seats keep the refusal ⚠ | qc-panel-rejection suite |
| `host-probe` | `defaultCleanroomProbe` is `ready` on this host and `rejected` with a missing bwrap | cleanroom-launch suite (host-gated) |
| `no-regression` | §4.1 all exit 0 at the candidate; base set recorded | evidence |
| `scope-integrity` | diff ⊆ §2.5 + plan/mission docs; engine, runner rail, launcher, schemas byte-identical; no caller of the deprecated aliases outside the module | command output |

### 4.1 No-regression commands (to confirm green at base before sealing; detached checkout)

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
```

(`check-contract-schema.js` is `node`, fix before sealing; `resolve-review-loop.test.sh` must be
checked for base colour — memory says a resolver-contract change drifts the whole suite.)

## 5. Dogfood proof (depth-0)

On this host after merge: `resolve-review-loop.sh --check-scorecard` with a codex qc seat in a
scratch config shows the advisory, not the refusal; a scratch campaign intake (routing-suite style
fixture, real `defaultCleanroomProbe`) admits a codex seat and writes the `cleanroom_probe` step.
After 2026-09-19 16:26: `cleanroom-launch.sh --profile codex` against a real packet returns a
parsed verdict → then and only then the pin swap (§1.5) and the first live cleanroom panel seat.

## 6. Risks + inversion

- **Probe cost at intake.** ~1 s per cleanroom runner, once; bounded by a 60 s cap → `rejected`.
- **Shadow-mode `unknown`.** Same semantics as `defaultReadiness`; enforced intake never admits on
  `unknown`.
- **Suite drift.** Three suites pin the old message/code; the code stays, only the tail changes; the
  routing fixture moves its "incompatible" example to `grok`. `resolve-review-loop.test.sh` is run at
  base and at head because the resolver is touched.
- **Codex quota.** The mechanism ships without the live verdict; §1.5 keeps the pin swap honest.

## 7. Where this sits

1a-A ✓ → 1a-B ✓ → 1b-A ✓ → **1b-B (this)** → deny-list config → 2.

## Review log

- (plan loop pending; consult seat still codex-bound — expect `rail-failed` unless the operator pins a GLM consult seat)
