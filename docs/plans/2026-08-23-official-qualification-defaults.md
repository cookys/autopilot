# Plan — Official qualification defaults (shipped roster scorecards, consumer adopts or self-qualifies)

> **Status**: authored 2026-08-23 (dev-flow L-2), depth-1 foreman run `official-defaults-l4`
> **Owner**: Board (approved 2026-08-23); depth-0 holds the authoritative qc verdict
> **Branch**: `worktree-agent-abc817b6800ff099f` (from `origin/develop` @ `754df354`)
> **Frame**: BACKLOG row「Official qualification defaults — 官方考過的 roster 成績單,consumer 吃預設或自考」

## 0. Context / thesis

The autopilot roster has now been *officially administered*. As of 2026-08-22 the real scorecard
store holds 13 implementer administrations (events 143–155: 9 QUALIFIED, 4 honest FAILED), 3
reviewer administrations from the v2 metamorphic corpus (events 139–141: 1 QUALIFIED, 2 FAILED),
and 1 verification-author administration from the declared-plan suite (event 142, QUALIFIED).

Every consuming repo that wants to enable a heterogeneous role today has exactly two options: run
those administrations again in its own environment (hours of real dispatches, real money), or route
unqualified. That is a false choice — the administrations already happened, and their results are
*routing information* regardless of whose machine produced them.

This plan ships those results **as defaults**, with the administration environment fully disclosed,
and asks the consuming repo **once**: adopt the official defaults, or self-qualify here.

The thesis in one line: **an official administration is evidence a consumer may adopt; it is never
evidence a consumer must trust. The disclosure is what makes adoption an informed choice, and
self-qualification is always the stronger path.**

## 1. Problem

A consuming repo enabling a hetero role has no qualified rows and no cheap way to get them. The
qualification evidence exists but is trapped in the maintainer's user-local store
(`~/.autopilot/engine-scorecard/scorecard.jsonl`), which never ships.

Three sub-problems:

1. **Packaging.** The rows must ship with the plugin, versioned, schema-validated, and regenerable
   — because the roster gets re-administered and a hand-maintained copy would silently rot.
2. **Environment disclosure.** The official environment is not the user's environment. Runner CLI
   versions, transport, effort, prompt-config hash, corpus version and date all differ, and every
   one of them can invalidate the transfer. Disclose all of it; hide none of it.
3. **Consumer choice + downgrade.** The one-time question, the mechanical adoption step, and the
   guarantee that an adopted row behaves *exactly like a self-qualified one* under the strike-decay
   no-confidence machinery — including telling the operator the remedy when it goes bad.

## 2. OKR / KRs

**O**: a consuming repo can enable a hetero role on official evidence in one command, with the
administration environment in front of it, and lose that authority through exactly the same
mechanical no-confidence path as any self-qualified seat.

| KR | Measurable |
|----|-----------|
| KR1 | A shipped, schema-validated defaults artifact holding every in-scope official row with full environment disclosure + evidence pointers. |
| KR2 | Generation is a script, not a hand-edit: same store in ⇒ byte-identical artifact out; a hand-edited artifact fails `--check`. |
| KR3 | `adopt` copies chosen rows into a consuming store; the adopted row is admissible via `dispatch-contract.js` with no code change to the admission path. |
| KR4 | An adopted row accrues strikes on the same `seat_hash` as a self-qualified row, and a `requalify_required` verdict on it names the self-qualify remedy. |
| KR5 | Every claim above has a test that goes red when its wiring is deleted (evidence-discipline §1/§2). |

## 2.5 Global Constraints (copied verbatim into every dispatch)

- **ADR-0001 is binding. NO trust machinery.** No hash chains, no signatures, no witness receipts,
  no attestation, no trust roots. The BACKLOG row's word「簽署」is implemented as **DISCLOSURE**
  (provenance fields + evidence pointers), never as cryptographic attestation. Any `sha256` in this
  work exists so an artifact can be **re-derived** (replayed by regenerating it from the same
  store), exactly as `references/strike-decay.md` justifies a strike's `artifact_sha256` — never so
  it can be proven un-tampered. The consumer's verification path is re-derivation: self-qualify.
- **`~/.autopilot/**` is a READ-ONLY input.** Never write to the real store. Every test sets
  `ENGINE_SCORECARD_DIR` / `ENGINE_CAPABILITY_DIR` to a temp dir (`hooks/tests/lib.sh` already
  exports both). A test that writes to the real store is manufacturing tomorrow's false evidence
  (evidence-discipline §9).
- **`version_source` is a closed enum** (`runtime | manual | operator-asserted`, `engine-scorecard.js:36`).
  The adoption provenance marker MUST NOT be written into it — it goes in a new `provenance` object.
- **Rows ship verbatim.** The generator copies scorecard rows byte-faithfully (modulo the local
  `event_id`, which the destination store reassigns). No editing, no score adjustment, no dropping
  of FAILED rows — a FAILED row is routing information.
- **`expires` stays advisory.** Nothing in this work may compare `now` against `expires` in an
  admission path (`references/strike-decay.md`; `hooks/tests/calendar-teeth-negative.test.sh`).
- Node ≥ 20.10, built-ins only, for every new script (CLAUDE.md language rules: these parse JSON).
- No new skill and no new agent (⇒ PATCH bump, not MINOR).

## 2.6 Change-policy decisions

- **Compatibility impact**: additive-only. New data file, two new scripts, one additive projection
  field (`remedy`) on `engine-scorecard.js seat-status`. No existing field changes meaning; no
  existing consumer needs to change. Rows written by `adopt` carry one extra object (`provenance`)
  that existing readers ignore.
- **Dependency decision**: `none`. Node built-ins only; no new package, no new external tool.

## 3. File-structure map

| File | Responsibility | New? |
|------|----------------|------|
| `references/official-qualification-defaults.json` | The shipped artifact (ships + mirrors: `references/` is in `sync-codex-plugin-skills.sh` `DIRS`, which rsyncs the tree regardless of extension — there is no `data/` precedent in this repo): versioned, schema-validated official rows + per-row environment disclosure + evidence pointers. **Generated — never hand-edit.** | new |
| `schemas/official-qualification-defaults.schema.json` | JSON Schema for the artifact; the mechanical shape gate. | new |
| `references/official-qualification-defaults.recipe.json` | Generation input: which official event ids are in scope per role, and each one's evidence-bundle path. Hand-authored *selection*; the artifact itself is derived. | new |
| `scripts/build-qualification-defaults.js` | Derives the artifact from a scorecard store + recipe. Modes: `build` (write), `--check` (re-derive and diff against the shipped file — the anti-hand-edit gate). | new |
| `scripts/adopt-qualification-defaults.js` | Consumer side: `list` (show defaults + disclosure), `adopt` (copy chosen rows into the local scorecard store with `provenance`), `--dry-run`. | new |
| `scripts/qualification-sweep.sh` | Formalizes the durable parts of the session-local sweep scripts (roster iteration, Stage-0 probe receipts, administer→record→bundle discipline). `--plan` is deterministic and testable; `--execute` spends real dispatches. | new |
| `scripts/engine-scorecard.js` | `seat-status` projection gains an additive `remedy` field when a `requalify_required` seat's baseline row is an adopted official default. | edit |
| `references/qualification-defaults.md` | The contract doc: what a default is, what it is not, the disclosure fields, the ADR-0001 statement, the adopt-vs-self-qualify decision, strike interplay. | new |
| `references/strike-decay.md` | Cross-ref: adopted defaults are ordinary seat-scoped strike targets. | edit |
| `skills/engine-onboarding/SKILL.md` | The one-time question + the adopt path in the runbook (Stage 1/2). | edit |
| `skills/onboard/SKILL.md` | Asks the question when a consuming repo enables a hetero role. | edit |
| `hooks/tests/qualification-defaults.test.sh` | Schema validity, generation determinism, hand-edit negative. | new |
| `hooks/tests/qualification-defaults-adoption.test.sh` | Adoption round-trip: admissible + strike-able + remedy. | new |
| `docs/BACKLOG.md` | This row resolved; roster-qualification row updated. | edit |
| `docs/projects/2026-08-23-official-qualification-defaults/` + `docs/projects/INDEX.md` | Project tracking. | new |
| `CHANGELOG.md`, `.claude-plugin/plugin.json` (+ mirrors) | PATCH bump. | edit |
| `CLAUDE.md` | Three new script basenames in the grouped inventory. | edit |
| `docs/scripts-inventory.md` | Three new index rows. | edit |

## 4. Phases

### Phase 1 — Artifact + generator (size: L, the load-bearing half)

1. Write `references/official-qualification-defaults.recipe.json`: per role, the in-scope official
   `event_id`s and each one's `evidence_bundle` path under `docs/plans/evidence/`.
   In scope (Board §4): implementer `143–155`; reviewer `139, 140, 141`; verification_author `142`.
   Out of scope with recorded rationale: legacy reviewer rows `5, 6, 9` (pre-schema,
   compatibility-only per `skills/engine-onboarding/SKILL.md`); verification_author `131–136`
   (2026-07-24 onboarding-era corpora, superseded by the `va-declared-plan-v1` suite); brain-seat
   sittings (a different store and a different record shape — `owner-brain-seat-v1` in the
   capability store, not a scorecard row; deferred with a BACKLOG row).
2. Write `scripts/build-qualification-defaults.js`:
   - reads the scorecard store (`--store <dir>`, default `ENGINE_SCORECARD_DIR` then `~/.autopilot/engine-scorecard`),
   - selects rows by recipe, fails closed on a missing event id,
   - emits per entry: `default_id`, `role`, `status`, `seat` + `seat_hash`
     (`sha256(canonicalJson({engine,runner,role}))` — the *same two-line algorithm* as
     `engine-scorecard.js:1424`, re-derived locally, never shelled out cross-script),
     `administration` (the full disclosure block), `quality`, `capability_score`,
     `evidence_pointers` (official event id, evidence-store pointer, bundle path), and `row`
     (the verbatim scorecard row minus `event_id`),
   - **determinism**: no wall-clock in the output; deterministic key order; entries sorted by
     `(role, official_event_id)`; two-space JSON + trailing newline,
   - `--check`: re-derive in memory and byte-compare against the shipped file; exit 1 with a diff
     summary on mismatch.
   - Acceptance: `node scripts/build-qualification-defaults.js --check` exits 0 on the committed
     artifact; flipping one byte in the artifact makes it exit 1.
3. Write `schemas/official-qualification-defaults.schema.json` and validate the artifact with
   `scripts/validate-json-schema.js`.
   - Acceptance: schema validation passes; deleting a required disclosure field from a copy fails it.

### Phase 2 — Adoption (size: L)

4. `scripts/adopt-qualification-defaults.js`:
   - `list [--role <r>]` — prints each default with its disclosure block and a one-line
     "administered on <date> with <runner> <runner_version> at effort <effort>" summary.
   - `adopt --role <r> [--seat <engine>:<runner>] [--all] [--dry-run]` — validates the artifact
     against its schema, then writes each chosen `row` into the local store **through
     `engine-scorecard.js record`'s own validation path** (never a raw append), with an added
     `provenance` object: `{kind:"official-default", official_event_id, defaults_artifact_version,
     defaults_artifact_sha256, adopted_at, self_qualify_command}`.
   - Fails closed when the local store already holds a newer row for the same seat+role — a
     self-qualification always wins over a default on the same seat identity.
   - Acceptance: adopt into a temp store ⇒ `engine-scorecard.js current --role implementer` returns
     the seat with `admission_status: qualified`; `dispatch-contract.js` says GO for that seat.
5. Wire the one-time question into `skills/onboard/SKILL.md` (asked when a hetero role is enabled)
   and the adopt path into `skills/engine-onboarding/SKILL.md` Stage 1/2 (with the explicit note
   that self-qualification is the stronger evidence tier and overrides on the same seat identity).

### Phase 3 — Strike interplay (size: S)

6. Confirm-by-test (not by reading) that an adopted row's `seat_hash` equals the self-qualified
   `seat_hash` for the same `{engine, runner, role}` and that strikes accrue against it.
7. `engine-scorecard.js seat-status`: when the projection yields `requalify_required` **and** the
   baseline row carries `provenance.kind === "official-default"`, add an additive `remedy` string
   naming the self-qualify command for that role/seat. No change to `admission_status` semantics.
8. Cross-reference in `references/strike-decay.md` (one paragraph: adopted defaults are ordinary
   seat-scoped strike targets; the epoch re-baseline is a *fresh local administration*, i.e.
   self-qualification, not re-adopting the same default).

### Phase 4 — Sweep-script formalization (size: S)

9. Read `/tmp/autopilot-dispatch-runs/official-defaults/sweep{,2,3,4,5}.sh` and extract the durable
   parts: `probe_receipt` emission, `stage0_probe`, and the `run_seat` administer→record→bundle
   sequence. These are exactly the "OPERATOR-RUN in v1 — the qualifier does not write these
   receipts; mechanization is a BACKLOG row" gap named in `skills/engine-onboarding/SKILL.md`.
   Ship `scripts/qualification-sweep.sh` taking a roster file, with a deterministic `--plan` mode
   (emits the exact per-seat command lines; testable without spending a dispatch) and `--execute`.
   Session-specific parts (frozen corpus hashes, a specific date's roster) stay in the roster file,
   not the script.
   - Acceptance: `--plan` over a fixture roster is byte-stable across runs and names the correct
     `engine-qualify.js` + `engine-scorecard.js record` invocations.

### Phase 5 — Docs, wiring, gates (size: S)

10. `references/qualification-defaults.md` (contract doc, incl. the explicit ADR-0001 paragraph).
11. All four CLAUDE.md wiring touchpoints for each of the three new scripts.
12. BACKLOG rows, project dir + INDEX, CHANGELOG, PATCH version bump via `scripts/sync-version.js`.
13. Full gate: `bash hooks/tests/run.sh --parallel 8` + `AUTOPILOT_SKIP_SLASH_PROBE=1` preflight 8/8.

## 5. Test / validation

Script-gated (each goes red when its wiring is deleted):

| Test | Asserts | Planted negative |
|------|---------|------------------|
| `qualification-defaults.test.sh` | artifact validates against its schema | delete a required disclosure field ⇒ red |
| " | `--check` passes on the committed artifact | flip one byte in the artifact ⇒ red |
| " | generation determinism: same store ⇒ byte-identical output over two runs | inject a wall-clock field ⇒ red |
| " | recipe fail-closed | recipe naming a missing event id ⇒ nonzero |
| `qualification-defaults-adoption.test.sh` | adopted row is admissible (`current` + `dispatch-contract`) | drop `provenance` handling ⇒ still admissible (that is the point: provenance is disclosure, not gating) |
| " | adopted `seat_hash` == self-qualified `seat_hash` for the same triple | change the derivation ⇒ red |
| " | 3 strikes on an adopted seat ⇒ `would_requalify` / `requalify_required` under enforce | remove the adopted row's seat fields ⇒ red |
| " | `requalify_required` on an adopted default carries `remedy` | delete the projection branch ⇒ red |
| `qualification-sweep` `--plan` | byte-stable plan output over a fixture roster | — |

Human-gated: whether the *selection* in the recipe is the right one (Board §4 fixes it), and the
wording of the one-time question.

Isolation: every test exports `ENGINE_SCORECARD_DIR`/`ENGINE_CAPABILITY_DIR` into `TEST_TMP` via
`hooks/tests/lib.sh`. No test may read or write `~/.autopilot`.

## 6. Risks + inversion

*What would guarantee this fails?*

| Risk | Mitigation |
|------|-----------|
| **The artifact silently rots** — roster re-administered, shipped file stale. | `--check` is a gate, not a convenience; the artifact is derived, never hand-authored. |
| **Defaults read as attestation** — a consumer treats "official" as a trust claim. | ADR-0001 paragraph stated in the reference doc, the schema description, and the `list` output. The disclosure block is *always* printed with the row; there is no way to see the verdict without seeing the environment. |
| **An adopted row escapes strike accrual** because its seat identity drifts from the self-qualified derivation. | Tested directly (KR4), not reasoned about. The `seat_hash` comes from `{engine,runner,role}` copied verbatim. |
| **`version_source` abused as the provenance marker** (the BACKLOG row's "e.g."). | Constraint §2.5: it is a closed enum; `record` would reject it. Provenance goes in its own object. |
| **A test writes to the real store.** | `hooks/tests/lib.sh` already exports isolated dirs; asserted in the test preamble. |
| **Scope creep into administering new exams.** | Out of scope, §7. This plan spends zero dispatches. |
| **The `sha256` in provenance re-imports trust machinery.** | It is a re-derivation aid, documented as such, with the same justification `strike-decay.md` gives `artifact_sha256`. It gates nothing. |

## 7. Out of scope

- Administering ANY new qualification (no engine dispatches for exams in this work).
- planner/explorer suites (separate BACKLOG legs).
- Brain-seat sittings in the defaults package (different store, different record shape — BACKLOG row).
- Trust machinery of any kind (ADR-0001).
- Changing strike-decay semantics or arming `AUTOPILOT_STRIKE_ENFORCEMENT`.
- Any new skill or agent.

## 8. Open questions

None blocking — the Board fixed the four design points and the row selection in the run brief.
One deferred to a BACKLOG row: whether brain-seat sittings should ship as defaults in a v2 artifact.

## 9. Implementation note — discovered during execution, not planned

**A scorecard row cannot travel alone.** `engine-scorecard.js record` refuses any `internal_eval`
row whose `evidence_store` triple does not resolve to a matching wrapper in the destination
CAPABILITY store (`verifyEvidenceStoreAnchor`, `engine-scorecard.js:406`). The plan above assumed
the scorecard row was self-contained; the first adoption round-trip failed with
`scorecard qualifier store anchor is missing or mismatched`.

Correction, applied in Phase 1+2: the artifact now carries `capability_evidence` per entry — the
verbatim `{event_id, producer, transcript_hash, evidence}` wrapper — and `adopt` appends it to the
destination capability store under a free local `event_id`, renumbering the scorecard row's
`evidence_store.event_id` to match in the same step. Producer and transcript_hash ride verbatim, so
the anchor still binds. The generator fails closed when a recipe entry's anchor is not resolvable
in the source capability store.

This is exactly `references/evidence-discipline.md` §1: the artifact existed and validated, and the
flow it exists for did not work. Only the end-to-end round-trip separated the two.

**Pre-existing defect found, deliberately NOT fixed here** (BACKLOG row filed with the measured
reproduction): `nowArgToMs` truncates to UTC midnight, so an evidence receipt issued later on the
same UTC day reads as not-yet-valid. Events 153/154/155 project `no_record` on the real store today
and `qualified` under `--now 2026-08-24`. Fixing it means touching admission semantics, which this
plan's §7 puts out of scope.

## Review log

- **R0 author**: depth-1 foreman, run `official-defaults-l4`, 2026-08-23.
- **R1 first-pass pre-merge review** (autopilot:reviewer, opus, 2026-08-23) — 0 🔴, 2 🟠, 5 🟡, 5 🔵.
  The three headline claims held under direct execution: the adoption round-trip is end-to-end
  through an unmodified `dispatch-contract.js` (verdict GO on an adopted row); the artifact
  re-derives byte-identically from the real store under hostile TZ/locale; the schema gate has teeth
  (dropping a disclosure field fails the build closed). ADR-0001 boundary verified clean — both
  sha256 values are written-and-never-read.
  Two of the reviewer's five mutations SURVIVED, and that was the sharpest result: the generator's
  duplicated `seatHash` and the `provenance.kind === 'official-default'` discriminator were
  asserted-but-unpinned, so KR5 was not actually met. Both are now fixed — the `kind` mutation was
  re-run after the fix and goes red (`43 passed, 1 failed`), restored green at 44.
  Dispositions: all 7 MUST-FIX applied (undeclared `.opencode` dependency bump reverted to base;
  sweep roster `role` fail-closed to `implementer` because the seats×25 consent warning is
  implementer-shaped and would understate a reviewer sweep's real spend by ~72%; over-claiming
  test-pin comment corrected to state what §7 actually pins; `kind` negative control added; the
  generator test now guards `ENGINE_CAPABILITY_DIR` — the var it destructively writes — and
  byte-fingerprints the real stores; schema misstatement corrected in two places; dangling fixture
  path fixed). Cut items 8–12 recorded as follow-ups; the sweep retry-semantics header drift (8) and
  the `validateAgainstSchema` silent self-disable (11) were fixed in-line rather than deferred.
  Widened the same-UTC-day BACKLOG row with the reviewer's sharper finding: the truncation also
  makes same-day STRIKE accrual a silent no-op (3 strikes at 19:49Z ⇒ `rejected_strikes: 3`).
- **R2 depth-0 authoritative panel** (sol@max + GLM-5.2 + MiniMax-M3, 2026-08-23) — **FIX-THEN-SHIP**
  from all three seats. One 🔴 from sol ("official-artifact-missing") was ruled a FALSE POSITIVE by
  depth-0: the generated JSON had been excluded from that seat's review diff for context budget.
  Six findings accepted, all fixed on this branch:
  - **F1 🔴 dead trust machinery** — `store_projection_sha256` and `defaults_artifact_sha256` were
    written and read by nothing. Both removed (generator, schema, adopt, docs, assertions).
    `--check` already byte-compares the whole file, which is strictly stronger; a
    written-but-never-read hash reads as trust machinery to the next person. Behavior-neutral.
  - **F2 🔴 local-evidence precedence** — the collision rule compared dates and `--force` bypassed
    it. Depth-0 extended the finding to its worst shape: a local **FAILED** row has no
    `qualified_at`, so `'' >= '2026-08-21'` was false, no collision fired at all, and an official
    QUALIFIED default landed silently on top of local honest failure. Rule is now identity-based,
    not date-based: ANY local non-adopted row refuses the seat, and `--force` cannot override it
    (it may only replace a previous adoption). Three planted negatives.
  - **F3 🟠 hollow schema gate** — the build validated a copy with fractional scores replaced by 0,
    and the test asserted the validator's exit 2 on the real artifact as green. `capability_score`
    now ships as a lossless decimal string; the committed bytes validate directly, `readArtifact`
    validates on the consumer side too, and the zero-substitution hack and exit-2-as-green
    assertions are gone.
  - **F4 🟠 sweep false success** — qualify/record failures were logged and swallowed. They now
    increment a failure counter, log `QUALIFY-FAIL`/`RECORD-FAIL`/`PROBE-FAIL`, and exit nonzero.
    A recorded FAILED verdict deliberately stays a success (that is the instrument working).
  - **F5 🟠 asserted-not-executed admission** — the test mirrored
    `isAdmissibleScorecardRow` by hand. It now drives the REAL `dispatch-contract.js check` on a
    real contract + repo (adopted seat ⇒ `"verdict":"GO"`, empty store ⇒ NO-GO control) and the
    REAL `resolve-review-loop.sh --check-scorecard`. The mirror is kept as a secondary signal.
    `dispatch-contract.js` was NOT given an export seam: it ends in an unconditional IIFE, so
    `require()` would execute it — driving the CLI is the correct seam.
  - **F6 🟠 version_source stamp** — adopted rows now carry `version_source: official-default`, with
    the administration's original value preserved as
    `provenance.administration_version_source`. The enum was widened deliberately in
    `engine-scorecard.js`; `qualify-scorecard-vocabulary.test.sh` still holds (it requires the
    accepting side to be a superset).
  Artifact regenerated (F1/F3 change its bytes): 17 entries, 201964 → new size, `--check` clean.
- Depth-0 holds the authoritative qc verdict; this run performs first-pass qc only per its brief.
