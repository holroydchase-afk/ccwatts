import { describe, expect, it } from "vitest";
import { errorLine, reason } from "../src/errors.js";

// CCW-H8: what we print for an error must never carry a full path or a URL.
describe("reason", () => {
  it("prefers the error's code, which never holds a path", () => {
    const error = Object.assign(new Error("EISDIR: illegal operation on a directory, read '/home/someone/.ccwatts'"), { code: "EISDIR" });
    expect(reason(error)).toBe("EISDIR");
  });

  it("falls back to the error's name", () => {
    expect(reason(new TypeError("/home/someone/x is broken"))).toBe("TypeError");
  });

  it("ignores a code that isn't a string", () => {
    expect(reason(Object.assign(new RangeError("x"), { code: 42 }))).toBe("RangeError");
  });

  it("says unknown error for anything else", () => {
    expect(reason("/home/someone/secret")).toBe("unknown error");
    expect(reason(undefined)).toBe("unknown error");
    expect(reason({ code: "EACCES" })).toBe("EACCES");
  });
});

describe("errorLine", () => {
  it("keeps a plain message as is", () => {
    expect(errorLine(new Error("--by must be one of: model, day"))).toBe("--by must be one of: model, day");
  });

  it("cuts URLs out of the message", () => {
    const line = errorLine(new Error("See https://example.com/a?token=abc and http://x.test/b for more."));
    expect(line).not.toMatch(/https?:/);
    expect(line).not.toContain("token=abc");
    expect(line).toContain("See ");
    expect(line).toContain(" for more.");
  });

  it("prints a fixed sentence for anything that isn't an Error", () => {
    const line = errorLine("https://example.com/secret");
    expect(line).not.toContain("example.com");
    expect(line.length).toBeGreaterThan(0);
  });
});

describe("PS-R1 errorLine never prints a path from an fs error (CCW-M2.6.4)", () => {
  it("PS-R1 RED: an fs error whose message holds a full path prints no part of that path", () => {
    const error = Object.assign(new Error("EISDIR: illegal operation on a directory, read '/tmp/a/b/c.jsonl'"), { code: "EISDIR", path: "/tmp/a/b/c.jsonl" });
    const line = errorLine(error);
    expect(line).not.toContain("/tmp/a/b");
    expect(line).toContain("EISDIR");
  });
});
