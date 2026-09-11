import { NavLink, useNavigate } from "react-router-dom";
import { Icon } from "@kaioken/shared-ui/icon";
import { cn } from "@kaioken/shared-ui/lib/utils";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar.js";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { useAppCommandRunner } from "@/components/commands/AppCommandProvider";
import { usePluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import {
  getPluginPanelRoutePath,
  getPluginsRoutePath,
  getSkillsRoutePath,
} from "@/lib/route-paths";

const RAIL_BUTTON_CLASS =
  "size-8 justify-center rounded-md p-0 text-sidebar-foreground/80 hover:text-sidebar-foreground [&_svg]:size-4";

interface SidebarRailProps {
  onNewChat: () => void;
  settingsRoutePath: string;
  showResources: boolean;
}

interface RailLinkProps {
  label: string;
  to: string;
  children: React.ReactNode;
}

function RailLink({ label, to, children }: RailLinkProps) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        className={RAIL_BUTTON_CLASS}
        tooltip={{ children: label, hidden: false, side: "right" }}
        aria-label={label}
      >
        <NavLink
          to={to}
          className={({ isActive }) =>
            cn(isActive && "bg-state-active text-sidebar-foreground")
          }
        >
          {children}
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function SidebarRail({
  onNewChat,
  settingsRoutePath,
  showResources,
}: SidebarRailProps) {
  const { toggleSidebar } = useSidebar();
  const commandRunner = useAppCommandRunner();
  const navigate = useNavigate();
  const panels = usePluginNavPanelChrome();
  return (
    <div
      data-testid="sidebar-rail"
      className="flex h-full min-h-0 flex-col items-center gap-1 px-2 pb-2 pt-[calc(var(--kaioken-chrome-row-height,2.25rem)+0.25rem)]"
    >
      <SidebarMenu className="w-auto items-center gap-1">
        <SidebarMenuItem>
          <SidebarMenuButton
            className={RAIL_BUTTON_CLASS}
            tooltip={{
              children: "Expand sidebar",
              hidden: false,
              side: "right",
            }}
            aria-label="Expand sidebar"
            onClick={toggleSidebar}
          >
            <Icon name="PanelLeft" />
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            className={RAIL_BUTTON_CLASS}
            tooltip={{ children: "New thread", hidden: false, side: "right" }}
            aria-label="New thread"
            onClick={onNewChat}
          >
            <Icon name="MessageSquarePlus" />
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            className={RAIL_BUTTON_CLASS}
            tooltip={{
              children: "Search threads",
              hidden: false,
              side: "right",
            }}
            aria-label="Search threads"
            disabled={!commandRunner.isCommandAvailable("thread.search", null)}
            onClick={() => commandRunner.dispatch("thread.search", null)}
          >
            <Icon name="Search" />
          </SidebarMenuButton>
        </SidebarMenuItem>
        {showResources ? (
          <>
            <RailLink label="Plugins" to={getPluginsRoutePath()}>
              <Icon name="Plug02" />
            </RailLink>
            <RailLink label="Skills" to={getSkillsRoutePath()}>
              <Icon name="Zap" />
            </RailLink>
          </>
        ) : null}
        {panels.map(({ chrome }) => (
          <SidebarMenuItem key={`${chrome.pluginId}/${chrome.id}`}>
            <SidebarMenuButton
              className={RAIL_BUTTON_CLASS}
              tooltip={{ children: chrome.title, hidden: false, side: "right" }}
              aria-label={chrome.title}
              onClick={() =>
                void navigate(
                  getPluginPanelRoutePath({
                    pluginId: chrome.pluginId,
                    path: chrome.path,
                  }),
                )
              }
            >
              <PluginIcon pluginId={chrome.pluginId} icon={chrome.icon} />
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
      <div className="min-h-0 flex-1" />
      <SidebarMenu className="w-auto items-center gap-1">
        <RailLink label="Settings" to={settingsRoutePath}>
          <Icon name="Settings" />
        </RailLink>
      </SidebarMenu>
    </div>
  );
}
