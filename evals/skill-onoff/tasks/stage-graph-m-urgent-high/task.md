Urgent, this has to ship today: sessions should expire after 30 minutes of inactivity instead of a
fixed eight hours since login. Every request that carries a valid session must push its expiry out
another 30 minutes, and a session idle for longer must be rejected. The expiry rule belongs in
`src/auth/session.js`; the request middleware must refresh the activity time and answer 401 with the
body `session expired` (not the generic one) when the session was valid but timed out. Also add a
`/session/status` route that returns the seconds remaining. Add tests to `run-tests.sh` and update
`docs/sessions.md`. `bash run-tests.sh` runs the tests. Commit when done.
