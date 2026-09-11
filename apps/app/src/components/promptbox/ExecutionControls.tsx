import { memo, useCallback } from "react";
import { useAtom } from "jotai";
import type {
  PermissionMode,
  ReasoningLevel,
  ServiceTier,
} from "@kaioken/domain";
import type {
  SystemExecutionOptionsModelLoadError,
  SystemProvidersQuery,
} from "@kaioken/server-contract";
import { formatModelLabel } from "@/hooks/useThreadCreationOptions";
import {
  ModelReasoningPicker,
  type ModelReasoningPickerFooterAction,
  type SavedModelSelection,
} from "@/components/pickers/ModelReasoningPicker";
import { ReasoningPicker } from "@/components/pickers/ReasoningPicker";
import { FastModeButton } from "@/components/pickers/FastModeButton";
import { type PickerOption } from "@/components/pickers/OptionPicker";
import type { ModelPickerOption } from "@/components/pickers/model-picker-option";
import {
  stripModelBrandPrefix,
  type ProviderPickerOption,
} from "@/components/pickers/model-brand-prefix";
import {
  modelFavoritesAtom,
  modelRecentsAtom,
  pushRecentModel,
  toggleFavoriteModel,
  type ModelSelectionEntry,
} from "@/lib/model-picker-preferences";

interface ExecutionProviderConfig {
  options?: readonly ProviderPickerOption[];
  selectedId?: string;
  onChange?: (value: string) => void;
  onSelectSaved?: (selection: SavedModelSelection) => void;
  hasMultiple?: boolean;
}

interface ExecutionModelConfig {
  active?: { model: string } | null;
  selected: string;
  options: readonly ModelPickerOption[];
  moreOptions: readonly ModelPickerOption[];
  isLoading: boolean;
  loadFailed: boolean;
  loadError?: SystemExecutionOptionsModelLoadError | null;
  onChange: (value: string) => void;
}

interface ExecutionServiceTierConfig {
  value?: ServiceTier;
  onChange: (value: ServiceTier | undefined) => void;
  supported: boolean;
  supportByProvider?: Record<string, boolean>;
  fastLabel?: string;
}

interface ExecutionReasoningConfig {
  value: ReasoningLevel;
  options: readonly PickerOption<ReasoningLevel>[];
  onChange: (value: ReasoningLevel) => void;
}

export interface ExecutionPermissionConfig {
  value?: PermissionMode;
  options: readonly PickerOption<PermissionMode>[];
  onChange: (value: PermissionMode) => void;
  supported: boolean;
}

export interface ExecutionControlsProps {
  providerRouting?: SystemProvidersQuery;
  provider: ExecutionProviderConfig;
  model: ExecutionModelConfig;
  serviceTier?: ExecutionServiceTierConfig;
  reasoning: ExecutionReasoningConfig;
  footerAction?: ModelReasoningPickerFooterAction;
  disabled?: boolean;
}

export const ExecutionControls = memo(function ExecutionControls({
  provider,
  providerRouting,
  model,
  serviceTier,
  reasoning,
  footerAction,
  disabled,
}: ExecutionControlsProps) {
  const handleServiceTierChange = serviceTier?.onChange ?? (() => {});
  const selectedProviderId = provider.selectedId ?? "";
  const [favorites, setFavorites] = useAtom(modelFavoritesAtom);
  const [recents, setRecents] = useAtom(modelRecentsAtom);

  const canSwitchProviders = Boolean(
    provider.hasMultiple &&
    (provider.onChange || provider.onSelectSaved) &&
    provider.options &&
    provider.options.length > 1,
  );
  const showModelPicker =
    model.isLoading ||
    model.loadFailed ||
    model.options.length > 0 ||
    canSwitchProviders ||
    selectedProviderId.length > 0 ||
    footerAction !== undefined;
  const hasSelectedModel = (model.active?.model ?? model.selected).length > 0;
  const showReasoningPicker =
    hasSelectedModel && !model.isLoading && reasoning.options.length > 0;
  const showFastMode =
    hasSelectedModel && !model.isLoading && (serviceTier?.supported ?? false);

  const describeSelection = useCallback(
    (providerId: string, modelId: string): ModelSelectionEntry => {
      const providerOption = provider.options?.find(
        (option) => option.value === providerId,
      );
      const modelOption =
        providerId === selectedProviderId
          ? [...model.options, ...model.moreOptions].find(
              (option) => option.value === modelId,
            )
          : undefined;
      return {
        providerId,
        providerLabel: providerOption?.label ?? providerId,
        model: modelId,
        label: modelOption
          ? stripModelBrandPrefix(
              modelOption.label,
              providerOption?.brandPrefix,
            )
          : modelId,
      };
    },
    [model.moreOptions, model.options, provider.options, selectedProviderId],
  );

  const recordRecent = useCallback(
    (entry: ModelSelectionEntry, reasoningLevel: ReasoningLevel) => {
      setRecents((current) =>
        pushRecentModel(current, { ...entry, reasoningLevel }),
      );
    },
    [setRecents],
  );

  const handleModelChange = useCallback(
    (value: string) => {
      model.onChange(value);
      if (selectedProviderId.length > 0) {
        recordRecent(
          describeSelection(selectedProviderId, value),
          reasoning.value,
        );
      }
    },
    [
      describeSelection,
      model,
      reasoning.value,
      recordRecent,
      selectedProviderId,
    ],
  );

  const handleReasoningChange = useCallback(
    (value: ReasoningLevel) => {
      reasoning.onChange(value);
      const currentModel = model.active?.model ?? model.selected;
      if (selectedProviderId.length > 0 && currentModel.length > 0) {
        recordRecent(
          describeSelection(selectedProviderId, currentModel),
          value,
        );
      }
    },
    [describeSelection, model, reasoning, recordRecent, selectedProviderId],
  );

  const browseProvider = useCallback(() => {}, []);

  const handleToggleFavorite = useCallback(
    (entry: ModelSelectionEntry) => {
      setFavorites((current) => toggleFavoriteModel(current, entry));
    },
    [setFavorites],
  );

  const handleSelectSaved = useCallback(
    (selection: SavedModelSelection) => {
      const saved =
        favorites.find(
          (entry) =>
            entry.providerId === selection.providerId &&
            entry.model === selection.model,
        ) ??
        recents.find(
          (entry) =>
            entry.providerId === selection.providerId &&
            entry.model === selection.model,
        );
      if (saved) {
        recordRecent(saved, selection.reasoningLevel ?? reasoning.value);
      }
      if (provider.onSelectSaved) {
        provider.onSelectSaved(selection);
        return;
      }
      provider.onChange?.(selection.providerId);
    },
    [favorites, provider, reasoning.value, recents, recordRecent],
  );

  return (
    <>
      {showModelPicker ? (
        <ModelReasoningPicker
          layout="model"
          favorites={favorites}
          recents={recents}
          onToggleFavorite={handleToggleFavorite}
          onSelectSaved={canSwitchProviders ? handleSelectSaved : undefined}
          providerOptions={provider.options ?? []}
          providerRouting={providerRouting}
          selectedProviderId={selectedProviderId}
          onSelectedProviderChange={
            provider.onChange ??
            (provider.onSelectSaved ? browseProvider : undefined)
          }
          hasMultipleProviders={provider.hasMultiple ?? false}
          modelValue={model.active?.model ?? model.selected}
          modelOptions={model.options}
          moreModelOptions={model.moreOptions}
          modelIsLoading={model.isLoading}
          modelLoadFailed={model.loadFailed}
          modelLoadError={model.loadError}
          onModelChange={handleModelChange}
          formatModelLabel={formatModelLabel}
          reasoningValue={reasoning.value}
          reasoningOptions={reasoning.options}
          onReasoningChange={handleReasoningChange}
          fastModeEnabled={serviceTier?.value === "fast"}
          onFastModeChange={(enabled) =>
            handleServiceTierChange(enabled ? "fast" : "default")
          }
          showFastModeToggle={false}
          serviceTierSupportByProvider={serviceTier?.supportByProvider}
          fastModeLabel={serviceTier?.fastLabel}
          muted
          disabled={disabled}
          footerAction={footerAction}
        />
      ) : null}
      {showReasoningPicker ? (
        <ReasoningPicker
          value={reasoning.value}
          options={reasoning.options}
          onChange={handleReasoningChange}
          disabled={disabled}
          muted
        />
      ) : null}
      {showFastMode ? (
        <FastModeButton
          enabled={serviceTier?.value === "fast"}
          onChange={(enabled) =>
            handleServiceTierChange(enabled ? "fast" : "default")
          }
          label={serviceTier?.fastLabel}
          disabled={disabled}
          muted
        />
      ) : null}
    </>
  );
});
