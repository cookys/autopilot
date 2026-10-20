# orchestration-eval-gate test reads a BASE_SHA missing from develop

BL-0263. File: hooks/tests/orchestration-eval-gate.test.sh. It reads files with git show at BASE_SHA 3a72a54dc.

That commit is not an ancestor of develop. It only survives in some local object stores. After a fresh clone or gc the test fails with rc=128.

Suggested fix: re-anchor BASE_SHA on a commit reachable from develop.
