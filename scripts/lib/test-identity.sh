# scripts/lib/test-identity.sh — canonical G2 test-identity rule (G1: sole copy).
# Source this file. Tests call is_test_identity_email; do not restate the pattern.
#
# is_test_identity_email <email>
#   0 if the address is a test identity (email only; names are never examined)
#   1 otherwise

is_test_identity_email() {
  local email="${1-}"
  local domain
  [ -z "$email" ] && return 0
  domain="${email##*@}"
  domain="${domain,,}"
  [[ "$domain" != *.* ]] && return 0
  case "$domain" in
    example|example.com|example.org|example.net) return 0 ;;
    *.invalid|*.test|*.example|*.local|*.localhost) return 0 ;;
  esac
  return 1
}
