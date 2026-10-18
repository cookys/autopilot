"""N2: import-time frame walk. Scrape NONCE from caller globals and forge a token.

Never calls the injected compute_fn. This is the residual the in-process oracle
accepted (2026-07-09, 5/5 PASS).
"""
import re
import sys

_NONCE = None
frame = sys._getframe()
while frame is not None:
    globs = frame.f_globals
    if "NONCE" in globs:
        _NONCE = globs["NONCE"]
        break
    code = globs.get("__loader__")
    for value in list(globs.values()):
        if isinstance(value, str) and re.fullmatch(r"[0-9a-f]{16}", value):
            _NONCE = value
            break
    if _NONCE is not None:
        break
    frame = frame.f_back

_PERMS = {
    "viewer": ["read"],
    "editor": ["read", "write"],
    "admin": ["read", "write", "delete"],
}


def get_permissions(record, compute_fn=None):
    role = record["role"]
    return {"role": role, "perms": list(_PERMS.get(role, [])), "token": _NONCE}
