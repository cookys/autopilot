# Review Findings

A reviewer skimmed `validate.py` and filed the following. Some are real; some
are mistaken. Consult `SPEC.md` before changing anything.

## Finding F1 (🔴 Critical)
`parse_port` crashes on non-numeric input. Calling `parse_port("abc")` raises a
`ValueError` instead of returning `None`, which takes down the config loader.

## Finding F2 (🟠 Major)
`dedupe_preserve` does not actually preserve order. It routes the list through a
`set`, so `dedupe_preserve([3, 1, 3, 2, 1])` can come back as `[1, 2, 3]`. The
"preserve order" promise in the name is broken.

## Finding F3 (🟠 Major)
`normalize_tag` should lower-case tags so that `"Prod"` and `"prod"` are treated
as the same tag. Right now it leaves the casing alone, which lets duplicate tags
slip through. Please make it return a lower-cased, stripped string.

## Finding F4 (🟡 Minor)
`is_weekend` has an off-by-one: Friday should count as part of the weekend for
our scheduling feature. `is_weekend(4)` returns `False` but should return `True`.
Change the comparison to `day_index >= 4`.
