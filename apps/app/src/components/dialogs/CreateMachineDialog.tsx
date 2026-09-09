import { MachineAccessControls } from "@/components/settings/MachineAccessSettings";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { isLocalOnlyUrl } from "@/lib/loopback-hostname";
import { MachineSetupProgress } from "./MachineSetupProgress";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import type { JsonValue } from "@bb/domain";
import type { PluginMachineProviderInputsChange } from "@get-bb/plugin-sdk";
import type { SystemMachineProvider } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { MachineProviderIcon } from "@/components/plugin/MachineProviderIcon";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { machineProviderInputsControlRequired } from "@/components/pickers/machine-provider-inputs";
import { OptionPicker } from "@/components/pickers/OptionPicker";
import { useHosts } from "@/hooks/queries/host-queries";
import { useSystemMachineProviders } from "@/hooks/queries/machine-provider-queries";
import { getPluginConfigurationRoutePath } from "@/lib/route-paths";
import { sdk } from "@/lib/sdk";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { usePluginSlots } from "@/lib/plugin-slots";

export function CreateMachineDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const hosts = useHosts();
  const close = (next: boolean) => {
    if (!next) void hosts.refetch();
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={close} modal={false}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        {open && <CreateMachineContent open={open} onOpenChange={close} />}
      </DialogContent>
    </Dialog>
  );
}

export function CreateMachineContent({
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { providers: loadedProviders } = useSystemMachineProviders();
  const providers = loadedProviders ?? [];
  const config = useSystemConfig();
  const { machineSetup } = usePluginSlots();
  const [selection, setSelection] = useState<string | null | undefined>();
  const setups = machineSetup.filter((slot) =>
    providers.some(
      (provider) =>
        provider.id === slot.machineProviderId &&
        provider.pluginId === slot.pluginId,
    ),
  );
  const selectedId =
    selection ?? (providers.length === 1 ? providers[0]?.id : null);
  const selected = setups.find((slot) => slot.machineProviderId === selectedId);
  const access = config.data?.serverAccess;
  const accessProvider = access?.providers.find(
    (provider) => provider.id === access.defaultProviderId,
  );
  const accessReady =
    accessProvider?.availability.status === "available" &&
    (access?.defaultProviderId !== "direct" ||
      (!!access.effectiveUrl && !isLocalOnlyUrl(access.effectiveUrl)));
  if (!accessReady || loadedProviders === undefined) {
    const loading =
      config.isPending || (accessReady && loadedProviders === undefined);
    return (
      <MachineAccessGate
        state={
          loading
            ? { status: "checking" }
            : config.isError
              ? { status: "failed", onRetry: () => void config.refetch() }
              : { status: "blocked" }
        }
      >
        <MachineAccessControls onNavigate={() => onOpenChange(false)} />
      </MachineAccessGate>
    );
  }
  if (selected) {
    const Component = selected.component;
    return (
      <>
        <DialogTitle className="sr-only">Add a machine</DialogTitle>
        <PluginSlotMount
          pluginId={selected.pluginId}
          slotKind="machineSetup"
          slotId={selected.machineProviderId}
        >
          <Component client={sdk} onClose={() => onOpenChange(false)} />
        </PluginSlotMount>
      </>
    );
  }
  return (
    <ProviderMachineSetup
      onOpenChange={onOpenChange}
      providers={providers}
      onSelectSetup={(id) => setSelection(id)}
      setupIds={setups.map((slot) => slot.machineProviderId)}
    />
  );
}

const machineProviderIcons = new WeakMap<
  SystemMachineProvider,
  ComponentType<{ className?: string }>
>();

function machineProviderIconComponent(
  provider: SystemMachineProvider,
): ComponentType<{ className?: string }> {
  const cached = machineProviderIcons.get(provider);
  if (cached !== undefined) return cached;
  function ProviderOptionIcon({ className }: { className?: string }) {
    return <MachineProviderIcon provider={provider} className={className} />;
  }
  machineProviderIcons.set(provider, ProviderOptionIcon);
  return ProviderOptionIcon;
}

export type MachineAccessGateState =
  | { status: "checking" }
  | { status: "failed"; onRetry: () => void }
  | { status: "blocked" };

export function MachineAccessGate({
  state,
  children,
}: {
  state: MachineAccessGateState;
  children: ReactNode;
}) {
  if (state.status === "checking") {
    return (
      <>
        <DialogTitle className="sr-only">Add a machine</DialogTitle>
        <p role="status" className="text-sm text-subtle-foreground">
          Checking machine access…
        </p>
      </>
    );
  }
  if (state.status === "failed") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Add a machine</DialogTitle>
          <DialogDescription>
            Couldn’t check whether machines can reach this server.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={state.onRetry}>
            Try again
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>Set up machine access</DialogTitle>
        <DialogDescription>
          A new machine has to reach this server over the network. Choose the
          address it should use.
        </DialogDescription>
      </DialogHeader>
      {children}
    </>
  );
}

export function ProviderMachineSetup({
  onOpenChange,
  providers,
  onSelectSetup,
  setupIds,
}: {
  onOpenChange: (open: boolean) => void;
  providers: readonly SystemMachineProvider[];
  onSelectSetup: (id: string) => void;
  setupIds: readonly string[];
}) {
  const createController = useRef<AbortController | null>(null);
  const createKey = useRef<string | null>(null);
  const [progress, setProgress] = useState("");
  const [launchId, setLaunchId] = useState<string | null>(null);
  useEffect(() => () => createController.current?.abort(), []);
  const machineProviderInputsSlots = usePluginSlots().machineProviderInputs;
  const [selectedMachineProvider, setSelectedMachineProvider] =
    useState<SystemMachineProvider | null>(() =>
      providers.length === 1 ? providers[0]! : null,
    );
  const [machineInputs, setMachineInputs] = useState<JsonValue | null>(() =>
    providers.length === 1 &&
    providers[0]?.inputs !== null &&
    providers[0]?.acceptsEmptyInputs
      ? {}
      : null,
  );
  const [machineInputsBlocked, setMachineInputsBlocked] = useState<
    string | null
  >(null);
  const machineInputsRegistration =
    selectedMachineProvider === null
      ? undefined
      : machineProviderInputsSlots.find(
          (slot) =>
            slot.machineProviderId === selectedMachineProvider.id &&
            slot.pluginId === selectedMachineProvider.pluginId,
        );
  const MachineInputsComponent = machineInputsRegistration?.component;
  const selectMachineProvider = (provider: SystemMachineProvider): void => {
    if (setupIds.includes(provider.id)) {
      onSelectSetup(provider.id);
      return;
    }
    createKey.current = null;
    setSelectedMachineProvider(provider);
    setMachineInputs(
      provider.inputs === null ? null : provider.acceptsEmptyInputs ? {} : null,
    );
    setMachineInputsBlocked(null);
  };
  const handleMachineInputsChange = (
    next: PluginMachineProviderInputsChange,
  ): void => {
    createKey.current = null;
    if (next.status === "blocked") {
      setMachineInputsBlocked(next.reason);
      return;
    }
    setMachineInputsBlocked(null);
    setMachineInputs(next.value);
  };
  const createMachine = useMutation({
    meta: { showErrorToast: false },
    mutationFn: async () => {
      if (selectedMachineProvider === null) {
        throw new Error("Select a machine provider.");
      }
      setProgress("");
      setLaunchId(null);
      const controller = new AbortController();
      createController.current = controller;
      createKey.current ??= crypto.randomUUID();
      try {
        const launch = await sdk.hosts.submit({
          key: createKey.current,
          machineProviderId: selectedMachineProvider.id,
          inputs: machineInputs,
          signal: controller.signal,
        });
        setLaunchId(launch.id);
        return await sdk.hosts.follow({
          id: launch.id,
          signal: controller.signal,
          onProgress: (status) => {
            setProgress(status.step);
            if (status.terminal) createKey.current = null;
          },
        });
      } finally {
        if (createController.current === controller)
          createController.current = null;
      }
    },
    onSuccess: () => onOpenChange(false),
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a machine</DialogTitle>
        <DialogDescription>Choose how to add your machine.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-normal text-foreground">
            Machine provider
          </span>
          <OptionPicker
            modal={false}
            align="end"
            label="Machine provider"
            value={selectedMachineProvider?.id ?? ""}
            disabled={providers.length === 0 || createMachine.isPending}
            showChevronWhenDisabled
            displayOverride={
              selectedMachineProvider === null
                ? {
                    label:
                      providers.length === 0
                        ? "None installed"
                        : "Choose a provider",
                  }
                : undefined
            }
            options={providers.map((provider) => ({
              value: provider.id,
              label: provider.displayName,
              icon: machineProviderIconComponent(provider),
              ...(provider.availability === null ||
              provider.availability.status === "available"
                ? {}
                : { description: provider.availability.message }),
            }))}
            onChange={(providerId) => {
              const provider = providers.find(
                (candidate) => candidate.id === providerId,
              );
              if (provider) selectMachineProvider(provider);
            }}
          />
        </div>
        {selectedMachineProvider === null ? null : (
          <div className="space-y-3">
            {machineInputsRegistration === undefined ||
            MachineInputsComponent === undefined ? null : (
              <PluginSlotMount
                pluginId={machineInputsRegistration.pluginId}
                slotKind="machineProviderInputs"
                slotId={machineInputsRegistration.machineProviderId}
              >
                <MachineInputsComponent
                  key={selectedMachineProvider.id}
                  projectId={null}
                  value={machineInputs}
                  onChange={handleMachineInputsChange}
                />
              </PluginSlotMount>
            )}
            {machineInputsBlocked === null ? null : (
              <p className="text-xs text-destructive-text">
                {machineInputsBlocked}
              </p>
            )}
            {createMachine.isError ? (
              <p role="alert" className="text-xs text-destructive-text">
                {getMutationErrorMessage({
                  error: createMachine.error,
                  fallbackMessage: "Couldn't create the machine.",
                })}
              </p>
            ) : null}
            {selectedMachineProvider.availability === null ||
            selectedMachineProvider.availability.status ===
              "available" ? null : (
              <p
                role={
                  selectedMachineProvider.availability.status === "unavailable"
                    ? "alert"
                    : "status"
                }
                className={
                  selectedMachineProvider.availability.status === "unavailable"
                    ? "text-xs text-destructive-text"
                    : "text-xs text-subtle-foreground"
                }
              >
                {selectedMachineProvider.availability.message}
              </p>
            )}
            {selectedMachineProvider.availability?.status ===
            "unavailable" ? null : selectedMachineProvider.availability
                ?.status === "setup-required" ? (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="w-full sm:w-auto sm:self-end"
              >
                <Link
                  to={getPluginConfigurationRoutePath({
                    pluginId: selectedMachineProvider.pluginId,
                  })}
                >
                  Configure {selectedMachineProvider.displayName}
                  <Icon name="ArrowRight" />
                </Link>
              </Button>
            ) : (
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  className="w-full sm:w-auto"
                  disabled={
                    createMachine.isPending ||
                    machineInputsBlocked !== null ||
                    (machineProviderInputsControlRequired(
                      selectedMachineProvider,
                    ) &&
                      machineInputsRegistration === undefined) ||
                    (selectedMachineProvider.inputs !== null &&
                      machineInputs === null)
                  }
                  onClick={() => createMachine.mutate()}
                >
                  {createMachine.isPending
                    ? "Creating machine…"
                    : `Create ${selectedMachineProvider.displayName}${/machine$/iu.test(selectedMachineProvider.displayName) ? "" : " machine"}`}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      {createMachine.isPending && progress && (
        <p role="status" className="text-sm text-subtle-foreground">
          {progress}
        </p>
      )}
      {launchId && selectedMachineProvider && (
        <MachineSetupProgress
          id={launchId}
          scope="launch"
          providerId={selectedMachineProvider.id}
        />
      )}

      {createMachine.isPending && launchId ? (
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void sdk.hosts.cancel({ id: launchId }).then(() => {
                createController.current?.abort();
                onOpenChange(false);
              })
            }
          >
            Cancel setup
          </Button>
        </DialogFooter>
      ) : null}
    </>
  );
}
