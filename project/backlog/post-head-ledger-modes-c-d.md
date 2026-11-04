# post-head ledger in Mode C (--packets) and Mode D (--chain) (BL-0379)

Source: follow-up recorded when the parent item closed (2026-11-04). Not yet scheduled.

BL-0377 shipped `--post-head-ledger <file>` / `--post-head-target <ref>` in 2cd868306 for Mode A only; `--chain`, `--packets` and Mode B refuse the flag explicitly. Wanted: support the ledger in Mode D (`--chain`) and Mode C (`--packets`) so a chain or packets project at the generation cap can account for own commits past the last reviewed head. Red case: an unlisted commit or path past the head must still fail in those modes.
