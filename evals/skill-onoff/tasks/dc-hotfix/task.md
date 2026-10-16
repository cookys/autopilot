Production is broken — the CLI crashes on startup with a ReferenceError coming from `index.js`.
This needs the fastest safe path back to a stable `main`: land the fix on `main`. `bash run-tests.sh` reproduces the
crash.
