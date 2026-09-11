import { z } from "zod";

/**
 * A plugin id as {@link derivePluginId} produces it: lowercase alphanumerics
 * and dashes, starting with an alphanumeric. Anywhere a plugin id crosses a
 * boundary (a queued row's wait holder) this is what makes it a value the
 * routes and CLI can address back.
 */
export const pluginIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/u);

/**
 * Derive the stable plugin id used for routes, storage, settings, and CLI
 * commands from an npm package name.
 *
 * `kaioken-plugin-linear` and `bb-plugin-linear` become `linear`; scoped names
 * first drop the scope. Marketplace plugins keep the upstream `bb-plugin-`
 * prefix, so both prefixes map to the same id.
 */
export function derivePluginId(packageName: string): string {
  const base = packageName.includes("/")
    ? (packageName.split("/").at(-1) ?? packageName)
    : packageName;
  const id = base
    .replace(/^(?:kaioken-plugin-|bb-plugin-)/, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");
  if (id.length === 0) {
    throw new Error(
      `cannot derive a plugin id from package name "${packageName}"`,
    );
  }
  return id;
}
