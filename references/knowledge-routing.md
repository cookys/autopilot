# Knowledge routing — where a lesson goes, and what may be published

> Canonical home for two decisions that were previously unwritten: **which sink a piece of knowledge
> belongs in**, and **what this public repository may disclose**. Consumed by `skills/learn`,
> `skills/handoff`, and `skills/distill`. Each carries an operational excerpt sized for its own flow;
> **this file is canonical on any conflict** — when an excerpt and this file disagree, the excerpt is
> the stale one and gets repaired here first.
>
> Origin: 2026-08-24 design review of two orthogonal defects — knowledge written into layers that
> evaporate, and a disclosure line that existed only in the habits of whoever authored the three
> `docs(knowledge):` commits. Companion to [`evidence-discipline.md`](evidence-discipline.md).

---

## 1. Why this file exists

**This repository is public.** Nothing in it said so, and nothing said what that implies. The four
tracked files under `.claude/knowledge/` are clean — but they are clean because one author had good
habits, not because a rule was written down. A habit is not a policy: it cannot be handed to the next
session, and it cannot be cited by a skill.

The second defect is durability. Knowledge was being written into layers that evaporate:

- `HANDOFF.md` — whose own Resume-Mode step 5 instructs the next session to **delete it**.
- `~/.claude/projects/<slug>/memory/` — machine-local; invisible to every other machine and to CI.
- `.claude/knowledge/` — **gitignored** (the `.claude/knowledge/` entry in `.gitignore`), so a write there produces an untracked
  file that no clone, no reviewer, and no future worktree will ever see.

That is not hypothetical. The last row of [`../.claude/knowledge/INDEX.md`](../.claude/knowledge/INDEX.md)
records `claude-code-plugin-dogfood-lessons.md` (2026-05-14, five dogfood lessons) as
**從未 commit 進本 repo** — discovered missing by a doc-sync sweep on 2026-07-16, and never recovered.
It was written. It was indexed. It is gone. That row is the precedent every skill in this family cites.

---

## 2. The disclosure line

State it as **categories, never as an instance list.** An instance list is structurally incapable of
protecting a name it was never told — it silently passes every unknown, which is the same defect that
disqualified the identifier deny-list (§5).

| Publishable | Not publishable |
|---|---|
| Vendor and tool names (`z.ai`, Kimi Code CLI, MiniMax, Grok, Gemini, Codex, agy) | Host names, machine aliases, fleet handles |
| Version numbers and version-bound behavior (`Kimi 0.28.0`, `CC 2.1.233`) | `/home/<user>/` paths and anything else naming a real account |
| Incident narrative — what broke, how it was diagnosed, what fixed it | tmux pane addresses, session/pane coordinates |
| In-repo paths (`src/runners/kimi.js`, `scripts/tree.js`) | Endpoint aliases and named-endpoint handles |
| Error messages, exit codes, CLI flags, API shapes | Anything credential-shaped — tokens, keys, cookies, bearer strings |

### The one question

> **把所有 fleet-specific token 刪掉後,這段還能教人嗎?**

- **Yes** → it is a *publishable class*. The lesson lived in the mechanism, not in the machine.
  Route it to `.claude/knowledge/` (or `references/`, per §3) and complete the promotion contract.
- **No** → it is an *inherently machine-local fact*. The identifiers were not decoration; they were
  the content. Route it to `~/.claude/projects/<slug>/memory/` and stop. Do not attempt to launder it
  into a publishable form by find-and-replacing the names — a lesson whose entire substance was a
  hostname becomes, once the hostname is gone, a sentence that teaches nobody anything.

### Grounding — what the currently-public files actually contain

Verified 2026-08-24 against the four tracked files (`INDEX.md`, `architecture.md`,
`debug-patterns.md`, `git-ref-lifecycle-races.md`):

- They carry vendor names, version numbers, in-repo paths and incident narrative — z.ai's
  deterministic 529, Kimi Code CLI 0.28.0's `--prompt` / `--plan` incompatibility, MiniMax, Grok,
  Gemini, worktree-shared `.git/config` identity bleed.
- They carry **zero** host names, **zero** tmux pane addresses, **zero** `/home/<user>/` paths, and
  **zero** credentials.
- Two honest exceptions, recorded rather than hidden, because a future reader should see them
  classified rather than discover them and doubt the whole table:
  1. `INDEX.md` names a personal GitHub repo (`cookys/TWGameProject`) in its cross-repo mirror
     section. A repo handle, not a fleet token, and already public.
  2. `debug-patterns.md` contains the literal address `bot@test.local` — the fabricated Test Bot
     identity from the 2026-07-16 worktree-identity incident. It is `@`-shaped, and therefore the
     nearest thing in the corpus to the not-publishable column, but it is a synthetic fixture value
     that is *part of the incident narrative*: deleting it would remove what the reader needs to
     recognise the same bleed. A fabricated identity is not a credential.

The table above is not aspirational. It is a description of a corpus that already obeys it.

---

## 3. The destination table

Three sinks. Each has a **write contract**, and the contract is the part that gets skipped.

| Sink | Content | Write contract |
|---|---|---|
| `~/.claude/projects/<slug>/memory/` | Anything carrying a fleet token — the "No" branch of the one question | **Default sink.** Write directly. No promotion, no review. It is machine-local by design and that is correct. |
| `.claude/knowledge/` | A publishable, generalizable lesson — a fact or gotcha that survives the token deletion | **Promotion.** Write → `git add -f` → show the user the diff → commit **in the same motion**. See §4. |
| `references/` | Discipline that binds *other skills* — a rule, not a fact | Normal review path: it is a tracked file in a reviewed directory, so the ordinary commit/review flow applies. Typically the [`evidence-discipline.md`](evidence-discipline.md) family. |

The `references/` row is the one people miss. The test is **who obeys it**: a fact that a future
session *looks up* is knowledge; a rule that a future session must *follow* is discipline, and
discipline belongs in `references/` where a skill can cite it by path.

---

## 4. The promotion contract — 不 commit 就等於沒寫

`.claude/knowledge/` is gitignored on purpose. The `.claude/knowledge/` entry in `.gitignore` was
added 2026-04-12 (`8314ca11c`, in the same commit as `.claude/session-start-sha`); the explanatory
comment above it was added 2026-08-24 by this policy's own commit. Sibling `.claude/*` ignores
accreted later — `settings.local.json` 2026-05-14, `next-state.json` 2026-05-18, `agents/` 2026-06-22,
`worktrees/` 2026-06-24 — the same "the `.claude` dir is local state" decision applied repeatedly. It
is **fail-closed by design**: local scratch never leaks into a public repo by
accident. Each of the four tracked knowledge files got there through an explicit `git add -f` in a
`docs(knowledge):` commit.

The consequence is absolute and worth stating in the bluntest available terms:

> **A write to `.claude/knowledge/` that is not committed did not happen.**
> 不 commit 就等於沒寫。

An uncommitted file there is not "saved pending review". It is invisible to `git status` (ignored),
invisible to every other clone, invisible to CI, and one `git clean -xdf` — or one worktree teardown —
from gone. `claude-code-plugin-dogfood-lessons.md` is what that looks like three months later.

The three steps are one motion, not three optional steps:

```bash
# 1. write the file
# 2. force it past the ignore rule
git add -f .claude/knowledge/<file>.md .claude/knowledge/INDEX.md
# 3. show the user what is about to become public, then commit
git diff --cached .claude/knowledge/
git commit -m "docs(knowledge): <one-line summary>" -- .claude/knowledge/
```

The trailing `-- .claude/knowledge/` is load-bearing: **the commit must be scoped to exactly what the
diff showed.** `learn` is routinely invoked mid-task (handoff's step 3.5 calls it during in-flight
work), so unrelated staged files may already be sitting in the index. An unscoped `git commit` would
sweep them in under a `docs(knowledge):` message — and the user would have approved a strict subset of
what actually landed. A disclosure gate that displays less than it commits is not a gate.

Step 3's diff is not ceremony. It is the **human disclosure gate** — the only point at which a person
sees the exact bytes before they become public, and the only defense against the identifier classes
that no scanner can see (§5).

---

## 5. Mechanism vs. gate — what the scanner cannot see

[`scripts/identifier-scan.js`](../scripts/identifier-scan.js) detects **structured tokens only**:
email, IPv4, `/home/<user>/` paths, FQDN, key shapes. Its covered set is pinned by
`hooks/tests/fixtures/identifier-scan/` — those fixtures, not this paragraph, are the referent for any
claim about what it catches.

Its **negative scope is the load-bearing half**: bare hostnames, client and company names, tmux pane
addresses and endpoint aliases have **no mechanical detection whatsoever**. A clean exit means "no
structured token matched". It never means "safe to publish". The human review step in §4 is not a
second opinion on the scanner — for that entire class it is the *only* opinion.

**A finding is a prompt to classify, not a verdict.** These are *shape* detectors, and several
shapes are publishable by §2's table. Run against the four tracked knowledge files today, the scanner
returns 5 findings and **all 5 are correct to publish**: `z.ai` ×3 (a vendor name — the FQDN pattern
cannot distinguish a vendor's domain from a host name) and `bot@test.local` / `test.local` (synthetic
fixture identities from the worktree-identity incident narrative). Expect this class; it is not a bug
to be tuned away. What matters is that an unannounced false-positive class is corrosive in exactly
the way §5's opening warns about, only inverted — a scanner that cries wolf on every vendor domain
trains its readers to dismiss it, and the dismissal habit is what carries a real token through.

So: **exit 1 means "classify these", exit 0 means "I found no shapes"**. Neither is a publish
decision. The publish decision is §2's category question, made by a person, every time.

**Why there is no deny-list.** The obvious patch is a file of the machine's real hostnames and client
names for the scanner to grep. It is rejected on
[ADR-0001](../docs/adr/0001-verification-over-attestation.md) grounds, and the reasoning is recorded
here so a future session hits it before rebuilding it:

> A deny-list silently passes every name it was never told, and then the run emits a **"lint-clean"**
> label. That label attests that *a list was consulted* — not that *the text is clean*. It is
> tamper-evidence of a procedure standing in for verification of a property, and it is **worse than
> no lint at all**, because a scanner that says nothing leaves the reviewer alert while one that says
> "clean" manufactures the confidence that ends the review.

The measure of a disclosure defense is what happens to an identifier it has never seen. A category
question (§2) asks the reviewer to classify it. A deny-list waves it through.

---

## 6. Prose and mechanism land in the same commit

The rule that prevents this document's own failure mode:

> **A sentence naming an executable may not ship before that executable exists.**

Prose that names a mechanism creates a referent. If the referent does not resolve, every downstream
reader — human or model — inherits a belief in a defense that is not running, and unlike a dead
script there is nothing to go inspect. See [`evidence-discipline.md`](evidence-discipline.md) §14 for
the incident and the enforcer.

Two obligations follow, and both are mechanised:

1. **Name the path.** An asserted mechanism states its executable path (`scripts/<name>.<ext>`), not
   a description of one ("the lint", "the scanner"). An unnamed mechanism is undereferenceable by
   construction — no gate can check it. Checklist row:
   [`skill-contract-card.md`](skill-contract-card.md) § Review checklist.
2. **The path must resolve.** `scripts/doc-drift-gate.js`'s `script-refs` check dereferences every
   `scripts/<name>.<ext>` reference in `skills/**` and `references/*.md` and fails on any that does
   not exist. Rule 1 is what gives rule 2 something to bite on.
