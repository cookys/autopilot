"""Import-time hang. A bounded oracle must fail closed on the wall clock."""
import time

time.sleep(10**9)


def dedup(records, key=None):
    return []
