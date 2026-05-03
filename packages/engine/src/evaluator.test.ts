import { describe, expect, it } from "vitest";
import type { Card } from "./cards.js";
import { evaluate, winners } from "./evaluator.js";

const c = (s: string): Card => s as Card;

describe("evaluate", () => {
  it("identifies a royal flush as a straight flush with A-high descr", () => {
    const result = evaluate(["Ah", "Kh", "Qh", "Jh", "Th"].map(c));
    expect(result.name).toBe("Straight Flush");
    expect(result.descr.toLowerCase()).toContain("royal");
  });

  it("identifies a full house", () => {
    const result = evaluate(["As", "Ah", "Ad", "Kh", "Kd", "2c", "3c"].map(c));
    expect(result.name).toBe("Full House");
  });

  it("identifies two pair", () => {
    const result = evaluate(["As", "Ah", "Kd", "Kh", "2c", "3c", "4d"].map(c));
    expect(result.name).toBe("Two Pair");
  });

  it("identifies a high card", () => {
    const result = evaluate(["As", "Kh", "Qd", "Jh", "9c", "7d", "3s"].map(c));
    expect(result.name).toBe("High Card");
  });
});

describe("winners", () => {
  it("returns a single index when one player has the best hand", () => {
    const board: Card[] = ["Ah", "Kh", "Qh", "2c", "3d"].map(c);
    const holes: Card[][] = [
      ["Jh", "Th"].map(c), // royal flush
      ["As", "Ks"].map(c), // two pair
    ];
    expect(winners(holes, board)).toEqual([0]);
  });

  it("returns multiple indices on a tie (board plays)", () => {
    const board: Card[] = ["Ah", "Kh", "Qh", "Jh", "Th"].map(c);
    // Both have royal flush (the board)
    const holes: Card[][] = [
      ["2c", "3d"].map(c),
      ["4s", "5h"].map(c),
    ];
    expect(winners(holes, board).sort()).toEqual([0, 1]);
  });

  it("higher kicker wins on identical pair", () => {
    const board: Card[] = ["As", "Kh", "5d", "7c", "2h"].map(c);
    const holes: Card[][] = [
      ["Ah", "Qd"].map(c), // pair of A, kicker K Q 7
      ["Ad", "9s"].map(c), // pair of A, kicker K 9 7
    ];
    expect(winners(holes, board)).toEqual([0]);
  });

  it("flush beats straight", () => {
    const board: Card[] = ["9h", "8h", "7h", "6c", "5d"].map(c);
    const holes: Card[][] = [
      ["Ah", "2h"].map(c), // flush in hearts (A high)
      ["4d", "3c"].map(c), // straight 3-7
    ];
    expect(winners(holes, board)).toEqual([0]);
  });

  it("three-way: returns all tied winners and excludes loser", () => {
    const board: Card[] = ["As", "Ks", "Qs", "Js", "Ts"].map(c);
    // Board is a royal flush in spades — all three players play the board
    const holes: Card[][] = [
      ["2h", "3h"].map(c),
      ["4d", "5d"].map(c),
      ["7c", "8c"].map(c),
    ];
    expect(winners(holes, board).sort()).toEqual([0, 1, 2]);
  });
});
