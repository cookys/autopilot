# Evidence — mission `blind-review-panel-standby-2026-09-18` (v2.36.66; blind review redesign cut 2-B)

- Plan: `../../2026-09-18-blind-review-panel-standby.md` (base `aeea2ca7` = v2.36.65; sealed at `83e3ac9c`). The plan
  header still reads "draft" on purpose: `docs/mission-…-standby-2026-09-18-sources.json` binds the plan bytes and
  `.claude/mission-routing-config.json` still selects this graph — flip the status line in the 2-C mission commit
  that moves routing. `base-suites-aeea2ca7.txt`: eleven §4.1 commands green at base, detached checkout.
- Unknown-escalation: U1 (`ladder-classify.json`); consult rail `rail-failed` on the codex quota.
- Plan hetero loop (GLM-5.2 + claude-fable-5-1, MiniMax fallback): G1 `g1-*` (6 folded), G2 `g2-*` terminal at the cap
  (3 folded). Receipts rc 0. Growth 1.24×.
- Campaign attempt 1 (`grant.json`, `prepared.json`, `impl-brief.md`, `scratch/dispatch.sh`): hand cursor-grok-4.6-low
  ran 84 min and committed `3641cbef` (21 files = §2.5 exactly, +1140/−74); verify, `full_diff_review` (MiniMax-M3,
  SHIP-AS-IS with 1 🟠 3 🔵 all CUT/FOLLOW-UP) and `full_suite` passed; the rail parked at `awaiting_disposition`
  at 6686 s of the sealed 7200 (`impl-run1-awaiting-disposition.json`). Depth-0 re-derived the four findings in the
  worktree and wrote `disposition-authority.json` (2 follow-up: the duplicated family classifier; 2 reject-out-of-scope:
  test-only env pin and fixture knob). `--resume --campaign-disposition-authority` 12 min later
  (`scratch/resume.sh`) was refused at `campaign_intake`: `WALL_BUDGET_EXCEEDED — campaign wall-clock ceiling
  exceeded` (`impl-run2-resume-wall-budget-exceeded.json`). RAIL DEFECT (BACKLOG row): the durable wait counts
  against `max_wall_seconds`, so a campaign parked late is unresumable. Consequences recorded honestly: the
  v2.36.41 disposition-resume path is **still not measured end-to-end** (intake refused before `disposition_resume`);
  the final panel never ran on this campaign. Degraded per doc to l3; candidate = the retained worktree's `3641cbef`.
  Also observed: the sealed contract carried `final_panel_reserve_seconds: 0` / `full_suite_reuse: 1` although the
  graph node set 900 / true — the 2-A knobs are validated but never projected (BACKLOG row); the 2-A §5 pocket proof
  stays open until that lands.
- Depth-0 at `3641cbef`: scope = §2.5; `review.js`/`review-fanout.js`/`review-packet.js`/`dispatch-review.sh`/
  `cleanroom-launch.sh`/resolvers byte-identical; six codex mirrors byte-identical; 11/11 green on a detached scratch
  checkout (`head-suites-3641cbef.txt`, `scratch/suites.sh`).
- Second-family reviews of `83e3ac9c..3641cbef` (99 KB, no path filter): claude-fable-5-1 FIX-THEN-SHIP (3 🟠 1 🟡 4 🔵,
  `review-claude-r2.json`), GLM-5.2 SHIP-AS-IS (2 🔵, `review-glm-r2.json`). Adjudication (`scratch/adjudication-r2.md`),
  repair r2 `67b10726` by a sonnet hand from `scratch/repair-brief-r2.md`: ✅ 🟠 quorum-family-threshold (= GLM 🔵):
  validator keyed the diversity floor on all rows, engine on reviewed rows → min 1 / 2 seats / 1 failure refused an
  engine receipt; validator now uses reviewed rows, RED-first receipt case. ❌ 🟠 packet-hash-scope: refuted — the
  block already iterates reviewed rows (unchanged base code), receipt suite green. ✅ 🟠 family-classifier-dup
  (= GLM 🔵 = the depth-0 follow-up): one `modelFamilyOfEngine` in `campaign-intake.js`, engine imports it, qwen arms
  folded, no-drift assertion — resolves the authority's follow-up in this cut, no BACKLOG row. ✅ 🟡
  reuse-branch-undefined: the gate-reuse branch spread three `undefined` keys → `final_panel_metadata_incomplete`
  on a pre-cut persisted gate; guarded. ✅ 🔵 seats-complete-hardcoded: snapshot written only when
  `qc_panel_seats_complete === true` (+ state-suite case). ✅ 🔵 step-order label. Deferred to 2-C: 🔵
  snapshot-before-claim (per spec §1.2), 🔵 snapshot-digest-unverified.
- Delta review (claude-fable-5-1) `review-claude-r3.json` on `3641cbef..67b10726`: SHIP-AS-IS, 1 🟡 follow-up
  (snapshot-read-gated-on-live-flag: a resume whose live roster flips `qc_panel_seats_complete` to false skips
  reading an existing snapshot — fail-closed; 2-C: gate the write, always read). 11/11 green at `67b10726`
  (`head-suites-67b10726.txt`).
- Plan §5 live proof (four seats / min 3 / one fault / pin change after intake) **NOT produced**: this campaign had
  three seats and its final panel never ran. Deferred to the next managed campaign (2-C), which needs a fourth
  qc family pinned first. What is proven here is suite-level (engine standby/snapshot cases with fixture seats).
- Merge `9f17bdc1`; `integration-record.json`, `pin-anchors-scan.json`, `reap-*.json`, `residue-receipt.json`
  (zero residue) = closeout; both l5 markers retired against the integration receipt.
