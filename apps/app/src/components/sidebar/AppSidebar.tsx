import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import {
  applySidebarPreferences,
  sidebarPreferencesAtom,
} from "@/lib/sidebar-preference";
import { cn } from "@kaioken/shared-ui/lib/utils";
import {
  PERSONAL_PROJECT_ID,
  THREAD_JUMP_APP_COMMAND_IDS,
} from "@kaioken/domain";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@kaioken/shared-ui/icon";
import { COARSE_POINTER_CHILD_ICON_BUTTON_CLASS } from "@kaioken/shared-ui/coarse-pointer-sizing";
import { OverflowFade } from "@/components/ui/overflow-fade.js";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useCloseMobileSidebar,
  useSidebar,
} from "@/components/ui/sidebar.js";
import { ProjectList } from "./ProjectList";
import { PluginThreadList } from "./PluginThreadList";
import { useThreadListReplacement } from "./threadListProvider";
import {
  PluginSidebarFooterDisclosure,
  PluginSidebarFooterItems,
  usePluginSidebarFooterDisclosure,
} from "@/components/plugin/PluginSidebarFooterItems";
import { SidebarPluginAttentionGlyph } from "./SidebarPluginAttentionGlyph";
import { SidebarUpdatesBadge } from "./SidebarUpdatesBadge";
import { SidebarHistoryNavigationControls } from "./SidebarHistoryNavigationControls";
import { useQuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import {
  CHROME_ROW_CLASS,
  getBbDesktopInfo,
  MACOS_CHROME_CONTROL_NO_DRAG_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/kaioken-desktop";
import { getRootComposeRoutePath, getThreadRoutePath } from "@/lib/route-paths";
import { usePaneContentSplitDrag } from "./usePaneContentSplitDrag";
import {
  EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS,
  getSidebarThreadNavigationTargets,
  getSidebarThreadShortcutTargets,
  SidebarThreadShortcutKeysContext,
  type SidebarThreadShortcutPresentation,
  type SidebarThreadShortcutTarget,
} from "./sidebarThreadShortcuts";
import {
  useAppCommandHandler,
  useAppCommandShortcut,
  useAppCommandShortcuts,
  useIsAppCommandModifierHeld,
  useIndexedAppCommandHandlers,
} from "@/components/commands/AppCommandProvider";
import { useRouteState } from "@/hooks/useRouteState";
import { SidebarNavigationRegion } from "./SidebarNavigationRegion";
import { SidebarRail } from "./SidebarRail";

const NEW_THREAD_PANE_CONTENT = { kind: "new-thread" } as const;

const SIDEBAR_FOOTER_ACTION_CLASS = cn(
  COARSE_POINTER_CHILD_ICON_BUTTON_CLASS,
  "text-muted-foreground hover:text-sidebar-foreground [&>svg]:opacity-80",
);

interface AppSidebarProps {
  onResizeMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
  showTopReserve: boolean;
  settingsRoutePath: string;
  toolsRoutePath?: string;
  mobileHosted?: { hidden: boolean };
}

export function AppSidebar({
  onResizeMouseDown,
  isResizing,
  showTopReserve,
  settingsRoutePath,
  toolsRoutePath,
  mobileHosted,
}: AppSidebarProps) {
  const quickCreateProject = useQuickCreateProjectController();
  const threadListReplacement = useThreadListReplacement();
  const { threadId: activeThreadId } = useRouteState();
  const navigate = useNavigate();
  const newThreadSplit = usePaneContentSplitDrag({
    content: NEW_THREAD_PANE_CONTENT,
    enabled: true,
    label: "New thread",
  });
  const closeOnMobile = useCloseMobileSidebar();
  const { isCompactViewport, openMobile, state: sidebarState } = useSidebar();
  const [compactCustomizeMode, setCompactCustomizeMode] = useState(false);
  const [desktopInfo] = useState(getBbDesktopInfo);
  const [threadShortcutKeysById, setThreadShortcutKeysById] = useState<
    ReadonlyMap<string, SidebarThreadShortcutPresentation>
  >(EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const threadShortcutTargetsRef = useRef<
    readonly SidebarThreadShortcutTarget[]
  >([]);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const threadJumpShortcuts = useAppCommandShortcuts(
    THREAD_JUMP_APP_COMMAND_IDS,
  );
  const isAppCommandModifierHeld = useIsAppCommandModifierHeld();
  const settingsShortcut = useAppCommandShortcut("settings.open");
  const pluginSidebarFooter = usePluginSidebarFooterDisclosure();
  const sidebarPreferences = useAtomValue(sidebarPreferencesAtom);
  useEffect(() => {
    applySidebarPreferences(sidebarPreferences);
  }, [sidebarPreferences]);

  const handleNewChat = useCallback(() => {
    closeOnMobile();
    void navigate(getRootComposeRoutePath(), {
      state: { focusPrompt: true },
    });
  }, [closeOnMobile, navigate]);
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const handleQuickChat = useCallback(() => {
    closeOnMobile();
    setRootComposeProjectId(PERSONAL_PROJECT_ID);
    void navigate(getRootComposeRoutePath(), {
      state: { focusPrompt: true },
    });
  }, [closeOnMobile, navigate, setRootComposeProjectId]);

  const showThreadShortcuts = useCallback(() => {
    const targets = getSidebarThreadShortcutTargets(sidebarRef.current);
    threadShortcutTargetsRef.current = targets;
    setThreadShortcutKeysById(
      new Map(
        targets.flatMap((target, index) => {
          const command = THREAD_JUMP_APP_COMMAND_IDS[index];
          const shortcut = command
            ? threadJumpShortcuts.get(command)
            : undefined;
          return shortcut ? [[target.threadId, shortcut] as const] : [];
        }),
      ),
    );
  }, [threadJumpShortcuts]);

  const hideThreadShortcuts = useCallback(() => {
    threadShortcutTargetsRef.current = [];
    setThreadShortcutKeysById(EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS);
  }, []);

  const activateThreadShortcut = useCallback((index: number): boolean => {
    const targets = threadShortcutTargetsRef.current;
    const target =
      targets[index] ??
      getSidebarThreadShortcutTargets(sidebarRef.current)[index];
    if (!target?.element) return false;
    target.element.click();
    return true;
  }, []);

  const activateAdjacentThread = useCallback(
    (offset: -1 | 1): boolean => {
      const targets = getSidebarThreadNavigationTargets(sidebarRef.current);
      if (targets.length === 0) return false;
      const activeIndex = targets.findIndex(
        (target) => target.threadId === activeThreadId,
      );
      const nextIndex =
        activeIndex === -1
          ? offset === 1
            ? 0
            : targets.length - 1
          : (activeIndex + offset + targets.length) % targets.length;
      const target = targets[nextIndex];
      if (!target) return false;
      if (target.element) {
        target.element.click();
        return true;
      }
      if (!target.projectId) return false;
      closeOnMobile();
      void navigate(
        getThreadRoutePath({
          projectId: target.projectId,
          threadId: target.threadId,
        }),
      );
      return true;
    },
    [activeThreadId, closeOnMobile, navigate],
  );

  const isHiddenHostedBody = mobileHosted?.hidden === true;
  const isCompactCustomizeModeActive =
    isCompactViewport && compactCustomizeMode;
  useEffect(() => {
    if (!isCompactViewport || !openMobile || isHiddenHostedBody) {
      setCompactCustomizeMode(false);
    }
  }, [isCompactViewport, isHiddenHostedBody, openMobile]);
  const activateVisibleThreadShortcut = useCallback(
    (index: number) =>
      isHiddenHostedBody ? false : activateThreadShortcut(index),
    [activateThreadShortcut, isHiddenHostedBody],
  );
  useIndexedAppCommandHandlers(
    THREAD_JUMP_APP_COMMAND_IDS,
    activateVisibleThreadShortcut,
  );
  useAppCommandHandler("thread.previous", () =>
    isHiddenHostedBody ? false : activateAdjacentThread(-1),
  );
  useAppCommandHandler("thread.next", () =>
    isHiddenHostedBody ? false : activateAdjacentThread(1),
  );

  useEffect(() => {
    if (isAppCommandModifierHeld) {
      showThreadShortcuts();
      return;
    }
    hideThreadShortcuts();
  }, [hideThreadShortcuts, isAppCommandModifierHeld, showThreadShortcuts]);

  const originalThreadList = (
    <ProjectList
      onNewProject={
        quickCreateProject.isAvailable
          ? quickCreateProject.openCreateDialog
          : undefined
      }
      onProjectSelect={closeOnMobile}
      isCreatingProject={quickCreateProject.isCreating}
    />
  );

  const body = (
    <>
      {showTopReserve ? (
        <div
          data-testid="app-sidebar-top-reserve-row"
          className={cn(
            CHROME_ROW_CLASS,
            "shrink-0 justify-end px-2",
            usesDesktopChrome && MACOS_WINDOW_DRAG_CLASS,
          )}
        >
          <SidebarHistoryNavigationControls
            onNavigate={closeOnMobile}
            className={cn(
              "group-data-[collapsible=icon]:hidden",
              usesDesktopChrome && MACOS_CHROME_CONTROL_NO_DRAG_CLASS,
            )}
          />
        </div>
      ) : null}
      <SidebarNavigationRegion
        compactCustomizeMode={isCompactCustomizeModeActive}
        onCompactCustomizeModeChange={setCompactCustomizeMode}
        onNavigate={closeOnMobile}
        splitEnabled
        toolsRoutePath={
          sidebarPreferences.hideResourceNav ? undefined : toolsRoutePath
        }
        newThreadSplit={newThreadSplit}
        onNewChat={handleNewChat}
        onQuickChat={handleQuickChat}
        onSearchThreads={closeOnMobile}
      />
      <div
        aria-hidden="true"
        className={cn(
          "mx-2 my-2 shrink-0 border-t border-sidebar-border/25",
          isCompactCustomizeModeActive && "hidden",
        )}
        data-testid="app-sidebar-navigation-divider"
      />
      <SidebarContent
        className={cn(isCompactCustomizeModeActive && "hidden")}
        aria-hidden={isCompactCustomizeModeActive ? true : undefined}
        inert={isCompactCustomizeModeActive ? true : undefined}
      >
        <PluginThreadList
          replacement={threadListReplacement}
          original={originalThreadList}
          searchQuery=""
          onNavigate={closeOnMobile}
        />
      </SidebarContent>
      <SidebarFooter className="relative">
        <OverflowFade placement="above" tone="sidebar" size="sm" />
        <PluginSidebarFooterDisclosure
          item={pluginSidebarFooter.activeItem}
          onDismiss={pluginSidebarFooter.dismiss}
        />
        <SidebarMenu className="flex-row flex-wrap-reverse items-center gap-1">
          <SidebarMenuItem className="min-w-0">
            <SidebarMenuButton
              asChild
              aria-label={
                settingsShortcut
                  ? `Settings (${settingsShortcut.label})`
                  : "Settings"
              }
              aria-keyshortcuts={settingsShortcut?.ariaKeyshortcuts}
              tooltip={{
                children: settingsShortcut
                  ? `Settings (${settingsShortcut.label})`
                  : "Settings",
                hidden: false,
                side: "top",
              }}
              className={SIDEBAR_FOOTER_ACTION_CLASS}
            >
              <Link to={settingsRoutePath} onClick={closeOnMobile}>
                <Icon name="Settings" />
                <span className="sr-only">Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <PluginSidebarFooterItems
            activeDisclosureKey={pluginSidebarFooter.activeKey}
            onDisclosureCommand={pluginSidebarFooter.handleCommand}
            onNavigate={closeOnMobile}
          />
          <li aria-hidden="true" className="min-w-0 flex-1" />
          <SidebarPluginAttentionGlyph
            className={SIDEBAR_FOOTER_ACTION_CLASS}
            onNavigate={closeOnMobile}
          />
          <SidebarUpdatesBadge onNavigate={closeOnMobile} />
        </SidebarMenu>
      </SidebarFooter>
      <div
        data-testid="app-sidebar-resize-handle"
        className={cn(
          "absolute -right-1.5 top-0 z-30 hidden h-full w-3 cursor-col-resize md:block",
          "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors hover:before:bg-sidebar-border",
          "group-data-[collapsible=icon]:hidden",
          isResizing && "before:bg-sidebar-border",
        )}
        onMouseDown={onResizeMouseDown}
      />
    </>
  );

  return (
    <SidebarThreadShortcutKeysContext.Provider value={threadShortcutKeysById}>
      {mobileHosted ? (
        <div
          ref={sidebarRef}
          data-testid="app-sidebar-body"
          hidden={mobileHosted.hidden}
          className="flex min-h-0 flex-1 flex-col"
        >
          {body}
        </div>
      ) : (
        <Sidebar
          ref={sidebarRef}
          collapsible={sidebarPreferences.rail ? "icon" : "offcanvas"}
        >
          {sidebarPreferences.rail &&
          sidebarState === "collapsed" &&
          !isCompactViewport ? (
            <SidebarRail
              onNewChat={handleNewChat}
              onQuickChat={handleQuickChat}
              settingsRoutePath={settingsRoutePath}
              showResources={
                toolsRoutePath !== undefined &&
                !sidebarPreferences.hideResourceNav
              }
            />
          ) : (
            body
          )}
        </Sidebar>
      )}
    </SidebarThreadShortcutKeysContext.Provider>
  );
}
