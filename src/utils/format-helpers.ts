import type { ConventionRecord, ExpertiseRecord, Outcome } from "../schemas/record.ts";
import { computeConfirmationScore } from "./scoring.ts";

export function formatTimeAgo(date: Date): string {
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	if (diffMins < 1) return "just now";
	if (diffMins < 60) return `${diffMins}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	return `${diffDays}d ago`;
}

export function formatEvidence(evidence: ConventionRecord["evidence"]): string {
	if (!evidence) return "";
	const parts: string[] = [];
	if (evidence.commit) parts.push(`commit: ${evidence.commit}`);
	if (evidence.date) parts.push(`date: ${evidence.date}`);
	if (evidence.issue) parts.push(`issue: ${evidence.issue}`);
	if (evidence.file) parts.push(`file: ${evidence.file}`);
	return parts.length > 0 ? ` [${parts.join(", ")}]` : "";
}

export function formatOutcome(outcomes: Outcome[] | undefined): string {
	if (!outcomes || outcomes.length === 0) return "";
	const latest = outcomes.at(-1);
	if (!latest) return "";
	const statusSymbol = latest.status === "success" ? "✓" : latest.status === "partial" ? "~" : "✗";
	const parts: string[] = [statusSymbol];
	if (latest.duration !== undefined) parts.push(`${latest.duration}ms`);
	if (latest.agent) parts.push(`@${latest.agent}`);
	if (outcomes.length > 1) parts.push(`(${outcomes.length}x)`);
	return ` [${parts.join(" ")}]`;
}

export function formatLinks(r: ExpertiseRecord): string {
	const parts: string[] = [];
	if (r.relates_to && r.relates_to.length > 0) {
		parts.push(`relates to: ${r.relates_to.join(", ")}`);
	}
	if (r.supersedes && r.supersedes.length > 0) {
		parts.push(`supersedes: ${r.supersedes.join(", ")}`);
	}
	return parts.length > 0 ? ` [${parts.join("; ")}]` : "";
}

export function formatRecordMeta(r: ExpertiseRecord, full: boolean): string {
	if (!full) return formatLinks(r);
	const parts = [`(${r.classification})${formatEvidence(r.evidence)}`];
	if (r.tags && r.tags.length > 0) {
		parts.push(`[tags: ${r.tags.join(", ")}]`);
	}
	return ` ${parts.join(" ")}${formatLinks(r)}`;
}

export function idTag(r: ExpertiseRecord): string {
	return r.id ? `[${r.id}] ` : "";
}

export function truncate(text: string, maxLen = 100): string {
	if (text.length <= maxLen) return text;
	const sentenceEnd = text.search(/[.!?]\s/);
	if (sentenceEnd > 0 && sentenceEnd < maxLen) {
		return text.slice(0, sentenceEnd + 1);
	}
	return `${text.slice(0, maxLen)}...`;
}

function formatClassificationAge(r: ExpertiseRecord): string {
	const c = r.classification;
	if (c === "foundational") return c;
	const age = formatTimeAgo(new Date(r.recorded_at));
	return `${c} ${age}`;
}

export function compactMeta(r: ExpertiseRecord): string {
	const parts: string[] = [];
	if (r.id) parts.push(r.id);
	parts.push(formatClassificationAge(r));
	const score = computeConfirmationScore(r);
	if (score > 0) {
		parts.push(Number.isInteger(score) ? `★${score}` : `★${score.toFixed(1)}`);
	}
	return ` (${parts.join(", ")})`;
}

export function xmlEscape(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function xmlAttrEscape(str: string): string {
	return xmlEscape(str).replace(/"/g, "&quot;");
}
