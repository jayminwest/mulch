import { DEFAULT_PRIME_TIER_WEIGHTS, type PrimeTierWeights } from "../schemas/config.ts";
import type { ExpertiseRecord } from "../schemas/record.ts";
import { TRACKERS, type TrackerName } from "./active-work.ts";
import { fileLivesUnderDir } from "./dir-anchors.ts";
import type { ActiveContext } from "./git.ts";
import { fileMatchesAny } from "./git.ts";
import { computeConfirmationScore } from "./scoring.ts";

// Trust-tier ranking for `ml prime` full-mode output (v0.10 slice 3 of the
// prime overhaul). The corpus is ordered so the most trustworthy records
// surface first within the budget cap: star-confirmed > foundational >
// tactical > observational. Within-tier ties preserve insertion order so a
// stable run-to-run shape lets agents notice when the top of the list shifts.

export type ResolvedTierWeights = Required<PrimeTierWeights>;

export function resolveTierWeights(override?: PrimeTierWeights): ResolvedTierWeights {
	return { ...DEFAULT_PRIME_TIER_WEIGHTS, ...(override ?? {}) };
}

export function computeTrustScore(r: ExpertiseRecord, weights: ResolvedTierWeights): number {
	const stars = computeConfirmationScore(r);
	const tier = weights[r.classification] ?? 0;
	return stars * weights.star + tier;
}

export function sortByTrust<T extends ExpertiseRecord>(
	records: T[],
	weights: ResolvedTierWeights,
): T[] {
	// Stable sort: equal scores keep insertion order so within-tier output is
	// deterministic. Array.prototype.sort is stable in Node ≥ 12 but the
	// index decorator makes the contract explicit and survives engine quirks.
	const decorated = records.map((r, i) => ({
		r,
		i,
		score: computeTrustScore(r, weights),
	}));
	decorated.sort((a, b) => b.score - a.score || a.i - b.i);
	return decorated.map((d) => d.r);
}

// "Why surfaced now" reasons — one per record, picked in priority order so the
// strongest signal wins. The agent-facing suffix shows the picked reason; the
// structured shape stays in the type system for future consumers (warren UI,
// audit reports).
export type SurfaceReason =
	| { kind: "file_match"; anchor: string }
	| { kind: "tracker_match"; tracker: TrackerName; id: string }
	| { kind: "stars"; count: number }
	| { kind: "recent"; daysAgo: number }
	| { kind: "universal" };

// Recency window for the "recent authorship" reason. Aligned with the
// tactical shelf-life floor so newly-recorded conventions get a why-surfaced
// hint even before they accumulate confirmations.
export const RECENT_AUTHORSHIP_DAYS = 7;

export function whySurfaced(r: ExpertiseRecord, ctx: ActiveContext | null): SurfaceReason {
	if (ctx) {
		const files = "files" in r && Array.isArray(r.files) ? r.files : undefined;
		if (files && files.length > 0) {
			for (const f of files) {
				if (fileMatchesAny(f, ctx.changedFiles)) {
					return { kind: "file_match", anchor: f };
				}
			}
		}
		if (Array.isArray(r.dir_anchors) && r.dir_anchors.length > 0) {
			for (const d of r.dir_anchors) {
				for (const cf of ctx.changedFiles) {
					if (fileLivesUnderDir(cf, d)) {
						return { kind: "file_match", anchor: d };
					}
				}
			}
		}
		for (const t of TRACKERS) {
			const active = ctx.trackers[t];
			const evValue = r.evidence?.[t];
			if (
				typeof active === "string" &&
				active !== "" &&
				typeof evValue === "string" &&
				active === evValue
			) {
				return { kind: "tracker_match", tracker: t, id: active };
			}
		}
	}
	const stars = computeConfirmationScore(r);
	if (stars > 0) return { kind: "stars", count: stars };
	const recordedAt = new Date(r.recorded_at);
	if (!Number.isNaN(recordedAt.getTime())) {
		const days = Math.floor((Date.now() - recordedAt.getTime()) / (1000 * 60 * 60 * 24));
		if (days < RECENT_AUTHORSHIP_DAYS) {
			return { kind: "recent", daysAgo: Math.max(0, days) };
		}
	}
	return { kind: "universal" };
}

export function formatSurfaceReason(reason: SurfaceReason): string {
	switch (reason.kind) {
		case "file_match":
			return `why: file match (${reason.anchor})`;
		case "tracker_match":
			return `why: in-progress ${reason.tracker}:${reason.id}`;
		case "stars": {
			const formatted = Number.isInteger(reason.count)
				? `★${reason.count}`
				: `★${reason.count.toFixed(1)}`;
			return `why: ${formatted} confirmations`;
		}
		case "recent":
			return reason.daysAgo === 0 ? "why: recorded today" : `why: recorded ${reason.daysAgo}d ago`;
		case "universal":
			return "why: applies broadly (no anchors)";
	}
}

// Build a per-record-id annotation map for downstream formatters. Records
// without an id are skipped — pre-id corpora exist in older projects and the
// formatters key on id-bearing lines.
export function buildSurfaceAnnotations(
	records: ExpertiseRecord[],
	ctx: ActiveContext | null,
): Map<string, string> {
	const map = new Map<string, string>();
	for (const r of records) {
		if (!r.id) continue;
		map.set(r.id, formatSurfaceReason(whySurfaced(r, ctx)));
	}
	return map;
}
