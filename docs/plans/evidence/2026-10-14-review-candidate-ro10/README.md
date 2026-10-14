# RO10 live runs: review-candidate (BL-0090 P1)

Engine: `node bin/autopilot.js engine review-candidate`, autopilot plugin 3.0.0-alpha.6 (worktree lane/review-candidate-p1),
`AUTOPILOT_LEVEL=l4`. Review seats are the repo-resolved defaults: reviewer MiniMax-M3 (cc-shim) plus a four-seat QC panel
(claude-fable-5-1, GLM-5.2, MiniMax-M3, Qwen3.8-Max-Preview).

Throwaway repos live under the session scratchpad, never this repo. They hold no governance files (no hooks, no enforce-mode
config); `.claude/{dispatch,model-routing,review-loop}-config.md` were copied from this worktree so the roster digest matches the
strict bootstrap, with two host-forced edits: implementer set to cursor-grok-4.6-low (host grok-4.7 was quota_exhausted, and
l4 readiness probes the unused implementer seat) and verification_author_present=false (qoderclicn seat transport_failure).
Setup, contract and seal: `ro10-setup.js` (seal mission-mode off, verify_cmd `node test.js`).

| Run | Range | Result | Implementer calls | Reviewing seats |
|-----|-------|--------|-------------------|-----------------|
| trivial | add `sub(a,b)` returning a-b | status converged, phase campaign_terminal_ready, verdict SHIP-AS-IS, exit 0; campaign state TERMINAL_READY | 0 (`implementation` null, no implementer entry in the ledger) | 4 `dispatch_review` seats reviewed; full-diff review and full suite passed |
| defect | `sub` returns a+b (planted) | status awaiting_disposition, verdict FIX-THEN-SHIP, exit 1; campaign state AWAITING_DISPOSITION (not ready; the caller chooses per plan Q1') | 0 | 4 seats reviewed, findings non-empty |

`campaign inspect` was run with `--campaign-id` and `--ledger <git-common-dir>/autopilot/implementation-campaign.jsonl` in each
throwaway repo (trivial campaign-v1-bf49dd24..., defect campaign-v1-0489810f...).
`repo-residue-sweep.js scan --json` (read-only): trivial has no worktrees and one `unintegrated` branch, external/trivial (the
externally authored branch, not owned by the campaign); defect is the same plus one `final_panel_seats` entry, class active,
decision keep (resumable). Neither run created a worktree or branch.

Bugs this live run found that the stubbed in-suite driver hid: (1) the review-candidate implementer_family roster override ran
before the strict readiness check and changed the roster digest ("roster changed after bootstrap"); (2) the adoption path never
built the campaign scope session, so the scope checkpoint returned "campaign scope seal drifted". Both are fixed in the follow-up
commit. Host finding: l4 readiness requires the unused implementer seat to be live; the unchanged implement-review rail is
blocked the same way.
