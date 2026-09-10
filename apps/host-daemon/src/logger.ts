import type { Logger } from "@kaioken/logger";

export type HostDaemonLogger = Pick<
  Logger,
  "debug" | "info" | "warn" | "error"
>;
