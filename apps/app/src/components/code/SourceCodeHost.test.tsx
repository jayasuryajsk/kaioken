// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSourceCodeRendererProps } from "@get-kaioken/plugin-sdk";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { resetDeprecatedAliasWarningsForTests } from "@/lib/plugin-sdk-deprecated-aliases";
import { PluginSourceCode } from "@/components/plugin/PluginSourceCode";
import { SourceCodeHost } from "./SourceCodeHost";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

const kaiokenSourceCode = vi.hoisted(() => ({
  loaded: false,
  lastProps: null as Record<string, unknown> | null,
}));

vi.mock("./KaiokenSourceCode", async () => {
  const React = await import("react");
  kaiokenSourceCode.loaded = true;
  return {
    default: (props: Record<string, unknown>) => {
      kaiokenSourceCode.lastProps = props;
      return React.createElement(
        "div",
        { "data-testid": "kaioken-source-code" },
        "kaioken source",
      );
    },
  };
});

const CONTENT = "const a = 1;\nconst b = 2;\n";
const received: PluginSourceCodeRendererProps[] = [];

function registerSourceCodeRenderer(
  component: (props: PluginSourceCodeRendererProps) => React.ReactNode,
) {
  setPluginSlotRegistrations(
    "demo",
    makePluginRegistrationSet({
      sourceCodeRenderers: [{ id: "source", title: "Demo source", component }],
    }),
  );
}

beforeEach(() => {
  kaiokenSourceCode.loaded = false;
  kaiokenSourceCode.lastProps = null;
  received.length = 0;
  resetPluginSlotStoreForTest();
  resetDeprecatedAliasWarningsForTests();
});

afterEach(() => {
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
});

describe("SourceCodeHost", () => {
  it("keeps Kaioken's renderer chunk unloaded when a replacement never delegates", async () => {
    registerSourceCodeRenderer((props) => {
      received.push(props);
      return <div data-testid="plugin-source">plugin source</div>;
    });

    render(<SourceCodeHost content={CONTENT} path="src/app.ts" />);

    await screen.findByTestId("plugin-source");
    await act(async () => {
      await Promise.resolve();
    });
    expect(kaiokenSourceCode.loaded).toBe(false);
  });

  it("hands the replacement resolved semantic props, not Kaioken's host-only inputs", async () => {
    registerSourceCodeRenderer((props) => {
      received.push(props);
      return <div data-testid="plugin-source">plugin source</div>;
    });

    render(
      <SourceCodeHost
        content={CONTENT}
        path="src/app.ts"
        cacheKey="rev-2:src/app.ts"
        overflow="wrap"
        highlightedLines={{ start: 2, end: 2 }}
        scrollToHighlightedLines
        onSelectionAddToChat={() => {}}
      />,
    );

    await screen.findByTestId("plugin-source");
    const props = received.at(-1);
    expect(props?.content).toBe(CONTENT);
    expect(props?.path).toBe("src/app.ts");
    expect(props?.overflow).toBe("wrap");
    expect(props?.highlightedLines).toEqual({ start: 2, end: 2 });
    expect(Object.keys(props ?? {})).not.toContain("cacheKey");
    expect(Object.keys(props ?? {})).not.toContain("onSelectionAddToChat");
    expect(Object.keys(props ?? {})).not.toContain("scrollToHighlightedLines");
  });

  it("loads Kaioken's renderer only when the replacement delegates", async () => {
    registerSourceCodeRenderer(({ path, Original }) =>
      path.endsWith(".md") ? <div>plugin source</div> : <Original />,
    );

    render(
      <SourceCodeHost
        content={CONTENT}
        path="src/app.ts"
        cacheKey="rev-2:src/app.ts"
        scrollToHighlightedLines
      />,
    );

    expect(await screen.findByTestId("kaioken-source-code")).toBeDefined();
    expect(kaiokenSourceCode.loaded).toBe(true);
    expect(kaiokenSourceCode.lastProps?.cacheKey).toBe("rev-2:src/app.ts");
    expect(kaiokenSourceCode.lastProps?.scrollToHighlightedLines).toBe(true);
  });

  it("falls back to Kaioken's renderer when the replacement crashes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerSourceCodeRenderer(() => {
      throw new Error("replacement exploded");
    });

    render(<SourceCodeHost content={CONTENT} path="src/app.ts" />);

    expect(await screen.findByTestId("kaioken-source-code")).toBeDefined();
  });

  it("resolves presentation defaults for Kaioken's renderer", async () => {
    render(<SourceCodeHost content={CONTENT} path="src/app.ts" />);

    await screen.findByTestId("kaioken-source-code");
    expect(kaiokenSourceCode.lastProps?.overflow).toBe("scroll");
    expect(kaiokenSourceCode.lastProps?.highlightedLines).toBeNull();
  });
});

describe("experimental_SourceCode", () => {
  it("shares the replacement with Kaioken's own surfaces", async () => {
    registerSourceCodeRenderer((props) => {
      received.push(props);
      return <div data-testid="plugin-source">plugin source</div>;
    });

    render(<PluginSourceCode content={CONTENT} path="src/app.ts" />);

    await screen.findByTestId("plugin-source");
    expect(received.at(-1)?.content).toBe(CONTENT);
    expect(received.at(-1)?.highlightedLines).toBeNull();
    expect(kaiokenSourceCode.loaded).toBe(false);
  });
});

describe("SourceCodeHost experimental_Original alias", () => {
  it("delegates to Kaioken's renderer through the alias and warns once across renders", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let renders = 0;
    registerSourceCodeRenderer(({ experimental_Original: LegacyOriginal }) => {
      renders += 1;
      return LegacyOriginal === undefined ? (
        <div>alias missing</div>
      ) : (
        <LegacyOriginal />
      );
    });

    const { rerender } = render(
      <SourceCodeHost content={CONTENT} path="src/app.ts" />,
    );
    expect(await screen.findByTestId("kaioken-source-code")).toBeDefined();
    expect(kaiokenSourceCode.lastProps?.overflow).toBe("scroll");

    rerender(
      <SourceCodeHost content={CONTENT} path="src/app.ts" overflow="wrap" />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(kaiokenSourceCode.lastProps?.overflow).toBe("wrap");
    expect(renders).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "experimental_Original is deprecated; use Original. Removed in kaioken 0.42",
    );
  });

  it("never warns for a renderer that reads Original", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerSourceCodeRenderer(({ Original }) => <Original />);

    render(<SourceCodeHost content={CONTENT} path="src/app.ts" />);

    expect(await screen.findByTestId("kaioken-source-code")).toBeDefined();
    expect(warn).not.toHaveBeenCalled();
  });
});
