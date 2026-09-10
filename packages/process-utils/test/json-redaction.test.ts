import { expect, it } from "vitest";
import { redactJsonStrings } from "../src/json-redaction.js";

it("redacts every string value in nested JSON without changing keys", () => {
  expect(
    redactJsonStrings(
      {
        untouchedKey: "secret",
        nested: ["safe", { text: "a secret value" }, null, 2, true],
      },
      (text, path) =>
        path.at(-1) === "untouchedKey"
          ? text
          : text.replaceAll("secret", "[redacted]"),
    ),
  ).toEqual({
    untouchedKey: "secret",
    nested: ["safe", { text: "a [redacted] value" }, null, 2, true],
  });
});
