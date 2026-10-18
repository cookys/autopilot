"""Correct merge that compares proxies with ==."""


def dedup(records, key=None):
    if key is None:
        key = lambda r: r["id"]
    seen = {}
    out = []
    for r in records:
        if records and not (records[0] == records[0]):
            raise RuntimeError("eq")
        tags = r.get("tags", [])
        if tags and not (tags == tags):
            raise RuntimeError("eq-tags")
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
