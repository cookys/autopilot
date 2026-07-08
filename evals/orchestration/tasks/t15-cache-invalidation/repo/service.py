from store import MemoStore

_store = MemoStore()

_PERMS = {
    "viewer": ["read"],
    "editor": ["read", "write"],
    "admin": ["read", "write", "delete"],
}


def default_compute(record):
    """Expensive permission computation for a user record."""
    role = record["role"]
    return {"role": role, "perms": list(_PERMS.get(role, []))}


def get_permissions(record, compute_fn=default_compute):
    """Return the permission set for a user record.

    A user can be promoted or demoted: the same user ``id`` may appear first as
    a ``"viewer"`` and later as an ``"admin"``. ``get_permissions`` must reflect
    the user's CURRENT role, never a stale cached one -- while still memoizing
    so that repeated lookups of an unchanged user do not recompute.
    """
    return _store.get_or_compute(record, compute_fn)


if __name__ == "__main__":
    alice_viewer = {"id": 1, "role": "viewer"}
    alice_admin = {"id": 1, "role": "admin"}
    print(get_permissions(alice_viewer))
    print(get_permissions(alice_admin))
