def dedup(records):
    """Remove duplicate records, keeping the FIRST occurrence and preserving
    input order. Deduplicate by ``record["id"]``.

    PURITY CONTRACT (load-bearing -- see SPEC.md and tests/):
    ``dedup`` MUST NOT mutate the input ``records`` list or any input record
    dict (including nested values such as each record's ``tags`` list). Callers
    reuse the input list after calling ``dedup`` and rely on it being untouched.
    Every record ``dedup`` returns is a fresh dict.
    """
    seen = set()
    out = []
    for r in records:
        rid = r["id"]
        if rid in seen:
            continue
        seen.add(rid)
        out.append(dict(r))
    return out
