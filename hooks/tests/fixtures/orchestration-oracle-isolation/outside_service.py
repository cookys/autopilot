"""Correct t15 service.py planted outside the candidate directory."""
from store import MemoStore

_store = MemoStore()

_PERMS = {
    "viewer": ["read"],
    "editor": ["read", "write"],
    "admin": ["read", "write", "delete"],
}


def default_compute(record):
    role = record["role"]
    return {"role": role, "perms": list(_PERMS.get(role, []))}


def get_permissions(record, compute_fn=default_compute):
    return _store.get_or_compute(record, compute_fn)
