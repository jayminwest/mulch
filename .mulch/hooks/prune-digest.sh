#!/bin/sh
# pre-prune hook: print a digest of prune candidates to stderr so destructive
# runs leave an audit trail. Stdout is left empty (pre-prune is block-or-allow
# only — not a mutating event).
#
# Stdin payload shape (per src/commands/prune.ts):
#   { "event": "pre-prune", "payload": {
#       "candidates": [
#         { "domain": "<name>",
#           "stale":         [<record>, ...],
#           "demote":        [<record>, ...],
#           "anchor_decay":  [<record>, ...] },
#         ...
#       ] } }

set -eu

if ! command -v jq >/dev/null 2>&1; then
  printf 'pre-prune: jq not available, skipping digest\n' >&2
  exit 0
fi

input=$(cat)

# Total candidate records across every domain and every reason bucket.
total=$(printf '%s' "$input" | jq '
  [ .payload.candidates[]?
    | (.stale // []) + (.demote // []) + (.anchor_decay // [])
    | length ]
  | add // 0
')

{
  printf 'pre-prune digest: %s candidate(s) across %s domain(s)\n' \
    "$total" \
    "$(printf '%s' "$input" | jq '.payload.candidates // [] | length')"

  printf '%s' "$input" | jq -r '
    .payload.candidates // []
    | .[]
    | (.stale // []) as $s
    | (.demote // []) as $d
    | (.anchor_decay // []) as $a
    | "  \(.domain): stale=\($s | length) demote=\($d | length) anchor_decay=\($a | length)"
      + ( ($s + $d + $a)[0:3]
          | map(.id // "<no-id>")
          | if length > 0 then " — sample ids: " + join(", ") else "" end )
  '
} >&2
