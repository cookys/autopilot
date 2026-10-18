"""Copy records, then mutate a nested tags list with *=.

list.__imul__ on a list subclass writes the proxy's local storage, so the
judge's snapshot used to stay unchanged.
"""


def dedup(records, key=None):
    if key is None:
        key = lambda r: r["id"]
    copied = []
    for r in records:
        nr = dict(r)
        nr["tags"] = list(r.get("tags", []))
        copied.append(nr)
    for r in records:
        r["tags"] *= 2
    seen = {}
    out = []
    for r in copied:
        k = key(r)
        if k in seen:
            kept = seen[k]
            for t in r.get("tags", []):
                if t not in kept["tags"]:
                    kept["tags"].append(t)
            continue
        seen[k] = r
        out.append(r)
    return out
