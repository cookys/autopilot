# Two suites go red under load

BL-0315. bltidy14 candidates (3) and (4), 2026-10-26. This row is the only place `agy-stdin-transport` is registered; BL-0313 points here.

- `paid-batch-auth-stop.test.sh`: "judging a live record did not let query 3 through (calls=2)" is a timing assertion.
- `agy-stdin-transport.test.sh`: the hetero part was red in the pre-push comparison and was also red on the base commit (measured, so not introduced by a lane). It passes when run alone.

Basis for "load related": both pass when run alone, and reds were seen while host load was high (about 35 on 2026-10-25). No count of red versus green runs was taken, so "intermittent" is an inference, not a measured rate.
