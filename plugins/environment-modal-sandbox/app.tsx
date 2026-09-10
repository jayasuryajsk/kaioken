import { useEffect, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type JsonValue,
  type PluginMachineProviderInputsProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { ResponsiveDrawerShell } from "@bb/shared-ui/responsive-overlay";
import type { modalRpcContract } from "./account.js";
import type {
  ModalImage,
  ModalLaunchOptions,
  SandboxPreset,
} from "./launch-options.js";
import { PROVIDER_ID } from "./provider-id.js";

function selectedName(
  value: JsonValue | null,
  key: "preset" | "image",
): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const selected = value[key];
  return typeof selected === "string" ? selected : undefined;
}

function machineInputs(
  preset: string | undefined,
  image: string | undefined,
): JsonValue {
  return {
    ...(preset === undefined ? {} : { preset }),
    ...(image === undefined ? {} : { image }),
  };
}

function ModalMachineInputsControl({
  value,
  onChange,
}: PluginMachineProviderInputsProps) {
  const rpc = useRpc<typeof modalRpcContract>();
  const selectedPresetName = selectedName(value, "preset");
  const selectedImageName = selectedName(value, "image");
  const [options, setOptions] = useState<ModalLaunchOptions | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    onChange({
      status: "ready",
      value: machineInputs(selectedPresetName, selectedImageName),
    });
  }, [onChange, selectedImageName, selectedPresetName]);
  useEffect(() => {
    let active = true;
    void rpc.call("launch.options", {}).then(
      (result) => {
        if (active) setOptions(result);
      },
      () => {
        if (active) setOptions(null);
      },
    );
    return () => {
      active = false;
    };
  }, [rpc]);
  if (
    options === null ||
    (options.presets.length <= 1 && options.images.length <= 1)
  ) {
    return null;
  }
  const presetName =
    options.presets.find((entry) => entry.name === selectedPresetName)?.name ??
    options.presets[0]?.name;
  const imageName =
    options.images.find((entry) => entry.name === selectedImageName)?.name ??
    options.images[0]?.name;
  const labels = [
    ...(options.presets.length > 1 && presetName !== undefined
      ? [presetName]
      : []),
    ...(options.images.length > 1 && imageName !== undefined
      ? [imageName]
      : []),
  ];
  const choose = (preset: string | undefined, image: string | undefined) => {
    onChange({ status: "ready", value: machineInputs(preset, image) });
  };
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 shrink-0 rounded-md border-border bg-background px-2.5 text-sm font-normal shadow-none hover:bg-state-hover"
        onClick={() => setOpen(true)}
      >
        Modal: {labels.join(" · ")}
      </Button>
      <ResponsiveDrawerShell
        open={open}
        onOpenChange={setOpen}
        srLabel="Configure the Modal sandbox"
        contentClassName="mx-auto w-full max-w-lg"
      >
        <div className="space-y-5 p-4 sm:p-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">
              Modal sandbox
            </h2>
            <p className="text-sm text-muted-foreground">
              Choose from the sizes and images configured in plugin settings.
            </p>
          </div>
          {options.presets.length > 1 ? (
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-foreground">Size preset</span>
              <select
                className="h-9 w-full rounded-md border bg-background px-3"
                value={presetName}
                onChange={(event) => choose(event.target.value, imageName)}
              >
                {options.presets.map((preset) => (
                  <option key={preset.name} value={preset.name}>
                    {preset.name} · {preset.cpu} CPU · {preset.memoryMiB} MiB
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {options.images.length > 1 ? (
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-foreground">Image</span>
              <select
                className="h-9 w-full rounded-md border bg-background px-3"
                value={imageName}
                onChange={(event) => choose(presetName, event.target.value)}
              >
                {options.images.map((image) => (
                  <option key={image.name} value={image.name}>
                    {image.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="flex justify-end">
            <Button type="button" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      </ResponsiveDrawerShell>
    </>
  );
}

function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
  return items.map((item, candidate) => (candidate === index ? value : item));
}

function LaunchOptionsSettings() {
  const rpc = useRpc<typeof modalRpcContract>();
  const [saved, setSaved] = useState<ModalLaunchOptions | null>(null);
  const [draft, setDraft] = useState<ModalLaunchOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void rpc.call("launch.options", {}).then(
      (result) => {
        if (!active) return;
        setSaved(result);
        setDraft(result);
      },
      (failure) => {
        if (active) {
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
        }
      },
    );
    return () => {
      active = false;
    };
  }, [rpc]);
  const save = async () => {
    if (draft === null) return;
    setSaving(true);
    setError(null);
    try {
      const result = await rpc.call("launch.options.set", draft);
      setSaved(result);
      setDraft(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };
  if (draft === null) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading launch options…
      </p>
    );
  }
  const updatePreset = (index: number, preset: SandboxPreset) => {
    setDraft({ ...draft, presets: replaceAt(draft.presets, index, preset) });
  };
  const updateImage = (index: number, image: ModalImage) => {
    setDraft({ ...draft, images: replaceAt(draft.images, index, image) });
  };
  return (
    <div className="min-w-0 space-y-8">
      {error === null ? null : (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <section className="space-y-3">
        <div>
          <h3 className="font-medium text-foreground">Sandbox sizes</h3>
          <p className="text-sm text-muted-foreground">
            With no preset, Modal defaults to 0.125 CPU and 128 MiB. A single
            preset becomes the default; multiple presets add a composer picker.
          </p>
        </div>
        {draft.presets.map((preset, index) => (
          <div
            key={index}
            className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_8rem_8rem_auto]"
          >
            <Input
              aria-label={`Preset ${index + 1} name`}
              value={preset.name}
              onChange={(event) =>
                updatePreset(index, { ...preset, name: event.target.value })
              }
              placeholder="Large"
            />
            <Input
              aria-label={`${preset.name || `Preset ${index + 1}`} CPU`}
              type="number"
              min="0.001"
              step="0.125"
              value={preset.cpu}
              onChange={(event) =>
                updatePreset(index, {
                  ...preset,
                  cpu: Number(event.target.value),
                })
              }
            />
            <Input
              aria-label={`${preset.name || `Preset ${index + 1}`} memory MiB`}
              type="number"
              min="1"
              step="1"
              value={preset.memoryMiB}
              onChange={(event) =>
                updatePreset(index, {
                  ...preset,
                  memoryMiB: Number(event.target.value),
                })
              }
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setDraft({
                  ...draft,
                  presets: draft.presets.filter(
                    (_entry, candidate) => candidate !== index,
                  ),
                })
              }
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setDraft({
              ...draft,
              presets: [
                ...draft.presets,
                { name: "", cpu: 1, memoryMiB: 1024 },
              ],
            })
          }
        >
          Add size preset
        </Button>
      </section>
      <section className="space-y-3">
        <div>
          <h3 className="font-medium text-foreground">Images</h3>
          <p className="text-sm text-muted-foreground">
            The bundled Standard Dockerfile is always first. Add Dockerfiles or
            existing Modal image IDs; multiple images add a composer picker.
          </p>
        </div>
        {draft.images.map((image, index) => (
          <div key={index} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap gap-2">
              <Input
                aria-label={`Image ${index + 1} name`}
                value={image.name}
                disabled={index === 0}
                onChange={(event) =>
                  updateImage(index, { ...image, name: event.target.value })
                }
                className="min-w-48 flex-1"
              />
              {index === 0 ? null : (
                <select
                  aria-label={`${image.name || `Image ${index + 1}`} source`}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  value={image.source}
                  onChange={(event) =>
                    updateImage(
                      index,
                      event.target.value === "image-id"
                        ? {
                            name: image.name,
                            source: "image-id",
                            imageId: "",
                          }
                        : {
                            name: image.name,
                            source: "dockerfile",
                            dockerfile: "FROM debian:bookworm-slim\n",
                          },
                    )
                  }
                >
                  <option value="dockerfile">Dockerfile</option>
                  <option value="image-id">Modal image ID</option>
                </select>
              )}
              {index === 0 ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      images: draft.images.filter(
                        (_entry, candidate) => candidate !== index,
                      ),
                    })
                  }
                >
                  Remove
                </Button>
              )}
            </div>
            {image.source === "dockerfile" ? (
              <textarea
                aria-label={`${image.name} Dockerfile`}
                value={image.dockerfile}
                onChange={(event) =>
                  updateImage(index, {
                    ...image,
                    dockerfile: event.target.value,
                  })
                }
                disabled={saving}
                spellCheck={false}
                rows={index === 0 ? 18 : 8}
                className="w-full resize-y rounded-md border p-4 font-mono text-xs"
              />
            ) : (
              <Input
                aria-label={`${image.name || `Image ${index + 1}`} Modal image ID`}
                value={image.imageId}
                onChange={(event) =>
                  updateImage(index, { ...image, imageId: event.target.value })
                }
                placeholder="im-…"
              />
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setDraft({
              ...draft,
              images: [
                ...draft.images,
                {
                  name: "",
                  source: "dockerfile",
                  dockerfile: "FROM debian:bookworm-slim\n",
                },
              ],
            })
          }
        >
          Add image
        </Button>
      </section>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          disabled={saving || JSON.stringify(draft) === JSON.stringify(saved)}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save launch options"}
        </Button>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_machineProviderInputs({
    machineProviderId: PROVIDER_ID,
    component: ModalMachineInputsControl,
  });
  app.slots.settingsSection({
    id: "launch-options",
    title: "Sandbox presets and images",
    component: LaunchOptionsSettings,
  });
});
