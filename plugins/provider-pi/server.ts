import type { KaiokenPluginApi } from "@get-kaioken/plugin-sdk";
import { piProviderDeclaration } from "./src/declaration.js";

export default function plugin(bb: KaiokenPluginApi): void {
  const registered = bb.providers.register(piProviderDeclaration());
  bb.onDispose(() => {
    registered.dispose();
  });
}
