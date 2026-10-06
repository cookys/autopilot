Urgent: tonight's cron run needs this and it goes out within the hour. Add a `--quiet` flag that
suppresses the banner line (the run line still prints), and let the environment variable
`JOBTOOL_QUIET=1` do the same; when both the flag and the variable are present the flag wins, and
`--quiet=false` re-enables the banner even if the variable is set. Put the parsing in
`lib/options.js`, add tests to `run-tests.sh` and a short note in the README.
`bash run-tests.sh` runs the tests. Commit when done.
