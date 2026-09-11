import { defaultAppSettings } from "@kaioken/domain";
import { describe, expect, it } from "vitest";
import { updateGeneralSetting } from "../commands/settings.js";

describe("updateGeneralSetting", () => {
  it("accepts the server's compatibility field alongside the strict settings schema", () => {
    const updated = updateGeneralSetting(
      { ...defaultAppSettings, showUnhandledProviderEvents: false },
      "streamerMode",
      "true",
    );
    expect(updated.streamerMode).toBe(true);
    expect("showUnhandledProviderEvents" in updated).toBe(false);
  });

  it("parses structured values such as the hidden provider list", () => {
    expect(
      updateGeneralSetting(defaultAppSettings, "hiddenProviderIds", '["pi"]')
        .hiddenProviderIds,
    ).toEqual(["pi"]);
    expect(() =>
      updateGeneralSetting(defaultAppSettings, "hiddenProviderIds", "pi"),
    ).toThrow(/Invalid value/);
    expect(() => updateGeneralSetting(defaultAppSettings, "nope", "1")).toThrow(
      /Unknown general setting/,
    );
  });
});
