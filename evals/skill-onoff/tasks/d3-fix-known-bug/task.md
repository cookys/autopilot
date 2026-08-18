Quick fix needed: `parseQuery` drops empty keys — the root cause is the split loop in
`lib/query.js` skipping zero-length segments. `bash run-tests.sh` currently shows the failure.
Fix it properly and land the fix on the develop branch.
