#!/usr/bin/env node
/**
 * Generate every Kaioken logo and icon asset from one SVG mark.
 *
 *   node scripts/generate-kaioken-brand-assets.mjs
 *
 * The mark is a bold "K": a graphite stem and lower arm with a red upper arm,
 * the Kaioken aura. Assets that the app inverts in dark mode, or that the PWA
 * pipeline tints per favicon color, use the all-graphite variant so the tint
 * math (dark glyph on white) keeps working. After running this, run
 * `pnpm --filter @kaioken/app generate:pwa-icons` to refresh the tinted
 * PWA variants and manifests.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const sharp = createRequire(resolve(root, "apps/app/package.json"))("sharp");

const GRAPHITE = ["#4c4c4c", "#373737", "#212121", "#0f0f0f", "#050505"];
const RED = ["#ff5a4f", "#f0342b", "#d11f1f", "#a80f14", "#7a0a10"];
const WHITE = ["#ffffff", "#f4f4f4", "#e6e6e6", "#d9d9d9", "#cfcfcf"];
const ORANGE = ["#ffa14a", "#f76b15", "#d9560c", "#b34407", "#8a3305"];
const YELLOW = ["#ffd166", "#ffba18", "#e5a300", "#c48a00", "#9c6d00"];

function gradient(id, stops) {
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="80" y1="60" x2="440" y2="460">${stops
    .map(
      (c, i) => `<stop offset="${i / (stops.length - 1)}" stop-color="${c}"/>`,
    )
    .join("")}</linearGradient>`;
}

/**
 * The K mark in a 512x512 box, glyph occupying roughly 70% of the box.
 * `stem` colors the stem and lower arm; `arm` colors the upper arm.
 */
export function markSvg({
  stem = GRAPHITE,
  arm = RED,
  background = "none",
  size = 512,
  scale = 1,
  radius = 0,
} = {}) {
  const t = 512 / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <defs>${gradient("stem", stem)}${gradient("arm", arm)}</defs>
  ${background === "none" ? "" : `<rect width="512" height="512" rx="${radius}" fill="${background}"/>`}
  <g transform="translate(${t} ${t}) scale(${scale}) translate(${-t} ${-t})" stroke-linecap="round" fill="none">
    <line x1="150" y1="118" x2="150" y2="394" stroke="url(#stem)" stroke-width="88"/>
    <line x1="206" y1="258" x2="384" y2="416" stroke="url(#stem)" stroke-width="88"/>
    <line x1="206" y1="254" x2="372" y2="100" stroke="url(#arm)" stroke-width="88"/>
  </g>
</svg>`;
}

async function png(svg, size, { flatten } = {}) {
  let image = sharp(Buffer.from(svg), { density: 300 }).resize(size, size);
  if (flatten) image = image.flatten({ background: flatten });
  return image.png().toBuffer();
}

function write(rel, data) {
  const abs = resolve(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, data);
  console.log(`wrote ${rel}`);
}

async function icns(rel, svg) {
  const dir = mkdtempSync(join(tmpdir(), "kaioken-icns-"));
  const iconset = join(dir, "icon.iconset");
  mkdirSync(iconset);
  for (const [name, size] of [
    ["icon_16x16", 16],
    ["icon_16x16@2x", 32],
    ["icon_32x32", 32],
    ["icon_32x32@2x", 64],
    ["icon_128x128", 128],
    ["icon_128x128@2x", 256],
    ["icon_256x256", 256],
    ["icon_256x256@2x", 512],
    ["icon_512x512", 512],
    ["icon_512x512@2x", 1024],
  ]) {
    writeFileSync(join(iconset, `${name}.png`), await png(svg, size));
  }
  const out = join(dir, "icon.icns");
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", out]);
  write(rel, execFileSync("cat", [out]));
  rmSync(dir, { recursive: true, force: true });
}

async function main() {
  const brand = markSvg();
  const graphite = markSvg({ arm: GRAPHITE });
  const white = markSvg({ stem: WHITE, arm: WHITE });
  const tile = (extra) => markSvg({ background: "#ffffff", ...extra });

  // Shared logo used by the app UI (inverted in dark mode) and docs.
  write("assets/kaioken-logo.svg", graphite);
  write("assets/kaioken-logo.png", await png(graphite, 568));
  write("assets/kaioken-logo-white.png", await png(white, 568));
  write(
    "assets/kaioken-logo-dev.png",
    await png(markSvg({ stem: ORANGE, arm: ORANGE }), 568),
  );
  write(
    "assets/kaioken-logo-black-white-bg-discord.png",
    await png(tile({ arm: GRAPHITE }), 1024),
  );

  // Desktop app icons: stable, dev, nightly (yellow).
  const desktop = tile({ scale: 0.82 });
  const desktopDev = tile({ stem: ORANGE, arm: ORANGE, scale: 0.82 });
  const desktopNightly = tile({ stem: YELLOW, arm: YELLOW, scale: 0.82 });
  write("apps/desktop/assets/icon.png", await png(desktop, 1024));
  write("apps/desktop/assets/icon-dev.png", await png(desktopDev, 1024));
  write(
    "apps/desktop/assets/icon-nightly.png",
    await png(desktopNightly, 1024),
  );
  await icns("apps/desktop/assets/icon.icns", desktop);
  await icns("apps/desktop/assets/icon-nightly.icns", desktopNightly);

  // PWA sources (the generate:pwa-icons script derives the tinted variants).
  const pub = "apps/app/public";
  write(`${pub}/icon-192.png`, await png(graphite, 192));
  write(`${pub}/icon-512.png`, await png(graphite, 512));
  write(
    `${pub}/icon-192-maskable.png`,
    await png(tile({ arm: GRAPHITE, scale: 0.62 }), 192),
  );
  write(
    `${pub}/icon-512-maskable.png`,
    await png(tile({ arm: GRAPHITE, scale: 0.62 }), 512),
  );
  write(
    `${pub}/apple-touch-icon.png`,
    await png(tile({ arm: GRAPHITE, scale: 0.8 }), 180),
  );
  for (const size of [16, 32]) {
    write(`${pub}/favicon-${size}x${size}.png`, await png(brand, size));
    write(`${pub}/favicon-${size}x${size}-dark.png`, await png(white, size));
    write(
      `${pub}/favicon-${size}x${size}-dev.png`,
      await png(markSvg({ stem: ORANGE, arm: ORANGE }), size),
    );
  }

  // Marketing site.
  write("apps/web/src/assets/kaioken-icon.png", await png(brand, 192));
  write(
    "apps/web/src/assets/kaioken-icon-dark.png",
    await png(markSvg({ stem: WHITE }), 192),
  );
  write(
    "apps/web/public/apple-touch-icon.png",
    await png(tile({ scale: 0.8 }), 180),
  );
  for (const size of [16, 32]) {
    write(
      `apps/web/public/favicon-${size}x${size}.png`,
      await png(brand, size),
    );
    write(
      `apps/web/public/favicon-${size}x${size}-dark.png`,
      await png(markSvg({ stem: WHITE }), size),
    );
  }
  const og = `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1260">
  <rect width="2400" height="1260" fill="#0b0b0b"/>
  <g transform="translate(300 330) scale(1.17)">${markSvg({ stem: WHITE }).replace(/<svg[^>]*>|<\/svg>/g, "")}</g>
  <text x="1080" y="640" fill="#ffffff" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="220" font-weight="700">Kaioken</text>
  <text x="1086" y="760" fill="#9a9a9a" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="72">A personal agentic IDE</text>
</svg>`;
  write(
    "apps/web/public/og.png",
    await sharp(Buffer.from(og)).png().toBuffer(),
  );

  // Connect worker inlines the icon as a data URI.
  const connectIcon = (await png(brand, 192)).toString("base64");
  write(
    "apps/connect/src/kaioken-icon.ts",
    `export const KAIOKEN_ICON_DATA_URI =\n  "data:image/png;base64,${connectIcon}";\n`,
  );

  // Mobile app (Expo) assets.
  const mobile = "apps/mobile/assets";
  write(
    `${mobile}/icon.png`,
    await png(tile({ scale: 0.8 }), 1024, { flatten: "#ffffff" }),
  );
  write(
    `${mobile}/icon-dark.png`,
    await png(
      markSvg({ stem: WHITE, background: "#0b0b0b", scale: 0.8 }),
      1024,
    ),
  );
  write(
    `${mobile}/favicon.png`,
    await png(tile({ scale: 0.8 }), 48, { flatten: "#ffffff" }),
  );
  write(`${mobile}/splash-icon.png`, await png(brand, 1024));
  write(
    `${mobile}/splash-icon-dark.png`,
    await png(markSvg({ stem: WHITE }), 1024),
  );
  write(
    `${mobile}/android-icon-foreground.png`,
    await png(markSvg({ scale: 0.55 }), 1024),
  );
  write(
    `${mobile}/android-icon-background.png`,
    await png(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#ffffff"/></svg>`,
      1024,
    ),
  );
  write(
    `${mobile}/android-icon-monochrome.png`,
    await png(markSvg({ stem: WHITE, arm: WHITE, scale: 0.55 }), 1024),
  );
}

await main();
