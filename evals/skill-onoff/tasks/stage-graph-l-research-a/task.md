Please add support for the Zyphrelt-7 interchange format to this importer. I have never worked with
it: as far as I know it wraps records in "glimmerwake" frames and protects them with a checksum whose
details I don't have, so working out how Zyphrelt-7 and its glimmerwake framing really behave comes
first. Then, in three stages that build on each other: a parser module for the format, registration
in the format registry plus CLI selection, and tests plus a docs page. `bash run-tests.sh` runs
the tests. Commit as you go.
