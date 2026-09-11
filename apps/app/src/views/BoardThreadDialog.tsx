import { Button } from "@kaioken/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@kaioken/shared-ui/dialog";
import { Icon } from "@kaioken/shared-ui/icon";
import { PluginThreadChat } from "@/components/plugin/PluginThreadChat";

interface BoardThreadDialogProps {
  threadId: string;
  title: string;
  subtitle: string;
  onOpenFull: () => void;
  onOpenInSplit: () => void;
  onClose: () => void;
}

export function BoardThreadDialog({
  threadId,
  title,
  subtitle,
  onOpenFull,
  onOpenInSplit,
  onClose,
}: BoardThreadDialogProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid="board-thread-dialog"
        className="flex h-[min(52rem,calc(100dvh-3rem))] w-[min(64rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-seam py-2 pl-4 pr-12">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm font-medium">
              {title}
            </DialogTitle>
            <DialogDescription className="truncate text-xs text-muted-foreground">
              {subtitle}
            </DialogDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onOpenInSplit}
            aria-label="Open in split"
          >
            <Icon name="Columns2" className="size-3.5" />
            Split
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenFull}
          >
            Open thread
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <PluginThreadChat
            threadId={threadId}
            variant="full"
            layout="contained"
            focusRequest={1}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
