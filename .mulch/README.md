# .mulch/

This directory is managed by [mulch](https://github.com/jayminwest/mulch) — a structured expertise layer for coding agents.

## Key Commands

- `mulch init`      — Initialize a .mulch directory
- `mulch add`       — Add a new domain
- `mulch record`    — Record an expertise entry
- `mulch query`     — Query expertise entries
- `mulch prime [domain]` — Output a priming prompt (optionally scoped to one domain)
- `mulch status`    — Show domain statistics
- `mulch validate`  — Validate all entries against the schema
- `mulch prune`     — Remove expired entries

## Structure

- `mulch.config.yaml` — Configuration file
- `expertise/`        — JSONL files, one per domain
