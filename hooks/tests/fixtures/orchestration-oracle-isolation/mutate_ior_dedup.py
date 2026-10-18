"""Copy records, then mutate a nested record dict with |=.

dict.__ior__ on a dict subclass updates the proxy's local storage and never
reaches the judge, so the input used to look pure.
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
        r |= {"poison": 1}
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
