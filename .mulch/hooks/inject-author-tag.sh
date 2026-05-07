#!/bin/sh
# pre-record hook: append `author:<git-email>` to record.tags[] when no
# `author:*` tag is present. Uses `tags` (a base record field) instead of a
# bespoke top-level field because record schemas are additionalProperties:false
# — injecting `owner` would fail re-validation.
#
# Stdin payload shape: { "event": "pre-record", "payload": { "domain", "record" } }
# Stdout: bare modified payload `{ "domain", "record" }` (mulch accepts both
# bare-payload and { payload } envelope shapes).
#
# Skip if jq or git aren't available — print original payload unchanged.

set -eu

if ! command -v jq >/dev/null 2>&1; then
  cat
  exit 0
fi

email=$(git config user.email 2>/dev/null || true)
if [ -z "$email" ]; then
  # No git author configured — pass through unchanged.
  jq '.payload'
  exit 0
fi

# Strip the @domain so the tag stays terse. Falls back to the full email if
# there's no @ (defensive).
short=$(printf '%s' "$email" | awk -F@ '{print $1}')
if [ -z "$short" ]; then
  short="$email"
fi
author_tag="author:${short}"

jq --arg tag "$author_tag" '
  .payload as $p
  | ($p.record.tags // []) as $tags
  | if ($tags | map(startswith("author:")) | any) then $p
    else $p | .record.tags = ($tags + [$tag])
    end
'
