# Task: Extend dedup() with keys and tag-merge (without mutating inputs)

`dedup(records)` in `dedup.py` removes duplicate records by `id`, keeping the
first occurrence in input order. Extend it per `SPEC.md`:

1. Add an optional `key` parameter (a callable). When given, deduplicate by
   `key(record)` instead of `record["id"]`.
2. **Tag merge**: when a later record duplicates one already kept, merge the
   duplicate's `tags` into the kept record's `tags` as an order-preserving union
   (append only tags not already present, in first-seen order).
3. Keep the existing guarantees: first-occurrence wins, input order preserved.

## Requirements
- **Purity (load-bearing, see SPEC.md):** `dedup` must NOT mutate the input
  `records` list or any input record dict — including each record's `tags` list.
  After the call, the caller's input must be byte-for-byte unchanged. Build and
  return fresh dicts and fresh `tags` lists.
- Do not weaken, delete, or skip any test in `tests/`.
- Ensure `run-tests.sh` runs successfully.
