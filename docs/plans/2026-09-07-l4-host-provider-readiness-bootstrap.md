# Plan — l4 host provider-readiness bootstrap

> Status: DRAFT (R0, awaiting plan loop review)
> Owner: cookys (Board) · Author: autopilot-eb session, 2026-09-07
> Branch: `feat/v2.37.0-l4-host-bootstrap` (not yet created — L-3)
> Frame: dev-flow L. Owner ruling 2026-09-06 「先 fix 然後完整修好」 — the Fix half shipped in v2.36.7; this is the「完整修好」half.
> logical_plan_id: `l4-host-provider-readiness-bootstrap`

## 0. Context / thesis

`bin/autopilot.js` compiles `createStrictL5ProviderBootstrap` only when `AUTOPILOT_LEVEL` is `l5` or `l6`
(`bin/autopilot.js:396`). That bootstrap is the **only** host-owned readiness authority the engine has:
it resolves the roster once, derives a frozen invocation policy, live-probes every seat, and issues the
`providerReadinessAuthority` + `qualificationProvider` that `campaign-intake.js`'s enforce-mode path
(`consumeEnforcedProviderReadiness`, ~1280) and the engine's reviewer-qualification preflight consume.

An l4 marker gets none of it. cuda's WIZHALL run (revival-world-city-war, Codex platform, owner-selected
agy `gemini-3.8-flash-low` implementer) therefore hit two walls in sequence:

1. `reviewer_qualification` — **closed in v2.36.7** by waiving it at l4 with a `waived` ledger entry.
2. `provider_readiness_authority_missing` — **not waived** (ADR-0001 boundary); v2.36.7 only made the
   refusal name its cause and the two legal remedies (shadow, or /l5).

Two facts make the complete fix smaller than the BACKLOG row estimated:

- **Canonical-policy coverage is already advisory** (Board 2026-08-16, owner-kernel retirement P4;
  `provider-bootstrap.js` ~365-420). A roster tuple outside the frozen D4 claim set derives with
  `claim_id: null`, a loud stderr `POLICY OVERRIDE` line and a recorded `policy_override` — it is not a
  gate. So l4 does **not** need new capability claims or exam evidence to obtain a readiness bundle; it
  needs the bootstrap to accept an l4-shaped roster and the CLI to compile it.
- **The l6 extension was a bounded change** (`8dbc8f51`, 2026-08-30: 118 lines across bin, bootstrap,
  two test suites, two docs). l4 follows the same shape, plus one real design difference: the l5/l6
  roster requires a verification-author seat and a complete QC panel (`deriveStrictL5InvocationPolicy`,
  `strict_l5_provider_roster_incomplete` at ~292 and ~301). An l4 roster is implementer + reviewer, with
  optional fallback ladder and optional QC panel.

The thesis: **give l4 the same live-probed, host-owned readiness bundle as l5/l6, with an l4 roster
profile, and thread it through the CLI exactly as l5/l6 are threaded.** Nothing is waived; nothing is
faked; the advisory policy-coverage rule already covers uncertified seats honestly.

## 1. Problem

An operator who runs `engine implement-review` under an l4 marker against an enforce-mode mission
campaign cannot proceed at all: the engine has no readiness authority to hand to intake. The only exits
today are to downgrade the mission to shadow or to re-run under /l5 — and /l5's roster shape (VA seat +
full QC panel) does not match an l4 roster, so the /l5 exit is itself blocked for the WIZHALL roster
(`strict_l5_provider_roster_incomplete`).

The user goal: **an l4 managed run reaches intake with real readiness evidence, using the roster the
operator configured, with every uncertified seat recorded as such.**

## 2. OKR / KRs

- **KR1** — `AUTOPILOT_LEVEL=l4 engine implement-review --campaign-contract <enforce-mode contract>` on a
  roster of {implementer, reviewer} (no VA, no QC panel) passes `campaign_intake`'s
  `consumeEnforcedProviderReadiness` with a bundle whose `strict_level` is `l4`. Verified by an executable
  fixture in `hooks/tests/autopilot-cli.test.sh` (twin of the existing L5/L6 fixtures at ~236-295).
- **KR2** — the same run against a roster whose seats are outside the frozen policy derives with
  `policy_override.reason = advisory_default`, each uncertified seat listed, and the stderr `POLICY
  OVERRIDE` line present. Verified by the same fixture family (advisory case).
- **KR3** — l5 and l6 behaviour is byte-identical before/after: the existing L5/L6 fixtures and
  `provider-readiness-consumer.test.sh` pass unchanged; an l5 roster missing its VA seat still fails
  `strict_l5_provider_roster_incomplete`.
- **KR4** — the v2.36.7 reviewer-qualification waiver interplay is explicit: when the l4 bootstrap's
  qualification provider certifies the reviewer tuple, the ledger shows **no** `waived` entry; when it does
  not (uncertified), the `waived` entry remains. Verified by an engine-level test.
- **KR5** — `engine-lifecycle-observation.js` accepts `l4` in `OBSERVABLE_LEGACY_LEVELS` and `waived` in
  `OBSERVABLE_ENGINE_STATUSES`, so an l4 run's lifecycle observation serializes intact statuses (no
  `unknown` + hash). Verified by a unit test.
- **KR6** — dogfood: cuda re-runs WIZHALL under l4 on the released version and reports intake reached
  (`dispatcher_called: true` or a later-phase rejection), not `provider_readiness_authority_missing`.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Node ≥ 20.10, built-ins only; no new dependency.
- ADR-0001: no trust machinery (no hash chains, attestation, trust roots). The l4 bundle is produced by the
  SAME `collectProviderReadinessBundle` live probe as l5/l6; a seat is `qualified` only through the live
  `qualificationProvider`; disk scorecards stay telemetry.
- Canonical-policy coverage stays ADVISORY at every site (Board 2026-08-16). No new hard gate on roster
  identity may be introduced for any level.
- The frozen D4 claim set (`STRICT_L5_CLAIM_IDS` / `STRICT_L5_PROVIDER_POLICY`) is NOT edited by this
  plan. l4 does not get its own claim set.
- `strict_level` in the bundle and the consumed receipt carries the actual level (`l4`), never an l5
  literal (same rule the l6 commit established).
- The v2.36.7 l4 reviewer-qualification waiver stays; this plan must not remove the `waived` ledger path.
- Every changed source under `bin/`, `src/` is mirrored to `platforms/codex/plugin/` via
  `scripts/sync-codex-plugin-skills.sh` before commit (the pre-commit ritual enforces it).
- Version: MINOR is NOT warranted (no new skill/agent); this ships as PATCH `v2.36.8` unless the Board
  decides the l4 managed rail is a new user-facing surface.

## 2.6 Change-policy decisions

- **Compatibility impact**: published-compatible. New behaviour appears only under `AUTOPILOT_LEVEL=l4`;
  l5/l6 bundles, receipts, rejection codes and the CLI flag surface are unchanged. The bundle/receipt
  `strict_level` enum widens from `{l5,l6}` to `{l4,l5,l6}` — consumers that switch on it must treat `l4`
  as a legacy level (KR5 covers the one in-repo consumer).
- **Dependency decision**: none — Node built-ins and existing in-repo modules only.

## 3. File-structure map

| File | Responsibility in this plan |
|---|---|
| `src/readiness/provider-bootstrap.js` | Accept `level: 'l4'`; introduce a per-level **roster profile** (`l4`: implementer + reviewer required, VA optional, QC panel optional; `l5`/`l6`: unchanged) used by `deriveStrictL5InvocationPolicy` and `validateCollectedBundle`; `strict_level` = actual level. |
| `bin/autopilot.js` | Compile the bootstrap for `l4` too (`level === 'l4' || 'l5' || 'l6'`), thread `providerReadinessAuthority` / `qualificationProvider` / `roster` identically; keep the v2.36.7 waiver block; usage text. |
| `src/engine/engine-lifecycle-observation.js` | `OBSERVABLE_LEGACY_LEVELS` += `l4`; `OBSERVABLE_ENGINE_STATUSES` += `waived`. |
| `src/engine/campaign-intake.js` | No behaviour change; the v2.36.7 message's "only l5/l6 build the strict host bootstrap" clause becomes "only l4/l5/l6" — text only. |
| `hooks/tests/autopilot-cli.test.sh` | L4 executable fixture twin (ready bundle, `strict_level: l4`), advisory-override case, l5-without-VA negative control (KR3). |
| `hooks/tests/provider-readiness-consumer.test.sh` | Bootstrap unit cases: l4 profile accepts implementer+reviewer; l4 with VA present still derives; l5 without VA still fails; level drift `l4`↔`l5` still fails. |
| `hooks/tests/autopilot-engine.test.sh` | KR4 interplay: certified reviewer ⇒ no `waived`; uncertified ⇒ `waived`. |
| `hooks/tests/engine-lifecycle-observation*.test.sh` (or nearest existing) | KR5 unit. |
| `skills/ceo-agent/references/level-front-door.md` | Foreman section: l4 now compiles the bootstrap; the "real l4 wall" paragraph added in v2.36.7 is rewritten to the new state. |
| `references/multi-agent-portability.md`, `docs/installation.md` | The two "Strict-L5 provider boundary" mentions gain l4. |
| `docs/BACKLOG.md` | Close the "l4 host provider-readiness bootstrap" row; close/annotate "Managed campaigns under an l4 marker can never satisfy reviewer_qualification". |
| `CHANGELOG.md`, `docs/projects/INDEX.md`, `docs/projects/2026-09-07-l4-host-bootstrap/README.md` | Release mechanics (L-3 project dir, L-5 archive). |
| `platforms/codex/plugin/**` | Mirrors of every touched `bin/`, `src/`, `skills/`, `references/` file (sync script). |

## 4. Phases

### P0 — Spike: enumerate the exact l4 fail sites on a real roster (S)

Run, on this host, the strict bootstrap against an l4-shaped resolved roster and record every failure in
order. Concretely:

```bash
node -e '
const { createStrictL5ProviderBootstrap } = require("./src/readiness/provider-bootstrap");
const { resolveReviewLoopJson } = require("./src/engine/resolve-review-loop");
const r = resolveReviewLoopJson(["--check-scorecard"], { cwd: process.cwd(), env: process.env }).result;
r.verification_author_present = false; r.qc_panel_seats = []; r.qc_panel_seats_complete = false;
try { createStrictL5ProviderBootstrap({ cwd: process.cwd(), level: "l5" }, { resolvedRoster: r }); }
catch (e) { console.log(e.code, e.message); }'
```

Expected today: `strict_l5_provider_bootstrap_invalid` for `level: 'l4'` (constructor guard) and
`strict_l5_provider_roster_incomplete` for the VA/QC shape. Record the list in
`docs/projects/2026-09-07-l4-host-bootstrap/ledger/p0-spike.md`. **Done when** the list is written and
every code line it names is cited by P1.

### P1 — Roster profile per level in the bootstrap (L core, one deliverable)

In `src/readiness/provider-bootstrap.js`:

1. Constructor guard (`~489-497`): accept `options.level ∈ {l4, l5, l6}`; error text
   `strict /l4|l5|l6 bootstrap accepts only a host cwd and level`.
2. Add `const LEVEL_ROSTER_PROFILE = deepFreeze({ l4: { verification_author: 'optional', qc_panel:
   'optional' }, l5: { verification_author: 'required', qc_panel: 'required' }, l6: { … same as l5 … } })`.
3. `deriveStrictL5InvocationPolicy(resolved, level)`: take the level; at ~292 (VA) and ~301 (QC panel)
   consult the profile — `required` keeps today's `strict_l5_provider_roster_incomplete`; `optional`
   includes the seat only when present (`verification_author_present === true`; `qc_panel_seats` non-empty
   and `qc_panel_seats_complete === true`, else skip). Fallback ladder handling unchanged.
4. Every caller of `deriveStrictL5InvocationPolicy` inside the module passes `strictLevel`
   (`providerReadinessAuthority` re-derives the request roster at ~549 — same level).
5. `validateCollectedBundle` / receipt: `strict_level` = `strictLevel`; level-drift check at ~619 keeps
   failing when bundle level ≠ bootstrap level (add `l4` to its accepted set).
6. `policy_override` semantics unchanged: an l4 roster outside the D4 set derives with
   `reason: advisory_default` and the stderr line.

**Done when** the P0 spike script, with `level: 'l4'`, returns a bootstrap whose `roster` lists exactly
the implementer and reviewer seats (plus fallbacks if configured), `policy_override` names both as
uncertified, and `level: 'l5'` with the same roster still throws `strict_l5_provider_roster_incomplete`.

### P2 — CLI threading, observation levels, intake message (S)

1. `bin/autopilot.js:396`: `if (level === 'l4' || level === 'l5' || level === 'l6')`; the v2.36.7 waiver
   block stays above it (order: waiver decision, then bootstrap). Usage text: `AUTOPILOT_LEVEL=l4|l5|l6
   additionally requires the compiled, host-owned exact-roster provider-readiness trust root` and the l4
   waiver clause retained.
2. `src/engine/engine-lifecycle-observation.js:13`: `OBSERVABLE_LEGACY_LEVELS = new Set(['l4','l5','l6'])`;
   `:35-60` add `'waived'` to `OBSERVABLE_ENGINE_STATUSES`; error text `must be l4, l5 or l6`.
3. `src/engine/campaign-intake.js` message: `only l4/l5/l6 build the strict host bootstrap`.
4. `scripts/sync-codex-plugin-skills.sh`.

**Done when** `AUTOPILOT_LEVEL=l4 node bin/autopilot.js engine implement-review … --campaign-contract
<missing>` prints `"strict_l5_provider_readiness":{"status":"ready"` and `"strict_level":"l4"` before the
campaign-file rejection (same observable the L6 fixture uses).

### P3 — Tests (S, must land in the same commit as P1+P2)

- `hooks/tests/autopilot-cli.test.sh`: **L4 executable fixture** — clone of the L6 fixture (~270-295)
  with `AUTOPILOT_LEVEL=l4` and the STRICT_L5_PRELOAD roster edited to `verification_author_present:false`
  and an empty QC panel; assert `status:"ready"`, `strict_level:"l4"`, and (advisory case) the
  `policy_override` record. **Negative control**: `AUTOPILOT_LEVEL=l5` with the same VA-less roster still
  rejects with `strict_l5_provider_roster_incomplete` before spend.
- `hooks/tests/provider-readiness-consumer.test.sh`: unit cases for the profile table (P1 done-when items
  as assertions) and level drift `l4` bundle consumed by an `l5` bootstrap ⇒ `strict_l5_provider_level_drift`.
- `hooks/tests/autopilot-engine.test.sh`: KR4 interplay (certified reviewer tuple via an injected
  `qualificationProvider` ⇒ no `waived`; uncertified ⇒ `waived`).
- Lifecycle observation unit for KR5.
- RED first: every new assertion must fail on `develop` (`git stash` the sources) — record the red run in
  the project ledger.

### P4 — Docs, BACKLOG closure, release (S)

- `level-front-door.md` foreman section: replace the v2.36.7 "real l4 wall" clause with: l4 compiles the
  bootstrap with the l4 roster profile; uncertified seats run under the advisory override and are recorded;
  the reviewer waiver applies only when the bootstrap does not certify the reviewer.
- `references/multi-agent-portability.md:185`, `docs/installation.md` mention.
- BACKLOG: close the two rows; CHANGELOG `v2.36.8`; INDEX row; project README progress; version bump.

### P5 — Dogfood (KR6, human-gated)

cuda re-runs WIZHALL under l4 on the released develop; report the intake outcome and the ledger's
`reviewer_qualification` entry (`waived` vs absent). Any new rejection code becomes a BACKLOG row, not a
same-day patch.

**Dependency map**: P0 → P1 → P2 → P3 (P1–P3 are one deliverable, one branch, one pre-merge review) → P4 →
merge → P5.

## 5. Test / validation

Script-gated: P3 suites + `hooks/tests/run.sh --parallel` full run before merge (classify every red against
clean develop, as in v2.36.2). Human-gated: P5 dogfood report from cuda; Board decision on §8.

Verification contract (dev-flow 驗證合約): `bash hooks/tests/autopilot-cli.test.sh &&
bash hooks/tests/provider-readiness-consumer.test.sh && bash hooks/tests/autopilot-engine.test.sh` — RED on
develop for the new assertions, GREEN on the branch.

## 6. Risks + inversion

- **What guarantees failure**: making l4 coverage a hard gate "for safety" — it would re-block WIZHALL
  under a new code and contradict the 2026-08-16 Board decision. Mitigation: KR2 asserts the advisory path.
- **Roster profile leak**: relaxing VA/QC for l5 by accident. Mitigation: KR3 negative control is mandatory
  in the same commit.
- **Level literal drift**: a bundle stamped `l5` for an l4 run (the exact bug the l6 commit fixed).
  Mitigation: `strict_level:"l4"` assertion in the fixture.
- **Observation feed rejects `waived`/`l4`**: KR5.
- **The /l4 skill's own semantics**: /l4 is documented as an all-Claude foreman; the "managed Codex l4"
  route exists on the Codex platform skill. If the Board decides l4 should never drive the engine, this
  plan is the wrong shape (§8 Q1) — ask before P1.

## 7. Out of scope

- New capability claims / exam evidence for agy `gemini-3.8-flash-low` or any l4 tuple (engine-onboarding
  work; advisory coverage makes it unnecessary for the bundle).
- Editing the frozen D4 claim set or `STRICT_L5_PROVIDER_POLICY`.
- The v2 claim ↔ ICC intake identity binding (separate BACKLOG row).
- Mission `enforcement_mode` defaults for consuming repos.

## 8. Open questions (Board)

1. Confirm that an l4 marker driving `engine implement-review` is a supported route (the Codex-platform
   l4 skill declares it) rather than an accident to be refused. The plan assumes **supported**.
2. l4 roster profile: implementer + reviewer required; VA and QC panel optional. Or should l4 require a QC
   panel when the mission is enforce-mode? The plan assumes **optional**.
3. Version: PATCH `v2.36.8` (assumed) vs MINOR.

## Review log

- R0: this document. Manifest and frozen rubric to be written at L-2.5 (`docs/plans/2026-09-07-l4-host-provider-readiness-bootstrap.rubric.md`, `plan-review-manifest` beside it).
