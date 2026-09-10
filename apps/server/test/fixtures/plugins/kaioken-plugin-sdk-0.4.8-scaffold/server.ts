import type { KaiokenPluginApi } from "@get-kaioken/plugin-sdk";

export default function plugin(bb: KaiokenPluginApi) {
  bb.log.info("0.4.8 scaffold upgrade fixture loaded");
}
