import { Suspense, lazy, type ReactNode } from "react";
import { PluginReplacementSlot } from "@/components/plugin/PluginReplacementSlot";
import { deprecatedOriginalAlias } from "@/lib/plugin-sdk-deprecated-aliases";
import { useSourceCodeRendererReplacement } from "./codeRendererProvider";
import {
  DEFAULT_CODE_OVERFLOW,
  type KaiokenSourceCodeProps,
} from "./code-rendering";

const SOURCE_CODE_RENDERER_SLOT_KIND = "sourceCodeRenderer";

const KaiokenSourceCode = lazy(() => import("./KaiokenSourceCode"));

interface SourceCodeHostProps extends Omit<
  KaiokenSourceCodeProps,
  "overflow" | "highlightedLines"
> {
  overflow?: KaiokenSourceCodeProps["overflow"];
  highlightedLines?: KaiokenSourceCodeProps["highlightedLines"];
  fallback?: ReactNode;
}

export function SourceCodeHost({
  content,
  path,
  cacheKey,
  overflow = DEFAULT_CODE_OVERFLOW,
  highlightedLines = null,
  className,
  fallback = null,
  scrollToHighlightedLines,
  onSelectionAddToChat,
}: SourceCodeHostProps) {
  const replacement = useSourceCodeRendererReplacement();

  const original = (
    <Suspense fallback={fallback}>
      <KaiokenSourceCode
        content={content}
        path={path}
        cacheKey={cacheKey}
        overflow={overflow}
        highlightedLines={highlightedLines}
        className={className}
        scrollToHighlightedLines={scrollToHighlightedLines}
        onSelectionAddToChat={onSelectionAddToChat}
      />
    </Suspense>
  );

  return (
    <PluginReplacementSlot
      replacement={replacement}
      original={original}
      slotKind={SOURCE_CODE_RENDERER_SLOT_KIND}
    >
      {(slot, BoundOriginal) => (
        <div className={className}>
          <slot.component
            content={content}
            path={path}
            overflow={overflow}
            highlightedLines={highlightedLines}
            Original={BoundOriginal}
            experimental_Original={deprecatedOriginalAlias(BoundOriginal)}
          />
        </div>
      )}
    </PluginReplacementSlot>
  );
}
