# agy payload-wall probe — the reproducer for the BACKLOG row

Kept here, not in `/tmp`, because reconstructing it is where both investigating hosts made their
methodology errors. See `docs/BACKLOG.md` § "agy `--input-format stream-json` raises the payload
ceiling but does NOT remove it".

## What it establishes, and why it is shaped this way

The question is not "did the call succeed" — `status: SUCCESS` answers that and answers it wrongly.
The question is **"did the tail of the payload reach the model"**. So the nonce sits on the LAST
line and the instruction says to return only that token: a partial read cannot answer it.

Two errors this design exists to prevent, both made for real on 2026-09-11:

- **Instruction at the head.** The first cross-host report put the instruction at the START of the
  payload. The model answered fluently from the head, the run said SUCCESS, and that was read as
  delivery. It measured transport.
- **An invalid model id.** `agy models` lists `gemini-3.8-flash-high|medium|low`; there is no bare
  `gemini-3.8-flash`. Passing one with `--effort` is accepted by the CLI but resolves to something
  you did not choose. Always pass an id the CLI itself lists.

`gen.py` is deterministic — fixed nonce, fixed padding, exact byte count — so two hosts can verify
they are running byte-identical input with `sha256sum` before comparing behaviour. That check is what
eliminated "different input" as an explanation.

## Use

```bash
python3 gen.py 175000 p175000.ndjson
python3 gen.py 200000 p200000.ndjson
sha256sum p*.ndjson     # compare across hosts BEFORE comparing results
bash run.sh p200000.ndjson [model-id]
```

Expected digests (any drift means the generator or Python changed — stop and reconcile first):

```
0faa4a59c0460cdf0fdb2fbb784ad4b98180a63660893ccae33b87875f3a9cf0  p175000.ndjson
38ec8965ccf655ef155344bc81ade833cfbcf2109c77a0453b44719d5d0beeb9  p200000.ndjson
```

Also record `sha256sum $(command -v agy)`. **`agy --version` is not version evidence** — the same
byte-identical binary reported 1.2.0 before `agy update` and 1.2.1 after, with mtime untouched.

## Reading the result

`tail_nonce=NO` with `status: SUCCESS` is the finding, not an error. On one host that came back as an
empty `response` string — a seat that "reviewed and found nothing", indistinguishable field-by-field
from a clean review. That is the fail-open this row exists to document.
