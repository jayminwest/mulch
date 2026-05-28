import { describe, expect, it } from "bun:test";
import {
	parseStrictNonNegativeNumber,
	parseStrictPositiveInt,
} from "../../src/utils/numeric-flags.ts";

describe("parseStrictNonNegativeNumber", () => {
	it("accepts integers", () => {
		expect(parseStrictNonNegativeNumber("0")).toBe(0);
		expect(parseStrictNonNegativeNumber("42")).toBe(42);
		expect(parseStrictNonNegativeNumber("1000")).toBe(1000);
	});

	it("accepts decimals", () => {
		expect(parseStrictNonNegativeNumber("3.14")).toBeCloseTo(3.14);
		expect(parseStrictNonNegativeNumber("0.5")).toBe(0.5);
	});

	it("rejects trailing garbage (the parseFloat trap)", () => {
		expect(parseStrictNonNegativeNumber("10abc")).toBeNull();
		expect(parseStrictNonNegativeNumber("3.7xyz")).toBeNull();
	});

	it("rejects non-numeric strings", () => {
		expect(parseStrictNonNegativeNumber("foo")).toBeNull();
		expect(parseStrictNonNegativeNumber("")).toBeNull();
		expect(parseStrictNonNegativeNumber("NaN")).toBeNull();
		expect(parseStrictNonNegativeNumber("Infinity")).toBeNull();
	});

	it("rejects negative numbers and leading signs", () => {
		expect(parseStrictNonNegativeNumber("-1")).toBeNull();
		expect(parseStrictNonNegativeNumber("+1")).toBeNull();
	});

	it("rejects whitespace", () => {
		expect(parseStrictNonNegativeNumber(" 1")).toBeNull();
		expect(parseStrictNonNegativeNumber("1 ")).toBeNull();
	});

	it("rejects exponent / hex notation", () => {
		expect(parseStrictNonNegativeNumber("1e3")).toBeNull();
		expect(parseStrictNonNegativeNumber("0x10")).toBeNull();
	});
});

describe("parseStrictPositiveInt", () => {
	it("accepts positive integers", () => {
		expect(parseStrictPositiveInt("1")).toBe(1);
		expect(parseStrictPositiveInt("100")).toBe(100);
	});

	it("rejects zero", () => {
		expect(parseStrictPositiveInt("0")).toBeNull();
	});

	it("rejects decimals", () => {
		expect(parseStrictPositiveInt("3.7")).toBeNull();
	});

	it("rejects trailing garbage", () => {
		expect(parseStrictPositiveInt("10abc")).toBeNull();
	});
});
