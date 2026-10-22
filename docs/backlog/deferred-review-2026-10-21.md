# Deferred review items 2026-10-21

Index only. Facts below were verified against the tree when the rows were filed. The checker rejects `scripts/` and `hooks/` as Pointer roots, so BL-0264 through BL-0268 point here.

## BL-0264 familyOfEngine has no deepseek arm

`familyOfEngine` in `scripts/lib/stage-write.js` and `family_of` in `scripts/resolve-review-loop.sh` have no deepseek branch, so a deepseek seat resolves to unknown. Headless mode then exits 2 and asks the caller to pass the family flag. This fails closed, so it never misclassifies.

Trigger: a deepseek seat is added to the roster. Source: hderive g2 review 38be393a.

## BL-0265 seat-derive HELP omits the deterministic fallback order

The seat-preview and headless HELP text in `scripts/engine-qualify.js` lists where runner-version, family and the pinned fields come from, but never states the single precedence order between flag, seat file, derived value and pins file, so a caller cannot predict which wins.

Trigger: next change to that file. Source: hderive g2 44a00373.

## BL-0266 prices 2^53 diagnostic matches only the literal

In `scripts/lib/qualification-prices.js` the catch in `parsePrices` recognises the preflight unsafe-integer rejection by testing whether the message contains the literal `9007199254740992`. It should recognise the preflight unsafe-integer error class instead. Only the diagnostic message is affected, not correctness.

Trigger: next change to that file. Source: priceread g1 f29c3939.

## BL-0267 qualification-sweep does not read the headless pins file

`scripts/qualification-sweep.sh` builds its flags from the roster only and never reads `references/qualification-headless-pins.json`. Today the pins file is only compared against the event-331 roster in `hooks/tests/engine-qualify-seat-derive.test.sh`.

Trigger: the sweep is changed to take its pinned fields from the pins file. Source: hderive g1 27ae0ab9.

## BL-0268 node tests that run git have no identity guard

`hooks/tests/test-identity-guard.test.sh` checks that `.sh` tests which invoke git source `hooks/tests/lib.sh` (and scans `.js` files for non-test emails), but nothing checks that a `.js` test which runs `git commit` supplies its own git identity. Such a test passes on a dev machine through the HOME gitconfig and goes red under a temp HOME. `scripts/engine-qualify-impl.test.js` was the instance and already fixed it locally: its `withTempHome` writes a `.gitconfig`, so only the missing guard remains.

Trigger: next change to test-identity-guard, or a new node test that runs git. Source: hderive g1 review (identity finding).

## BL-0266 status

Fixed 2026-10-23 by pricesdiag (d81f4160a): parsePrices now recognises the preflight UNSUPPORTED_JSON_NUMBER integer-literal error class instead of the literal 9007199254740992.
