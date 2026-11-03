# Blind review redesign — cut 1a-B: the engine hands every managed review its packet, and the receipt says which one

> Status: draft for plan hetero loop · Size: L · Base: `bee8da3d` (v2.36.60) · Parent plan:
> `docs/plans/2026-09-16-blind-review-packet.md` (cut 1a-A, shipped v2.36.59) — its §1 defines the
> packet; this plan does not restate it. Evidence dir: `docs/plans/evidence/2026-09-17-blind-review-packet-engine/`
> (`base-suites-bee8da3d.txt` = §4.1 run at base; plan-review artifacts land there after each generation).

## 0. What is actually true today (verified 2026-09-17, base `bee8da3d`)

- `dispatchReview` (`src/runners/review.js:200-270`) builds a packet only when the caller passes
  `options.packet = { repo, baseSha, candidateSha }` together with `blindDiscovery: true`;
  `dispatchReviewJson` returns `packet: { packet_hash, entries_count, denied_paths }` on the success
  branch and `packet: null` on every other branch (1a-A). No caller passes `options.packet`: both
  engine `reviewOptions` sites (`autopilot-engine.js:4900` in the campaign `performReview` closure of
  `_runManagedCampaignComposition`, `:9791` at the `_runImplementationReviewLoop` terminal site) send `{ ...input.reviewOptions, cwd: loopCwd,
  blindDiscovery: true }` and nothing else. So every managed seat is still reviewed on the legacy
  copy (`diff.file.input` / `spec.file.input`) of the WHOLE-tree diff — verdict carriers ride in.
- `reviewDiff` (`:2945`) returns `{ status, verdict, roster, resolveResult, reviewResult, review,
  reviewArgs, ledger, … }`; `reviewResult.packet` is present inside `reviewResult` but nothing reads
  it. The campaign `performReview` (`:4768`, inside `_runManagedCampaignComposition`) returns `{ reviewed: true, verdict, findings,
  review_digest, review_input_mode: 'full_diff_generation', blind_discovery: true,
  prior_findings_included: false, full_diff_required: true, raw }` — no packet identity.
- `finalPanelSeatReceipt` (`:5053`) writes a closed body of 12 keys plus optional `raw_log` (failed
  seats only, v2.36.57); `receipt_digest = canonicalDigest(body)`. `campaign-composition.js:318-420`
  (`FINAL_PANEL_SEAT_KEYS`, `hasFinalPanelSeatKeys`, `validateFinalPanelReceipt`) allows exactly
  those keys (`raw_log` as the one optional) and `schemas/implementation-campaign-receipt.schema.json`
  `$defs/finalPanelSeat` is `additionalProperties: false` with `raw_log` optional. The codex mirror
  holds byte copies of `src/engine/*` and `schemas/*` (`sync-codex-plugin-skills.sh --mirror-roots-json`
  lists `src`, `schemas`, `references`).
- The diff every managed review sees is `defaultDiffProvider` (`:1810`): `git diff --no-ext-diff
  --no-textconv <base>..<commit>` with `base` = the campaign's immutable base for EVERY generation
  (`prepareReview` `:4712` passes `base`, not `currentBase`) and `commit = candidate.commit`; the
  terminal site uses `immutableBase` and the round's `commit`. The packet builder regenerates that
  exact command in `repo` and fails closed on any byte difference (`diff not canonical`), so the
  packet's `(baseSha, candidateSha)` must be exactly those two values and `repo` must hold both
  objects — `loopCwd` (the repository the campaign runs in; candidate worktrees share its object store).
- Eight suites hand-build final-panel seat receipts without `raw_log` (state, routing, receipt,
  dogfood, status-task, qc-panel-honesty, next-touch-validation, controller-execution-independent);
  every one stubs `reviewDispatcher`, so the real `dispatchReview` — and therefore any packet — never
  runs inside them. A stubbed dispatcher result carries no `packet` key.

## 1. Ruling and shape

1. **Every managed review dispatch requests a packet — or does not dispatch.** Both engine sites
   pass `reviewDiff` a new input `packet: { repo: loopCwd, baseSha, candidateSha }` where `baseSha`
   is the value `diffProvider` was called with as `base` (campaign `performReview`: `base`;
   terminal site: `immutableBase`) and `candidateSha` is the `commit` it was called with
   (`candidate.commit` / `commit`) — read from the same two variables, never `currentBase`, never
   a tree sha. There is NO fallback: if either is not a non-empty string the site returns its
   existing blocked shape (`reviewed: false` / `finish({ status: 'blocked' })`) with `phase:
   'prepare_review'`, `reason: 'review packet identity unavailable'` BEFORE `reviewDiff` is called,
   so the legacy whole-diff copy can never run for a managed review. `noReviewSpec` needs nothing:
   the runner already writes a zero-byte `packet/spec.md` when no `--spec-file` arg is present
   (1a-A §1.2).
1b. **`reviewDiff` owns the dispatcher's `packet` option.** In the block that builds
   `reviewOptions` (`:3366-3378`), `delete reviewOptions.packet` ALWAYS (a caller's
   `input.reviewOptions.packet` never reaches the dispatcher), then set `reviewOptions.packet`
   from `input.packet` ONLY when BOTH `reviewOptions.blindDiscovery === true` AND `input.packet`
   is an object with three non-empty strings — a non-blind dispatch never carries the key even
   when `input.packet` is supplied; a present-but-malformed `input.packet` is a `prepare_review`
   block (`reason: 'packet must be { repo, baseSha, candidateSha }'`) regardless of blind mode. A
   direct call without `input.packet` (CLI `engine review`, tests) dispatches without the key
   exactly as at base.
2. **`reviewDiff` surfaces the packet identity.** The success return (`:3429`) gains
   `packet: reviewResult.packet` ONLY when `reviewResult.packet` is an object whose `packet_hash`
   is 64 lower-case hex; otherwise the key is ABSENT (never `null`), so a stubbed dispatcher
   leaves every `reviewChain` entry byte-identical to base. Blocked returns and ledger entries
   are unchanged.
3. **`performReview` returns `packet_hash`.** The `reviewed: true` return (`:5040`) gains
   `packet_hash: reviewed.packet.packet_hash` when `reviewed.packet` is non-null, else the key is
   ABSENT (not `null`). Failure returns are unchanged. `review_digest` preimage is unchanged
   (parent plan §3: durable replay binding refuted for this cut).
4. **The seat receipt carries the hash only when it has one.** `finalPanelSeatReceipt`: when
   `outcome.reviewed === true` AND `typeof outcome.packet_hash === 'string'` AND it is 64 hex,
   `body.packet_hash = outcome.packet_hash` (inside the digested body, like `raw_log`). A failed
   seat never gets the key even if `outcome.packet_hash` exists. Legacy stubbed runs produce the
   base receipt byte-for-byte.
5. **The panel asserts one hash — twice, independently (ADR-0001).**
   - Engine (`performFinalPanel`): after seats run, collect `packet_hash` over
     `reviewedOutcomes`. If SOME reviewed outcomes have it and others do not → `reviewed: false`,
     `verdict: null` (same shape as `findingsConsistent === false`). If two or more DISTINCT values
     → `reviewed: false`. All-absent (legacy) or all-equal → unchanged behaviour. The panel
     object itself gains NO new key (the adapter only reads `sealed_min_panel_size`,
     `final_panel_count`, `final_panel_seat_receipts`; the per-seat receipts already carry the
     hash and the validator proves agreement). `final_panel_count` still counts reviewed seats
     (the inconsistency is a panel-level refusal, like findings inconsistency).
   - Validator (`campaign-composition.js` `validateFinalPanelReceipt`): `FINAL_PANEL_SEAT_OPTIONAL_KEYS
     = Object.freeze(['raw_log', 'packet_hash'])` replaces the inline `'raw_log'` allow-set. Rules,
     checked after the per-seat loop that already exists: a seat with `packet_hash` that is not
     64 lower-case hex → `final_panel_metadata_incomplete`; a NON-reviewed seat carrying
     `packet_hash` → `final_panel_metadata_incomplete`; among `status === 'reviewed'` seats, some
     with and some without → `final_panel_packet_hash_mixed`; two distinct values →
     `final_panel_packet_hash_mismatch`. All-absent stays valid (legacy receipts). New reason
     codes need no registration elsewhere: at base `final_panel_below_minimum` is referenced only
     by the validator itself and `qc-panel-honesty.test.sh` (no reason enum exists).
   - Schema: `$defs/finalPanelSeat.properties.packet_hash = { "$ref": "#/$defs/sha256" }`, NOT in
     `required`, `additionalProperties` stays `false`; codex mirror regenerated.
6. **Nothing else moves.** `dispatch-review.sh`, the intake predicate, `BLIND_DISCOVERY_CAPABLE_RUNNERS`,
   the resolver, the deny-list, `review-packet.js`, `review.js` are byte-identical to `bee8da3d`.
   No new CLI flag, resolver field, config knob, ledger entry or event type. In-rail (non-final)
   reviews get the packet (1.1) but record nothing new: their `packet_hash` reaches the ledger
   only through the existing `raw` object.

## 2. Changes by file

- `src/engine/autopilot-engine.js` (+ mirror): §1.1 at `:4900` and `:9791`; §1.2 at `:3429`; §1.3
  at `:5040`; §1.4 in `finalPanelSeatReceipt`; §1.5 engine half in `performFinalPanel`. A
  single helper `packetHashOf(value)` → 64-hex string or `null` may be added at module level.
- `src/engine/campaign-composition.js` (+ mirror): §1.5 validator half; export
  `FINAL_PANEL_SEAT_OPTIONAL_KEYS` next to the existing exports.
- `schemas/implementation-campaign-receipt.schema.json` (+ mirror): §1.5 schema line.
- Tests (each change-pinning block starts `# RED at base bee8da3d: <observed message>` quoting
  the base run; preservation guards labelled `(preservation, green at base)`; stubs only — no real
  reviewer runs, no real `git` packet build in the engine suites):
  - `hooks/tests/autopilot-engine.test.sh`: (a) `reviewDiff` with a stubbed `reviewDispatcher`
    that returns `packet: { packet_hash: 'a'×64, entries_count: 3, denied_paths: [] }` → result
    `packet.packet_hash === 'a'×64` (RED at base: `packet` undefined); a stub returning no
    `packet` key, or `packet: { packet_hash: 'zz' }` → the result has NO `packet` key
    (`hasOwnProperty` false; preservation).
    (b) the existing `noReviewSpec` fixture (`createEngine(noReviewSpec)` ~`:4052-4136`, which
    already captures the terminal-site review args) extended to capture the `options` argument:
    both the spec and no-spec runs receive `options.packet` deep-equal to `{ repo: <loopCwd>,
    baseSha: <base>, candidateSha: <commit> }` with `options.blindDiscovery === true` (RED at
    base: `packet` undefined) — the fixture's `loopArgs` carry `reviewOptions: { packet: { repo:
    '/bogus', baseSha: 'bogus', candidateSha: 'bogus' } }` and the dispatcher must see the
    engine-derived tuple, not it (RED at base: the bogus tuple is forwarded); a direct
    `reviewDiff` call with `reviewOptions: { blindDiscovery: false, packet: { repo: '/bogus', … } }`
    and no `input.packet` reaches the dispatcher with NO `packet` key (RED at base: forwarded);
    `reviewDiff` with `input.packet: { repo: 'x' }` (malformed) → `status: 'blocked'`, `phase:
    'prepare_review'`, dispatcher never called; a direct `reviewDiff` with a WELL-FORMED
    `input.packet` and `reviewOptions: { blindDiscovery: false }` reaches the dispatcher with NO
    `packet` key (pins the blind-only gate of §1.1b; green at base because `input.packet` is
    ignored there — labelled as such). (b2) the managed campaign path with a stubbed
    `diffProvider` and a candidate whose `commit` is missing cannot be produced through the public
    API, so the fail-closed branch is pinned at the `reviewDiff` boundary (malformed `input.packet`
    above) and by reading: both sites derive the tuple from the variables already required to be
    strings by `prepareReview` / the terminal round.
  - `hooks/tests/implementation-campaign-routing.test.sh`: (c) the `proofPanel` red-path fixture
    (~`:2438-2478`, `proofRoster` with two `cc-shim` seats qualified through `fallback_ladder`,
    where the REAL `performReview` / `finalPanelSeatReceipt` run and each seat's envelope is
    controlled per call) gains a `packetHashes` knob on the transport stub (`packet: { packet_hash,
    entries_count: 1, denied_paths: [] }` or no key): equal hashes → panel `reviewed: true` and
    both seat receipts carry that value inside the digested body
    (`canonicalDigest(bodyWithoutReceiptDigest) === receipt_digest` re-computed in the test);
    distinct → `reviewed: false`, `verdict: null`, `final_panel_count: 2`; one with / one
    without → `reviewed: false`; both without → `reviewed: true` and NO `packet_hash` key on
    either receipt (deep-equal to the receipt the same inputs produce at base). Every campaign
    `reviewDispatcher` call in that fixture receives `options.packet` with `baseSha === base` and
    `candidateSha` = the reviewed commit (RED at base: `packet` undefined).
  - `hooks/tests/implementation-campaign-receipt.test.sh` (next to the `raw_log` block ~`:951-1035`
    — copy its idiom): reviewed seat with `packet_hash: 'b'×64` validates (RED at base:
    `final_panel_metadata_incomplete` — the unknown-key guard); `packet_hash: 'B'×64` (upper) and
    `'b'×63` → `final_panel_metadata_incomplete`; a `no_verdict` seat with `packet_hash` →
    `final_panel_metadata_incomplete`; two reviewed seats (distinct tuples) with `'b'×64` and
    `'c'×64` → `final_panel_packet_hash_mismatch`; one with, one without →
    `final_panel_packet_hash_mixed`; both without → passes (preservation); tampering `packet_hash`
    after digesting → `final_panel_receipt_digest_mismatch`. Schema: a document with a reviewed
    seat carrying `packet_hash` validates (RED at base: exit 2), with `packet_hash: 'zz'` is
    rejected, `seat-extra-key.json` stays rejected (preservation).
  - `hooks/tests/implementation-campaign-dogfood.test.sh`: the kill→resume campaign (~`:660-770`,
    it already captures `reviewArgsSeen`) also captures the dispatcher `options`; asserts every
    call carried `packet.repo === repo`, `packet.baseSha === base`, `packet.candidateSha ===
    candidate` (RED at base: `packet` undefined) and, because the stub returns no `packet`, the
    terminal receipt's seat has no `packet_hash` key and the run still converges (preservation).
- Docs: `references/blind-dispatch.md` (+ mirror) "Packet blinding (v2.36.59)" section gains one
  paragraph "Engine wiring (v2.36.61)": every managed review is packet-backed, the seat receipt's
  optional `packet_hash`, the mixed/mismatch rules, and the pointer to cut 1b for the cleanroom
  tier. `docs/BACKLOG.md`: the redesign row's Context becomes EXACTLY `packet (tree + git diff +
  spec, deny-list); packet/cleanroom tiers; intake canary; verify-once; parallel seats. Cuts 1a-A
  (v2.36.59) and 1a-B (v2.36.61) shipped; 1b/2 open. Detail in the pointer.` (Status `open`);
  `check-backlog-entries.js` exits 0. `CHANGELOG.md` and version manifests are NOT sealed
  (depth-0 release commit after the merge; `v2.36.61` in text is a pin as in v2.36.53–60).

### 2.5 Sealed `output_paths` (exact)

```
src/engine/autopilot-engine.js
platforms/codex/plugin/src/engine/autopilot-engine.js
src/engine/campaign-composition.js
platforms/codex/plugin/src/engine/campaign-composition.js
schemas/implementation-campaign-receipt.schema.json
platforms/codex/plugin/schemas/implementation-campaign-receipt.schema.json
hooks/tests/autopilot-engine.test.sh
hooks/tests/implementation-campaign-routing.test.sh
hooks/tests/implementation-campaign-receipt.test.sh
hooks/tests/implementation-campaign-dogfood.test.sh
references/blind-dispatch.md
platforms/codex/plugin/references/blind-dispatch.md
docs/BACKLOG.md
```

Every path exists at base; nothing is created.

### 2.6 Global constraints (copied verbatim into every dispatch)

- `packet` is requested with the SAME `(base, commit)` pair `diffProvider` received — never
  `currentBase`, never a tree sha — and `repo` is `loopCwd`; otherwise the runner's canonical-diff
  check fails closed and the seat records `transport_failed` (that is correct behaviour, not a bug
  to route around).
- Optional keys on a seat receipt live INSIDE the digested body; `packet_hash` is never `null`,
  never present on a non-reviewed seat, never present when the dispatcher returned no packet.
- Reviewed seats agree on one `packet_hash` or the panel is not reviewed; the engine and the
  validator each decide this from their own inputs (no shared flag).
- No change to `review_digest`, ledger entries, campaign events, `dispatch-review.sh`, `review.js`,
  `review-packet.js`, the intake predicate, the resolver, any schema other than the one line above.
- Stubs return whatever `packet` the test dictates; no engine suite builds a real packet.
- `scripts/**`, `bin/autopilot.js`, `src/runners/**` byte-identical to `bee8da3d`.

## 3. Out of scope

- Cut 1b (cleanroom tier, `bwrap` launcher, intake canary, runner `tools` column, configurable
  deny-list, codex back on the panel) and cut 2 (verify-once, concurrent seats, standby, snapshot).
- Binding `packet_hash` into `review_digest` or the durable replay digest (parent plan §3).
- Recording `packet_hash` for in-rail (non-final) reviews anywhere durable, or a new ledger/event
  field for it — the raw dispatcher result already carries it; a durable field is a cut-2 question.
- Rail defect (2): graph-check admits `max_wall_seconds` 14400 while the contract schema caps 7200
  (BACKLOG, a ruling).
- Changing the eight receipt-building suites: `packet_hash` is optional, so they stay untouched.

## 4. Acceptance

| id | criterion | evidence |
|----|-----------|----------|
| `engine-packet-request` | every campaign and terminal-site `reviewDispatcher` call carries `options.packet = { repo: loopCwd, baseSha: <diffProvider base>, candidateSha: <diffProvider commit> }` with `blindDiscovery: true`, even when the caller's `reviewOptions` carried a bogus `packet`; a missing identity blocks BEFORE the dispatcher is called; a direct `reviewDiff` without `input.packet` forwards no `packet` key even when `reviewOptions.packet` is supplied | autopilot-engine suite (b), routing suite (c), dogfood suite |
| `packet-identity-surfaced` | `reviewDiff` returns `packet` (object with 64-hex `packet_hash`) only when the dispatcher returned one — otherwise the key is ABSENT (never `null`; `hasOwnProperty` asserted both ways); `performReview` returns `packet_hash` only when present; seat receipt carries it inside the digested body only for reviewed seats that have one | autopilot-engine suite (a), routing suite (c) |
| `panel-one-hash` | engine: mixed or distinct hashes across reviewed seats → `reviewed: false`; validator: `final_panel_packet_hash_mixed` / `final_panel_packet_hash_mismatch`; non-reviewed seat with the key, non-hex, or upper-case → `final_panel_metadata_incomplete`; tamper → `final_panel_receipt_digest_mismatch`; all-absent valid | routing suite (c), receipt suite |
| `schema-parity` | receipt schema accepts a reviewed seat with 64-hex `packet_hash`, rejects `'zz'`, still rejects an unknown key; codex mirror in sync | receipt suite, `sync-codex-plugin-skills.sh --check` |
| `no-regression` | each of the thirteen commands in §4.1 exits 0 at the candidate (run from the repository root of a checkout of the candidate commit on a temporary branch, one at a time, never in parallel); the same thirteen were run at `bee8da3d` before sealing and their exit codes and summary lines are recorded in `docs/plans/evidence/2026-09-17-blind-review-packet-engine/base-suites-bee8da3d.txt` (committed with this plan) | suite output + evidence file |
| `scope-integrity` | `git diff --name-only bee8da3d HEAD` ⊆ §2.5 plus committed plan/mission docs; `scripts/**`, `bin/autopilot.js`, `src/runners/**` byte-identical to `bee8da3d`; no test file created | command output |

### 4.1 No-regression commands (exact; also the graph's `verification_commands`)

```
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/implementation-campaign-receipt.test.sh
bash hooks/tests/implementation-campaign-dogfood.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/implementation-campaign-routing.test.sh
bash hooks/tests/controller-execution-independent.test.sh
bash hooks/tests/qc-panel-honesty.test.sh
bash hooks/tests/status-task.test.sh
bash hooks/tests/next-touch-validation.test.sh
bash hooks/tests/review-runner.test.sh
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
```

Expected exit status 0 for every line; suites print `PASS [<name>] N assertions`.

## 5. Dogfood proof (depth-0, after merge)

Run a real `engine implement-review` campaign on this repo (the next cut's own campaign qualifies):
the terminal receipt's `final_panel_seat_receipts` each carry the same 64-hex `packet_hash`, the
seat's `raw_log`-less reviewed body re-digests, and a manual `buildReviewPacket` at depth-0 with the
receipt's `(base_sha, candidate)` reproduces that hash. If the campaign's final panel dies, the
first thing read is each seat's `--timeout` (v2.36.60) and `packet` in `raw`.

## 6. Risks + inversion

- **Canonical-diff refusal on a live campaign.** If any engine path hands `diffProvider` a base
  other than the one it passes to the packet, every seat fails `diff not canonical` →
  `transport_failed`. Mitigation: the pair is read from the same two variables at each site (§1.1)
  and the dogfood fixtures pin `baseSha === base` at the resume path (the only one with a stubbed
  `diffProvider`). Inversion: a seat that fails closed is preferable to one reviewed on an
  unproven diff.
- **Optional-key drift.** A hand that puts `packet_hash: null` or adds it to failed seats breaks
  eight suites' deep-equals; the rules in §1.4 and the receipt-suite negatives pin it.
- **Packet build failure on a live seat.** The runner never launches the reviewer; `reviewDiff`
  blocks on the transport shape and the seat records `transport_failed` with NO `raw_log` — the
  builder's message (`diff not canonical`, `tree integrity: …`) is in `raw.reviewResult.error` of
  the run output; that is where field debugging starts.
- **Cost.** Every review dispatch now pays the packet build (~21 s for 4236 files on this host)
  BEFORE the seat's `--timeout` clock starts — outside the seat timeout, inside the campaign wall
  budget; four to five builds per campaign. Mitigation is the hash-batching BACKLOG row (S), not
  this cut.
- **Panel refusal on inconsistent hashes.** Two seats reviewing the same candidate get the same
  packet by construction (pure function of base, tree, spec, deny-list); a mismatch means a bug
  or a mid-panel repo mutation and MUST stop the campaign — the engine refusal is a feature.
- **Hand scope.** Three product files (+3 mirrors), four test files, two docs — one round.

## 7. Where this sits

Parent plan §7: 1a-A (shipped) → **1a-B (this)** → 1b → 2. After merge: BACKLOG redesign row
Context updated (§2), `record-integration.js`, reap, lifecycle receipt, HANDOFF.

## Review log

- Unknown-escalation probe 2026-09-17 (`ladder-classify.json` in the evidence dir): every design noun had
  local hits → U0, no consult dispatched (dev-flow L-2 rule).
- Plan hetero loop G1 2026-09-17 (GLM-5.2 READY, gpt-5.6-sol STOP 4 blockers; evidence `g1-*`,
  as-reviewed bytes `plan.as-reviewed-g1.md`): all four accepted — (R1) the "both SHAs non-empty
  else no packet" fallback let a managed review fall back to the whole-diff copy → §1.1 now blocks
  before dispatch with `review packet identity unavailable`; (R1) `reviewDiff` forwarded a caller's
  `reviewOptions.packet` → §1.1b deletes it always and sets the key only from the engine-derived
  `input.packet`, tests (b) supply a bogus caller packet on both paths; (R2) §4 said `null` while
  §1.2 said absent → absent, `hasOwnProperty` both ways; (R8) no-regression named suites, not
  commands, and no base evidence → §4.1 lists the thirteen exact commands and
  `base-suites-bee8da3d.txt` records their base run (next-touch-validation re-run on a temp branch:
  it dies on a detached HEAD, as the l5 recipe warns).
- Plan hetero loop G2 2026-09-17 (terminal at the generation cap; gpt-5.6-sol READY, GLM-5.2
  CONDITIONAL 1 non-blocking; evidence `g2-*`, `plan.as-reviewed-g2.md`): accepted at depth-0 —
  (R1) §1.1b set the dispatcher packet on shape alone; it is now gated on
  `blindDiscovery === true` as well, with the direct non-blind + well-formed `input.packet` case
  pinned in test (b). Growth 22718/19855 = 1.14×. Zero unaddressed blockers, zero deferred.
