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

const WAVE_RAMP = [" ", " ", "·", "-", "~", "≈", "="];

function createWaves(grid: BackdropGrid, seed: number): BackdropSimulation {
  const phase = hash2(1, 1, seed) * Math.PI * 2;
  return {
    step: (timeMs) => {
      const t = timeMs / 1400;
      const glyphs: BackdropGlyph[] = [];
      for (let row = 0; row < grid.rows; row += 1) {
        for (let column = 0; column < grid.columns; column += 1) {
          const x = column / 7;
          const y = row / 3;
          const value =
            (Math.sin(x + t + phase) +
              Math.sin(y * 1.3 - t * 0.7) +
              Math.sin((x + y) * 0.8 + t * 0.5) +
              3) /
            6;
          const index = Math.min(
            WAVE_RAMP.length - 1,
            Math.floor(value * WAVE_RAMP.length),
          );
          const char = WAVE_RAMP[index] ?? " ";
          if (char === " ") continue;
          glyphs.push({ column, row, char, alpha: 0.3 + value * 0.7 });
        }
      }
      return glyphs;
    },
  };
}

const MATRIX_GLYPHS = "0123456789ABCDEFabcdefxyz=+*<>:;#$%&";

interface MatrixStream {
  column: number;
  head: number;
  speed: number;
  length: number;
  salt: number;
}

function createMatrix(grid: BackdropGrid, seed: number): BackdropSimulation {
  const streams: MatrixStream[] = [];
  const count = Math.max(1, Math.floor(grid.columns / 2));
  for (let index = 0; index < count; index += 1) {
    streams.push({
      column: Math.floor(hash2(index, 3, seed) * grid.columns),
      head: hash2(index, 4, seed) * grid.rows * 2 - grid.rows,
      speed: 4 + hash2(index, 5, seed) * 8,
      length: 4 + Math.floor(hash2(index, 6, seed) * 10),
      salt: Math.floor(hash2(index, 7, seed) * 1000),
    });
  }
  let lastTime: number | null = null;
  return {
    step: (timeMs) => {
      const delta = lastTime === null ? 0 : (timeMs - lastTime) / 1000;
      lastTime = timeMs;
      const tick = Math.floor(timeMs / 120);
      const glyphs: BackdropGlyph[] = [];
      streams.forEach((stream, index) => {
        stream.head += stream.speed * delta;
        if (stream.head - stream.length > grid.rows) {
          stream.head = -hash2(index, tick, seed) * grid.rows;
          stream.column = Math.floor(
            hash2(index, tick + 13, seed) * grid.columns,
          );
          stream.speed = 4 + hash2(index, tick + 17, seed) * 8;
          stream.length = 4 + Math.floor(hash2(index, tick + 19, seed) * 10);
        }
        const headRow = Math.floor(stream.head);
        for (let offset = 0; offset < stream.length; offset += 1) {
          const row = headRow - offset;
          if (row < 0 || row >= grid.rows) continue;
          const glyphIndex = Math.floor(
            hash2(row, stream.salt + Math.floor(tick / 3), seed) *
              MATRIX_GLYPHS.length,
          );
          glyphs.push({
            column: stream.column,
            row,
            char: MATRIX_GLYPHS[glyphIndex] ?? "0",
            alpha: offset === 0 ? 1 : 0.85 * (1 - offset / stream.length),
          });
        }
      });
      return glyphs;
    },
  };
}

const STAR_GLYPHS = ["·", "·", "+", "*", "✦"];

function createStars(grid: BackdropGrid, seed: number): BackdropSimulation {
  return {
    step: (timeMs) => {
      const glyphs: BackdropGlyph[] = [];
      for (let row = 0; row < grid.rows; row += 1) {
        for (let column = 0; column < grid.columns; column += 1) {
          const presence = hash2(column, row, seed);
          if (presence > 0.08) continue;
          const period = 2000 + hash2(column, row, seed + 2) * 5000;
          const offset = hash2(column, row, seed + 3) * period;
          const twinkle =
            (Math.sin(((timeMs + offset) / period) * Math.PI * 2) + 1) / 2;
          const index = Math.min(
            STAR_GLYPHS.length - 1,
            Math.floor(twinkle * STAR_GLYPHS.length),
          );
          glyphs.push({
            column,
            row,
            char: STAR_GLYPHS[index] ?? "·",
            alpha: 0.2 + twinkle * 0.8,
          });
        }
      }
      return glyphs;
    },
  };
}

const FLOW_GLYPHS = ["→", "↗", "↑", "↖", "←", "↙", "↓", "↘"];

function createFlow(grid: BackdropGrid, seed: number): BackdropSimulation {
  return {
    step: (timeMs) => {
      const t = timeMs / 12000;
      const glyphs: BackdropGlyph[] = [];
      for (let row = 0; row < grid.rows; row += 2) {
        for (let column = 0; column < grid.columns; column += 3) {
          const angle =
            valueNoise(column / 9 + t, row / 4 - t * 0.5, seed) * Math.PI * 2;
          const strength = valueNoise(column / 5 - t, row / 3 + t, seed + 5);
          if (strength < 0.35) continue;
          const index =
            Math.round((angle / (Math.PI * 2)) * FLOW_GLYPHS.length) %
            FLOW_GLYPHS.length;
          glyphs.push({
            column,
            row,
            char: FLOW_GLYPHS[index] ?? "→",
            alpha: 0.25 + strength * 0.75,
          });
        }
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
    case "waves":
      return createWaves(grid, seed);
    case "matrix":
      return createMatrix(grid, seed);
    case "stars":
      return createStars(grid, seed);
    case "flow":
      return createFlow(grid, seed);
  }
}

export function isAnimatedBackdrop(pattern: ComposeBackdropPattern): boolean {
  return pattern !== "off" && pattern !== "static";
}

export const BACKDROP_PALETTE_TOKENS = [
  "--primary",
  "--success",
  "--warning",
  "--file-accent",
] as const;

export function pickBackdropColor(
  glyph: Pick<BackdropGlyph, "column" | "row" | "alpha">,
  palette: readonly string[],
  base: string,
): string {
  if (palette.length === 0 || glyph.alpha < 0.55) return base;
  const band = (Math.sin(glyph.column / 9 + glyph.row / 4) + 1) / 2;
  const index = Math.min(palette.length - 1, Math.floor(band * palette.length));
  return palette[index] ?? base;
}
