# dispatch-hetero suites leave detached children

BL-0289. Two detached `bash -c IN_DETACHED_CHILD=1 ... detached_main` processes from a dispatch-hetero test run (`/tmp/autopilot-test-dispatch-hetero-*`) were still running 9 days later on this host, so a suite leaves detached children behind. Trigger-Type event: next time the dispatch-hetero suites are touched. Effort S.
