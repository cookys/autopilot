# seal-baseline filledByMove is quadratic (BL-0368)

Left over from the sealbase merge (6b31d2a67).

In `tools/migrate/seal-baseline.js`, `filledByMove` is computed for every list entry, and each computation scans all entries (about 4634). One check-rewrite therefore costs roughly 21M mapPath calls. The result is correct, only slow.

Options: compute it only when `hp !== e.path`, or build a reverse lookup table once.

Do it when the P1 file-move lane uses check-rewrite and finds it slow.
