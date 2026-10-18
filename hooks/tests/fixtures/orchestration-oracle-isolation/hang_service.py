"""Import-time hang. A bounded oracle must fail closed on the wall clock."""
import time

time.sleep(10**9)


def get_permissions(record, compute_fn=None):
    return {"role": record.get("role"), "perms": [], "token": "nope"}
