export function redactJsonStrings<T>(
  value: T,
  redact: (text: string, path: readonly (string | number)[]) => string,
): T {
  function visit(current: unknown, path: readonly (string | number)[]): unknown {
    if (typeof current === "string") return redact(current, path);
    if (Array.isArray(current))
      return current.map((entry, index) => visit(entry, [...path, index]));
    if (current !== null && typeof current === "object")
      return Object.fromEntries(
        Object.entries(current).map(([key, entry]) => [
          key,
          visit(entry, [...path, key]),
        ]),
      );
    return current;
  }
  return visit(value, []) as T;
}
