# hetero-review-loop finalize: open_findings_count mixes open and verified-pending-resolution (BL-0399)

Reporter: codeforge (2026-11-05).

## Problem
- `finalize` prints `open_findings_count`, which counts verified findings not yet resolved by a later generation (`scripts/hetero-review-loop.js` summary object, `open_findings_count: openFindings.length`). By design a verified finding stays open until a later generation resolves it, but the output does not say so.
- The exact resolve syntax is now written in `skills/hetero-review/references/code-loop.md` (docs28).

## Proposed fix
- Split the summary into `open` and `verified_pending_resolution`; keep the old key only if a consumer needs it, in the same change.
- Print, next to a nonzero pending count, the resolve entry shape (`resolutions` array of `{ id, rationale }` in the next dispositions file, or `refinalize --add-resolutions`).
