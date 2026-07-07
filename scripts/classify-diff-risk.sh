#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(pwd)"
COMMAND="classify"
SAMPLE_RATIO=""
DIFF_FILE=""
DIFF_RANGE=""
DIFF_RULES_FILE=""
SOURCE_TRUST=""
ORACLE_AVAILABLE=""
SECURITY_SURFACE=""
RULE_SCOPE="either"
RULE_DOMAIN=""
RULE_PATTERN=""
RULE_CHECKLISTS=""
RULE_APPEND_FILE=""
SAMPLING_SEED=""

# Usage helpers
usage() {
  sed -n '2,180p' "$0" | sed 's/^# \{0,1\}//'
}

err_usage() {
  local msg="$1"
  echo "$msg" >&2
  usage
  exit 2
}

json_escape() {
  printf '%s' "$1" \
    | sed -e 's/\\/\\\\/g' \
      -e 's/\"/\\\"/g' \
      -e ':a;N;$!ba;s/\n/\\n/g'
}

json_array() {
  local -n arr="$1"
  local out='['
  local first=1
  local item=''

  for item in "${arr[@]}"; do
    [ -z "$item" ] && continue
    if [ "$first" -eq 1 ]; then
      first=0
    else
      out="${out},"
    fi
    out="${out}\"$(json_escape "$item")\""
  done

  out="${out}]"
  printf '%s' "$out"
}

normalize_ratio() {
  local ratio="$1"
  if [ -z "$ratio" ]; then
    printf '0'
    return
  fi
  if ! [[ "$ratio" =~ ^([0-9]+(\.[0-9]+)?|\.[0-9]+)$ ]]; then
    err_usage "invalid sampling ratio: $ratio"
  fi
  awk -v r="$ratio" 'BEGIN { if (r < 0) { r = 0 }; if (r > 1) { r = 1 }; printf "%d", int((r + 0.0000005) * 1000000) }'
}

ratio_to_string() {
  local ratio_int="$1"
  awk -v n="$ratio_int" 'BEGIN { printf "%.6f", n/1000000 }'
}

resolve_config_path() {
  local root="$1"
  if [ -n "${REVIEW_LOOP_CONFIG_OVERRIDE:-}" ] && [ -r "${REVIEW_LOOP_CONFIG_OVERRIDE}" ]; then
    echo "$REVIEW_LOOP_CONFIG_OVERRIDE"
    return
  fi
  if [ -r "$root/.claude/review-loop-config.md" ]; then
    echo "$root/.claude/review-loop-config.md"
    return
  fi
  if [ -r "$root/project-config-template/review-loop-config.md" ]; then
    echo "$root/project-config-template/review-loop-config.md"
    return
  fi
}

read_sampling_ratio_from_config() {
  local config_file="$1"
  local ratio=""
  if [ -z "$config_file" ] || [ ! -r "$config_file" ]; then
    echo ""
    return
  fi

  ratio="$(awk '
    $0 ~ /^[[:space:]]*-[[:space:]]*risk_adversarial_sampling_ratio:[[:space:]]*/ {
      sub(/^[[:space:]]*-[[:space:]]*risk_adversarial_sampling_ratio:[[:space:]]*/, "", $0);
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", $0);
      print $0;
      exit;
    }
  ' "$config_file" 2>/dev/null || true)"

  if [ -z "$ratio" ]; then
    echo ""
    return
  fi
  printf '%s' "$ratio"
}

trim() {
  local value="$1"
  value="${value#${value%%[![:space:]]*}}"
  value="${value%${value##*[![:space:]]}}"
  printf '%s' "$value"
}

RULE_FILE_PATH_DEFAULT=''
RULE_FILE_PATH=''

default_rules() {
  cat <<'RULES'
auth	path	(^|/)(auth|authentication)(/|[_.-]|$)	authz-boundary
tenant	path	(^|/)(tenant|tenant[_-]?id)(/|[_.-]|$)	tenant-boundary
tenant	content	\b(tenant|tenant_id|tenant-id)\b	tenant-boundary
dispatch-gate	content	(\b2e\b|dispatch[_ -]?gate|section\s*2e)	dispatch-gate-hardening
money	content	\b(money|billing|stripe|invoice|subscription|payment)\b	billing-contracts,payment-security
schema	path	(^|/)(schema|schemas)(/|[_.-]|$|\..*$)	schema-stability
schema	content	\bschema(_|-)?(version|change|migration)?\b	schema-stability,contracts
migration	path	(^|/)(migration|migrations)(/|[_.-]|$)	migration-safety
migration	content	\b(migration|migrate|ddl)\b	migration-safety
sync-cursor	content	\b(sync|cursor|watermark|cdc)\b	sync-safety,replication-gating
shared-infra	path	(^|/)(shared[_-]?infra|shared-services)(/|[_.-]|$)	shared-infra-hardening
config	path	(^|/)(config|configuration)(/|[_.-]|$|\..*$)	configuration-drift
generated-types	path	(^|/)(generated|types_generated|generated[_-]types|\.generated)	generated-types-contract
contracts	path	(^|/)(contract|contracts)(/|[_.-]|$)	contracts-hardening
concurrency	content	\b(concurrency|mutex|race|lock|deadlock)\b	concurrency-safety
serialization	content	\b(serializ|serialize|deserialize|json|protobuf|marshal|unmarshal)\b	serialization-correctness
db-helper	path	(^|/)(db[-_]?helper|database-helper)(/|[_.-]|$)	db-helper-integrity
feature-flag	path	(^|/)(feature[_-]?flag)(/|[_.-]|$)	feature-flag-governance
feature-flag	content	\b(feature[_-]?flag|flag[_-]?rollout|kill[_-]?switch)\b	feature-flag-governance
clock-timezone	content	\b(clock|timezone|time[_-]?zone|tz)\b	clock-time-ordering
RULES
}

RULES_DOMAINS=()
RULES_SCOPES=()
RULES_PATTERNS=()
RULES_CHECKLISTS=()

append_rule_record() {
  RULES_DOMAINS+=("$1")
  RULES_SCOPES+=("$2")
  RULES_PATTERNS+=("$3")
  RULES_CHECKLISTS+=("$4")
}

clear_rules() {
  RULES_DOMAINS=()
  RULES_SCOPES=()
  RULES_PATTERNS=()
  RULES_CHECKLISTS=()
}

append_rule_list() {
  local -n target="$1"
  local value="$2"
  target+=("$value")
}

load_rules() {
  clear_rules
  local line=''
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    [[ "$line" == \#* ]] && continue
    append_rule_record_from_line "$line"
  done < <(default_rules)

  if [ -n "$RULE_FILE_PATH" ] && [ -r "$RULE_FILE_PATH" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      [[ "$line" == \#* ]] && continue
      append_rule_record_from_line "$line"
    done < "$RULE_FILE_PATH"
  fi
}

append_rule_record_from_line() {
  local raw_line="$1"
  local domain=''
  local scope=''
  local pattern=''
  local checklists=''

  IFS=$'\t' read -r domain scope pattern checklists <<<"$raw_line"
  [ -z "$domain" ] && return
  [ -z "$scope" ] && return
  [ -z "$pattern" ] && return
  domain="$(trim "$domain")"
  scope="$(trim "$scope")"
  pattern="$(trim "$pattern")"
  checklists="$(trim "$checklists")"
  case "$scope" in
    path|content|either) ;;
    *) return ;;
  esac
  append_rule_record "$domain" "$scope" "$pattern" "$checklists"
}

contains() {
  local needle="$1"
  local -n list="$2"
  local item=''
  for item in "${list[@]}"; do
    if [ "$item" = "$needle" ]; then
      return 0
    fi
  done
  return 1
}

append_unique() {
  local value="$1"
  local -n list="$2"
  [ -z "$value" ] && return
  if ! contains "$value" "$2"; then
    list+=("$value")
  fi
}

build_rules_paths() {
  RULE_FILE_PATH_DEFAULT="$REPO_ROOT/.autopilot/diff-risk-rules.tsv"
  if [ -z "$DIFF_RULES_FILE" ]; then
    RULE_FILE_PATH="$RULE_FILE_PATH_DEFAULT"
  else
    RULE_FILE_PATH="$DIFF_RULES_FILE"
  fi
}

append_rule_mode() {
  if [ -z "$RULE_DOMAIN" ]; then
    err_usage "append-rule requires --domain"
  fi
  if [ -z "$RULE_SCOPE" ]; then
    RULE_SCOPE="either"
  fi
  if [ -z "$RULE_PATTERN" ]; then
    err_usage "append-rule requires --pattern"
  fi
  if [ -z "$RULE_CHECKLISTS" ]; then
    err_usage "append-rule requires --checklist"
  fi
  case "$RULE_SCOPE" in
    path|content|either) ;;
    *) err_usage "append-rule --scope must be path|content|either" ;;
  esac

  RULE_DOMAIN="$(trim "$RULE_DOMAIN")"
  RULE_SCOPE="$(trim "$RULE_SCOPE")"
  RULE_PATTERN="$(trim "$RULE_PATTERN")"
  RULE_CHECKLISTS="$(trim "$RULE_CHECKLISTS")"

  if [ -z "$RULE_APPEND_FILE" ]; then
    RULE_APPEND_FILE="$RULE_FILE_PATH_DEFAULT"
  fi
  mkdir -p "$(dirname "$RULE_APPEND_FILE")"
  printf '%s\t%s\t%s\t%s\n' "$RULE_DOMAIN" "$RULE_SCOPE" "$RULE_PATTERN" "$RULE_CHECKLISTS" >> "$RULE_APPEND_FILE"
  printf '{"action":"append","status":"ok","rule":{"domain":"%s","scope":"%s","pattern":"%s","checklists":"%s","file":"%s"}}\n' \
    "$(json_escape "$RULE_DOMAIN")" \
    "$(json_escape "$RULE_SCOPE")" \
    "$(json_escape "$RULE_PATTERN")" \
    "$(json_escape "$RULE_CHECKLISTS")" \
    "$(json_escape "$RULE_APPEND_FILE")"
  exit 0
}

parse_args() {
  if [ "$#" -gt 0 ] && [ "$1" = "append-rule" ]; then
    COMMAND="append-rule"
    shift
  fi

  case "$COMMAND" in
    append-rule)
      while [ "$#" -gt 0 ]; do
        case "$1" in
          --repo)
            REPO_ROOT="${2:-}"
            shift 2
            ;;
          --domain)
            RULE_DOMAIN="${2:-}"
            shift 2
            ;;
          --scope)
            RULE_SCOPE="${2:-}"
            shift 2
            ;;
          --pattern)
            RULE_PATTERN="${2:-}"
            shift 2
            ;;
          --checklist|--checklists)
            RULE_CHECKLISTS="${2:-}"
            shift 2
            ;;
          --rules-file)
            RULE_APPEND_FILE="${2:-}"
            shift 2
            ;;
          -h|--help)
            usage
            exit 0
            ;;
          *)
            err_usage "unknown append-rule arg: $1"
            ;;
        esac
      done
      ;;
    *)
      while [ "$#" -gt 0 ]; do
        case "$1" in
          --help|-h)
            usage
            exit 0
            ;;
          --repo)
            REPO_ROOT="${2:-}"
            shift 2
            ;;
          --diff-file)
            DIFF_FILE="${2:-}"
            shift 2
            ;;
          --range)
            DIFF_RANGE="${2:-}"
            shift 2
            ;;
          --sampling-ratio)
            SAMPLE_RATIO="${2:-}"
            shift 2
            ;;
          --sampling-seed)
            SAMPLING_SEED="${2:-}"
            shift 2
            ;;
          --rules-file)
            DIFF_RULES_FILE="${2:-}"
            shift 2
            ;;
          --source-trust)
            SOURCE_TRUST="${2:-}"
            shift 2
            ;;
          --oracle-available)
            ORACLE_AVAILABLE="${2:-}"
            shift 2
            ;;
          --security-surface)
            SECURITY_SURFACE="${2:-}"
            shift 2
            ;;
          *)
            err_usage "unknown arg: $1"
            ;;
        esac
      done
      ;;
  esac
}

collect_touched_paths() {
  local diff_file="$1"
  local -n paths_out="$2"
  local line=''
  local left=''
  local right=''
  local path=''
  paths_out=()

  while IFS= read -r line; do
    if [[ "$line" == diff\ --git\ * ]]; then
      left="$(awk '{print $3}' <<<"$line")"
      right="$(awk '{print $4}' <<<"$line")"
      for path in "$left" "$right"; do
        path="${path%%\"}"
        path="${path#\"}"
        path="${path#a/}"
        path="${path#b/}"
        [ -z "$path" ] && continue
        [ "$path" = "/dev/null" ] && continue
        append_unique "$path" paths_out
      done
    fi
  done < "$diff_file"
}

classify_diff() {
  local diff_file="$1"
  local diff_lines
  local -a touched_paths=()
  local -a detected_domains=()
  local -a selected_checklists=()
  local protected_path=0
  local high_risk=0
  local matched=0
  local i
  local domain
  local scope
  local pattern
  local rule_checklists
  local checklist
  local path_item
  local ratio_int
  local ratio_str
  local sampling_selected=0
  local sampling_bucket=0
  local sampling_reason=""
  local -i source_trust_is_valid=1
  local src_trust=""

  [ -r "$diff_file" ] || err_usage "diff file is not readable: $diff_file"

  diff_lines="$(wc -l < "$diff_file")"
  [ -z "$diff_lines" ] && diff_lines=0

  collect_touched_paths "$diff_file" touched_paths

  for ((i = 0; i < ${#RULES_PATTERNS[@]}; i += 1)); do
    matched=0
    domain="${RULES_DOMAINS[$i]}"
    scope="${RULES_SCOPES[$i]}"
    pattern="${RULES_PATTERNS[$i]}"
    rule_checklists="${RULES_CHECKLISTS[$i]}"

    if [[ "$scope" == path || "$scope" == either ]]; then
      for path_item in "${touched_paths[@]}"; do
        if printf '%s' "$path_item" | grep -Eq -- "$pattern"; then
          matched=1
          protected_path=1
          break
        fi
      done
    fi

    if (( matched == 0 )) && [[ "$scope" == content || "$scope" == either ]]; then
      if grep -Eq -- "$pattern" "$diff_file"; then
        matched=1
      fi
    fi

    if (( matched == 1 )); then
      high_risk=1
      append_unique "$domain" detected_domains

      if [ -n "$rule_checklists" ]; then
        IFS=',' read -r -a checklist_parts <<<"$rule_checklists"
        for checklist in "${checklist_parts[@]}"; do
          checklist="$(trim "$checklist")"
          append_unique "$checklist" selected_checklists
        done
      fi
    fi
  done

  ratio_int="$(normalize_ratio "${SAMPLE_RATIO}")"
  ratio_str="$(ratio_to_string "$ratio_int")"

  if (( high_risk == 0 )); then
    if (( ratio_int > 0 )); then
      local hash_source=''
      if [ -z "$SAMPLING_SEED" ]; then
        hash_source="$(sha256sum "$diff_file" | awk '{print $1}')"
      else
        hash_source="$(printf '%s|%s' "$SAMPLING_SEED" "$(sha256sum "$diff_file" | awk '{print $1}')" | sha256sum | awk '{print $1}')"
      fi
      sampling_bucket="$(( 0x${hash_source:0:8} % 1000000 ))"
      if [ "$sampling_bucket" -lt "$ratio_int" ]; then
        sampling_selected=1
        sampling_reason="low-risk-sampling"
        append_unique "sampling-sanity" selected_checklists
      else
        sampling_reason="low-risk-not-selected"
      fi
    else
      sampling_reason="low-risk-no-ratio"
    fi
  else
    sampling_reason="high-risk-domain"
    sampling_selected=0
  fi

  if [ -n "$SOURCE_TRUST" ]; then
    src_trust="$(trim "$SOURCE_TRUST")"
    case "$src_trust" in
      high|low) ;;
      *) src_trust="high" ;;
    esac
  else
    src_trust="high"
  fi

  local oracle_value="1"
  local security_value="0"
  if [ -n "$ORACLE_AVAILABLE" ]; then
    case "$ORACLE_AVAILABLE" in
      0|1) oracle_value="$ORACLE_AVAILABLE" ;;
      *) oracle_value="1" ;;
    esac
  fi
  if [ -n "$SECURITY_SURFACE" ]; then
    case "$SECURITY_SURFACE" in
      0|1) security_value="$SECURITY_SURFACE" ;;
      *) security_value="0" ;;
    esac
  fi

  if (( high_risk == 0 && sampling_selected == 1 )); then
    adversarial_review=true
  elif (( high_risk == 1 )); then
    adversarial_review=true
  else
    adversarial_review=false
  fi

  security_value="$(printf '%s' "$security_value")"
  printf '{\n'
  printf '  "version": 1,\n'
  printf '  "repo_root": "%s",\n' "$(json_escape "$REPO_ROOT")"
  printf '  "diff_file": "%s",\n' "$(json_escape "$diff_file")"
  printf '  "diff_range": "%s",\n' "$(json_escape "$DIFF_RANGE")"
  printf '  "diff_lines": %s,\n' "$diff_lines"
  printf '  "domains": %s,\n' "$(json_array detected_domains)"
  printf '  "checklists": %s,\n' "$(json_array selected_checklists)"
  printf '  "adversarial_review": %s,\n' "$adversarial_review"
  printf '  "risk_flags": {\n'
  printf '    "source_trust": "%s",\n' "$src_trust"
  printf '    "diff_lines": %s,\n' "$diff_lines"
  printf '    "protected_path": %s,\n' "$protected_path"
  printf '    "oracle_available": %s,\n' "$oracle_value"
  printf '    "security_surface": %s\n' "$security_value"
  printf '  },\n'
  printf '  "sampling": {\n'
  printf '    "enabled": %s,\n' "$([ "$ratio_int" -gt 0 ] && echo true || echo false)"
  printf '    "ratio": "%s",\n' "$ratio_str"
  printf '    "bucket": %s,\n' "$sampling_bucket"
  printf '    "selected": %s,\n' "$([ "$sampling_selected" -eq 1 ] && echo true || echo false)"
  printf '    "reason": "%s"\n' "$(json_escape "$sampling_reason")"
  printf '  }\n'
  printf '}\n'
}

parse_args "$@"
REPO_ROOT="$(cd "$REPO_ROOT" && pwd)"

if [ "$COMMAND" = "append-rule" ]; then
  build_rules_paths
  append_rule_mode
fi

build_rules_paths
if [ -z "$REPO_ROOT" ]; then
  err_usage "--repo is required"
fi
if [ -z "$DIFF_FILE" ] && [ -z "$DIFF_RANGE" ]; then
  err_usage "--diff-file or --range is required"
fi

if [ -z "$SAMPLE_RATIO" ]; then
  SAMPLE_RATIO="$(read_sampling_ratio_from_config "$(resolve_config_path "$REPO_ROOT")")"
fi

if [ -z "$DIFF_FILE" ]; then
  if [ -z "$DIFF_RANGE" ]; then
    err_usage "--range must be set when --diff-file is absent"
  fi
  if [ -z "$REPO_ROOT" ] || [ ! -d "$REPO_ROOT" ]; then
    err_usage "--repo is required to generate --range"
  fi
  DIFF_FILE="$(mktemp "${TEST_TMP:-/tmp}/classify-diff.XXXXXX")"
  trap 'rm -f "$DIFF_FILE"' EXIT
  if ! git -C "$REPO_ROOT" diff --no-ext-diff --unified=0 "$DIFF_RANGE" -- > "$DIFF_FILE"; then
    rm -f "$DIFF_FILE"
    err_usage "failed to produce diff for range: $DIFF_RANGE"
  fi
else
  if [ ! -r "$DIFF_FILE" ]; then
    err_usage "diff file is not readable: $DIFF_FILE"
  fi
fi

load_rules
classify_diff "$DIFF_FILE"
