"""Correct merge that uses list.index and list.count."""


def dedup(records, key=None):
    if key is None:
        key = lambda r: r["id"]
    seen = {}
    out = []
    for r in records:
        tags = r.get("tags", [])
        if tags:
            if tags.index(tags[0]) != 0 or tags.count(tags[0]) < 1:
                raise RuntimeError("index/count")
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
