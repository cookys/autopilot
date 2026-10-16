# review-candidate follow-ups (BL-0146, BL-0155)

Source: the review-only external candidate plan (BL-0090), archived 2026-10-15 at
`docs/plans/_archive/2026/10/2026-10-13-review-only-external-candidate.md`; operator doc `docs/review-candidate.md`.

- **BL-0146 — delta-only re-review after `return`.** Plan §10 Q3 ruled (c) on 2026-10-14: every seat re-reviews the
  whole `base..new_head`, and a seat outcome is reused only when its full input binding is identical. Delta-only review
  needs a new reuse key, a re-check of files the delta touches, and a read-only context packet for the cumulative range
  (option (a)); seats have no context channel today. Write a plan for those three rulings before any code.
  2026-10-16: re-checked, still open and not started; it is a plan-first item of more than half a day.
- **BL-0155 — repair branch numbering ignores remote branches.** The P5 hardening merged 2026-10-15 (`-rN` suffix,
  `%(refname:lstrip=2)` listing, fail-closed `review_candidate_repair_seed_invalid`, seed written before close, prompt
  says "a repair campaign"). Left open: `listRepairBranches` counts `refs/heads/repair/` only, so a same-named branch
  another clone already pushed is not seen; the engine path that turns a listing failure into `blocked` has unit
  coverage only. Not a follow-up: the `review-candidate-repair/<id>/` handoff directory has no cleanup on purpose. It
  is the caller's deliverable when the review-only campaign closes; options were (a) an age-based sweep with a
  tmp-residue registry kind, (b) the repair campaign deleting the seed directory it consumed, (c) leave it, and (c)
  was chosen on the owner's behalf on 2026-10-15.
