"""Correct merge that copies the record list and the tags list with list.copy."""


def dedup(records, key=None):
    if key is None:
        key = lambda r: r["id"]
    records = records.copy()
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
        nr["tags"] = r["tags"].copy()
        seen[k] = nr
        out.append(nr)
    return out
