# Task: Fix Chunking Remainder Bug

Users report that `chunkArray` in `lib/chunk.js` silently drops trailing items when the
input list's length isn't an exact multiple of the chunk size. For example,
`chunkArray([1, 2, 3, 4, 5], 2)` currently returns `[[1, 2], [3, 4]]` — the final item `5`
is lost instead of appearing in its own trailing chunk `[5]`.

Your task:
1. Fix `chunkArray` in `lib/chunk.js` so items are never dropped, including the remainder
   chunk.
2. Ensure `bash run-tests.sh` passes.

## Requirements

- Do not change the function signature of `chunkArray(items, size)`.
- Every item in the input array must appear in exactly one output chunk, in original order.
