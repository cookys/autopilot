# Ledger rotation: the carry-forward preserves journal append order

> Status: execution plan for ONE managed deliverable (`/l5`, mission graph node
> `ledger-rotation-order-2026-09-16`).
> Source row: `docs/BACKLOG.md` "Managed rail: ledger rotation carry-forward reorders journal rows —
> resume/inspect fail above 256 KiB" (fired 2026-09-16, the v2.36.43 measurement point). Owner
> instruction 2026-09-16: CEO mode, work the fired rows in order via `/l5`; scope = the ordering
> defect only, with one measurable acceptance. The stale-lease GC (why 109 runs are still "active")
> is a separate row and is NOT in scope.

## 0. What is actually broken (measured 2026-09-16)

`scripts/run-ledger.sh` `atomic_append_ledger` rotates the live segment whenever it is at or above
`RUN_LEDGER_MAX_BYTES` (default 262144) and, under the same lock, carries into the NEW live segment
(1) the latest leased stage row per `(run_id, stage)` and (2) every journal row of every run that
still holds a lease. The journal carry (`run-ledger.sh` ~3168-3186) is

```jq
| group_by(._rotation_root) | map(.[-1])
```

`group_by` SORTS by its key, so carried journals are emitted in `base64(row)` order, not append order.
Two facts make this fatal in practice:

- The canonical ledger of this repo (`.git/autopilot/implementation-campaign.jsonl`) is 2.09 MB and
  109 runs hold leases (some since July), so the carry alone is ~2 MB: every append rotates again,
  and after `RUN_LEDGER_MAX_ROTATIONS` (default 4) rotations the original append-ordered segment is
  GC'd. Measured: all five segments hold 601 rows, 451 journals, ALL `_rotation_carry:true`; zero
  original journal rows survive anywhere on disk.
- The reader `projectCampaign` (`src/campaign/cli.js:356`) walks the oldest-to-live snapshot in
  file order, dedupes carry rows by `_rotation_root` (first occurrence wins), and replays the
  campaign's events in that order through `reduceCampaignState`
  (`src/engine/implementation-campaign.js:848`), which enforces
  `event.input_artifact_digest === state.last_output_artifact_digest`. A reordered journal fails with
  `ARTIFACT_CHAIN_BROKEN` "event input artifact must match the prior output artifact".

Effect: `campaign resume`, `--resume`, `mission inspect` cannot project ANY campaign with more than one
event once its original segment is gone — including `campaign-v1-fd316019…`, parked
`review_no_verdict / durable_wait / resumable` by v2.36.43 and therefore un-resumable.

Reproduced at base with the shipped fixture (`hooks/tests/lib/implementation-campaign-ledger-fixture.js`
`buildTerminalReadyCampaignLedger` under `RUN_LEDGER_MAX_BYTES=1500 RUN_LEDGER_MAX_ROTATIONS=1`): the
fixture's own terminal projection throws `event input artifact must match the prior output
artifact`; the live segment reads `intake, implementation_completed, review_completed,
implementation_started, vertical_verified, terminal_ready`. With `RUN_LEDGER_MAX_ROTATIONS=8` the same
run projects `TERMINAL_READY` because the reader still finds the originals in `.5`.

Row facts the fix and its test must respect:
- `ts` is `date -u +%Y-%m-%dT%H:%M:%SZ` (one-second resolution, no override); rows carry no sequence
  number. Within one second the base64 order is decided by `idempotency_key`
  (`campaign-event:<sha256>` by default; `appendCampaignEvent` accepts an `idempotencyKey` override).
  So "the sort inverts the order" is a property of the fixture bytes and a red-at-base test must
  either pin those bytes or assert its own precondition.
- Event payloads carry `input_artifact_digest` / `output_artifact_digest` (sha256 of canonical state)
  and `generation`; the intake root and non-event journals are not on that chain.
- The existing rotation suites (`hooks/tests/run-ledger-rotation.test.sh`,
  `implementation-campaign-dogfood.test.sh` ~1227) rotate an intake-only campaign and never exercised
  event order.

## 1. Ruling and shape

Fix the WRITER only (option (a) of the design consult, see Review log): the journal carry in
`atomic_append_ledger` keeps append order and dedupes by `_rotation_root` keeping the FIRST
occurrence in the oldest-to-live slurp. No `group_by` / `unique_by` / `sort_by` on the journal carry
(all three sort). The stage carry (latest leased row per `(run_id, stage)`) is unchanged — "latest
wins" is right there and its `group_by` sorts stage rows only. `_rotation_root` derivation
(`base64(tojson(row minus carry keys))`) is unchanged: the reader's dedupe keys on it.

Why keep-first: the first occurrence is either the producer-authored original at its authentic
position, or the oldest retained carry once the original is GC'd; every later copy is another
materialization of the same immutable row and relocating it after later appends is itself a
reorder. The reader already dedupes first-wins (`seenRotationRoots`), so writer and reader agree.

Not done here (codex recommended (c) = writer + reader-side chain recovery for the segments that are
ALREADY scrambled; depth-0 narrows to the owner's scope): a reader that re-derives event order from
the artifact chain for `_rotation_carry` rows, or a locked one-off migration of the existing
segments, is a separate BACKLOG row (§6). Every `projectCampaign` caller is per-campaign-id and the
only scrambled campaign anyone needed (`fd316019`) was closed on the degrade path in v2.36.53, so
nothing live depends on healing the old bytes. The reader is untouched.

## 2. Changes by file

### 2.1 `scripts/run-ledger.sh` (`atomic_append_ledger`, the `carry=` jq)

Replace the `$journals` binding. Reference shape (either form is acceptable; both keep first
occurrence and append order):

```jq
| (reduce (.[]
      | select(.kind=="journal" and ((.run_id as $r | $active | index($r)) != null))
      | . as $row
      | (($row | del(._rotation_carry, ._rotation_root) | tojson | @base64)) as $root
      | ($row + {_rotation_carry:true, _rotation_root:($row._rotation_root // $root)})
    ) as $j ({seen:{}, out:[]};
      if .seen[$j._rotation_root] then . else .seen[$j._rotation_root] = true | .out += [$j] end)
  | .out) as $journals
```

or `to_entries | group_by(.value._rotation_root) | map(min_by(.key)) | sort_by(.key) | map(.value)`
over the same filtered stream. The comment block above the jq is updated to say the carry preserves
append order and why (the reader replays the campaign event chain in file order). `$leases` and
`($leases + $journals) | .[]` are unchanged.

### 2.2 `platforms/codex/plugin/scripts/run-ledger.sh`

Byte-identical mirror (`bash scripts/sync-codex-plugin-skills.sh --check`).

### 2.3 Tests — new `hooks/tests/run-ledger-rotation-order.test.sh`

Bash harness (`. "$(dirname "$0")/lib.sh"`), sandbox ledger under `$TEST_TMP` only — never the host
ledger (`$(git rev-parse --git-common-dir)/autopilot/implementation-campaign.jsonl`). The block head
records each change-pinning assertion RED against base `41193a66` with the failing message captured
at base; preservation guards are labelled and green at base.

**Fixture (deterministic)**: an intake root plus THREE real campaign events through the shipped
writers (`hooks/tests/lib/implementation-campaign-ledger-fixture.js` `openCampaignLedger` +
`src/engine/campaign-intake.js` `appendCampaignEvent`), rotation disabled while building
(`RUN_LEDGER_MAX_BYTES=0`). Determinism: (i) a `date` shim first on `PATH` that returns one pinned
value for exactly the `iso_ts` argv (`-u +%Y-%m-%dT%H:%M:%SZ`) and execs the real `date` for every
other argv (`now_ts`, liveness `-d` parsing must keep working); (ii) the three events use one
`observedAt`; (iii) pinned `idempotencyKey`s. **Precondition assertion inside the test**: the
rotation roots of the three event rows sorted lexically (`sort`) are NOT in append order — if that
ever holds the test fails as `fixture not discriminating`, never passes vacuously. Also assert the
three journal `ts` values are identical (a `ts`-sorting "fix" is then a no-op and cannot pass).

**T1 (RED at base) — order survives two carry generations**: set `RUN_LEDGER_MAX_BYTES=1
RUN_LEDGER_MAX_ROTATIONS=1`, then append twice with real `stage-heartbeat` calls (two rotations).
Assert: no original journal survives in any segment (every intake/event copy is
`_rotation_carry:true`); `${ledger}.1` lists the campaign's journals in append order; the live
segment lists them in append order; each `_rotation_root` occurs exactly once per segment; the
first-occurrence dedupe over `run-ledger.sh snapshot` yields append order. Checking BOTH `.1` and
live is what catches a patch that orders originals on the first rotation but sorts already-carried
rows on the second.

**T2 (RED at base) — projection**: `projectCampaign(loadRows(ledger), campaignId)` (via `node -e`)
returns the expected phase, `state.event_count === 3` (or the equivalent count field the projection
exposes), the expected `last_output_artifact_digest`, and does not throw. At base it throws
`event input artifact must match the prior output artifact`.

**T3 (preservation, green at base)** — stage carry unchanged: the latest leased stage row per
`(run_id, stage)` is present exactly once in the live segment after rotation; `query-latest` returns
the same generation/nonce as before rotation.

**T4 (preservation, green at base)** — the reader is not part of the fix: with the fixed writer, the
snapshot contains no duplicate roots for the reader to collapse beyond what
`run-ledger-rotation.test.sh` already covers; `src/campaign/cli.js` is byte-identical to base.

### 2.4 Docs (pinned version **v2.36.54**; canonical `origin/develop` is 2.36.53 at freeze — if an
intervening release lands first, depth-0 reseals with the freed number per the concurrent-session
rule)

- `docs/BACKLOG.md`: the fired row → Status `shipped v2.36.54 2026-09-16`; Context names the real
  mechanism (`group_by` sorted the journal carry; now keep-first in append order). New open row
  (§6) for the already-scrambled segments.
- `skills/l5/references/hetero-impl-loop.md` step 11: add "ledger rotation carry keeps journal
  append order v2.36.54" to the fixed list; its generated mirror
  `platforms/codex/plugin/skills/l5/references/hetero-impl-loop.md` regenerated
  (`bash scripts/sync-codex-plugin-skills.sh`, then `--check`) and is a sealed output path.
- `CHANGELOG.md` is NOT a sealed output path: the v2.36.54 section is a depth-0 release action after
  the merge.

## 3. Out of scope (do not touch)

- `src/campaign/cli.js`, `src/engine/implementation-campaign.js`, `src/engine/campaign-intake.js`
  and every other `src/` file; no reader-side reordering, no chain recovery.
- The stale-lease problem (109 runs leased since July keep the carry at ~2 MB) — separate row.
- Repairing the existing on-disk segments of this repo's ledger — separate row (§6).
- `RUN_LEDGER_MAX_BYTES` / `RUN_LEDGER_MAX_ROTATIONS` defaults.

## 4. Acceptance

| id | criterion | evidence |
|----|-----------|----------|
| `carry-order-preserved` | after two forced rotations with no originals left, both `.1` and the live segment list the campaign's journals in append order, each root exactly once per segment | T1 |
| `projection-after-gc` | `projectCampaign` on the carry-only snapshot returns the expected phase, event count and final digest without throwing | T2 |
| `stage-carry-unchanged` | latest leased stage row semantics and `query-latest` unchanged | T3 |
| `no-regression` | `bash hooks/tests/run-ledger-rotation.test.sh`, `run-ledger-directive.test.sh`, `implementation-campaign-dogfood.test.sh`, `campaign-claim-resolve.test.sh`, `next-touch-validation.test.sh`, `mission-runtime-v2.test.sh` green; `bash scripts/sync-codex-plugin-skills.sh --check`; `src/` byte-identical to base | suite output, `git diff --stat base -- src/` empty |

## 5. Dogfood proof (depth-0, after merge)

The existing host ledger stays scrambled by design (§1). Proof is on a fresh fixture: re-run the
base repro (`buildTerminalReadyCampaignLedger` under `RUN_LEDGER_MAX_BYTES=1500
RUN_LEDGER_MAX_ROTATIONS=1`) at the merged sha — it projects `TERMINAL_READY`. D's own campaign
rows are written by the OLD writer in the main checkout and will scramble once its original segment
is GC'd; if it parks, degrade per HANDOFF, do not `--resume`.

## 6. Follow-ups filed, not done here

- Already-scrambled carry-only segments: either a provenance-gated reader recovery (reorder only
  `_rotation_carry` rows, exactly one reducer-valid replay, `RESUMED` self-edges allowed — codex's
  (b) spec) or a locked one-off migration that backs up every segment and proves projected
  state/digests identical before and after. BACKLOG row (open).
- Stale July leases keep every run active so the live segment never shrinks — BACKLOG row (open,
  from the source row's Context).

## Review log

- Design consult 2026-09-16 (grok seat still 402 → codex gpt-5.6-sol via the raw-prompt rail,
  evidence `docs/plans/_archive/2026/09/evidence/2026-09-16-ledger-rotation-order/consult-codex-answer.md`):
  recommends (c) writer + provenance-gated reader recovery; confirms keep-first and names the
  two-rotation `.1`+live assertion, the equal-`ts` guard and the fixture precondition, all folded
  into §2.3. Depth-0 ruling: (a) only — the owner froze D's scope to carry-order preservation, no
  live caller needs the old bytes healed, and the reader recovery is a DFS inside the fail-closed
  projection core that deserves its own plan and hetero loop (§6).
