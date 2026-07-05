#!/usr/bin/env bash
set -e

# Re-create logs.txt with all test cases including malformed ones
python3 -c '
with open("logs.txt", "wb") as f:
    f.write(b"2026-07-06 10:00:00 INFO User logged in\n")
    f.write(b"2026-07-06 10:01:00 ERROR Database connection failed\n")
    f.write(b"2026-07-06 10:02:00 ERROR\n") # truncated
    f.write(b"2026-07-06 10:03:00 ERROR \xff\xfe\xfd\xfc invalid bytes\n") # binary bytes / wrong charset
    f.write(b"2026-07-06 10:04:00 ERROR " + b"A"*10000 + b"\n") # huge line
'

python3 parser.py
