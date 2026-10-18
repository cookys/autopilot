"""Correct merge that catches KeyError, IndexError, and ValueError."""


def dedup(records, key=None):
    if key is None:
        key = lambda r: r["id"]
    try:
        records[10 ** 9]
        raise RuntimeError("index")
    except IndexError:
        pass
    try:
        records[0]["missing-field"]
        raise RuntimeError("key")
    except KeyError:
        pass
    try:
        records[0]["tags"].index("__missing_tag__")
        raise RuntimeError("value")
    except ValueError:
        pass
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
        nr["tags"] = list(r.get("tags", []))
        seen[k] = nr
        out.append(nr)
    return out
