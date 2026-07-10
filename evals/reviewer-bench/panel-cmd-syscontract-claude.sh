#!/usr/bin/env bash
# panel-cmd-syscontract-claude.sh — Reviewer-bench panel-cmd adapter that loads the
# autopilot reviewer contract as the REAL system prompt of the local `claude` CLI
# (faithful to how the native Agent loads agents/reviewer.md), then maps the model's
# severity-tiered report output to a pass/fail verdict.
#
# Sibling of panel-cmd-contract-claude.sh (which injects the contract as a prompt
# PREAMBLE — ruled unfaithful in phase-b-results.md). This adapter puts reviewer.md
# in the system-prompt channel and inlines code-review.md in the user message.
#
# v3 tools-enabled behavior: Runs claude with read-only tools enabled (Read, Grep, Glob)
# and sets the working directory to REPO_CWD (resolved dynamically from
# SYSCONTRACT_CWD_MANIFEST if set, otherwise fallback to SYSCONTRACT_REPO_CWD).
# Timeout is increased to 600s. Fail-closed-on-miss semantics apply if manifest is set.
# Bash is deliberately excluded.
#
# Usage: panel-cmd-syscontract-claude.sh <reviewer-md-path> <code-review-md-path> <model>
#   diff on stdin; emits {"verdict":"pass"|"fail"} on stdout; exits 0 on every
#   review outcome (fail-closed), exit 1 only on usage error.
#
# ENV:
#   SYSCONTRACT_REPO_CWD      required default repository directory.
#   SYSCONTRACT_CWD_MANIFEST  optional text file of lines '<sha256> <absolute-path>' mapping diff to worktree.
#   SYSCONTRACT_LOG_DIR       when set, the full raw model output for each case is saved
#                             to <dir>/<case-basename>.out (basename recovered from the
#                             stdin source file via /proc/self/fd/0).

set -uo pipefail

if [ $# -ne 3 ] || [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
  echo "Usage: $0 <reviewer-md-path> <code-review-md-path> <model>" >&2
  exit 1
fi

REVIEWER_MD="$1"
SPEC_MD="$2"
MODEL="$3"

if [ ! -f "$REVIEWER_MD" ] || [ ! -r "$REVIEWER_MD" ]; then
  echo "panel-cmd-syscontract-claude: reviewer methodology contract file does not exist or is not readable: $REVIEWER_MD" >&2
  echo '{"verdict":"fail"}'
  exit 0
fi

if [ ! -f "$SPEC_MD" ] || [ ! -r "$SPEC_MD" ]; then
  echo "panel-cmd-syscontract-claude: canonical review spec file does not exist or is not readable: $SPEC_MD" >&2
  echo '{"verdict":"fail"}'
  exit 0
fi

if [ -z "${SYSCONTRACT_REPO_CWD:-}" ] || [ ! -d "$SYSCONTRACT_REPO_CWD" ]; then
  echo "panel-cmd-syscontract-claude: SYSCONTRACT_REPO_CWD unset or not a directory (required in v2 tools-enabled mode): ${SYSCONTRACT_REPO_CWD:-}" >&2
  echo '{"verdict":"fail"}'
  exit 0
fi
REPO_CWD="$SYSCONTRACT_REPO_CWD"

# STEP 1 — resolve claude binary absolute path before cd'ing to scratch cwd
CC_BIN="$(command -v claude 2>/dev/null || true)"
if [ -z "$CC_BIN" ]; then
  echo "panel-cmd-syscontract-claude: claude binary not found" >&2
  echo "panel-cmd-syscontract-claude: no verdict (fail-closed)" >&2
  echo '{"verdict":"fail"}'
  exit 0
fi

case "$CC_BIN" in
  /*) ;;
  *)  CC_BIN="$(cd "$(dirname "$CC_BIN")" 2>/dev/null && pwd)/$(basename "$CC_BIN")" || true
      case "$CC_BIN" in /*) ;; *) echo "panel-cmd-syscontract-claude: could not resolve claude to an absolute path" >&2; exit 1 ;; esac ;;
esac

# Temp files/dirs
DIFF_TEMP="$(mktemp -t panel-cmd-syscontract-claude-diff-XXXXXX)"
SYS_PROMPT="$(mktemp -t panel-cmd-syscontract-claude-sysprompt-XXXXXX)"
USER_MSG="$(mktemp -t panel-cmd-syscontract-claude-usrmsg-XXXXXX)"
RAW_LOG="$(mktemp -t panel-cmd-syscontract-claude-log-XXXXXX)"

cleanup() {
  rm -f "$DIFF_TEMP" "$SYS_PROMPT" "$USER_MSG" "$RAW_LOG" "$RAW_LOG.err"
}
trap cleanup EXIT

# Read the diff from stdin
cat > "$DIFF_TEMP"

# Insert the lookup after DIFF_TEMP has been read and before STEP 2
if [ -n "${SYSCONTRACT_CWD_MANIFEST:-}" ]; then
  MANIFEST_FILE="$SYSCONTRACT_CWD_MANIFEST"
  if [ ! -f "$MANIFEST_FILE" ] || [ ! -r "$MANIFEST_FILE" ]; then
    echo "panel-cmd-syscontract-claude: SYSCONTRACT_CWD_MANIFEST set but unreadable: $MANIFEST_FILE" >&2
    echo '{"verdict":"fail"}'
    exit 0
  fi
  DIFF_SHA="$(sha256sum "$DIFF_TEMP" | awk '{print $1}')"
  MAPPED="$(awk -v k="$DIFF_SHA" '$1==k{sub(/^[^[:space:]]+[[:space:]]+/,""); print; exit}' "$MANIFEST_FILE")"
  if [ -n "$MAPPED" ]; then
    case "$MAPPED" in
      /*) ;;
      *)  echo "panel-cmd-syscontract-claude: manifest cwd not absolute for $DIFF_SHA: $MAPPED" >&2
          echo '{"verdict":"fail"}'
          exit 0 ;;
    esac
    if [ ! -d "$MAPPED" ]; then
      echo "panel-cmd-syscontract-claude: manifest cwd missing for $DIFF_SHA: $MAPPED" >&2
      echo '{"verdict":"fail"}'
      exit 0
    fi
    REPO_CWD="$MAPPED"
  else
    echo "panel-cmd-syscontract-claude: MANIFEST-MISS $DIFF_SHA (case not enumerated; refusing HEAD fallback)" >&2
    echo '{"verdict":"fail"}'
    exit 0
  fi
fi

# STEP 2 — strip leading YAML frontmatter from REVIEWER_MD to build the system-prompt file.
# Drops the leading `---`…`---` block if present; otherwise copies verbatim.
awk 'NR==1 && $0=="---"{infm=1; next} infm && $0=="---"{infm=0; next} !infm{print}' "$REVIEWER_MD" > "$SYS_PROMPT"

# STEP 3 — build the USER message: note + full canonical spec + the diff. NO verdict-format
# instruction (the reviewer contract's own output format is the parse target).
printf 'The canonical review spec follows, inlined for determinism. You have read-only tools (Read, Grep, Glob) and your working directory is the repository under review; you may verify claims against the codebase, but you cannot run commands or tests. Review the diff per your contract.\n\n' > "$USER_MSG"
cat "$SPEC_MD" >> "$USER_MSG"
printf '\n\nInput diff:\n' >> "$USER_MSG"
cat "$DIFF_TEMP" >> "$USER_MSG"

# STEP 4 — invoke claude with reviewer.md as the REAL system prompt.
# stdout ONLY into RAW_LOG (the report is parsed from model output); stderr is
# diagnostics and must never be able to satisfy the parse. HOME is NOT overridden
# so native auth survives (as in panel-cmd-contract-claude.sh).
ERR_LOG="$RAW_LOG.err"
timeout 600 bash -c 'cd "$1" && exec "$2" -p --model "$3" --system-prompt-file "$4" --setting-sources project --strict-mcp-config --tools "Read,Grep,Glob" < "$5"' \
    _ "$REPO_CWD" "$CC_BIN" "$MODEL" "$SYS_PROMPT" "$USER_MSG" > "$RAW_LOG" 2>"$ERR_LOG"
CC_RC=$?
[ -s "$ERR_LOG" ] && sed 's/^/panel-cmd-syscontract-claude[stderr]: /' "$ERR_LOG" >&2
rm -f "$ERR_LOG"

# STEP 5 — save raw output per-case when SYSCONTRACT_LOG_DIR is set.
# Recover the case basename from the stdin source file (calibration.sh runs the
# panel-cmd with `< <case>.diff`, so /proc/self/fd/0 points at it).
SRC="$(readlink /proc/self/fd/0 2>/dev/null || true)"
BASENAME=""
if [ -n "$SRC" ] && [[ "$SRC" == *.diff ]]; then
  BASENAME="$(basename "$SRC" .diff)"
else
  if command -v sha1sum >/dev/null 2>&1; then
    SHA="$(sha1sum "$DIFF_TEMP" | awk '{print $1}')"
    BASENAME="sha-${SHA:0:12}"
  else
    BASENAME="unknown"
  fi
fi

if [ -n "${SYSCONTRACT_LOG_DIR:-}" ] && [ -f "$RAW_LOG" ]; then
  mkdir -p "$SYSCONTRACT_LOG_DIR" 2>/dev/null || true
  cp "$RAW_LOG" "$SYSCONTRACT_LOG_DIR/$BASENAME.out" 2>/dev/null || true
fi

# STEP 6 — fail-closed on crash/empty
if [ "$CC_RC" -ne 0 ] || [ ! -s "$RAW_LOG" ]; then
  echo "panel-cmd-syscontract-claude: no verdict (fail-closed)" >&2
  echo '{"verdict":"fail"}'
  exit 0
fi

# STEP 7 — SEVERITY-AWARE verdict mapping.
#
# Recognizability: require a STRUCTURAL report anchor, not a bare emoji anywhere in
# the text — an emoji mentioned mid-sentence in otherwise-garbled output must NOT be
# read as a parseable report (else it falls through to a false pass). Parseable IFF
# the output contains the report header, a "Verified Clean" line, or a severity token
# in a structural position (markdown header / bullet / quote lead). Else fail-closed
# + loud marker so legs can distinguish parser misses from real flags.
if ! grep -qF "## Reviewer Report" "$RAW_LOG" \
   && ! grep -qF "Verified Clean" "$RAW_LOG" \
   && ! grep -qE "^[[:space:]]*(#+[[:space:]]*)?[>*+-]*[[:space:]]*(🔴|🟠|🟡|🔵|✅)" "$RAW_LOG"; then
  echo "SYSCONTRACT-UNPARSEABLE" >&2
  echo '{"verdict":"fail"}'
  exit 0
fi

# has_finding: does the given severity have at least one REAL finding? Handles BOTH
# report shapes the contract emits: (a) a `### <emoji> Critical` SECTION HEADER
# followed by finding bullets, and (b) an INLINE `<emoji> **Critical** —` finding
# line (the "Good review" example form in agents/reviewer.md). A none-marker
# ("None", "None found", …) is not a finding; a mid-sentence emoji mention is not a
# finding (emoji must lead the line's content).
has_finding() {
  # $1 = severity emoji, reads RAW_LOG
  awk -v emo="$1" '
    function is_none(s,   t) {
      t=tolower(s)
      gsub(/^[[:space:]]+|[[:space:]]+$/,"",t)
      sub(/\.$/,"",t)
      gsub(/^[[:space:]]+|[[:space:]]+$/,"",t)
      return (t=="" || t=="none" || t=="none found" || t=="none identified" || t=="n/a" || t=="no findings" || t=="no issues" || t=="no critical findings" || t=="no major findings" || t=="no critical issues" || t=="no major issues")
    }
    {
      line=$0
      rest=line
      sub(/^[[:space:]]+/,"",rest)
      if (index(line,emo)>0) {
        if (rest ~ /^#+[[:space:]]*/) {
          # section-header form: open the section, check bullets below it
          insec=1
          next
        }
        # inline form: strip leading bullet/quote markers + bold; emoji must lead
        c=rest
        sub(/^[>*+-]+[[:space:]]*/,"",c)
        sub(/^\*+[[:space:]]*/,"",c)
        if (index(c,emo)==1) {
          body=substr(c,length(emo)+1)
          gsub(/\*/,"",body); sub(/^[[:space:]]+/,"",body)
          sub(/^(Critical|Major|CRITICAL|MAJOR|critical|major)[[:space:]]*/,"",body)
          sub(/^[[:space:]]*[—:-][[:space:]]*/,"",body)
          if (!is_none(body) && body ~ /[[:alnum:]`]/) found=1
        }
        next
      }
      if (line ~ /^#/) { insec=0; next }
      if (insec==1) {
        b=rest
        if (b ~ /^[-*][[:space:]]+/) {
          sub(/^[-*][[:space:]]+/,"",b)
          if (!is_none(b) && b ~ /[[:alnum:]`]/) found=1
        }
      }
    }
    END { print (found?1:0) }
  ' "$RAW_LOG"
}

CRIT="$(has_finding "🔴")"
MAJ="$(has_finding "🟠")"

case "$CRIT$MAJ" in 00|01|10|11) ;; *) echo "SYSCONTRACT-UNPARSEABLE (severity probe malfunction: crit='$CRIT' maj='$MAJ')" >&2; echo '{"verdict":"fail"}'; exit 0 ;; esac

if [ "$CRIT" = "1" ] || [ "$MAJ" = "1" ]; then
  echo '{"verdict":"fail"}'
else
  echo '{"verdict":"pass"}'
fi
exit 0

