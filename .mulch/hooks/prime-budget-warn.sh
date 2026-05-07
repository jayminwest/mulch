#!/bin/sh
# pre-prime hook: emit a stderr warning when the loaded record set is large
# (>= 200 records across all selected domains). Useful as a heads-up before
# pasting `ml prime` output into a context window. Payload is passed through
# unchanged.
#
# Stdin payload shape: { "event": "pre-prime", "payload": { "domains":
#   [ { "domain", "records": [...] }, ... ] } }

set -eu

if ! command -v jq >/dev/null 2>&1; then
  cat
  exit 0
fi

input=$(cat)

total=$(printf '%s' "$input" | jq '[.payload.domains[]?.records // [] | length] | add // 0')

if [ "$total" -ge 200 ]; then
  printf 'pre-prime: priming %s record(s); consider `ml prime --manifest` or scoping with `--domain`/`--files` to save context.\n' "$total" >&2
fi

# Pass through the original payload (bare shape).
printf '%s' "$input" | jq '.payload'
