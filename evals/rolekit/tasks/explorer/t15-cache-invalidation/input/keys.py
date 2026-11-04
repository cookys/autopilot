def make_key(record):
    """Build the cache key for a record.

    The cache key must capture every field that changes the computed result.
    If two records that should compute DIFFERENT results collapse to the same
    key, the second one silently gets the first one's cached value.
    """
    return (record["id"],)
