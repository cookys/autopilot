# rrint1 review follow-ups (BL-0384 a / BL-0389 stage 1) (BL-0394)

Source: deferred Suggestions from the rrint1 hetero-review, generation 1.

## Items
- Range value case: `Range: Full` / `FULL` is matched case-insensitively on the key but not on the value, so it falls to "unrecognised" (and fails under `--strict-range`). Normalise full/delta in `scripts/hetero-review-loop.js` (`parseSpecRange`, `rangeMismatches`).
- A bare `--expect-range` followed by another flag parses to true and is silently ignored; make it a usage error.
- The refinalize and packet paths do not emit the unresolved-findings warning.
- Test hardening in `hooks/tests/hetero-review-loop.test.sh`:
  - R2 re-finalize of generation 1 asserts only the absence of a warning (no exit-code check) and never reaches the SHIP-AS-IS guard; add a generation-1 SHIP-AS-IS case that has its own open Minor.
  - The R6 block restores the shared repo's branch without asserting it.

## Notes
- Trigger: next change to `hetero-review-loop.js`. Effort S.
