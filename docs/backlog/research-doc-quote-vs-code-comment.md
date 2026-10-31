# Research doc quote vs code comment (BL-0350)

docs/plans/research/2026-10-03-cost-tracker-context-signal-dogfood.md (item 5) quotes the cost-tracker comment as "<host> digest #6" with a placeholder where the host name was. The code comment in hooks/cost-tracker.js (the "Cumulative cache-read report" block) still carries the original host name in the same position. Find both with `git grep -n 'digest #6'`.

Options: reword the doc so it does not quote the comment, or redact the code comment too. Never write the real host name in docs (leak-guard blocks it). From relay0 review g2 (research-doc-misquote), cut as cosmetic.
