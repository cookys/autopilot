# Plan C — secret-scan-diff streams per file
1. RED: 3 MiB fixture range → ENOBUFS exit 2 at base.
2. GREEN: name-only listing + per-file -U0 diffs through the unchanged line scanner; oversize single file → exit 2 named.
3. Sync mirror; verify; one commit on the hands branch.
Acceptance: a release-sized range is scanned; exit codes and JSON shape unchanged.
