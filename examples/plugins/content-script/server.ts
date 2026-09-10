import type { KaiokenPluginApi } from "@get-kaioken/plugin-sdk";

export default function contentScriptExample(bb: KaiokenPluginApi) {
  bb.log.info("Content script example loaded");
}
