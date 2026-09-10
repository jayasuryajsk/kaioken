import type { KaiokenPluginApi } from "@get-kaioken/plugin-sdk";

export default function plugin(bb: KaiokenPluginApi) {
  bb.log.info("thread-chat-demo loaded (frontend-only demo)");
}
