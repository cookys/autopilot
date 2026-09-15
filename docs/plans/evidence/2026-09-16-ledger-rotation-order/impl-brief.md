# Implementation brief — ledger-rotation-order-2026-09-16

You are the implementer of ONE managed deliverable. The harness commits your work; you never push,
never `git stash`, never touch files outside `output_paths`, never read or write the host ledger
(`.git/autopilot/implementation-campaign.jsonl` of this repo or any other) — tests use sandbox
ledgers under `$TEST_TMP` only.

## Read first (in this order, nothing else)
1. `docs/plans/2026-09-16-ledger-rotation-order.md` — §0 mechanism, §1 ruling, §2.1 the jq, §2.3 tests.
2. `docs/plans/2026-09-16-ledger-rotation-order.rubric.md` — R1–R10 are the acceptance.
3. `scripts/run-ledger.sh` lines 3130-3195 (`atomic_append_ledger`, the rotation carry) and 145-146
   (`now_ts`/`iso_ts`).
4. `hooks/tests/run-ledger-rotation.test.sh` (harness idiom) and
   `hooks/tests/implementation-campaign-dogfood.test.sh` lines 1225-1330 (how a real campaign ledger
   with events is built inside a bash test via `node - <<'NODE'`, using
   `hooks/tests/lib/implementation-campaign-ledger-fixture.js` and `src/engine/campaign-intake.js`
   `appendCampaignEvent`; note its `idempotencyKey` and `observedAt` inputs).

## The defect (one paragraph)
The rotation carry in `atomic_append_ledger` re-materializes every journal row of every still-leased
run into the new live segment with `group_by(._rotation_root) | map(.[-1])`. `group_by` SORTS, so
the carried journals come out in base64(row) order, not append order. Once the original segment is
GC'd (RUN_LEDGER_MAX_ROTATIONS), the reader `projectCampaign` (`src/campaign/cli.js:356`) replays
campaign events in file order and fails with `event input artifact must match the prior output
artifact`. Reproduced at base: `buildTerminalReadyCampaignLedger` under `RUN_LEDGER_MAX_BYTES=1500
RUN_LEDGER_MAX_ROTATIONS=1` throws exactly that.

## The fix (product) — `scripts/run-ledger.sh` ONLY
Replace the `$journals` binding in the carry jq with the reduce form in plan §2.1 (keep FIRST
occurrence per `_rotation_root`, oldest-to-live order). Use NO `group_by` / `unique_by` / `sort_by`
/ `sort` on journal rows (R4). Leave `$leases` (stage carry, latest leased per run_id+stage) and
`($leases + $journals) | .[]` exactly as they are. Leave `_rotation_root` derivation and
`_rotation_carry` unchanged. Update the comment block above the jq: the carry preserves append order
because the reader replays the campaign event chain in file order. Then copy the file byte-for-byte
to `platforms/codex/plugin/scripts/run-ledger.sh` (`bash scripts/sync-codex-plugin-skills.sh` does
it; verify with `--check`).

Do NOT change any file under `src/` — the reader is deliberately untouched (R6). Do not add a
reader-side reorder, a migration, or change the `RUN_LEDGER_MAX_*` defaults.

## Tests — new `hooks/tests/run-ledger-rotation-order.test.sh` (plan §2.3)
Bash harness (`. "$(dirname "$0")/lib.sh"`); build the fixture inside a `node - <<'NODE'` block like
the dogfood test: `openCampaignLedger` (intake root) + THREE `appendCampaignEvent` calls
(`IMPLEMENTATION_STARTED`, `IMPLEMENTATION_COMPLETED`, `VERTICAL_VERIFIED` — copy the payload shapes
from `driveCampaignToTerminalReady` in the fixture lib; a real candidate commit is needed for
`IMPLEMENTATION_COMPLETED`, make one in a scratch git repo under `$TEST_TMP`). Rotation OFF while
building (`RUN_LEDGER_MAX_BYTES=0`).

Determinism (R3): put a `date` shim first on `PATH` for the whole test — a tiny script that prints
one pinned timestamp when its argv is exactly `-u +%Y-%m-%dT%H:%M:%SZ` and otherwise `exec`s the
real `date` (find it with `command -v date` BEFORE prepending PATH). Give all three events the same
`observedAt` and pinned `idempotencyKey`s (e.g. `campaign-event:zz-1`, `campaign-event:mm-2`,
`campaign-event:aa-3`). PRECONDITION assertion in the test: compute each event row's rotation root
(base64 of the row JSON minus carry keys — the same `tojson|@base64` jq the writer uses, or Node
`Buffer.from(JSON.stringify(row)).toString('base64')` on the parsed row, which is what the reader
does) and assert the lexically sorted order differs from append order; fail with the message
`fixture not discriminating` if not. Also assert the three journal `ts` values are identical.

T1 (RED at base): `RUN_LEDGER_MAX_BYTES=1 RUN_LEDGER_MAX_ROTATIONS=1`, two real `stage-heartbeat`
appends on the campaign lease → two rotations. Assert: every intake/event copy in every segment is
`_rotation_carry:true` (no originals survive); `${ledger}.1` lists the campaign's journals in append
order; the live segment lists them in append order; each `_rotation_root` exactly once per segment;
first-occurrence dedupe over `run-ledger.sh snapshot --ledger …` yields append order.
T2 (RED at base): `projectCampaign(loadRows(ledger), campaignId)` does not throw; `state.phase` is
the expected phase after VERTICAL_VERIFIED, `state.event_count === 3`,
`state.last_output_artifact_digest` equals the digest the third `appendCampaignEvent` returned.
T3 (preservation, green at base): the latest leased stage row for the campaign is present exactly
once in the live segment; `query-latest` returns the pre-rotation generation and nonce.

Header comment of the test: for T1 and T2 paste the failing message you observed at base
`9fa7ac1a` (run the test before touching run-ledger.sh, quote the actual assertion text), and label
T3 as a preservation guard.

## Docs
- `docs/BACKLOG.md`: the row "Managed rail: ledger rotation carry-forward reorders journal rows —
  resume/inspect fail above 256 KiB" → `- **Status**: shipped v2.36.54 2026-09-16`; rewrite its
  Context to the real mechanism (`group_by` sorted the journal carry; now keep-first in append order;
  reader untouched). Add ONE new row directly after it, Status `open`, titled "Managed rail:
  already-scrambled carry-only ledger segments cannot project — reader recovery or locked migration"
  with Trigger/Effort/Source/Pointer/Context lines in the same shape as neighbouring rows (Pointer:
  `docs/plans/2026-09-16-ledger-rotation-order.md` §6). Then `node scripts/check-backlog-entries.js
  --backlog docs/BACKLOG.md` must exit 0.
- `skills/l5/references/hetero-impl-loop.md` step 11: append to the "Fixed since 2026-09-14" list
  "ledger rotation carry keeps journal append order v2.36.54". Regenerate the mirror
  `platforms/codex/plugin/skills/l5/references/hetero-impl-loop.md` with
  `bash scripts/sync-codex-plugin-skills.sh`, then `--check`. Do NOT touch CHANGELOG.md.

## Verify (run all, one at a time, in the foreground; all must be green)
```
bash hooks/tests/run-ledger-rotation-order.test.sh
bash hooks/tests/run-ledger-rotation.test.sh
bash hooks/tests/run-ledger-directive.test.sh
bash hooks/tests/implementation-campaign-dogfood.test.sh
bash hooks/tests/campaign-claim-resolve.test.sh
bash hooks/tests/next-touch-validation.test.sh
bash hooks/tests/mission-runtime-v2.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
git diff --stat 9fa7ac1a -- src/    # must print nothing
```
Do not weaken or delete any existing assertion.

## Sealed output_paths (the ONLY files you may change)
```
scripts/run-ledger.sh
platforms/codex/plugin/scripts/run-ledger.sh
hooks/tests/run-ledger-rotation-order.test.sh   (new)
docs/BACKLOG.md
skills/l5/references/hetero-impl-loop.md
platforms/codex/plugin/skills/l5/references/hetero-impl-loop.md
```
Finish by leaving a clean tree with your changes committed as the harness instructs; report the
RED-at-base messages you recorded for T1/T2 and the pass/fail counts of every suite.
