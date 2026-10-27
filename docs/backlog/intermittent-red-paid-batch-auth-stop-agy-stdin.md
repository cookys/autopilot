# Two suites go red intermittently under load

BL-0315. bltidy14 candidates (3) and (4), 2026-10-26. `paid-batch-auth-stop.test.sh`: "judging a live record did not let query 3 through (calls=2)" is a timing flake. `agy-stdin-transport.test.sh`: the hetero part goes red occasionally under high host load. Both pass when run alone.
