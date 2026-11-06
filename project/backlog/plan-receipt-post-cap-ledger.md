# Plan receipt accepts a post-cap ledger (BL-0406)

`check-phase-review-receipt.js` Mode B (plan receipts) should accept a post-cap ledger, the way code review has `--post-head-ledger`. The ledger holds:
- the declared changed sections;
- the PM ruling id;
- the confirmation review result, re-derived.

Happened twice on 2026-11-05 (plan 084; the rm-prompt auto-answer plan); each time the PM's ruling had to stand in for the receipt. PM go 2026-11-05 (fleet 01M6NMTWQJPNV799ZQYD71MSNW). Priority: after leadbase. Reported by: PM.
