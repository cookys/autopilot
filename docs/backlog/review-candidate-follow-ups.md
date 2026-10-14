# review-candidate follow-ups (BL-0146, BL-0154, BL-0155)

Source: the review-only external candidate plan (BL-0090), archived 2026-10-15 at
`docs/plans/_archive/2026/10/2026-10-13-review-only-external-candidate.md`; operator doc `docs/review-candidate.md`.

- **BL-0146 — delta-only re-review after `return`.** Plan §10 Q3 ruled (c) on 2026-10-14: every seat re-reviews the
  whole `base..new_head`, and a seat outcome is reused only when its full input binding is identical. Delta-only review
  needs a new reuse key, a re-check of files the delta touches, and a read-only context packet for the cumulative range
  (option (a)); seats have no context channel today. Write a plan for those three rulings before any code.
- **BL-0154 — `return` refused when a fix shrinks the cumulative file count.** Adoption books `changed_files` as the
  cumulative absolute count while the campaign requires usage to be monotonic, so a fix that fully reverts a file is
  refused as `BUDGET_RESET`. Reproduced in the P4 doc review (revB refused, revCtl converged). Fix: book a monotonic
  value or exempt adoption from the monotonic check.
- **BL-0155 — repair handoff leftovers.** Items from the P5 reviews: a second repair of the same ticket can reuse the
  previous repair branch name; the seed files should survive a failed close; the write-seed-before-close order has no
  test; the prompt says one round while the contract allows two. The `review-candidate-repair/<id>/` handoff
  directory has no cleanup; it is the caller's deliverable when the review-only campaign closes, so deleting it there
  would remove what the caller needs. Options were (a) an age-based sweep with a tmp-residue registry kind, (b) the
  repair campaign deleting the seed directory it consumed, (c) leave it; (c) was chosen on the owner's behalf on
  2026-10-15.
