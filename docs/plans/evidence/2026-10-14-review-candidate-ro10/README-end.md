# RO10 live run: planted defect ending in `end` (review-candidate, BL-0090 P2)

Engine: `node bin/autopilot.js engine review-candidate`, autopilot plugin 3.0.0-alpha.6 (worktree lane/review-candidate-p2b, commit
c49377ab), `AUTOPILOT_LEVEL=l4`. Same repo-resolved review seats as the P1 run (reviewer MiniMax-M3 plus the four-seat QC panel).

Throwaway repo under the session scratchpad, never this repo, no governance files (no hooks, no enforce-mode config). The
`.claude/{dispatch,model-routing,review-loop}-config.md` files were copied from this worktree with the same host-forced edits as the
P1 run: **implementer switched to cursor-grok-4.6-low because the host grok implementer quota is exhausted** (l4 readiness probes the
unused implementer seat), and verification_author_present=false. Setup, contract and seal: `ro10-end-setup.js` (kind `defect`, seal
mission-mode off, verify_cmd `node test.js`). Planted defect: `sub(a, b)` returns `a + b` while the spec says a minus b.

| Step | Command | Result |
|------|---------|--------|
| 1 first run | `engine review-candidate --campaign-contract ... --campaign-seal ... --spec-file ... --cwd <repo>` | status awaiting_disposition, verdict FIX-THEN-SHIP, exit 1; campaign `campaign-v1-b9797fbc...` AWAITING_DISPOSITION; 0 implementer calls |
| 2 end | same command plus `--resume --campaign-continuation end` | status blocked, phase review_candidate_end, code `review_candidate_disposition_end`, exit 1, `model_calls` 0, `dispatcher_called` false; 4 unresolved findings listed in `reason` and `findings` (sub-returns-sum, MATH-SUB-WRONG-OPERATOR, sub-implementation, sub-wrong-operator) |

`campaign inspect --campaign-id campaign-v1-b9797fbc... --ledger <git-common-dir>/autopilot/implementation-campaign.jsonl`: phase
TERMINAL_STOP, terminal_reason starts `review_candidate_disposition_end: the review was closed by the caller; 4 finding(s) left
unresolved`, 6 events (adopted, verified, review completed, awaiting disposition, resumed, terminal stop).
`repo-residue-sweep.js scan --json` (read-only): no worktrees, branches external/defect (unintegrated, the externally authored
branch) and master, `final_panel_seats` empty (reaped at terminal). The run created no worktree and no branch.

First attempt note: passing the contract, seal and spec as relative paths fails with campaign_contract_unreadable because they are
resolved against `--cwd`; absolute paths were used for the recorded run.
