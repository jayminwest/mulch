// Strict numeric-flag parsers. `Number.parseFloat("10abc")` silently strips
// trailing garbage and `Number.parseInt("3.7", 10)` truncates to 3 — both
// would let typos through and write nonsense (NaN, partial values) to
// .mulch/expertise/*.jsonl. Use a regex gate + Number() to reject anything
// that isn't a clean numeric literal. Convention: mx-5b9578.

const POSITIVE_INT_RE = /^\d+$/;
const NON_NEGATIVE_NUMBER_RE = /^\d+(\.\d+)?$/;

export function parseStrictPositiveInt(raw: string): number | null {
	if (!POSITIVE_INT_RE.test(raw)) return null;
	const n = Number(raw);
	return Number.isFinite(n) && n >= 1 ? n : null;
}

export function parseStrictNonNegativeNumber(raw: string): number | null {
	if (!NON_NEGATIVE_NUMBER_RE.test(raw)) return null;
	const n = Number(raw);
	return Number.isFinite(n) && n >= 0 ? n : null;
}
