import type { KaiokenProjectOption } from "../../shared/contract.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@kaioken/shared-ui/select";

const NO_LINK = "__none__";

export interface KaiokenProjectLinkState {
  selection: string | null;
}

export function emptyBbProjectLinkState(): KaiokenProjectLinkState {
  return { selection: null };
}

export function kaiokenProjectLinkStateFor(
  linkedBbProjectId: string | null,
): KaiokenProjectLinkState {
  return { selection: linkedBbProjectId };
}

export function resolveBbProjectLink(state: KaiokenProjectLinkState): string {
  return state.selection ?? "";
}

export function KaiokenProjectLinkPicker({
  state,
  onStateChange,
  kaiokenProjects,
  noneLabel = "Not linked",
}: {
  state: KaiokenProjectLinkState;
  onStateChange: (state: KaiokenProjectLinkState) => void;
  kaiokenProjects: readonly KaiokenProjectOption[];
  noneLabel?: string;
}) {
  const unavailableSelection =
    state.selection !== null &&
    !kaiokenProjects.some((project) => project.id === state.selection)
      ? state.selection
      : null;
  return (
    <Select
      value={state.selection ?? NO_LINK}
      onValueChange={(value) =>
        onStateChange({ selection: value === NO_LINK ? null : value })
      }
    >
      <SelectTrigger aria-label="Linked kaioken project" className="h-8">
        <SelectValue>
          {kaiokenProjects.find((project) => project.id === state.selection)?.name ??
            unavailableSelection ??
            noneLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_LINK}>{noneLabel}</SelectItem>
        {unavailableSelection !== null ? (
          <SelectItem value={unavailableSelection}>
            Unavailable · {unavailableSelection}
          </SelectItem>
        ) : null}
        {kaiokenProjects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            {project.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
