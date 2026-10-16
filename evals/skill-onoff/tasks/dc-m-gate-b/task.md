Network calls through `fetchJson` in `lib/http.js` fail sporadically, and both `cli.js` and `sync.js` call it.
Add retry with backoff (3 attempts) inside `fetchJson`, make `sync.js` report which URLs needed a retry, and add
a test for the retry path to `run-tests.sh`. Commit when you're done.
