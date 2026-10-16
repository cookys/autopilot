# dedupe(list)

Returns a new array with duplicate entries removed, preserving FIRST-occurrence order.
Entries are compared by strict equality. Non-array input throws TypeError.
Example: dedupe(["b","a","b","c","a"]) → ["b","a","c"]
