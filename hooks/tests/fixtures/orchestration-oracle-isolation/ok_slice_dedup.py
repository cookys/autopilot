"""Correct merge that copies with slices."""


def dedup(records, key=None):
    if key is None:
        key = lambda r: r["id"]
    records = records[:]
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
        nr = dict(r)
        nr["tags"] = r["tags"][:]
        seen[k] = nr
        out.append(nr)
    return out
