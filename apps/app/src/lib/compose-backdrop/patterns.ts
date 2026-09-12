import type { ComposeBackdropPattern } from "@kaioken/domain";

export interface BackdropGrid {
  columns: number;
  rows: number;
}

export interface BackdropGlyph {
  column: number;
  row: number;
  char: string;
  alpha: number;
}

export interface BackdropSimulation {
  step: (timeMs: number) => readonly BackdropGlyph[];
}

const DRIFT_RAMP = [" ", " ", " ", "·", "·", ":", "-", "=", "+", "*", "#"];
const RAIN_TRAIL = ["|", "|", ":", ":", "·", "·", " "];
const LIFE_ALIVE = "▪";

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return (
    a * (1 - tx) * (1 - ty) +
    b * tx * (1 - ty) +
    c * (1 - tx) * ty +
    d * tx * ty
  );
}

export function driftValue(
  column: number,
  row: number,
  timeMs: number,
  seed: number,
): number {
  const t = timeMs / 9000;
  const coarse = valueNoise(column / 11 + t, row / 6 - t * 0.6, seed);
  const fine = valueNoise(column / 4 - t * 1.4, row / 2.5 + t, seed + 1);
  return coarse * 0.7 + fine * 0.3;
}

function createDrift(
  grid: BackdropGrid,
  seed: number,
  frozen: boolean,
): BackdropSimulation {
  return {
    step: (timeMs) => {
      const time = frozen ? 0 : timeMs;
      const glyphs: BackdropGlyph[] = [];
      for (let row = 0; row < grid.rows; row += 1) {
        for (let column = 0; column < grid.columns; column += 1) {
          const value = driftValue(column, row, time, seed);
          const index = Math.min(
            DRIFT_RAMP.length - 1,
            Math.floor(value * DRIFT_RAMP.length),
          );
          const char = DRIFT_RAMP[index] ?? " ";
          if (char === " ") continue;
          glyphs.push({
            column,
            row,
            char,
            alpha: 0.35 + value * 0.65,
          });
        }
      }
      return glyphs;
    },
  };
}

interface RainDrop {
  column: number;
  head: number;
  speed: number;
  length: number;
}

function createRain(grid: BackdropGrid, seed: number): BackdropSimulation {
  const drops: RainDrop[] = [];
  const dropCount = Math.max(1, Math.floor(grid.columns / 3));
  for (let index = 0; index < dropCount; index += 1) {
    drops.push({
      column: Math.floor(hash2(index, 0, seed) * grid.columns),
      head: hash2(index, 1, seed) * (grid.rows + RAIN_TRAIL.length),
      speed: 3 + hash2(index, 2, seed) * 6,
      length: RAIN_TRAIL.length,
    });
  }
  let lastTime: number | null = null;
  return {
    step: (timeMs) => {
      const delta = lastTime === null ? 0 : (timeMs - lastTime) / 1000;
      lastTime = timeMs;
      const glyphs: BackdropGlyph[] = [];
      drops.forEach((drop, index) => {
        drop.head += drop.speed * delta;
        if (drop.head - drop.length > grid.rows) {
          drop.head = -hash2(index, timeMs | 0, seed) * grid.rows * 0.5;
          drop.column = Math.floor(
            hash2(index, (timeMs | 0) + 7, seed) * grid.columns,
          );
          drop.speed = 3 + hash2(index, (timeMs | 0) + 11, seed) * 6;
        }
        const headRow = Math.floor(drop.head);
        for (let offset = 0; offset < drop.length; offset += 1) {
          const row = headRow - offset;
          if (row < 0 || row >= grid.rows) continue;
          const char = RAIN_TRAIL[offset] ?? " ";
          if (char === " ") continue;
          glyphs.push({
            column: drop.column,
            row,
            char,
            alpha: 1 - offset / drop.length,
          });
        }
      });
      return glyphs;
    },
  };
}

export function lifeStep(cells: Uint8Array, grid: BackdropGrid): Uint8Array {
  const next = new Uint8Array(cells.length);
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      let neighbours = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = (column + dx + grid.columns) % grid.columns;
          const ny = (row + dy + grid.rows) % grid.rows;
          neighbours += cells[ny * grid.columns + nx] ?? 0;
        }
      }
      const index = row * grid.columns + column;
      const alive = cells[index] === 1;
      next[index] = neighbours === 3 || (alive && neighbours === 2) ? 1 : 0;
    }
  }
  return next;
}

export function seedLife(grid: BackdropGrid, seed: number): Uint8Array {
  const cells = new Uint8Array(grid.columns * grid.rows);
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      cells[row * grid.columns + column] =
        hash2(column, row, seed) < 0.22 ? 1 : 0;
    }
  }
  return cells;
}

const LIFE_TICK_MS = 260;
const LIFE_RESEED_AFTER_TICKS = 220;

function createLife(grid: BackdropGrid, seed: number): BackdropSimulation {
  let cells = seedLife(grid, seed);
  let age = new Uint8Array(cells.length);
  let lastTick: number | null = null;
  let ticks = 0;
  let generation = 0;
  return {
    step: (timeMs) => {
      if (lastTick === null || timeMs - lastTick >= LIFE_TICK_MS) {
        if (lastTick !== null) {
          const next = lifeStep(cells, grid);
          const nextAge = new Uint8Array(cells.length);
          let population = 0;
          for (let index = 0; index < next.length; index += 1) {
            if (next[index] === 1) {
              population += 1;
              nextAge[index] = Math.min(255, (age[index] ?? 0) + 1);
            }
          }
          cells = next;
          age = nextAge;
          ticks += 1;
          if (
            ticks >= LIFE_RESEED_AFTER_TICKS ||
            population < cells.length * 0.02
          ) {
            generation += 1;
            cells = seedLife(grid, seed + generation);
            age = new Uint8Array(cells.length);
            ticks = 0;
          }
        }
        lastTick = timeMs;
      }
      const glyphs: BackdropGlyph[] = [];
      for (let index = 0; index < cells.length; index += 1) {
        if (cells[index] !== 1) continue;
        glyphs.push({
          column: index % grid.columns,
          row: Math.floor(index / grid.columns),
          char: LIFE_ALIVE,
          alpha: 0.45 + Math.min(1, (age[index] ?? 0) / 12) * 0.55,
        });
      }
      return glyphs;
    },
  };
}

export function createBackdropSimulation(
  pattern: Exclude<ComposeBackdropPattern, "off">,
  grid: BackdropGrid,
  seed: number,
): BackdropSimulation {
  switch (pattern) {
    case "drift":
      return createDrift(grid, seed, false);
    case "static":
      return createDrift(grid, seed, true);
    case "rain":
      return createRain(grid, seed);
    case "life":
      return createLife(grid, seed);
  }
}

export function isAnimatedBackdrop(pattern: ComposeBackdropPattern): boolean {
  return pattern !== "off" && pattern !== "static";
}
