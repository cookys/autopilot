"""Shallow-copy a record, then append through the nested tags list.

In real Python this mutates the input. A deep copy would hide the write.
"""


def dedup(records, key=None):
    if key is None:
        key = lambda r: r["id"]
    seen = {}
    out = []
    for r in records:
        k = key(r)
        if k in seen:
            kept = seen[k]
            for t in r.get("tags", []):
                if t not in kept["tags"]:
                    kept["tags"].append(t)
            continue
        kept = dict(r)
        seen[k] = kept
        out.append(kept)
    return out
