# Plan — Operator pin supersedes qualification: the exam becomes an opt-in recommender

> Status: **R2 — FROZEN** (G2 terminal, depth-0 final adjudication 2026-09-11) · Owner: depth-0 session under Board delegation ·
> Branch: develop (units via dev-flow worktrees) · Frame: owner ruling 2026-09-11

## 0. Context / thesis

Two Board rulings currently make the qualification exam a gate that binds the **operator**:

- **KR6** (`docs/plans/2026-08-17-autonomous-brain-integration.md:72-74`, FROZEN): no fresh evidence →
  an explicit **per-invocation** override artifact is required; absent both, refusal. "**Among qualified
  candidates**, the user's preference config beats any system ranking."
- **Strike precedence** (`scripts/dispatch-contract.js:1240-1253`, 2026-08-22): a `requalify_required`
  seat is detected **before** the override is consulted; "the only exit … is a fresh PASSING
  administration, never an override."

Both were written against a documented pathology — three weeks of unattended `gpt-5.6-sol` depth-0
operation, 12 failure shapes — whose threat model is **an autonomous brain choosing silently**.

The owner ruling of 2026-09-11 is that this was over-applied: an operator who names a seat is not that
case, and the exam's job is to **recommend when the operator has not named one**. Observed cost: the
v2.36.21 run interrupted the owner **twice** to re-authorise seats the owner had already named, turning
a one-sentence dispatch into an onboarding negotiation.

**Thesis**: keep every gate for autonomously-chosen seats; make an operator-named seat a **standing pin**
that admits on its own; and when a pinned seat becomes unusable, **substitute and keep running** rather
than stop and ask (§1.5). This is a **supersession**, recorded as one — not a reinterpretation.

## 1. Problem

1. **No standing operator preference exists.** `project-config-template/task-class-config.md:27` ships a
   "user-owned; outranks every system ranking" block, but no script reads it (the only consumer is prose
   at `skills/ceo-agent/references/level-front-door.md:47-55`), it governs **ranking** not admission, and
   this repo has no `.claude/task-class-config.md` at all. KR6's "preference config" has no
   admission-side implementation.
2. **The only evidence-free path is per-invocation and file-shaped** (`dispatch-contract.js:1274`). An
   operator who has already named a seat must hand-author a JSON artifact **per dispatch** to be obeyed.
3. **Revocation is silent and unconditional** (`dispatch-contract.js:119`). The operator learns of it as
   a NO-GO string; the evidence (`predicate_id`, `receipt_ref`, `observed_at`) stays in the store.
4. **Unavailability stops the run** — see the corrected table below; this is the defect G1 exposed.

What is **already correct**, and what this plan wrongly assumed was — each re-derived by depth-0 on
2026-09-11 with the command recorded, not accepted from a reading:

| Owner requirement | State | Re-derivation |
|---|---|---|
| quota wall must not revoke | **EXISTS, but narrower than R1 claimed** | `sed -n '736p' scripts/engine-capability-state.js` → the exclusion registry; **and** `sed -n '3782,3800p' scripts/dispatch-hetero.sh` → `engine_unavailable` is re-derived from the **exit code alone**, so a text-only quota message on an ordinary exit code deliberately falls through to `ambiguous` and **accrues**. The guarantee holds for **host-corroborated** quota only — by design (a runner is never trusted to label its own failure). |
| quota wall gets a stand-in | **DOES NOT EXIST — new work** | `sed -n '1303p' scripts/dispatch-contract.js` → quota unavailability is a **NO-GO reason**; `grep -n 'DEF_ON_ENGINE_UNAVAILABLE=' scripts/resolve-review-loop.sh` → `"ask"`, i.e. the shipped default is to **stop and ask the operator**; `grep -c quota scripts/resolve-dispatch-topology.js` → **0**, the ladder is not quota-aware and cannot climb past an exhausted seat |
| fabricated evidence is punishable | **EXISTS** | `sed -n '735p' scripts/engine-capability-state.js` → `CRITICAL_REEXAM_PREDICATES` includes `evidence_hash_manipulation`, exactly what the v2.36.21 implementer did |
| timeout accrues | **EXISTS** | `sed -n '3768,3781p' scripts/dispatch-hetero.sh` → `failure\|dirty → ambiguous` accrues; `no_verdict → runner_delivery` accrues |
| cannot-complete accrues | **DOES NOT EXIST — new work** | `sed -n '3800,3804p' scripts/dispatch-hetero.sh` → the `*)` arm returns 0 for "committed / no_op / question_suspected". A run that finishes having done nothing accrues **nothing** today. The owner named 「無法完成」 as a revocation cause, so this is scope, not a defect (§7 records the boundary). |

The corrected second row is the plan's largest change from R0 and was found by G1 (R16). It matters twice
over: the owner's "stand-in, not revocation" requirement is **new work**, and `on_engine_unavailable=ask`
is a **second, independent source** of the re-authorisation interrupts this plan exists to remove.

## 1.5 The unification (owner ruling 2026-09-11)

R0 treated "quota exhausted" and "seat caught cheating" as different problems. The owner ruled they are
the same problem: **the pinned seat is unusable right now**. Blocking would defeat unattended operation,
and continuing on a seat whose output cannot be read as evidence is worse. Both therefore take one path:

```
pinned seat unusable (quota exhausted | critical strike)
  → substitute from the ladder, keep running
  → pin is RETAINED (never silently revoked)
  → the evidence is queued durably for the next interactive turn / round-end
  → quota: auto-revert to the pinned seat after reset_at
  → ladder exhausted: halt honestly ("no engine available"), never "policy refused you"
```

Ordinary strikes do **not** substitute: the seat keeps working and the evidence is queued.

## 2. OKR / KRs

**Objective**: an operator-named seat dispatches without a re-authorisation round, and stays running
unattended when that seat becomes unusable; an autonomously-named seat keeps every gate it has today.

- **KR1** — A pinned seat with **no** scorecard row is admitted with `engine_assurance = 'operator-pin'`,
  no override file, and the check output records the pin (engine, runner, role, operator, reason). Red
  case: the same dispatch with the pin absent still refuses. (`pinned_at` dropped from R0 — it does not
  fit the frozen row shape, G1 R6.)
- **KR2** — **Anti-disable.** A table-driven byte-for-byte capture of **every** pre-change inadmissible
  row shape (no-row, `failed`, `provisional` inadmissible for the output kind, `requalify_required`
  ordinary, `requalify_required` critical, invalid override, expired override) still refuses, byte-identical
  to output captured from the pre-change build. Authored **before** any permissive code. An early-true
  mutation at each guard boundary must turn at least one named case red.
- **KR3** — A pinned seat with **ordinary** strikes at or over threshold is admitted; the check output
  carries `pending_revocation` with each active strike's `class`, `predicate_id`, `cause_class`,
  `receipt_ref`, `observed_at`. Red case: the same seat unpinned still refuses with `strikeReasonMessage`,
  byte-for-byte against the pre-change build.
- **KR4** — A **critical** strike on a pinned seat **substitutes** (§1.5): the resolver returns
  `effective_tuple` = the next admissible rung with `substitution_reason: critical_strike`, the dispatch
  proceeds on it in the **same invocation**, `pins.jsonl` and `topology.json` are byte-unchanged, and
  `pending_revocation` names the `predicate_id` (not merely the class — the shipped `strikeReasonMessage`
  names only the class). Red case: unpinned, the same seat still refuses.
- **KR5** — Quota exhaustion on a pinned seat substitutes by the **same** code path as KR4: no strike is
  written, `pins.jsonl` is unchanged, and after `reset_at` the next dispatch resolves back to the pinned
  seat with no operator action. Verified by advancing the clock over an already-written topology file,
  not by regenerating it.
- **KR6** — `pin-seat` / `unpin-seat` / `pins` are first-class verbs, validated by their **own** validator
  against their **own** `pins.jsonl`; the override validator still requires a real calendar date and
  `loadQualificationOverride` is never called for a pin. **Row = eight keys**:
  `(engine, runner, role, effort, endpoint, reason, operator, expires: null)`. *The earlier "same six keys
  as the override row, with effort derived from the ladder" design is **abandoned as provably impossible**
  (R2-G2 R6 ×2): KR1's whole point is admitting a seat with **no scorecard row**, and such a seat is by
  definition **not on the qualified-only ladder**, so there is nothing to derive `effort` / `endpoint`
  from.* The pin is therefore self-sufficient: it carries the full dispatch identity, which is also
  exactly what the effort-partitioned strike lookup needs — P9's `--effort low` now **matches** the pin row
  instead of contradicting it. `family` stays derived: it is a property of the engine, not an operator
  choice. At most one active row per `role`; a pin on an already-pinned role replaces it.
  **State model**: `pins.jsonl` is a snapshot of active rows only — no tombstones, no second schema.
  `pin-seat` and `unpin-seat` both rewrite it through a NEW `jsonl-store.writeSnapshot` (temp file +
  atomic rename) under `withWriteLock`; `appendRow` cannot express this and is **not** used for pins.
- **KR7** — `pending_revocation` is **durable and fully specified** (G2 R12): producer = the resolver,
  at the moment it computes the fold; store = the existing decision ledger under a new `kind:
  pending_revocation`; row = `{seat_hash, engine, runner, role, class, predicate_id, cause_class,
  receipt_ref, observed_at}`; row identity = the seat plus the sorted active strike
  `event_id` set, so re-running the same incident writes nothing new and a **new** strike produces a new
  row; rehydration = the round-end report **recomputes the fold** and reports every row whose event-id set
  is still active, so the queue is a projection of live evidence rather than a mailbox.
  **There is no acknowledgement verb** (R2 review R11: an ack would let an operator silence live evidence
  while the pin and the strike both remain in force). A row leaves the report exactly when its evidence
  leaves the authoritative fold — a passing requalification, a strike invalidation, or `unpin-seat` — and
  by no other means. Because the fold is the same one admission uses, invalidated / rejected-writer /
  duplicate / pre-baseline / future rows can never appear.
- **KR8** — When substitution exhausts the ladder, the run halts with "no engine available", naming the
  exhausted rungs. It never presents an unusable-seat halt as a qualification refusal.
- **KR9** — `substitute` joins the `on_engine_unavailable` enum and is selected **only when a live pin
  is present for the role**. A zero-pin host keeps `ask`, byte-identically (G2 R5 ×2: the R1 global
  default flip contradicted KR2's own zero-pin equivalence claim; narrowing preserves the owner's intent
  — a pinned seat never stops to ask — without changing any unpinned host).
- **KR10 — the resolver is the single acyclic seam.** One read-side live resolution entry point loads the
  cached scorecard ladder, then applies `pins.jsonl`, the active-strike fold and live quota **in memory**,
  and returns `{preferred_tuple, effective_tuple, substitution_reason, pending_revocation}` **before**
  contract admission. It never writes `topology.json` or `pins.jsonl`. `dispatch-contract.js` and every
  dispatcher consume and cross-check `effective_tuple`; none reads the pin store independently
  (G2 R11/R13/R15 — in R1 the `seat_unusable` signal was emitted downstream of the component that had to
  consume it, which is unimplementable).

- **KR11 — a pin admits only the seat it names.** `engine_assurance: 'operator-pin'` applies to
  `preferred_tuple` **only**. A substitute chosen by the resolver must pass **ordinary admission on its own
  merits** (qualified scorecard row, or its own pin); a rung that cannot is skipped, and if no rung passes
  the run takes the KR8 honest halt. Red case: pin seat A, mark it unusable, plant an **unqualified** seat
  B as the next rung → B is skipped, not admitted. (R2-G2 R10: without this, one operator pin silently
  becomes an admission bypass for an autonomously selected seat — the exact autonomy this plan preserves
  gates for.)
- **KR12 — substitution is decided before launch, never mid-flight.** The resolver runs at dispatch
  preflight; a failure discovered **after** the child launches is classified by the existing outcome path
  (strike accrual or an excluded cause) and changes the seat on the **next** dispatch, not the current one.
  Re-entering the resolver mid-flight is explicitly out of scope (§7). Acceptance asserts the **child
  process argv** carries `effective_tuple`'s engine/runner/effort — proving substitution reaches the
  process, not just the JSON (R2-G2 R12 ×2).
## 2.5 Global Constraints (copied verbatim into every dispatch)

- Node ≥ 20.10, built-ins only. No new dependency.
- ADR-0001 binding: no trust machinery. A pin is an operator preference record, NOT an attestation;
  nothing in this plan may add hash chains, witness receipts or tamper-evidence.
- The strike event log format is frozen — append-only, never rewrite a prior line. This plan reads
  strike rows and changes what admission does with them; it does not change how they are written.
- `EXTERNAL_CAUSE_EXCLUSIONS`, `CRITICAL_REEXAM_PREDICATES`, `STRIKE_WRITER_ALLOWLIST` and
  `ORDINARY_STRIKE_THRESHOLD` are frozen closed registries — do not add, remove or reorder members.
- No behaviour change on any path where the seat is not operator-pinned. A run with zero pins must
  produce byte-identical decisions to the pre-change build.
- The exam/scorecard/ladder remains the recommender when no pin exists — this plan must not delete
  or bypass `resolve-dispatch-topology.js` seat selection.
- `isAdmissibleScorecardRow` stays **pin-unaware** and keeps returning false on `requalify_required`.
  Pins are handled only in the `!matched` / strike-precedence branch **after** that false (G1 R10 — a
  pin-aware admission predicate is the return-true-too-early failure the anti-disable KR exists to stop).
- The pin is a **non-persisted live overlay** computed by the KR10 resolver, never written into
  `~/.autopilot/topology.json` or back into `pins.jsonl`. During a substitution both files stay
  byte-identical; only `effective_tuple` differs from `preferred_tuple`.
- **Acyclic protocol**: resolver → contract admission → dispatcher. Nothing downstream of the contract
  may emit a signal the resolver is required to consume.
- Two commits, never one: mechanism (code + tests) and guidance (SKILL/reference prose) are separate
  per `CLAUDE.md` mechanism-vs-guidance.

## 2.6 Change-policy decisions

- **Compatibility impact**: **behaviour-changing, opt-in by data. No default is flipped.**
  `--qualification-override` keeps working unchanged; `DEF_ON_ENGINE_UNAVAILABLE` stays `ask`; a host with
  **no pin observes no change at all**, which is KR2's byte-equivalence claim and is asserted, not argued.
  `substitute` is a new enum member that only a live pin can select (KR9). Two frozen Board rulings are **superseded, not reinterpreted** — KR6's
  `per-invocation` clause and the strike-precedence ruling — recorded here and pointed to at every code
  anchor (P0), including the `platforms/codex/plugin` mirror.
- **Dependency decision**: `none` — built-ins only; `pins.jsonl` uses `lib/jsonl-store.js`; the durable
  `pending_revocation` queue reuses the decision-ledger surface rather than adding a store.
- **scorecard-first waiver**: the guidance commit changes what the skills *ask for*, which `CLAUDE.md`
  normally gates on eval ON/OFF evidence. The owner ruling of 2026-09-11 is the waiver, recorded here
  rather than left implicit. The mechanism commit needs no waiver.

## 3. File-structure map

| File | Responsibility |
|---|---|
| `scripts/engine-capability-state.js` | NEW verbs `pin-seat` / `unpin-seat` / `pins` over a NEW `pins.jsonl` in the capability store dir, with their own validator (`expires` must be JSON `null`). NEW: extract the authoritative active-strike fold into one shared primitive so admission and `pending_revocation` derive from the same result (KR7). Strike **write** path untouched. |
| `scripts/dispatch-contract.js` | **Consumer only — it never reads `pins.jsonl` and never emits a substitution signal** (this is the G2 cycle fix, and R2 review found the old description still living here). `isAdmissibleScorecardRow` unchanged. It receives the resolver's `effective_tuple` + `pin` + `pending_revocation`, and decides: pin present and `effective_tuple == preferred_tuple` → admit as `operator-pin`; pin present with a `substitution_reason` → admit the **substitute** tuple and carry `pending_revocation`; no pin → every branch byte-identical to today, including the L1303 quota NO-GO. |
| `scripts/resolve-dispatch-topology.js` | Gains a **no-write live-resolution mode** (KR10): given the cached ladder it applies pin + active-strike fold + quota in memory and returns `{preferred_tuple, effective_tuple, substitution_reason, pending_revocation}`. The cached-generation path and ladder order are untouched; the cache stays qualification-only. |
| `scripts/resolve-review-loop.sh` | `substitute` joins the `on_engine_unavailable` enum and is chosen **only when a live pin exists** (KR9); `DEF_ON_ENGINE_UNAVAILABLE` stays `ask`. Emits `effective_*` alongside the existing `implementer_*` (which keep naming the preferred/pinned seat) so no consumer mistakes a stand-in for a preference. |
| `scripts/dispatch-hetero.sh`, `scripts/dispatch-review.sh` | Consume the one resolved tuple; surface `pending_revocation` in the dispatch preamble; emit the KR8 honest halt when the ladder is exhausted. |
| `scripts/decision-ledger.js` | New `kind: pending_revocation` row (KR7) and a round-end selector that **recomputes the authoritative fold** rather than reading a stored acknowledgement. No ack verb, no new store. |
| `scripts/lib/jsonl-store.js` | NEW `writeSnapshot(storeFile, rows)` — temp file in the same directory plus atomic rename, called under `withWriteLock`. The store today has only `appendRow`, which cannot express KR6's no-tombstone snapshot (R2 review R1/R6). Existing primitives untouched. |
| `platforms/codex/plugin/scripts/dispatch-contract.js` | Generated mirror — carries the same superseded-ruling pointer comment (G1 R8: the mirror still holds the stale absolute). |
| `project-config-template/task-class-config.md`, `.../review-loop-config.md` | Point the prose-only "user-owned candidate preference" block at the pin store; document `substitute`. |
| `skills/ceo-agent/references/depth0-control-loop.md`, `skills/dev-flow/SKILL.md`, `skills/engine-onboarding/SKILL.md`, `references/strike-decay.md` | **Guidance commit only.** Pinned → dispatch; unpinned → ladder recommends; unusable → substitute and queue the evidence. |
| `hooks/tests/*` | Every existing NO-GO assertion **splits into two** (pinned / unpinned). No assertion deleted. |

## 4. Phases

Every acceptance names file, command, expected output (G1 R19). `CAP=$(mktemp -d)` is the isolated
capability store; all fixtures set `ENGINE_CAPABILITY_DIR=$CAP`.

**P0 — Anchor re-derivation + supersession pointers (Fix, no dep).**
Re-derive the four §1 anchors plus `no_op`'s fall-through; correct §1 if any differs. Freeze an **anchor manifest**
`hooks/fixtures/supersession-anchors.json` listing the exact qualification-admission and strike-precedence
sites (file + symbol + the superseded ruling), **including every generated mirror**; a raw grep cannot tell
an applicable anchor from a mention (G2 R7). Add `scripts/check-supersession-anchors.js`: for each manifest
entry it requires a `superseded by owner ruling 2026-09-11` marker within a bounded line window of the named
symbol, and fails naming any entry without one. Pointer comments ride the mechanism commit; the frozen-plan
amendment note rides the guidance commit.
**Protected-region assertion** (R2-G2 R17): `dispatch-hetero.sh`'s strike-writer block
(`3765-3880`) and `check_mission_enforcement_gate` (`1411`) are §7 out-of-scope; the phase asserts those
line ranges are byte-unchanged via a pinned sha256 of each extracted region.
**Acceptance**: `node scripts/check-supersession-anchors.js` → exit 0; deleting any one pointer → exit
non-zero naming that manifest entry; `git diff --stat` for this step touches only `.js`/`.sh` comments plus
the new checker and manifest.

**P1 — Pin store + CLI (S, dep P0).** `pin-seat` / `unpin-seat` / `pins` over `pins.jsonl`, via
`lib/jsonl-store.js` append/read primitives. Operator attribution: `--operator` is **required** and
echoed back on the row (G1 R11); a call omitting it exits non-zero naming the missing field.
**Acceptance** (`hooks/tests/engine-capability-pin.test.sh`, new):
`node scripts/engine-capability-state.js pin-seat --engine gemini-3.8-flash-low --runner agy --role implementer --operator cookys --reason 'owner ruling' --store $CAP` → exit 0;
`… pins --role implementer --store $CAP` → one row, `expires: null`;
same call with `--expires 2026-12-01` → exit non-zero, stderr names `expires`;
same call without `--operator` → exit non-zero, stderr names `operator`;
`unpin-seat` twice → exit 0 both times (idempotent);
`grep -n 'withWriteLock\|writeSnapshot' scripts/engine-capability-state.js` → the pin mutation path names
both, and `grep -n 'appendRow' ` over that path is **empty** (a bare "imports jsonl-store" grep is already
green today and proves nothing; naming `appendRow` would contradict KR6's snapshot model);
**crash-atomicity case**: kill the process between temp-write and rename → `pins.jsonl` still parses and
still holds the pre-call row set;
**concurrency case**: two `pin-seat` calls for different roles launched in parallel → both rows present,
file parses, neither lost; **replacement case**: `pin-seat` twice on the same role → `pins` returns exactly
one row for it, carrying the second reason.

**P2 — Zero-pin capture + the KR10 resolver (S, dep P1).** Capture the pre-change decision bytes
**first**; then build the no-write resolver (`preferred_tuple` / `effective_tuple` / `substitution_reason`
/ `pending_revocation`) and its unit tests. **The resolver lands before any contract change** (R2-G2 R10:
R1 ordered the contract first, which forces pin reads into the admission predicate — the one thing §2.5
forbids). At this phase the resolver has no consumer; that is intended and is what keeps the seam acyclic.
**Acceptance**: zero-pin baseline captured and pinned; `node scripts/resolve-dispatch-topology.js
--resolve-live --role implementer --store "$CAP"` on a store with no pin → `preferred_tuple ==
effective_tuple`, `substitution_reason: null`, and `topology.json` mtime unchanged (no write).

**P2b — Contract consumes the resolver (S, dep P2).** KR1 + KR2 + KR11.
**Acceptance** (`hooks/tests/dispatch-contract-pin.test.sh`, new): `grep -n "pins.jsonl\|pin-seat"
scripts/dispatch-contract.js` → **empty** (the contract never reads the pin store; it consumes the
resolver's output). KR11 red case: pinned seat A unusable, unqualified seat B as next rung → B skipped,
not admitted. Plus a **branch-complete** table with one
named case per `false`-return boundary in `isAdmissibleScorecardRow` and per refusal branch in the
`!matched` path — not a fixed seven (G2 R10) — enumerated from the pre-change source and captured from an
immutable pre-change commit, each run through `node scripts/dispatch-contract.js check …` on the **pre-change** build with
stdout pinned into `hooks/tests/fixtures/zero-pin-baseline/`; after the change every one is byte-identical
(`diff -u` exit 0). Then a pinned no-row seat → exit 0 with `"engine_assurance":"operator-pin"` and the
pin echoed; pin removed → the baseline refusal bytes return.
Also assert the frozen registries are untouched (G1 R4):
`node -e` printing `EXTERNAL_CAUSE_EXCLUSIONS`, `CRITICAL_REEXAM_PREDICATES`, `STRIKE_WRITER_ALLOWLIST`,
`ORDINARY_STRIKE_THRESHOLD` → byte-identical to the pre-change print.

**P3 — Strike fold + pending_revocation (S, dep P2).** Extract the authoritative active-strike fold
(KR7); the resolver emits `pending_revocation` from it; KR3 admits in place, KR4 returns a substituted `effective_tuple`.
**Acceptance**: plant three ordinary strikes on a pinned seat → contract exit 0, `pending_revocation`
has 3 rows each with non-null `receipt_ref`; unpinned → refusal bytes match the P2 baseline exactly.
Plant one `critical_reexam_trigger` on a pinned seat → the resolver returns
`substitution_reason: critical_strike` with `predicate_id` present in `pending_revocation` (not
class-only), `preferred_tuple` still the pinned seat; unpinned → baseline refusal bytes.
Negative cases: an `invalidates_event_id`-invalidated row, a non-allowlisted writer row, a duplicate
`dedup_key`, a pre-baseline row and a future-dated row each appear in **neither** admission nor
`pending_revocation`.

**P4 — Substitution path (L, dep P3).** The single unusable → substitute path (§1.5) inside the KR10
resolver in `resolve-dispatch-topology.js`, plus the `substitute` enum member in `resolve-review-loop.sh`
selectable only under a live pin (`DEF_ON_ENGINE_UNAVAILABLE` stays `ask`); quota awareness; KR8 honest
halt.
**Acceptance**, split into the two halves G2 R13 showed R1 had conflated —
*(on-disk, must not change)*: reusing the **already-written** `topology.json` without regenerating it,
`implementer_ladder` still lists the pinned seat at its pre-exhaustion identity, and `pins.jsonl` is
byte-identical;
*(live, must name the substitute)*: the resolver's `effective_tuple` names the next rung with
`substitution_reason: quota_exhausted`, `preferred_tuple` still names the pinned seat, and
`resolve-review-loop.sh --field implementer_engine` still returns the **pinned** engine while
`--field effective_engine` returns the stand-in. No strike row is written.
Advance `--now` past `reset_at` → `effective_tuple` returns to the pinned seat with no operator action.
Same fixture with a critical strike instead of quota → identical substitution, `pins.jsonl` unchanged.
Ladder exhausted → exit names "no engine available" and the exhausted rungs, and does **not** contain
the qualification refusal string.
Negative controls: `decision-ledger.js` and `next-pick.js` write no last-used-engine field.

**P5 — Durable pending_revocation queue (S, dep P3).** KR7's cross-round durability.
**Acceptance**: a headless multi-round fixture — round 1 accrues the strike on a pinned seat and reaches
no operator; round 2 starts fresh; the round-end report still carries the `pending_revocation` rows with
`predicate_id` and `receipt_ref` intact. Deleting the queue write makes this test red.

**P6 — Dispatcher pass-through (Fix, dep P4/P5).** `dispatch-hetero.sh` + `dispatch-review.sh`.
**Acceptance**: `node scripts/dispatch-contract.js check --contract <f> --repo <r>` driven through the
dispatcher's own preflight on a planted pin → stdout matches
`grep -F '"engine_assurance":"operator-pin"'` (it is a Node CLI, not a shell script).
**KR12 argv assertion**: run the dispatcher against a pinned-but-unusable seat with the runner replaced by
a recording stub (`AUTOPILOT_RUNNER_BIN=<stub>`), then assert the recorded argv names `effective_tuple`'s
engine/runner/effort and **not** the pinned one — substitution must reach the process, not just the JSON
(R2-G2 R12);
`AUTOPILOT_QUALIFICATION_OVERRIDE=<file>` on an unpinned seat → the pre-change override behaviour,
byte-identical to the P2 baseline capture.

**P7 — Negation runs (Fix, dep P2-P6).** The red proof, as its own gate (G1 R14).
**Acceptance**: **one controlled mutant per shipping gate — KR1 through KR10, not a sample of three**
(R2 review R14). Each is recorded with its non-zero exit and the named assertion that failed, then
reverted and the suite shown green again. The mapping is frozen in
`hooks/fixtures/negation-matrix.json` (gate → mutation site → expected failing assertion), and the phase
fails if any shipping gate has no entry — so a gate added later cannot quietly ship without a red proof.

**P8 — Guidance commit (Fix, dep P0-P7).** All §3 guidance rows, **separate commit**.
**Acceptance**: a path **classifier** over `git show --name-only` for each commit — every path must match
an exhaustive allowed set for its side (mechanism: `scripts/`, `hooks/`, `platforms/**/scripts/`;
guidance: `skills/`, `references/`, `docs/`, `project-config-template/`, `platforms/**/skills/`), a
generated mirror classified with its source, and **any unclassified path fails** (G2 R8: a
"contains zero X" test passes when an unanticipated path appears);
`node scripts/check-claude-md-inventory.js && node scripts/check-reference-sizes.js && AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh` → 8/8.

**P9 — Real-data acceptance (Fix, dep P3, P8).** *(Frozen rubric R20 names this phase "P7"; R1 inserted
the negation-run phase, shifting the number. The rubric ID governs the requirement, and this phase is it —
recorded here rather than renumbering a frozen rubric, per G2 R20.)* Record the v2.36.21 incident against the
`agy` / `gemini-3.8-flash-low` implementer seat — a seat the owner pinned by name in that same run:
```
node scripts/engine-capability-state.js strike-seat \
  --engine gemini-3.8-flash-low --runner agy --role implementer --effort low \
  --class critical_reexam_trigger --predicate-id evidence_hash_manipulation \
  --cause-class engine_output --writer qualification_admin \
  --dedup-key 'v2.36.21:1488a268:evidence_hash_manipulation' \
  --detector-id depth0_evidence_audit --detector-version 1 \
  --artifact-sha256 "$(git show 1488a268 | sha256sum | cut -d' ' -f1)" \
  --receipt-ref 'commit=1488a268 evidence-discipline=§31' --store "$CAP"
```
`--effort low` is required: the seat identity is effort-partitioned, and omitting it writes a row that
never matches the dispatched tuple (G2 R20). `artifact_sha256` is derived from the cited commit, never
hand-written.
**Acceptance**: `CAP=$(mktemp -d); cp -r ~/.autopilot/engine-capability/. "$CAP"` — every command in this
phase passes `--store "$CAP"`, and the phase asserts `~/.autopilot/engine-capability` is byte-unchanged at
the end (R2 review R20: the previous wording never actually pointed the run at the copy). Establish the
live pin the substitution needs: `pin-seat --engine gemini-3.8-flash-low --runner agy --role implementer
--operator <owner> --reason 'v2.36.21 owner pin' --store "$CAP"`. Then write the strike above and run the
dispatch: `effective_tuple` names the next ladder rung with `substitution_reason: critical_strike`,
`preferred_tuple` still names the pinned seat, `pins.jsonl` is byte-unchanged, and the report carries
`evidence_hash_manipulation` with the `1488a268` receipt. Only after that passes is the same strike
written to the real store, as the record of the incident.

## 5. Test / validation

**Script-gated**: KR1-KR9. The load-bearing shape is the **anti-disable pair** — every permissive
assertion ships beside the unpinned assertion it must not break, and P2's baseline capture makes
"unchanged" mechanical rather than argued. P7 is the red proof and is a phase, not prose
(`references/evidence-discipline.md` §9 family: a suite that stays green with the change reverted is not
evidence).

**Human-gated**: the legibility of the operator question in P6 — whether the evidence rows are enough to
decide on; and P9's real-data outcome.

**Full-suite**: `timeout 3400 bash hooks/tests/run.sh --parallel 4` against the recorded baseline fail
set; `AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh` 8/8.

## 6. Risks + inversion

- **Admission is silently disabled for everyone** — the highest-probability failure. Mitigations:
  `isAdmissibleScorecardRow` stays pin-unaware (§2.5); KR2 is a seven-shape byte-identity table captured
  from the pre-change build; P7 runs **one controlled mutant per guard boundary**, each recording the named assertion that fails.
- **The pin becomes a rerun-until-green escape**, what the 2026-08-22 ruling guarded. Mitigations: pins
  require `--operator`; `pending_revocation` is never suppressible; a critical strike **removes the seat
  from this run** by substitution, so re-running never reaches it without the operator re-pinning.
- **Substitution hides a failing seat forever** — it substitutes every round and nobody notices the pinned
  seat is never used. Mitigations: KR7's durable queue reaches the round-end report; KR8 makes exhaustion
  loud.
- **The stand-in leaks into preference.** Mitigation: non-persisted overlay (§2.5); P4 asserts against an
  already-written `topology.json`, not a regenerated one.
- **Scope grew with Q4** — the substitution path is new work, and P4 is the only L-size phase. Inversion:
  if P4 exceeds its estimate, P0-P3 + P8 still ship a coherent slice (pin admits, strikes queue evidence)
  and P4 becomes its own plan. The §1.5 unification is what makes that split safe — both consumers reach
  the same substitution seam.
- **Prose and mechanism ship together and neither meets its bar.** Mitigation: P8 asserts commit
  disjointness mechanically.

## 7. Out of scope

- `check_mission_enforcement_gate` (`dispatch-hetero.sh:1411`) — mission mode, a different axis.
- The `skill_transport: native` precondition die (`dispatch-hetero.sh:2302`) — an honest refusal.
- Strike detectors and writers. No general "hallucination" detector: `evidence_hash_manipulation` covers
  the mechanically-checkable case; the rest is depth-0 / reviewer judgment via `--writer qualification_admin`.
- The exam harness itself. It keeps producing recommendations; only its authority over an operator-named
  seat changes.
- A full per-class routing engine behind `task-class-config.md`.
- `ask` / `wait-reset` semantics for `on_engine_unavailable`, and the **default itself** — `ask` stays the
  zero-pin default; `substitute` only activates under a live pin (KR9).
- **Making `no_op` / `question_suspected` accrue a strike.** Re-derived at `dispatch-hetero.sh:3800-3804`:
  they are conclusively excluded today, so the owner's 「無法完成」 revocation cause has no mechanism. Adding
  one means changing the strike **writer**, which §2.5 freezes for this plan. Recorded as a BACKLOG
  candidate with a stated trigger, not smuggled in here.
- **Mid-flight re-resolution.** A seat that becomes unusable *after* its child launches keeps running to
  its outcome; the substitution applies from the next dispatch (KR12). Killing and re-launching mid-run is
  a different feature with its own partial-work semantics.
- **Text-only quota failures.** Only host-corroborated quota is excluded from accrual (§1). Trusting a
  runner's own prose about its own failure is what that design deliberately refuses; changing it is a
  separate threat-model decision.

## 8. Owner rulings (§8 questions, all resolved 2026-09-11)

- **Q1 — critical strike on a pinned seat**: **RULED — substitute, do not refuse.** The owner's objection
  to R0's recommendation was that blocking defeats unattended operation. Refusing and continuing-on-a-liar
  were a false pair: the third option is the one already approved for quota. See §1.5. The pin is retained;
  the evidence is queued; the operator re-pins nothing unless they choose to.
- **Q2 — pin location**: **RULED — machine (`~/.autopilot/`)**, alongside the capability store. A pin names
  a locally-installed runner+engine; a project-level pin would be read by peers who cannot run that seat.
- **Q3 — pin granularity**: **RULED — per-role, machine-wide**, matching the existing seat identity
  (engine+runner+role). Revisit only on a real two-project conflict.
- **Q4 — quota stand-in in scope?**: **RULED — yes.** `ask` was a second source of the interrupts this
  plan removes. The owner's 2026-09-11 wording was "flip the default"; R2 review then showed a **global**
  flip contradicts KR2's zero-pin byte equivalence (four independent findings). Narrowed accordingly:
  `substitute` activates **only under a live pin**, `DEF_ON_ENGINE_UNAVAILABLE` stays `ask`. The owner's
  intent — a pinned seat never stops to ask — is fully served, since an unpinned host has no seat of the
  owner's to protect.

No open questions remain. G2 reviews a plan with no unresolved Board input.

## Review log

- **R0** authored 2026-09-11 by depth-0. `logical_plan_id`: `operator-pin-supersedes-qualification-2026-09-11`.
  Rubric: `docs/plans/2026-09-11-operator-pin-supersedes-qualification.rubric.md` (20 IDs, frozen).
  Manifest: `docs/plans/2026-09-11-operator-pin-supersedes-qualification.plan-review-manifest.json`.
- **G1** 2026-09-11, 3 seats, all transports complete. Verdict **CONDITIONAL**
  (`policy_reason: depth_0_adjudication_required`); seat verdicts grok CONDITIONAL, MiniMax **STOP**,
  sol **STOP**. 31 findings / 22 candidate blockers. Artifact:
  `~/.autopilot/plan-review/8a26bb28a506a0ac89f7fe42681e4416e6f9403178f386b8637e1bae5d06087e/generation-01.json`.
  Full findings + every depth-0 disposition:
  [`evidence/2026-09-11-operator-pin-supersedes-qualification/g1-dispositions.md`](evidence/2026-09-11-operator-pin-supersedes-qualification/g1-dispositions.md).
  Summary: **20 accepted** (incl. the §1 factual correction, pin-unaware admission predicate, two
  validators, non-persisted overlay, authoritative strike fold, predicate naming, full zero-pin matrix,
  two-commit split incl. the Codex mirror); **2 refuted** (reviewer-attestation acceptances — ADR-0001
  forbids treating a recorded reviewer claim as evidence; replaced by depth-0 re-derivation with the
  command recorded, which is how the §1 error was actually found); **3 escalated to the owner** and ruled
  in §8. R1 folds all of the above.
- **G2** 2026-09-11, same 3 seats, all transports complete. Verdict **CONDITIONAL**, `terminal: true`
  (`policy_reason: generation_cap_requires_depth_0_adjudication`); seat verdicts grok **STOP**, MiniMax
  CONDITIONAL, sol **STOP**. 25 findings / 17 blockers. Growth 1.435 (warn 1.25, stop 1.5 — under the stop).
  Artifact: `~/.autopilot/plan-review/8a26bb28…/generation-02.json`. Full adjudication:
  [`evidence/…/g2-dispositions.md`](evidence/2026-09-11-operator-pin-supersedes-qualification/g2-dispositions.md).
  **All 17 accepted, zero deferred, zero refuted.** The three that changed the design: (1) KR9's global
  default flip contradicted the plan's own zero-pin equivalence — `substitute` now activates only under a
  live pin; (2) R1's `seat_unusable` signal was emitted downstream of the component required to consume it
  — replaced by the KR10 read-side resolver returning `preferred_tuple` / `effective_tuple`; (3) two more
  §1 anchors were wrong — `no_op` is conclusively excluded (so 「無法完成」 has no mechanism today, now §7)
  and the quota exclusion covers host-corroborated quota only.
- **Freeze**: generation cap reached, no G3. Freeze predicate satisfied — zero unrepaired mechanism-level
  findings, zero deferred blockers, zero open Board questions. R2 is the implementation baseline.
