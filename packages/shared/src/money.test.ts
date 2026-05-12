import { describe, expect, it } from "vitest";
import { formatMoney, parseMoney } from "./money.js";

describe("formatMoney", () => {
  it("formats whole dollars", () => {
    expect(formatMoney(1000)).toBe("$10.00");
    expect(formatMoney(100)).toBe("$1.00");
  });

  it("formats sub-dollar amounts", () => {
    expect(formatMoney(10)).toBe("$0.10");
    expect(formatMoney(25)).toBe("$0.25");
    expect(formatMoney(5)).toBe("$0.05");
    expect(formatMoney(1)).toBe("$0.01");
  });

  it("formats mixed amounts", () => {
    expect(formatMoney(1050)).toBe("$10.50");
    expect(formatMoney(1234)).toBe("$12.34");
  });

  it("formats zero", () => {
    expect(formatMoney(0)).toBe("$0.00");
  });

  it("formats large amounts", () => {
    expect(formatMoney(100_000)).toBe("$1,000.00");
    expect(formatMoney(123_456_789)).toBe("$1,234,567.89");
  });

  it("handles negative amounts with a leading minus", () => {
    expect(formatMoney(-1050)).toBe("-$10.50");
    expect(formatMoney(-10)).toBe("-$0.10");
  });
});

describe("parseMoney", () => {
  it("parses plain decimals as dollars → cents", () => {
    expect(parseMoney("10.50")).toBe(1050);
    expect(parseMoney("0.10")).toBe(10);
    expect(parseMoney("0.25")).toBe(25);
    expect(parseMoney("1")).toBe(100);
  });

  it("strips a leading dollar sign", () => {
    expect(parseMoney("$10.50")).toBe(1050);
    expect(parseMoney("$0.10")).toBe(10);
  });

  it("strips commas", () => {
    expect(parseMoney("1,000")).toBe(100_000);
    expect(parseMoney("$1,234.56")).toBe(123_456);
  });

  it("rounds to the nearest cent", () => {
    expect(parseMoney("0.105")).toBe(11);
    expect(parseMoney("0.104")).toBe(10);
    expect(parseMoney("10.555")).toBe(1056);
  });

  it("trims whitespace", () => {
    expect(parseMoney("  10.50  ")).toBe(1050);
  });

  it("returns null for invalid input", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("$$10")).toBeNull();
    expect(parseMoney("10.50.50")).toBeNull();
  });

  it("round-trips with formatMoney", () => {
    for (const cents of [0, 1, 10, 25, 100, 1050, 1234, 100_000]) {
      const formatted = formatMoney(cents);
      expect(parseMoney(formatted)).toBe(cents);
    }
  });
});
