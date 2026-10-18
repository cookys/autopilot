"""Import-time flood. A bounded oracle must fail closed on output size."""
print("X" * 5_000_000)


def get_permissions(record, compute_fn=None):
    return {"role": record.get("role"), "perms": [], "token": "nope"}
