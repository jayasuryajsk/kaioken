import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { cn } from "@kaioken/shared-ui/lib/utils";
import { composeBackdropAtom } from "@/lib/compose-backdrop/atom";
import {
  BACKDROP_PALETTE_TOKENS,
  createBackdropSimulation,
  isAnimatedBackdrop,
  pickBackdropColor,
  type BackdropSimulation,
} from "@/lib/compose-backdrop/patterns";

const CELL_WIDTH = 8;
const CELL_HEIGHT = 15;
const FONT_SIZE = 12;
const FRAME_INTERVAL_MS = 1000 / 12;
const BASE_ALPHA = 0.16;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function ComposeBackdrop({ className }: { className?: string }) {
  const pattern = useAtomValue(composeBackdropAtom);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || pattern === "off") return;
    const context = canvas.getContext("2d");
    if (context === null) return;
    const effectivePattern =
      isAnimatedBackdrop(pattern) && prefersReducedMotion()
        ? "static"
        : pattern;
    const animated = isAnimatedBackdrop(effectivePattern);
    const seed = Math.floor(Math.random() * 10_000);

    let simulation: BackdropSimulation | null = null;
    let frame = 0;
    let timer = 0;
    let lastPaint = 0;
    let visible = !document.hidden;
    const startedAt = performance.now();

    const paint = (now: number) => {
      if (simulation === null) return;
      const glyphs = simulation.step(now - startedAt);
      const ratio = window.devicePixelRatio || 1;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.font = `${FONT_SIZE}px ui-monospace, Menlo, monospace`;
      context.textBaseline = "top";
      const style = getComputedStyle(canvas);
      const base = style.color;
      const palette = BACKDROP_PALETTE_TOKENS.map((token) =>
        style.getPropertyValue(token).trim(),
      ).filter((value) => value.length > 0);
      for (const glyph of glyphs) {
        context.fillStyle = pickBackdropColor(glyph, palette, base);
        context.globalAlpha = BASE_ALPHA * glyph.alpha;
        context.fillText(
          glyph.char,
          glyph.column * CELL_WIDTH,
          glyph.row * CELL_HEIGHT,
        );
      }
      context.globalAlpha = 1;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      simulation = createBackdropSimulation(
        effectivePattern,
        {
          columns: Math.ceil(rect.width / CELL_WIDTH),
          rows: Math.ceil(rect.height / CELL_HEIGHT),
        },
        seed,
      );
      paint(performance.now());
    };

    const loop = (now: number) => {
      frame = 0;
      if (!visible) return;
      if (now - lastPaint >= FRAME_INTERVAL_MS) {
        lastPaint = now;
        paint(now);
      }
      frame = window.requestAnimationFrame(loop);
    };

    const start = () => {
      if (!animated || frame !== 0 || !visible) return;
      frame = window.requestAnimationFrame(loop);
    };
    const stop = () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      frame = 0;
    };
    const onVisibility = () => {
      visible = !document.hidden;
      if (visible) start();
      else stop();
    };

    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(resize, 80);
    });
    observer.observe(canvas);
    resize();
    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stop();
      window.clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [pattern]);

  if (pattern === "off") return null;

  return (
    <canvas
      ref={canvasRef}
      data-testid="compose-backdrop"
      data-pattern={pattern}
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 size-full text-foreground",
        "[mask-image:radial-gradient(ellipse_70%_75%_at_50%_45%,black_35%,transparent_100%)]",
        className,
      )}
    />
  );
}
