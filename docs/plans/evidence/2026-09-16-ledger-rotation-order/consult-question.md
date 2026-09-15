Design question (autopilot managed campaign rail; bash writer scripts/run-ledger.sh, Node reader src/campaign/cli.js).

Defect measured end-to-end (this repo, 2026-09-16): the canonical campaign ledger
`.git/autopilot/implementation-campaign.jsonl` is 2.09 MB while RUN_LEDGER_MAX_BYTES defaults to
262144 and RUN_LEDGER_MAX_ROTATIONS to 4. Every append therefore rotates. The rotation carry in
`atomic_append_ledger` (run-ledger.sh ~3155-3190) re-materializes, into the new live segment,
(1) the latest leased stage row per (run_id, stage) and (2) every journal row of every run that
still holds a lease. The journal carry is written as:

    [ .[] | select(.kind=="journal" and active) | . + {_rotation_carry:true, _rotation_root:(._rotation_root // base64(row minus carry keys))} ]
    | group_by(._rotation_root) | map(.[-1])

jq `group_by` SORTS by key, so the carried journals come out in base64(row) order, not append
order. Because 109 runs hold stale leases (some since July), the carry is ~2 MB, so the live
segment is immediately over the cap again; after 4 rotations the original (append-ordered)
segment is GC'd. Measured on disk now: all 5 segments contain 601 rows each, 451 of them journals,
all 451 marked `_rotation_carry:true` — zero original journal rows survive anywhere.

The reader `projectCampaign(rows, campaignId)` (src/campaign/cli.js:356) consumes the
oldest-to-live snapshot in file order, dedupes carry rows by `_rotation_root` (first occurrence
wins), then replays campaign events in that order through `reduceCampaignState`
(src/engine/implementation-campaign.js:848), which enforces
`event.input_artifact_digest === state.last_output_artifact_digest`, so a reordered journal fails
with ARTIFACT_CHAIN_BROKEN "event input artifact must match the prior output artifact". Effect:
`campaign resume` / `--resume` / `mission inspect` cannot project any campaign that has more than
one event once its original segment is gone — including a durable-wait campaign that is otherwise
resumable.

Journal rows carry `ts` at ONE-SECOND resolution (iso_ts), no sequence number. Event payloads carry
`input_artifact_digest` / `output_artifact_digest` (sha256 of canonical state), and `generation`.
Duplicate-event suppression already exists in `validateCommonEvent` (idempotency).

Scope already decided by the owner: fix ONLY the ordering defect with one measurable acceptance.
The stale-lease GC (why 109 runs are "active") is a separate backlog row and must NOT be folded in.

Candidate fixes:
(a) Writer-only: make the carry preserve append order (dedupe with `reduce` + a seen-set keyed on
    `_rotation_root`, keeping the FIRST occurrence's position; never `group_by`/`unique_by`, both
    sort). Existing on-disk segments stay broken; only campaigns whose original segment is still
    present, or campaigns created after the fix, project correctly.
(b) Reader-side: in `projectCampaign`, order the campaign's event journals by walking the artifact
    chain (`input_artifact_digest === previous output_artifact_digest`, starting from the intake's
    `initial_state_digest`) instead of trusting file order; fail closed on a fork (two events with
    the same input digest) or a gap. Heals every existing segment, and tolerates any future carry
    reorder. Pulls `src/campaign/cli.js` into the change set.
(c) Both: (a) as the invariant, (b) as the defensive read.

Questions:
1. Which option should ship, and what concrete failure does each REJECTED option let through? In
   particular for (b): does chain-walking weaken any fail-closed property the file-order replay
   currently provides (e.g. a manually appended forged event that chains correctly but was written
   out of order, or a repair-generation event ordering that the chain does not capture)? Also:
   the intake journal and non-event journals (idempotency rows, op != campaign_event) are not on
   the digest chain — where do they sit in the walked order, and does a stray non-event journal
   between two events change `reduceCampaignState` behaviour?
2. For (a): is keep-first-occurrence the right dedupe position, given that the snapshot is
   oldest-to-live and a carry copy in a newer segment is byte-identical to its root? Name any case
   where keep-last is required.
3. Red-first test (bash, hooks/tests/, next to run-ledger-rotation.test.sh): what must it assert so
   that it discriminates a real fix from (i) a writer patch that preserves order only within one
   rotation but not across two, and (ii) a reader patch that sorts by `ts` (seconds collide)? The
   owner's draft: three journals whose base64 order differs from append order, ledger already over
   cap, one append, then assert snapshot order == append order AND `projectCampaign` does not throw.
   Refine or replace those assertions.
   Fixture facts: `hooks/tests/lib/implementation-campaign-ledger-fixture.js` drives the SHIPPED
   writers (`openCampaignLedger` journals a real intake root; `appendCampaignEvent` accepts an
   `idempotencyKey` override, default `campaign-event:<sha256>` i.e. effectively random). Row byte
   layout is `{"kind","ts","run_id","stage","generation","nonce","op","idempotency_key",...}` and
   `ts` is `date -u %Y-%m-%dT%H:%M:%SZ` at write time with no override, so base64 order is decided
   by `ts` first and by `idempotency_key` only within one second. A red-at-base fixture must be
   reproducible, not "usually inverted". Existing `implementation-campaign-dogfood.test.sh` (line
   ~1227) already forces rotation with an intake-only campaign and never exercised event order.
4. Should the existing corrupted ledger be repaired by a one-off migration, or is (b) the migration?
Answer with a recommendation and precise assertions; do not emit a ship/no-ship verdict.
