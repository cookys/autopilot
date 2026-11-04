# Merge gate runs on the tip (BL-0377)

PM ruling of 2026-11-04. The merge gate used to run `check-phase-review-receipt.js` against the last reviewed head, not the tip that gets merged.

Rules:
- (A) Below the generation cap: any product-code delta after the last reviewed head needs one more single-seat delta review, so the receipt passes on the tip. Process rule, no code.
- (B) At the generation cap: the PM ruling plus a structured post-head ledger (`--post-head-ledger <file>`, schema `post-head-ledger/1`) listing every commit after the head, the paths it touched and how depth-0 verified it. `--post-head-target <ref>` (normally origin/develop) is required with it: own commits are `git rev-list --no-merges <head>..<tip> ^<target>`, so develop history merged into the branch is not listed; a merge in that range whose tree differs from git's own re-merge of its parents (`git diff-tree --remerge-diff`) is listed too. The target must descend from the phase base and must not contain the reviewed head. The checker re-derives the commit list and paths with git; an unlisted commit or path fails.
- The merge gate always runs on the tip.

Scope of the build: Mode A only. `--chain`, `--packets` and Mode B refuse `--post-head-ledger` explicitly. Follow-up (not yet scheduled): support the ledger in Mode D (`--chain`) and Mode C (`--packets`).

Retro backfill: ledgers for g40d1, g40d2 and selgap, written outside the repo and checked with the new flag.
