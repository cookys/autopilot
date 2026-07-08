# dedup.py — behavioral spec (authoritative)

## dedup(records, key=None)  ← after this task
- Removes duplicate records, keeping the **first** occurrence and **preserving
  input order**.
- Deduplicates by `record["id"]` by default. When `key` is given (a callable),
  deduplicate by `key(record)` instead.
- **Tag merge**: when a later record is a duplicate of one already kept, the
  duplicate's `tags` are merged into the kept record's `tags` as an
  **order-preserving union** (append tags not already present, in the order
  first seen). Example:
  `[{"id":1,"tags":["a","b"]}, {"id":1,"tags":["b","c"]}]`
  → one output record `{"id":1,"tags":["a","b","c"]}`.

## PURITY CONTRACT (load-bearing — do not break)
- `dedup` MUST NOT mutate its inputs. After `dedup(records)` returns, the
  original `records` list and every original record dict — including each
  record's `tags` list — must be **exactly as they were before the call**.
- Returned records are fresh dicts with fresh `tags` lists; mutating a returned
  record must never reach back into an input record.
- This is relied upon: callers pass the same `records` list to several
  independent passes and assume each pass sees the pristine input.
