import type { SystemEnvironmentProvider } from "@kaioken/server-contract";

export function providerInputsControlRequired(
  provider: SystemEnvironmentProvider,
): boolean {
  return provider.inputs !== null && !provider.acceptsEmptyInputs;
}
