import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { outputJson, outputJsonError } from "../../src/utils/json-output.ts";

describe("outputJson", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("outputs valid JSON with success and command fields", () => {
    outputJson({ success: true, command: "test" });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(output.success).toBe(true);
    expect(output.command).toBe("test");
  });

  it("includes extra fields in output", () => {
    outputJson({ success: true, command: "init", created: true, path: "/tmp" });
    const output = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(output.created).toBe(true);
    expect(output.path).toBe("/tmp");
  });

  it("pretty-prints with 2-space indent", () => {
    outputJson({ success: true, command: "test" });
    const raw = logSpy.mock.calls[0][0] as string;
    expect(raw).toContain("\n");
    expect(raw).toContain("  ");
  });
});

describe("outputJsonError", () => {
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("outputs error to stderr with success: false", () => {
    outputJsonError("test", "something went wrong");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(output.success).toBe(false);
    expect(output.command).toBe("test");
    expect(output.error).toBe("something went wrong");
  });
});
