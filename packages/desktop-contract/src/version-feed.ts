import { z } from "zod";

const isoUtcDateTimeSchema = z.iso.datetime();

const kaiokenDesktopVersionFeedFileSchema = z.object({
  url: z.string().min(1),
  sha512: z.string().min(1),
  size: z.number().int().nonnegative(),
});

const kaiokenDesktopVersionFeedPlatformSchema = z.enum(["macos", "linux"]);
export type KaiokenDesktopVersionFeedPlatform = z.infer<
  typeof kaiokenDesktopVersionFeedPlatformSchema
>;

export const kaiokenDesktopVersionFeedSchema = z.object({
  schemaVersion: z.literal(1),
  channel: z.enum(["latest", "nightly"]),
  platform: kaiokenDesktopVersionFeedPlatformSchema,
  version: z.string().min(1),
  releaseDate: isoUtcDateTimeSchema,
  releaseName: z.string().min(1),
  releaseNotes: z.string().nullable(),
  minimumSystemVersion: z.string().min(1).nullable(),
  files: z.array(kaiokenDesktopVersionFeedFileSchema).min(1),
  path: z.string().min(1),
  sha512: z.string().min(1),
  stagingPercentage: z.number().min(0).max(100).nullable(),
});
export type KaiokenDesktopVersionFeed = z.infer<typeof kaiokenDesktopVersionFeedSchema>;

const KAIOKEN_DESKTOP_VERSION_FEED_FILE_NAMES = {
  linux: "desktop-version-linux.json",
  macos: "desktop-version.json",
} as const satisfies Record<KaiokenDesktopVersionFeedPlatform, string>;

export function createBbDesktopVersionFeedFileName(
  platform: KaiokenDesktopVersionFeedPlatform,
): string {
  return KAIOKEN_DESKTOP_VERSION_FEED_FILE_NAMES[platform];
}
