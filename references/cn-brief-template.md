# Restricted operator brief

Use exactly these fields in this order, with a nonempty value for each section:

```text
Brief-Class: clean-sandbox
Task: Describe the public-source task.
Inputs: Describe the permitted inputs.
Output: Describe the expected result.
Limits: Describe the constraints.
```

Do not include repository paths. Task is limited to 6 KB, Inputs to 24 KB,
Output and Limits to 2 KB each, and the complete brief to 40 KB. Code blocks
may contain at most 40 lines each and 80 lines total.

The shingle check only establishes that the brief has no verbatim 8-token overlap
with the current contents of the single `--source-repo`. Other repositories,
rewritten logic, and ignored files are outside its coverage.
