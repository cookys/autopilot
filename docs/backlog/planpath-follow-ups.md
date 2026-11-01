# planpath follow-ups (BL-0367)

Left over from the planpath merge (3b39f9077), found in acceptance.

## 1. repoRoot defaults to cwd

A consumer run from a project subdirectory (graph-check, graduation, doc-drift-gate) must pass `--repo-root` itself. Measured in acceptance: doc-drift-gate run from docs/ exits rc=1 with `2 check(s) FAILED`, and the message never names repoRoot.

To evaluate: should the default become the project root that owns the cwd? That can only be decided by the caller, never inferred from the manifest. At minimum, make the error message name the repoRoot it used.

## 2. Read counter in test 5j misses canonical reads

In `hooks/tests/manifest-path-resolver.test.sh`, case 5j counts reads by comparing only `String(f) === target`. A read through the canonical path is not counted. Compare against `fs.realpathSync(target)` as well.
