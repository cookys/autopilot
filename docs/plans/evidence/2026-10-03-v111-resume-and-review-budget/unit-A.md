# Unit A — campaign resume: REVIEWING phase + zero-write resume budget
Worktree `wt-A`, branch `hands/w111/A`, base = default BASE_SHA.
Sidecar (read it first): `docs/backlog/campaign-resume-reviewing-phase-and-zero-write-budget.md`.

Defect (peer-reported, verified only by reading): `resumePhaseSupported` in `src/campaign/cli.js` (near the `campaign_resume_phase_unsupported` reason code) does not admit the phase the ICC projection shows after a final-panel seat transport failure (REVIEWING), even though the engine classifies `final_panel_seat_transport_failed` as gate_transient / `retry_full_diff_review` / resumable (`classifyFullDiffReviewFault` in `src/engine/campaign-composition.js`). Second, the `campaign_file_budget_exhausted` check blocks every resume once `usage.changed_files >= limits.max_changed_files`, including a resume that only re-runs review and cannot write.

Do:
1. Reproduce first: a fixture campaign (follow the existing campaign resume tests — `git grep -l campaign_resume_phase_unsupported -- '*.test.js' 'hooks/tests/*.sh'`) whose state is REVIEWING after a transient final-panel seat failure, and one at the file cap whose resume is review-only. Both must be RED at base.
2. Pick ONE fix shape for (a): either project the transient review failure back to VERTICAL_VERIFICATION, or admit REVIEWING only with a bound candidate (and whatever binding the existing ADJUDICATING branch requires). Prefer the narrower change that matches how the controller actually records the state. Report which you picked and why — a follow-up unit (per-seat final-panel reuse) will resume into this state.
3. (b): apply the changed-file cap only to resumes that can write. A review-only resume is not blocked by it.
4. REQUIRED negative controls (tests): a writing resume at the cap stays `campaign_file_budget_exhausted`; REVIEWING without a bound candidate (or a non-transient fault) stays blocked.
Commit message: `fix(campaign): resume admits a transient final-panel review failure; changed-file cap applies only to writing resumes`
