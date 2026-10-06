`parseCount('')` returns NaN but it should return 0 (an empty field means a count of zero). Everything else
about `parseCount` is right. `bash run-tests.sh` currently fails on it. Find out why and fix it, then
commit.
