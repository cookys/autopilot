# Evidence — mission `blind-review-shared-packet-2026-09-18` (blind review redesign cut 2-C, deliverable 2: one packet per candidate)

- Plan: `../../2026-09-18-blind-review-panel-station.md` §1.2 (frozen after G2; the plan hetero loop and the G1/G2
  receipts live in `../2026-09-18-blind-review-panel-station/`). Second lineage from the same plan bytes:
  `NODE=packet` of the station's `scratch/freeze-c2c.js` — the objective now names the deliverable, because the
  adoption key derives from `{repo, intent, acceptance hashes}` and an unchanged objective would have found the
  station's registry entry (`MISSION_BINDING_MISMATCH` on a different graph digest). Graph digest `4e4a8299…`,
  lineage `lineage-v1-b33ff20c…`, node `shared-packet` (13 output paths, pocket 900, verify-once).
- Base `fd4ea3a6` (the freeze commit on v2.36.68 + docs). `base-suites-fd4ea3a6.txt`: the thirteen §4.1 commands
  at base, detached checkout, `env -u AUTOPILOT_SESSION_ID`.
- Campaign attempt 1 (`grant.json`, `prepared.json`, `impl-brief.md`, `scratch/dispatch.sh`; contract
  `final_panel_reserve_seconds: 900`, `max_wall_seconds: 7200`; dispatch env = `AUTOPILOT_LEVEL` + `AUTOPILOT_ROOT_RUN_ID`
  only): hand cursor-grok-4.6-low committed `5d7ad66a` (12 files ⊆ §2.5, +856/−88) at 20:30Z (implement 19:29→20:30);
  scope + verify 20:30→20:51 (13/13 in-rail); **the panel station ran** 20:51→21:00 — `impl-run1-awaiting-disposition.json`
  (trimmed run receipt: trace, review, ledger), `qc_panel_snapshot.json` (`review_station: panel`), `seat-results/`
  (the four seat envelopes + stderr). Then `awaiting_disposition` (13 findings, no authority bound), clock paused at
  `elapsed_wall_seconds: 5435`.
- **Depth-0 adjudication** (`disposition-authority.json`, validated by `loadCampaignDispositionAuthority`): 🟠
  `stdin-paths-quote-prefix` (claude) CONFIRMED by probe — `git hash-object --stdin-paths` dies `fatal: line is badly
  quoted` on a `"`-prefixed name (git 2.53.0), absolute paths hash fine; 🟠 `runpanel-build-uncaught` (claude)
  CONFIRMED by code read — the shared build sits before the `try`; 🟠 `shared-packet-caller-count` and 🟠
  `hashObject-export-stability` (Qwen) REFUTED with mutation probes (`grep buildReviewPacket(` = 2 lines, mutant = 3;
  review-packet suite 57/57, mutant routing symlinks through `hashObject` → `hashObject_calls=3` FAIL); 🔵
  `engine-sealed-paths` (Qwen) refuted (twin is sealed and synced; mutant twin → drift detected); eight 🔵 →
  follow-up, three of them folded into the repair (`prepare-error-reclass`, `skiplaunch-phase-labelling`,
  `sha1-batch-cwd-discovery`).
- **Resume not exercised — degraded to l3.** Remaining wall 1765 s; a repair round costs implement (60 min measured)
  + scope/verify (21 min) + panel (9 min, pocket-coverable), so `--resume --campaign-disposition-authority` would
  have burned the attempt at `WALL_BUDGET_EXCEEDED` mid-round. `session-mode set --level l3 --entry-level l5
  --fallback precondition_failed`; repair r2 by a sonnet hand in the retained worktree (`scratch/repair-brief-r2.md`).
- Repair r2 `a59356c9` (sonnet hand, `scratch/repair-brief-r2.md`; RED at `5d7ad66a` recorded beside each assertion): A —
  the batch feeds absolute paths with `cwd = entry.repo` and base's `-c objectFormat` rule (fake `GIT_DIR` block deleted;
  `"quoted.txt` in the fixture); B — the shared build is caught, `sharedPacket = null`, seats take the per-seat path and
  fail as base did; C — only `phase === 'precondition_failed'` short-circuits `reviewDiff`. Depth-0 at `a59356c9`: diff
  ⊆ §2.5 (12 of 13), §2.6 byte-identical, mirrors identical, test modes 100755, 13/13 green on a temp-branch scratch
  checkout (`head-suites-a59356c9.txt`). Delta reviews of `5d7ad66a..a59356c9` (full diff): claude-fable-5-1
  SHIP-AS-IS 3 🔵 (`review-claude-r2.json`: `path.resolve` instead of `join` for the treeDir invariant; Fix-B RED text
  not quoted in the test comment; Fix-C covered through a stub dispatcher) — deferred; GLM-5.2 SHIP-AS-IS, none
  (`review-glm-r2.json`). `red-<suite>.txt`: the candidate's new cases at base (§4.1).
- **Measurements (plan §5 and the three carried items).**
  - 2-C station §5 — **produced**: one `full_diff_review` row `station: panel`, `seat_count: 4`, four seat receipts
    (claude FIX-THEN-SHIP, GLM SHIP-AS-IS, MiniMax SHIP-AS-IS, Qwen FIX-THEN-SHIP → `union-on-verified-critical` =
    FIX-THEN-SHIP), `final_panel_quorum_met`, one `packet_hash` `d4e110ee…` on every row, `budget_source: wall`,
    `seat_timeout_seconds: 3215`; no single-seat review. `repair_authorized` → second station panel and
    `final_panel_gate_reused` — **not observed** (the campaign parked; see below).
  - 2-B §5 four seats + quorum — **produced** (same row).
  - 2-A §5 pocket — **not observed**: the wall remainder sufficed (`budget_source: wall`); the contract carried the
    projected `final_panel_reserve_seconds: 900`.
  - v2.36.41 durable wait — **produced**: `awaiting_disposition` with `resumable: true`, clock paused at
    `elapsed_wall_seconds: 5435` (v2.36.67). Resume — **not exercised**: 1765 s cannot fit a repair round (BACKLOG row
    "a park reserves no wall for the repair round it authorises").
  - packet-once live — **not producible by this campaign**: the rail runs depth-0's checkout engine (`bin/autopilot.js`
    at base `fd4ea3a6`), so the live panel built four per-seat packets; the candidate's engine ran only inside the
    verify suites (BACKLOG row "engine-touching deliverables cannot self-prove live"). First observable on the next
    campaign after v2.36.69.
  - `tree-hash-batch` timing on this repo (candidate `5d7ad66a`, 3426 packet entries after the deny-list): base
    per-file build **23.3 s** → batched build **2.0 s**; `materializePacket` 0.38 s; `hashPacketDir` 0.13 s.
- Merge `03a5666e` (no-ff); `integration-record.json` (source `a59356c9`, accepted `03a5666e`), `pin-anchors-scan.json`
  (no unreachable), `reap-worktrees*.json`, `reap-branches.json` (bundle), `residue-receipt.json` (`zero_residue: true`);
  marker retired against the integration receipt. Deferred 🔵 (follow-up rows in `disposition-authority.json`): shared
  build gated on the blind predicate; extra `prepareReview` in `runPanel`; lstat pre-pass ordering; runner test pins a
  base hash; `path.resolve(treeDir, rel)`.
