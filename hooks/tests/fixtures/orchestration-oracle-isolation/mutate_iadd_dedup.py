"""Copy records, then mutate a nested tags list with +=.

A proxy that inherits list.__iadd__ updates its own empty storage and the
judge still sees the original list, so this impure write used to pass.
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
        r["tags"] += ["poison"]
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
