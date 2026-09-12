import type { KaiokenPluginApi } from "@get-kaioken/plugin-sdk";
import { z } from "zod";
import { registerConnectCli } from "./cli.js";
import { createKvCredentialStore } from "./credential.js";
import {
  connectRpcContract,
  createRpcHandlers,
  type MobilePairingGate,
} from "./rpc.js";
import { ShareRegistry } from "./shares.js";
import { ConnectTunnel } from "./tunnel.js";
import { ShareHostResolver } from "./hosts.js";
import { resolveLocalCloudLoopbackUrl } from "./local-loopback.js";
import { resolveDefaultConnectBaseUrl } from "./redeem.js";
import {
  CONNECT_REALTIME_CHANNEL,
  REMOTE_ACTIVITY_INSTRUCTIONS_MS,
} from "./types.js";

export default async function plugin(bb: KaiokenPluginApi) {
  const settings = bb.settings.define({
    relayUrl: {
      type: "string",
      label: "Relay URL",
      description:
        "Origin of the Connect relay to pair with, for example https://kaioken-relay.you.workers.dev. Leave empty to use the bb-hosted relay.",
      default: "",
      experimental_schema: z.string().superRefine((value, context) => {
        const trimmed = value.trim();
        if (trimmed.length === 0) return;
        let url: URL | null = null;
        try {
          url = new URL(trimmed);
        } catch {}
        if (
          url === null ||
          (url.protocol !== "https:" && url.protocol !== "http:") ||
          url.pathname !== "/" ||
          url.search.length > 0 ||
          url.hash.length > 0
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Use an origin such as https://kaioken-relay.you.workers.dev",
          });
        }
      }),
    },
    sendRemoteInstructions: {
      type: "boolean",
      label: "Tell agents about remote access",
      description:
        "When you use Kaioken remotely, tell agents to share servers through Connect. Applies to new agent sessions.",
      default: true,
    },
  });
  let currentSettings = await settings.get();
  settings.onChange((next) => {
    currentSettings = next;
  });
  const store = createKvCredentialStore(bb.storage.kv);
  let tunnel!: ConnectTunnel;
  const hostResolver = new ShareHostResolver(() => bb.sdk);
  const getLoopbackBaseUrl = () =>
    resolveLocalCloudLoopbackUrl(
      tunnel.getCredential()?.serverUrl,
      process.env.KAIOKEN_DEV_APP_PORT,
    ) ?? bb.server.loopbackBaseUrl;

  const shares = new ShareRegistry({
    kv: bb.storage.kv,
    hosts: bb.hosts,
    hostResolver,
    getLoopbackBaseUrl,
    getCredential: () => tunnel.getCredential(),
    log: bb.log,
    onChange: () => {
      bb.realtime.publish(CONNECT_REALTIME_CHANNEL, tunnel.status());
    },
  });

  tunnel = new ConnectTunnel({
    store,
    shares,
    defaultBaseUrl: () => {
      const configured = currentSettings.relayUrl.trim();
      return configured.length > 0
        ? new URL(configured).origin
        : resolveDefaultConnectBaseUrl(process.env);
    },
    getLoopbackBaseUrl,
    log: bb.log,
    onStatusChange: (status) =>
      bb.realtime.publish(CONNECT_REALTIME_CHANNEL, status),
  });

  const mobilePairing: MobilePairingGate = {
    enabled: async () => (await bb.sdk.system.config()).experiments.mobileApp,
  };

  bb.rpc.register(
    connectRpcContract,
    createRpcHandlers(tunnel, hostResolver, mobilePairing),
  );
  registerConnectCli({ bb, tunnel, hostResolver, mobilePairing });

  bb.agents.contributeInstructions(() => {
    if (!currentSettings.sendRemoteInstructions) return null;
    const status = tunnel.status();
    if (!status.paired || status.url === null) return null;
    const recent =
      status.remoteClients > 0 ||
      (status.lastRemoteActivityAt !== null &&
        Date.now() - status.lastRemoteActivityAt <
          REMOTE_ACTIVITY_INSTRUCTIONS_MS);
    if (!recent) return null;
    return (
      `The user is currently viewing this kaioken remotely at ${status.url}. ` +
      "Port shares work from a thread on any enrolled host: when you start an HTTP server they should see, run `kaioken connect expose <port>` from that thread. " +
      "The command returns the correct public URL for the thread's host; give it to them as a markdown link because a localhost URL will not work remotely."
    );
  });

  bb.background.service("tunnel", {
    async start(signal) {
      await tunnel.start();
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      tunnel.stop();
    },
  });
}
