#!/usr/bin/env bash
set -e
python3 - <<'PY'
from service import get_permissions

viewer = {"id": 7, "role": "viewer"}
admin = {"id": 7, "role": "admin"}

assert get_permissions(viewer)["perms"] == ["read"], "viewer perms"
assert "delete" in get_permissions(admin)["perms"], \
    "a promoted user must get fresh perms, not a stale cached role"

print("ok")
PY
