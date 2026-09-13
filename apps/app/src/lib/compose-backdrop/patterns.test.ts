import { describe, expect, it } from "vitest";
import {
  createBackdropSimulation,
  driftValue,
  lifeStep,
  pickBackdropColor,
  seedLife,
} from "./patterns";

const grid = { columns: 12, rows: 6 };

describe("compose backdrop patterns", () => {
  it("drift is deterministic per seed and moves over time", () => {
    expect(driftValue(3, 2, 0, 7)).toBe(driftValue(3, 2, 0, 7));
    expect(driftValue(3, 2, 0, 7)).not.toBe(driftValue(3, 2, 0, 8));
    const before = createBackdropSimulation("drift", grid, 7).step(0);
    const after = createBackdropSimulation("drift", grid, 7).step(6000);
    expect(before).not.toEqual(after);
    for (const glyph of before) {
      expect(glyph.column).toBeLessThan(grid.columns);
      expect(glyph.row).toBeLessThan(grid.rows);
      expect(glyph.alpha).toBeGreaterThan(0);
      expect(glyph.alpha).toBeLessThanOrEqual(1);
    }
  });

  it("static freezes the drift field", () => {
    const simulation = createBackdropSimulation("static", grid, 3);
    expect(simulation.step(0)).toEqual(simulation.step(15000));
  });

  it("rain drops fall and stay inside the grid", () => {
    const simulation = createBackdropSimulation("rain", grid, 5);
    const first = simulation.step(0);
    const later = simulation.step(400);
    expect(later.length).toBeGreaterThan(0);
    expect(first).not.toEqual(later);
    for (const glyph of later) {
      expect(glyph.row).toBeGreaterThanOrEqual(0);
      expect(glyph.row).toBeLessThan(grid.rows);
    }
  });

  it("life follows Conway's rules with wraparound", () => {
    const blinker = new Uint8Array(grid.columns * grid.rows);
    blinker[2 * grid.columns + 4] = 1;
    blinker[2 * grid.columns + 5] = 1;
    blinker[2 * grid.columns + 6] = 1;
    const next = lifeStep(blinker, grid);
    expect(next[1 * grid.columns + 5]).toBe(1);
    expect(next[2 * grid.columns + 5]).toBe(1);
    expect(next[3 * grid.columns + 5]).toBe(1);
    expect(next[2 * grid.columns + 4]).toBe(0);
    expect(lifeStep(next, grid)).toEqual(blinker);
    expect(seedLife(grid, 1).some((cell) => cell === 1)).toBe(true);
  });

  it("life only advances on its tick interval", () => {
    const simulation = createBackdropSimulation("life", grid, 9);
    const a = simulation.step(0);
    const b = simulation.step(100);
    const c = simulation.step(600);
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
  });
});

describe("newer backdrop patterns", () => {
  it.each(["waves", "matrix", "stars", "flow"] as const)(
    "%s animates and stays inside the grid",
    (pattern) => {
      const simulation = createBackdropSimulation(pattern, grid, 9);
      const first = simulation.step(0);
      const later = simulation.step(2500);
      expect(later.length).toBeGreaterThan(0);
      expect(first).not.toEqual(later);
      for (const glyph of later) {
        expect(glyph.column).toBeGreaterThanOrEqual(0);
        expect(glyph.column).toBeLessThan(grid.columns);
        expect(glyph.row).toBeGreaterThanOrEqual(0);
        expect(glyph.row).toBeLessThan(grid.rows);
        expect(glyph.alpha).toBeGreaterThan(0);
        expect(glyph.alpha).toBeLessThanOrEqual(1);
        expect(glyph.char.trim().length).toBeGreaterThan(0);
      }
    },
  );

  it("stars keep the same positions and only twinkle", () => {
    const simulation = createBackdropSimulation("stars", grid, 4);
    const key = (glyphs: readonly { column: number; row: number }[]) =>
      glyphs.map((glyph) => `${glyph.column}:${glyph.row}`).join(",");
    expect(key(simulation.step(0))).toBe(key(simulation.step(900)));
  });
});

describe("pickBackdropColor", () => {
  it("tints only strong glyphs and falls back to the base colour", () => {
    const palette = ["red", "green", "blue"];
    expect(
      pickBackdropColor({ column: 0, row: 0, alpha: 0.2 }, palette, "base"),
    ).toBe("base");
    expect(
      pickBackdropColor({ column: 0, row: 0, alpha: 0.9 }, [], "base"),
    ).toBe("base");
    const strong = pickBackdropColor(
      { column: 3, row: 1, alpha: 0.9 },
      palette,
      "base",
    );
    expect(palette).toContain(strong);
    expect(
      pickBackdropColor({ column: 3, row: 1, alpha: 0.9 }, palette, "base"),
    ).toBe(strong);
  });
});
