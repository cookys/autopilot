"""Correct merge that requires each record to be a Mapping."""

from collections.abc import Mapping


def dedup(records, key=None):
    if key is None:
        key = lambda r: r["id"]
    seen = {}
    out = []
    for r in records:
        if not isinstance(r, Mapping):
            raise RuntimeError("not a mapping")
        tags = r.get("tags", [])
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
