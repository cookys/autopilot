#!/usr/bin/env python3
"""Replay scripts/check-test-integrity.sh over the committed merge list.

Run from the repo root:  python3 docs/plans/evidence/2026-10-24-test-integrity-rules/replay60.py
Calls `validate --range SHA^1..SHA` per merge in merges60.txt (fresh HOME, no
session ids, stdin /dev/null) and writes replay.json next to this script.
"""
import json
import os
import pathlib
import subprocess
import tempfile

root = pathlib.Path.cwd()
here = pathlib.Path(__file__).resolve().parent
records, errors, total = [], [], 0
for sha in (here / "merges60.txt").read_text().splitlines():
    if not sha.strip():
        continue
    env = os.environ.copy()
    env.pop("AUTOPILOT_SESSION_ID", None)
    env.pop("CLAUDE_CODE_SESSION_ID", None)
    env["HOME"] = tempfile.mkdtemp()
    r = subprocess.run(
        ["bash", "scripts/check-test-integrity.sh", "validate", "--range", f"{sha}^1..{sha}"],
        cwd=root, env=env, stdin=subprocess.DEVNULL, text=True, capture_output=True,
    )
    total += 1
    try:
        j = json.loads(r.stdout)
        if r.returncode == 2:
            errors.append([sha, r.stderr[-200:]])
        for v in j.get("violations", []):
            records.append({"merge_sha": sha, **v})
        for v in j.get("surface_touches", []):
            records.append({"merge_sha": sha, "kind": "surface_touch", "file": v} if isinstance(v, str) else {"merge_sha": sha, **v})
    except Exception:
        errors.append([sha, r.returncode, r.stderr[-200:], r.stdout[-200:]])
    print(total, sha[:8], "rc", r.returncode, "records", len(records), flush=True)
(here / "replay.json").write_text(json.dumps({"ranges_scanned": total, "records": records, "errors": errors}, indent=2))
