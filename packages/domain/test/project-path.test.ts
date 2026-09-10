import { describe, expect, it } from "vitest";
import {
  deriveProjectNameFromPath,
  getProjectPathValidationMessage,
  INVALID_PROJECT_PATH_MESSAGE,
  isAbsoluteProjectPath,
  isNativeWindowsProjectPath,
  normalizeProjectPathInput,
  PROJECT_PATH_ROOT_MESSAGE,
  UNSUPPORTED_NATIVE_WINDOWS_PROJECT_PATH_MESSAGE,
} from "../src/project-path.js";

describe("project-path", () => {
  const windowsProjectPath = "C:\\Users\\michael\\kaioken";
  const windowsRootPath = "C:\\";
  const uncProjectPath = "\\\\server\\share\\kaioken";

  it("derives a project name from POSIX paths", () => {
    expect(deriveProjectNameFromPath("/srv/repos/kaioken")).toBe("kaioken");
    expect(deriveProjectNameFromPath("/srv/repos/kaioken/")).toBe("kaioken");
    expect(deriveProjectNameFromPath("/mnt/c/Users/michael/kaioken/")).toBe("kaioken");
  });

  it("does not derive a project name from unsupported native Windows paths", () => {
    expect(deriveProjectNameFromPath(windowsProjectPath)).toBe("");
    expect(deriveProjectNameFromPath("C:/Users/michael/kaioken/")).toBe("");
    expect(deriveProjectNameFromPath(uncProjectPath)).toBe("");
  });

  it("does not derive a project name from filesystem roots", () => {
    expect(deriveProjectNameFromPath("/")).toBe("");
    expect(deriveProjectNameFromPath(windowsRootPath)).toBe("");
  });

  it("recognizes supported absolute paths", () => {
    expect(isAbsoluteProjectPath("/srv/repos/kaioken")).toBe(true);
    expect(isAbsoluteProjectPath("/mnt/c/Users/michael/kaioken")).toBe(true);
    expect(isAbsoluteProjectPath(windowsProjectPath)).toBe(false);
    expect(isAbsoluteProjectPath(uncProjectPath)).toBe(false);
    expect(isAbsoluteProjectPath("C:Users\\michael\\kaioken")).toBe(false);
    expect(isAbsoluteProjectPath("relative/path")).toBe(false);
  });

  it("recognizes unsupported native Windows paths", () => {
    expect(isNativeWindowsProjectPath(windowsProjectPath)).toBe(true);
    expect(isNativeWindowsProjectPath("C:/Users/michael/kaioken")).toBe(true);
    expect(isNativeWindowsProjectPath(uncProjectPath)).toBe(true);
    expect(isNativeWindowsProjectPath(windowsRootPath)).toBe(true);
    expect(isNativeWindowsProjectPath("/mnt/c/Users/michael/kaioken")).toBe(false);
  });

  it("normalizes trailing separators without collapsing Linux roots", () => {
    expect(normalizeProjectPathInput("/srv/repos/kaioken/")).toBe("/srv/repos/kaioken");
    expect(normalizeProjectPathInput("/mnt/c/Users/michael/kaioken/")).toBe(
      "/mnt/c/Users/michael/kaioken",
    );
    expect(normalizeProjectPathInput("/")).toBe("/");
    expect(normalizeProjectPathInput(`${windowsProjectPath}\\`)).toBe(
      `${windowsProjectPath}\\`,
    );
  });

  it("returns clear validation messages for unsupported path formats", () => {
    expect(getProjectPathValidationMessage("/srv/repos/kaioken")).toBeNull();
    expect(
      getProjectPathValidationMessage("/mnt/c/Users/michael/kaioken"),
    ).toBeNull();
    expect(getProjectPathValidationMessage("/")).toBe(
      PROJECT_PATH_ROOT_MESSAGE,
    );
    expect(getProjectPathValidationMessage("relative/path")).toBe(
      INVALID_PROJECT_PATH_MESSAGE,
    );
    expect(getProjectPathValidationMessage(windowsProjectPath)).toBe(
      UNSUPPORTED_NATIVE_WINDOWS_PROJECT_PATH_MESSAGE,
    );
    expect(getProjectPathValidationMessage(uncProjectPath)).toBe(
      UNSUPPORTED_NATIVE_WINDOWS_PROJECT_PATH_MESSAGE,
    );
  });
});
