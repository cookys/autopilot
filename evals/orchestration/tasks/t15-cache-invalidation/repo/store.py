from keys import make_key


class MemoStore:
    """A tiny memoizing store.

    ``get_or_compute(record, compute_fn)`` returns a cached value when a record
    with the same cache key has already been computed; otherwise it calls
    ``compute_fn(record)``, caches the result, and returns it.

    The store MUST keep memoizing: repeated calls for the same logical record
    must not recompute (recomputation here is expensive and is the whole reason
    this store exists).
    """

    def __init__(self):
        self._cache = {}

    def get_or_compute(self, record, compute_fn):
        key = make_key(record)
        if key in self._cache:
            return self._cache[key]
        value = compute_fn(record)
        self._cache[key] = value
        return value
