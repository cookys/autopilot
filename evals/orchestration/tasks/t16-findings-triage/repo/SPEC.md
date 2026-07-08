# validate.py — behavioral spec (authoritative)

These are the intended, agreed-upon contracts. Code that matches this spec is
CORRECT even if a review note claims otherwise.

## parse_port(s)
- Returns an `int` when `s` names a valid TCP port, i.e. an integer in the
  inclusive range **1..65535**.
- Port `0` is NOT a valid port and must return `None`.
- Non-numeric input (e.g. `"abc"`, `None`) must return `None` — it must **not**
  raise.

## dedupe_preserve(items)
- Returns the items with duplicates removed, keeping the **first** occurrence
  and **preserving the original order**.
- Example: `dedupe_preserve([3, 1, 3, 2, 1]) == [3, 1, 2]`.

## normalize_tag(tag)
- Tags are **case-sensitive by design**. Two tags that differ only in case are
  different tags (`"Prod"` and `"prod"` are distinct environments).
- `normalize_tag` strips surrounding whitespace ONLY; it must preserve casing
  exactly. `normalize_tag("  Prod  ") == "Prod"`.

## is_weekend(day_index)
- `day_index`: `0` = Monday, `1` = Tuesday, … `6` = Sunday.
- The weekend is **Saturday (5)** and **Sunday (6)** only.
- Friday (`4`) is a weekday: `is_weekend(4) == False`.
