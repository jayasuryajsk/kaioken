import { Icon } from "@kaioken/shared-ui/icon";
import { useState } from "react";
import {
  ActionMenuItem,
  ActionMenuSeparator,
} from "@/components/ui/action-menu-items";
import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@kaioken/shared-ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@kaioken/shared-ui/dropdown-menu";
import { useProjectSectionMove } from "./ProjectSectionMoveProvider";
import { findLocalPathProjectSourceForHost } from "@kaioken/domain";
import type { ProjectResponse } from "@kaioken/server-contract";
import type { MouseEvent, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@kaioken/shared-ui/button";

import { COARSE_POINTER_ICON_SIZE_CLASS } from "@kaioken/shared-ui/coarse-pointer-sizing";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@kaioken/shared-ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@kaioken/shared-ui/dropdown-menu";
import { useIsCompactViewport } from "@kaioken/shared-ui/hooks/use-compact-viewport";
import { CompactLongPressMenu } from "@/components/ui/compact-long-press-menu";
import { usePathPickerHost } from "@/hooks/useLocalPathPicker";
import { getSettingsProjectRoutePath } from "@/lib/route-paths";
import { cn } from "@kaioken/shared-ui/lib/utils";
import { useProjectActions } from "./ProjectActionsProvider";

interface ProjectActionsMenuBaseProps {
  project: ProjectResponse;
}

interface ProjectActionsMenuProps extends ProjectActionsMenuBaseProps {
  triggerClassName?: string;
  onOpenChange?: (open: boolean) => void;
}

interface ProjectActionsContextMenuProps extends ProjectActionsMenuBaseProps {
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
}

type ProjectActionsMenuSurface = "context" | "dropdown";

interface ProjectActionsMenuItemsProps extends ProjectActionsMenuBaseProps {
  surface: ProjectActionsMenuSurface;
}

function stopProjectActionsMenuClickPropagation(event: MouseEvent) {
  event.stopPropagation();
}

function ProjectSectionMoveMenu({
  project,
  surface,
}: ProjectActionsMenuItemsProps) {
  const sectionMove = useProjectSectionMove();
  const isCompactViewport = useIsCompactViewport();
  const [expanded, setExpanded] = useState(false);
  if (!sectionMove) return null;
  const currentSectionId = sectionMove.currentSectionId(project);
  const Item = surface === "context" ? ContextMenuItem : DropdownMenuItem;
  const inline = isCompactViewport && surface === "dropdown";
  const items = (
    <>
      {sectionMove.destinations.map((destination) => {
        const isCurrent = destination.sectionId === currentSectionId;
        return (
          <Item
            key={destination.sectionId ?? "none"}
            aria-current={isCurrent ? "true" : undefined}
            className="flex items-center justify-between gap-3"
            inset={inline}
            disabled={isCurrent}
            onSelect={() =>
              sectionMove.moveProject(project, destination.sectionId)
            }
          >
            <span className="min-w-0 flex-1 truncate">{destination.label}</span>
            {isCurrent ? (
              <Icon name="Check" className="ml-auto" aria-hidden="true" />
            ) : null}
          </Item>
        );
      })}
      {sectionMove.requestNewSection ? (
        <Item inset={inline} onSelect={() => sectionMove.requestNewSection?.()}>
          <Icon name="SectionAdd" aria-hidden="true" />
          New section…
        </Item>
      ) : null}
    </>
  );

  if (inline) {
    return (
      <>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            setExpanded((current) => !current);
          }}
        >
          <Icon name="MoveTo" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">Move to section</span>
          <Icon
            name={expanded ? "ChevronDown" : "ChevronRight"}
            className="ml-auto"
            aria-hidden="true"
          />
        </DropdownMenuItem>
        {expanded ? items : null}
      </>
    );
  }

  const Sub = surface === "context" ? ContextMenuSub : DropdownMenuSub;
  const SubTrigger =
    surface === "context" ? ContextMenuSubTrigger : DropdownMenuSubTrigger;
  const SubContent =
    surface === "context" ? ContextMenuSubContent : DropdownMenuSubContent;
  return (
    <Sub>
      <SubTrigger>
        <Icon name="MoveTo" aria-hidden="true" />
        Move to section
      </SubTrigger>
      <SubContent className="max-h-[min(24rem,calc(100vh-2rem))] min-w-44 overflow-y-auto">
        {items}
      </SubContent>
    </Sub>
  );
}

export function ProjectActionsMenuItems({
  project,
  surface,
}: ProjectActionsMenuItemsProps) {
  const navigate = useNavigate();
  const { hostId: pickerHostId } = usePathPickerHost();
  const { requestRename, requestDelete, requestAddLocalPath } =
    useProjectActions();
  const showAddLocalPath =
    pickerHostId != null &&
    !findLocalPathProjectSourceForHost(project.sources, pickerHostId);

  return (
    <>
      <ActionMenuItem
        surface={surface}
        icon="Settings"
        onSelect={() => {
          navigate(getSettingsProjectRoutePath(project.id));
        }}
      >
        Project settings
      </ActionMenuItem>
      <ActionMenuItem
        surface={surface}
        icon="Edit"
        onSelect={() => {
          requestRename(project);
        }}
      >
        Rename
      </ActionMenuItem>
      {showAddLocalPath ? (
        <ActionMenuItem
          surface={surface}
          icon="FolderPlus"
          onSelect={() => {
            requestAddLocalPath(project);
          }}
        >
          Add local path
        </ActionMenuItem>
      ) : null}
      <ProjectSectionMoveMenu project={project} surface={surface} />
      <ActionMenuSeparator surface={surface} />
      <ActionMenuItem
        surface={surface}
        icon="Trash2"
        variant="destructive"
        onSelect={() => {
          requestDelete(project);
        }}
      >
        Remove
      </ActionMenuItem>
    </>
  );
}

export function ProjectActionsMenu({
  project,
  triggerClassName,
  onOpenChange,
}: ProjectActionsMenuProps) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "rounded-md p-0 text-muted-foreground",
            triggerClassName,
            "data-[state=open]:bg-state-active data-[state=open]:text-foreground",
          )}
          aria-label={`${project.name} actions`}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <Icon
            name="MoreHorizontal"
            className={COARSE_POINTER_ICON_SIZE_CLASS}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onClick={stopProjectActionsMenuClickPropagation}
      >
        <ProjectActionsMenuItems project={project} surface="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectActionsContextMenu(
  props: ProjectActionsContextMenuProps,
) {
  const isCompactViewport = useIsCompactViewport();
  if (isCompactViewport) {
    return <ProjectActionsCompactLongPressMenu {...props} />;
  }
  return <ProjectActionsDesktopContextMenu {...props} />;
}

function ProjectActionsCompactLongPressMenu({
  children,
  project,
  onOpenChange,
}: ProjectActionsContextMenuProps) {
  return (
    <CompactLongPressMenu
      label={`${project.name} actions`}
      onOpenChange={onOpenChange}
      items={<ProjectActionsMenuItems project={project} surface="dropdown" />}
    >
      {children}
    </CompactLongPressMenu>
  );
}

function ProjectActionsDesktopContextMenu({
  children,
  project,
  onOpenChange,
}: ProjectActionsContextMenuProps) {
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        aria-label={`${project.name} actions`}
        onClick={stopProjectActionsMenuClickPropagation}
      >
        <ProjectActionsMenuItems project={project} surface="context" />
      </ContextMenuContent>
    </ContextMenu>
  );
}
