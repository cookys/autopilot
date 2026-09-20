# Blind review redesign — cut 1b-B: intake probes the cleanroom boundary, the JS/resolver learn seat tiers, codex returns to the panel

> Status: SHIPPED v2.36.63 (merge `bc4ea99e`, 2026-09-17) · Size: L · Base: `d7912c7e` (v2.36.62 shipped, 1b-A merge `94d44940`) · Parent:
> `docs/plans/_archive/2026-09-16-blind-review-packet.md` §7 item 3; sibling `docs/plans/2026-09-17-blind-review-cleanroom-launcher.md`
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
   `{ runner, repo, contractPath, roster }` and must return a decision in the closed set
   `ready | rejected | unknown`, where `unknown` has exactly one meaning — **the probe adapter is
   absent**: no `adapters.cleanroomProbe` was injected AND the default probe found no launcher to
   spawn (the resolved launcher path does not exist or is not executable; `spawnSync` reports
   `ENOENT`/`EACCES` with `status: null`, so no process ran and no launcher diagnostic can exist).
   Any other decision value is refused as `cleanroom_probe_adapter_invalid` through the same
   `requireDecision` rail the readiness adapter uses (`:1825-1836`). `unknown` is recorded as
   `step('cleanroom_probe', 'unknown', { enforcement: 'shadow', reason: 'launcher not present at
   <path>' })` — the same shape `defaultReadiness`/`defaultOccupancy` use — and admits only under
   shadow enforcement: enforcement mode is not known where the blind block runs (`missionMode` is
   computed at `campaign-intake.js:1481-1483`), so immediately after that line an enforced intake
   with any `unknown` `cleanroom_probe` step is refused with `final_panel_seat_cleanroom_unavailable`
   (`enforced intake requires a probe decision; launcher not present at <path>`), before any claim
   or spend, mirroring how enforced intake refuses unknown readiness (`:1300-1326`). Launcher
   outcome → decision, exhaustively (the probe spawns the launcher directly with `spawnSync(launcher,
   args, { timeout: timeoutMs, killSignal: 'SIGKILL' })` — one process, no coreutils `timeout`;
   the launcher's `bwrap --die-with-parent` (`cleanroom-launch.sh:198`) takes the namespace down with
   it): exit 0 with one parseable JSON line on stdout → `ready`; exit 0 without such a line →
   `rejected` (`launcher emitted no launch line`); `ETIMEDOUT` (`status: null`) → `rejected` (`probe
   timed out after <n> s, no diagnostic`); any non-zero exit (2, 3, 124, 137, …) → `rejected` (`exit
   <n>: <first stderr line>` or `exit <n>: no diagnostic` when stderr is empty); a spawn error other
   than the absent-launcher case (e.g. `EACCES` on an existing file) → `rejected` (`spawn error
   <code>`). `rejected` → `final_panel_seat_cleanroom_unavailable`
   carrying that reason verbatim; the seat is refused BEFORE the qualification check, before any
   claim or spend, and the probe result is a `step('cleanroom_probe', …)` in the intake receipt
   carrying `runner`, `exit_status`, `launcher` (the resolved absolute path that answered, so an
   env override is visible in the receipt), `deny_paths` (as passed), `launcher_json` (the launcher's
   one line, parsed; `null` when absent) — a step, not a receipt or attestation (ADR-0001).
   `defaultCleanroomProbe({ runner, repo, contractPath, roster }, { launcher, timeoutMs, bwrap })`
   runs `<launcher> --preflight --deny-path … [--bwrap <bwrap>]`, cwd = repo, child env = `PATH` +
   the operator `HOME` only. The deny list is built from `path.resolve`d candidates — `repo`,
   `git -C <repo> rev-parse --git-common-dir` (omitted when git fails, e.g. a non-git fixture),
   `process.env.HOME` (omitted when unset or empty), `path.dirname(contractPath)` — dropping
   duplicates and any entry equal to `/` (which would deny everything and pin exit 3), so the argv
   is well-formed for every fixture and the step's `deny_paths` shows what was actually checked.
   `launcher` defaults to `<module dir>/../../scripts/lib/cleanroom-launch.sh` (the same relative
   shape in the codex mirror, where `platforms/codex/plugin/scripts/lib/cleanroom-launch.sh` exists
   at base); env `AUTOPILOT_CLEANROOM_LAUNCHER` overrides, the seam `dispatch-review.sh:333` honours;
   `timeoutMs` defaults to 60000, `bwrap` to env `AUTOPILOT_CLEANROOM_BWRAP`. The operator `HOME` is passed only as a deny path: the launcher sets
   the seat HOME to `/home/review` itself (`cleanroom-launch.sh:253-256`) and the deny check runs
   inside the namespace where the operator HOME is not mounted, which is why
   `--preflight --deny-path <repo> --deny-path <HOME>` already exits 0 on this host
   (`cleanroom-launch.test.sh:178-181`); the `host-probe` row is therefore satisfiable as written.
   It is the only place intake spawns a process for a review seat, exactly one process per
   distinct cleanroom runner. `packet` seats are untouched. Order: tier/probe → qualification
   (`finalPanelSeatQualified`) → the rest, exactly where the blind block sits today.
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
- `schemas/`: NONE. Verified at base `d7912c7e`: no schema under `schemas/` encloses the intake
  receipt `steps[]` owner names (no `enum` near `owner`/`steps` in any `schemas/*.json`), so a
  `cleanroom_probe` step needs no schema edit; `check-contract-schema.js` reconciles the shell
  resolver's field set and `x-shell-validated` enums against `review-loop-contract.schema.json`, and
  the advisory line lands in the existing `capability_warnings[]` field, so the resolver's field
  set is unchanged (R4) and the gate stays green. Schemas are byte-identical to base (§2.6).
- Tests (RED-first, `# RED at base d7912c7e: <observed>`; stubs only — the probe adapter is
  injected in every engine/intake suite, the REAL launcher runs only in the host-gated suite):
  - `hooks/tests/implementation-campaign-routing.test.sh`: the fixture at ~`:3302` (codex seat →
    `final_panel_seat_blind_incompatible`) becomes TWO cases: `grok` seat (in the contract's
    `reviewer_runner` enum, `schemas/review-loop-contract.schema.json`, and in neither tier at base)
    → still `final_panel_seat_blind_incompatible` (preservation of the code, new message tail); `codex` seat
    with an injected `cleanroomProbe` returning `rejected` (exit 2, `bwrap not found`) →
    `final_panel_seat_cleanroom_unavailable`, `implCalls === 0`, `reviewCalls === 0`, reason carries
    the stderr line (RED at base: blind_incompatible); `codex` seat with the probe returning `ready`
    and a qualified tuple → intake admits and the receipt has a `cleanroom_probe` step with
    `runner: 'codex'` (RED at base: refused); two codex seats → the probe adapter is called ONCE;
    plus the REAL `defaultCleanroomProbe` driven with a stub `launcher` (no bwrap, no host gate):
    a stub that prints one JSON line and exits 0 → `ready` with `launcher_json` parsed; a stub that
    writes one stderr line and exits 2 → `rejected`, reason `exit 2: <that line>`; a stub that sleeps
    with `timeoutMs: 500` → `rejected`, reason names the timeout; `launcher` pointing at a path that
    does not exist → `unknown` step (shadow) and the seat admitted in shadow mode, refused with
    `final_panel_seat_cleanroom_unavailable` under `enforce`; an adapter returning any other value →
    `cleanroom_probe_adapter_invalid`; a fixture without a git dir and with `HOME` unset still yields
    a well-formed argv (`deny_paths` recorded, no `/`).
  - `hooks/tests/implementation-campaign-state.test.sh`: its two blind pins re-targeted to a
    `none`-tier runner (preservation) + one `cleanroom_probe` step-shape assertion.
  - `hooks/tests/resolve-review-loop-qc-panel-rejection.test.sh`: the eight ⚠ assertions keep the
    `none` case (with the new tail) and gain the cleanroom advisory line for a codex seat (RED at
    base: codex produced the refusal ⚠).
  - `hooks/tests/dispatch-review.test.sh` parity block (~`:1097-1143`): extended to assert the JS
    `reviewSeatTier` equals the shell `review_seat_tier` for every runner in
    `schemas/review-loop-contract.schema.json` `properties.reviewer_runner.enum` minus `auto`, read
    from the schema at test time (never a hard-coded list; a runner added to the enum is covered
    automatically), with both `packet` and `cleanroom` members reaching the right rail and `none`
    refused, and that the resolver's mirror agrees for EVERY enum member (`--check-scorecard` on a
    fixture config that lists each enum runner as a qc seat in turn, asserting the advisory line for
    cleanroom members, the refusal ⚠ for `none` members, and neither for packet members).
  - `hooks/tests/cleanroom-launch.test.sh` (host-gated, from 1b-A): one added case — the REAL
    `defaultCleanroomProbe` (exported for the test) returns `ready` on this host and `rejected` with
    `AUTOPILOT_CLEANROOM_BWRAP=/nonexistent`; plus the 1b-A second-review carry-in: suite (a) asserts
    `HOME=DENIED` in the stub's output (the probe already reads the operator HOME; only the assertion
    is missing).
- Docs: `references/blind-dispatch.md` (+ mirror) "Cleanroom tier" section gains "Intake probe
  (v2.36.63)" + the credential recovery sentence; `skills/l5/references/hetero-impl-loop.md` (+ mirror)
  step 6b: the ⚠ sentence now names both tiers and the intake probe; `docs/BACKLOG.md` redesign row
  Context → EXACTLY `packet (tree + git diff + spec, deny-list); packet/cleanroom tiers; intake
  canary; verify-once; parallel seats. Shipped: 1a-A v2.36.59, 1a-B v2.36.61, 1b-A v2.36.62, 1b-B
  v2.36.63. Open: deny-list config, cut 2. Detail in the pointer.` (234 bytes, under the 240-byte
  Context cap) with the row's Status field staying the literal `open`; `v2.36.63` in text is a pin
  for the release commit, which is depth-0's, not the hand's — if the release lands under another
  number, depth-0 re-stamps the doc, mirror and row in the release commit (1b-A's `(v2.36.62)`
  followed the same convention).

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

Nothing created. `max_changed_files` sealed at 18, deliberately above the 16 sealed paths: the
rail's `changed_files >= max_changed_files` check refuses repair when the hand touched every sealed
path (BACKLOG row, hit on 1a-B); the headroom is the workaround until that row ships.

### 2.6 Global constraints (verbatim into the dispatch)

- Intake decides, the resolver reports, the engine dispatches: no probe in the resolver, no tier
  logic in `autopilot-engine.js`, no new receipt/attestation type — the probe is a `step`.
- A cleanroom seat is admitted only on a probe decision `ready` from the injected or default
  adapter, or on `unknown` (adapter absent = no launcher to spawn) under shadow enforcement only;
  anything else is `cleanroom_probe_adapter_invalid`; a pin or override never bypasses `rejected`.
- The probe spawns exactly one process per distinct cleanroom runner per intake (`spawnSync` with
  its own `timeout`, no wrapper), with a 60 s cap, and never a model.
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
| `intake-probe` | `none` seat → `final_panel_seat_blind_incompatible` (new tail); cleanroom seat → probe called once per runner; `rejected` → `final_panel_seat_cleanroom_unavailable` before any claim/spend with the launcher's stderr line; `ready` → admitted with a `cleanroom_probe` step; timeout / non-zero exits / missing launch line / spawn error each map to `rejected` with the stated reason; absent launcher → `unknown`, admitted in shadow, refused under enforce; any other adapter value is `cleanroom_probe_adapter_invalid` | routing + state suites |
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

Base record: `evidence/…-intake/base-suites-d7912c7e.txt` — all twelve exit 0 at base on a detached
checkout, sequential, the isolation suite under `AUTOPILOT_HOST_ISOLATION=1` (2026-09-17).
`resolve-review-loop.test.sh` is in the set because the resolver is touched; it must stay green at
the candidate with only the qc-panel warning cases changed.

## 5. Dogfood proof (depth-0)

On this host after merge: `resolve-review-loop.sh --check-scorecard` with a codex qc seat in a
scratch config shows the advisory, not the refusal; a scratch campaign intake (routing-suite style
fixture, real `defaultCleanroomProbe`) admits a codex seat and writes the `cleanroom_probe` step.
After 2026-09-19 16:26: `cleanroom-launch.sh --profile codex` against a real packet returns a
parsed verdict → then and only then the pin swap (§1.5) and the first live cleanroom panel seat.

## 6. Risks + inversion

- **Probe cost at intake.** ~1 s per cleanroom runner, once; the 60 s cap is `spawnSync`'s own
  `ETIMEDOUT` → `rejected` with a reason that says so (no launcher line exists on that path).
- **`unknown` is narrow.** Only "no launcher to spawn" is `unknown`; it admits in shadow and is
  refused in enforce at the point `missionMode` becomes known, so a launcher-less host degrades
  exactly like unknown readiness does today.
- **Suite drift.** Three suites pin the old message/code; the code stays, only the tail changes; the
  routing fixture moves its "incompatible" example to `grok`. `resolve-review-loop.test.sh` is run at
  base and at head because the resolver is touched.
- **Codex quota.** The mechanism ships without the live verdict; §1.5 keeps the pin swap honest.

## 7. Where this sits

1a-A ✓ → 1a-B ✓ → 1b-A ✓ → **1b-B (this)** → deny-list config → 2.

## Review log

- Unknown-escalation probe (`ladder-classify.json`): U0 — every coined name already had repo hits
  (the draft, brief and handoff name them), so no consult rung was climbed.
- Plan hetero loop G1 2026-09-17 (GLM-5.2 CONDITIONAL, claude-fable-5-1 CONDITIONAL; 5 blockers +
  5 non-blocking; `g1-*`, `plan.as-reviewed-g1.md`): all ten accepted — exhaustive launcher exit →
  decision map (R2), `unknown` removed in favour of a binary decision (R2; revisited in G2), HOME
  semantics cited to the launcher and the existing host test (R3), schemas NONE verified at base
  (R5), base record instead of a memory note (R7), grok's enum membership (R6), enum read from the
  schema at test time (R1), Context bytes + Status pinned (R8 ×2).
- Plan hetero loop G2 2026-09-17 (terminal at the cap; both seats CONDITIONAL, 1 blocker + 6
  non-blocking; `g2-*`, `plan.as-reviewed-g2.md`): all seven accepted — the G1 fold had contradicted
  frozen R2's "an absent probe adapter admits only under shadow enforcement", so `unknown` is
  restored with one meaning (no launcher to spawn), admitted in shadow and refused under enforce at
  the point `missionMode` is known; the probe spawns the launcher directly with `spawnSync`'s own
  timeout (R3, one process); deny-list construction is total over fixtures (R2); the step records
  the answering launcher and the deny paths (R3); resolver parity iterates the enum (R1); version
  pin re-stamp convention stated (R8). Growth 1.38× over the G2-reviewed bytes (cap reached, no
  further dispatch). Zero unaddressed blockers, zero deferred.
- Campaign 2026-09-17 (/l5 attempt 1, `impl-run1-attempt1-blocked.json`): implement 71 min (cursor-grok-4.6-low,
  hand `29d852e4`, 16 files ⊆ §2.5); in-rail scope + verification green (12 commands); in-rail MiniMax-M3
  review `no_verdict` (NO-FINDING-PROOF tautological — instrument fault; raw block SHIP-AS-IS); the engine
  said durable/resumable but `--resume` was refused (`campaign_resume_phase_unsupported`, phase REVIEWING) —
  rail defect filed → l3 degrade. Depth-0 at `29d852e4`: 12/12 green (`head-suites-29d852e4.txt`), scope
  clean; GLM-5.2 second review framing fault (block SHIP-AS-IS, not counted); claude-fable-5-1 second review
  FIX-THEN-SHIP 1 🟡 (a rejected probe decision was not kept as a step) → repaired at `af1879cb` with a
  RED-first routing case (`repair-red-at-29d852e4.log`), delta review SHIP-AS-IS, 12/12 green again
  (`head-suites-af1879cb.txt`). §5 dogfood: `dogfood-resolver.txt`, `dogfood-probe.txt`. Pin swap (§1.5)
  deferred to a BACKLOG row — no live codex verdict yet. Merge `bc4ea99e`.
