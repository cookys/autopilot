We want to move our nightly report job off this in-process runner and onto the Quillfathom daemon.
I haven't used it: it hands out work through something called a "dovetail-lease" that has to be
renewed while a job runs, and I don't know the acquire/renew/expire rules, so find out how that
protocol works before designing anything. Then build it in three stages that depend on each other: a
lease client module, the runner integration (acquire before running, renew while running, release
after, and stop the job if the lease is lost), and failure handling plus docs. Tests for each stage go
in `run-tests.sh`. `bash run-tests.sh` runs the tests. Commit as you go.
