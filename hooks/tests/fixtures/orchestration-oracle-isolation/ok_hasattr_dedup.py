"""Correct merge that probes missing attributes with hasattr and getattr."""


def dedup(records, key=None):
    if key is None:
        key = lambda r: r["id"]
    seen = {}
    out = []
    for r in records:
        if hasattr(r, "no_such_attr"):
            raise RuntimeError("hasattr")
        if getattr(r, "no_such_attr", None) is not None:
            raise RuntimeError("getattr")
        tags = r.get("tags", [])
        if hasattr(tags, "no_such_attr"):
            raise RuntimeError("hasattr-tags")
        if getattr(tags, "no_such_attr", []) != []:
            raise RuntimeError("getattr-tags")
        k = key(r)
        if k in seen:
            kept = seen[k]
            for t in tags:
                if t not in kept["tags"]:
                    kept["tags"].append(t)
            continue
        nr = dict(r)
        nr["tags"] = list(tags)
        seen[k] = nr
        out.append(nr)
    return out
