# Lane A summary

Landed. Candidate sha 1111aaa.

Review (verified by depth-0):
- A-F1 (Major): the retry helper loops forever when the upstream returns an empty body.
- A-F2 (Major): the cache key ignores the locale, so two locales share one entry.
