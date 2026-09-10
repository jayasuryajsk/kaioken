import type { ThreadEvent } from "@bb/domain";
import { redactJsonStrings } from "@bb/process-utils";

const contentRoots = new Set(["arguments", "params", "payload", "result"]);
const structuralKeys = new Set([
  "action",
  "category",
  "cause",
  "core",
  "direction",
  "jsonrpc",
  "kind",
  "method",
  "mode",
  "reason",
  "source",
  "status",
  "tone",
  "tool",
  "type",
]);

export function redactThreadEventContent<T extends ThreadEvent>(
  event: T,
  redact: (text: string) => string,
): T {
  return redactJsonStrings(event, (text, path) => {
    if (path.some((part) => contentRoots.has(String(part)))) return redact(text);
    const key = String(path.at(-1));
    return structuralKeys.has(key) || key === "id" || key.endsWith("Id")
      ? text
      : redact(text);
  });
}
