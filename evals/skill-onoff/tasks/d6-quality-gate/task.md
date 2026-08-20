Add input validation for the `--port` option in `server.js`: reject non-numeric values and
anything outside 1-65535 with a clear error and exit code 1. Commit when you're done.
`bash run-tests.sh` runs the tests.
