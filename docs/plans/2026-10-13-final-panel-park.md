# Final panel with findings parks for depth-0 disposition

Status: active (backlog row: "Final panel with non-empty findings terminal-stops instead of parking for depth-0 disposition")

## Current behaviour

`runCampaignComposition` (`src/engine/campaign-composition.js`) adjudicates the final panel with `final: true`.
Non-empty findings with no bound authority make the adjudicator return `registry_complete: false`
(`AUTHORITY_REQUIRED`), and the final path returns `blocked('final_adjudication', ...)` with no `durable_wait`
marker. The engine terminalizes the campaign; terminal campaigns cannot resume. Only the in-loop path parks.
Authority cannot be supplied up front: it binds the panel `review_digest`, which exists only after the panel ran.

## Design (option A)

1. Extract the in-loop "incomplete registry" classification (identity-invalid and malformed findings are hard
   fails; otherwise `incompleteIsDurableWait`) into one helper used by both paths. No new policy.
2. On the final path, a durable-wait classification parks instead of blocking: persist the controller with
   `phase: AWAITING_DISPOSITION`, `next_action: 'await_final_disposition_authority'` (both already in the
   closed controller field set, so no new controller field), emit `AWAITING_DISPOSITION`, return
   `awaitingDisposition(...)`. Hard-fail classifications still return `blocked` and terminalize.
3. Persistence: the final panel result (verdict, findings, review_digest, seat receipts) is already in the
   `joint_review` gate-journal entry recorded before adjudication, and the journal lives in the controller.
   The park keeps `findings_snapshot` and `unresolved_findings` empty so the in-loop resume does not bind the
   final findings onto the full-diff review. `review_payload`, `verification_receipt`, `candidate` are stored
   as for the in-loop park.
4. Resume: existing `dispositionOnlyResume` restores candidate, verification and review, re-runs the loop with
   the journal-reused (no model call) full-diff review, reaches the final stage, reuses the stored panel from the
   gate journal (`findReusableGate`), and calls `adjudicate({final: true})` again. The resume re-adjudicates the
   in-loop review before the panel, so when the in-loop review had findings the depth-0 authority must carry
   both digests, one `reviews[]` entry each: INLOOP (the in-loop `review_digest`) + PANEL (the panel
   `review_digest`, which the park receipt's `campaign_receipt.review.review_digest` reports). A complete
   registry reaches terminal ready/follow_up. A missing, unbound or stale PANEL entry fails normalisation and
   parks again. A missing INLOOP entry also parks again (`next_action` stays
   `await_final_disposition_authority`, no ledger event because the journal never left AWAITING_DISPOSITION);
   it never terminal-stops and never reaches terminal success.
5. Seat artifacts: parking is not terminal, so the terminal-only reaper does not run.

## Tests (`hooks/tests/final-panel-park.test.sh`)

1. Final panel with a finding-only (blue) result and no authority: status `awaiting_disposition`, durable wait,
   not blocked/terminal; controller phase and next_action persisted.
2. Resume with an authority bound to the panel digest: terminal `follow_up`/`ready`, final panel adapter not
   called again.
3. Resume with an authority bound to another digest: parks again, no terminal status.
3b. In-loop review with a finding: in-loop park, INLOOP authority, final park, PANEL-only authority parks again
   (not `blocked`), INLOOP+PANEL authority reaches `follow_up` carrying both findings, no second panel call.
4. A final-panel seat fault still fails at `final_panel` (blocked, terminalize).
5. Final panel without findings: terminal `ready`, unchanged.

## Not doing

No new model call, no new writer, no ledger edit, no new CLI flag, no change to in-loop parking, no change to
the adjudicator or the authority format. A FIX disposition on the final findings keeps routing through the
existing path (this plan parks; it does not authorise a repair).
