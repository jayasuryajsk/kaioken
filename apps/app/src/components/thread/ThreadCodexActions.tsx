import type { Thread } from "@kaioken/domain";
import {
  ActionMenuItem,
  ActionMenuSeparator,
} from "@/components/ui/action-menu-items";
import { useCodexThreadLink } from "@/hooks/queries/codex-queries";
import {
  useCodexHandoff,
  useCodexSync,
} from "@/hooks/mutations/codex-mutations";

interface ThreadCodexActionsProps {
  thread: Pick<Thread, "id" | "providerId">;
  surface: "context" | "dropdown";
  showSeparator: boolean;
}

export function ThreadCodexActions({
  thread,
  surface,
  showSeparator,
}: ThreadCodexActionsProps) {
  const link = useCodexThreadLink({
    threadId: thread.id,
    providerId: thread.providerId,
  });
  const handoff = useCodexHandoff();
  const sync = useCodexSync();
  const linked = link.data?.providerThreadId != null;
  if (!linked) return null;
  const handedOff = link.data?.handoffState === "handed-off";

  return (
    <>
      <ActionMenuItem
        surface={surface}
        icon="Terminal"
        onSelect={() => {
          handoff.mutate({ threadId: thread.id });
        }}
      >
        Continue in Codex
      </ActionMenuItem>
      {handedOff ? (
        <ActionMenuItem
          surface={surface}
          icon="FolderSync"
          onSelect={() => {
            sync.mutate({ threadId: thread.id });
          }}
        >
          Sync from Codex
        </ActionMenuItem>
      ) : null}
      {showSeparator ? <ActionMenuSeparator surface={surface} /> : null}
    </>
  );
}
