import { useQuery } from "@tanstack/react-query";
import type {
  SystemMachineProvider,
  SystemMachineProvidersQuery,
} from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { SERVER_SESSION_QUERY_POLICY } from "./query-policies";
import { systemMachineProvidersQueryKey } from "./query-keys";

const NO_MACHINE_PROVIDERS: readonly SystemMachineProvider[] = [];

export function useSystemMachineProviders(
  query: SystemMachineProvidersQuery = {},
): { providers: readonly SystemMachineProvider[] | undefined } {
  const result = useQuery({
    queryKey: systemMachineProvidersQueryKey(query),
    queryFn: () => sdk.hosts.listProviders(query),
    ...SERVER_SESSION_QUERY_POLICY,
  });
  return {
    providers: result.isError ? NO_MACHINE_PROVIDERS : result.data,
  };
}
