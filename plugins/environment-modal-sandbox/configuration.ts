export const SETTING_DESCRIPTORS = {
  tokenId: {
    type: "string",
    secret: true,
    label: "Modal token id",
    description:
      "The token id half of a Modal API token (modal token new writes one to ~/.modal.toml).",
  },
  tokenSecret: {
    type: "string",
    label: "Modal token secret",
    secret: true,
    description: "The token secret half of the same Modal API token.",
  },
  appName: {
    type: "string",
    label: "Modal app name",
    description: "The Modal app the sandboxes are created in.",
    default: "bb-sandboxes",
  },
  idleMinutes: {
    type: "number",
    label: "Hibernate after idle (minutes)",
    description:
      "Snapshot and stop an idle sandbox after this long. Use 0 to keep it running until Modal's 24-hour sandbox limit.",
    default: 15,
  },
  cpu: {
    type: "number",
    label: "CPU cores",
    description:
      "Physical cores reserved, fractional allowed. Blank uses Modal's default of 0.125.",
  },
  memoryMiB: {
    type: "number",
    label: "Memory (MiB)",
    description: "Memory reserved in MiB. Blank uses Modal's default of 128.",
  },
} as const;

export interface ResolvedSettings {
  tokenId: string;
  tokenSecret: string;
  appName: string;
  idleMs: number | null;
  cpu: number | null;
  memoryMiB: number | null;
}

export type SettingsResolution =
  | { ok: true; settings: ResolvedSettings }
  | { ok: false; message: string };

export interface RawSettings {
  tokenId: string | undefined;
  tokenSecret: string | undefined;
  appName: string;
  idleMinutes: number;
  cpu: number | undefined;
  memoryMiB: number | undefined;
}

export const SANDBOX_LIFETIME_MS = 24 * 60 * 60_000;
const MAX_IDLE_MINUTES = 24 * 60;

export function resolveSettings(raw: RawSettings): SettingsResolution {
  const tokenId = (raw.tokenId ?? "").trim();
  const tokenSecret = (raw.tokenSecret ?? "").trim();
  const missing: string[] = [];
  if (tokenId.length === 0) missing.push("tokenId");
  if (tokenSecret.length === 0) missing.push("tokenSecret");
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Modal sandbox is not configured: set ${missing.join(", ")} in the plugin's settings.`,
    };
  }
  const appName = raw.appName.trim();
  if (appName.length === 0) {
    return { ok: false, message: "Modal sandbox appName must not be blank." };
  }
  if (raw.cpu !== undefined && !(Number.isFinite(raw.cpu) && raw.cpu > 0)) {
    return {
      ok: false,
      message: `Modal sandbox cpu must be a positive number or blank, not ${raw.cpu}.`,
    };
  }
  if (
    raw.memoryMiB !== undefined &&
    !(Number.isFinite(raw.memoryMiB) && raw.memoryMiB > 0)
  ) {
    return {
      ok: false,
      message: `Modal sandbox memoryMiB must be a positive number or blank, not ${raw.memoryMiB}.`,
    };
  }
  if (
    !Number.isInteger(raw.idleMinutes) ||
    raw.idleMinutes < 0 ||
    raw.idleMinutes > MAX_IDLE_MINUTES
  ) {
    return {
      ok: false,
      message: `Modal sandbox idleMinutes must be a whole number between 0 and ${MAX_IDLE_MINUTES}, not ${raw.idleMinutes}.`,
    };
  }
  return {
    ok: true,
    settings: {
      tokenId,
      tokenSecret,
      appName,
      idleMs: raw.idleMinutes === 0 ? null : raw.idleMinutes * 60_000,
      cpu: raw.cpu ?? null,
      memoryMiB: raw.memoryMiB ?? null,
    },
  };
}
