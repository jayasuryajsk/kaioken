import { useCallback, useState } from "react";
import { PERSONAL_PROJECT_ID } from "@kaioken/domain";
import { Button } from "@kaioken/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@kaioken/shared-ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@kaioken/shared-ui/toggle-group";
import {
  NewThreadComposer,
  type NewThreadComposerSubmission,
} from "@/components/promptbox/NewThreadComposer";
import { useCreateThread } from "@/hooks/mutations/thread-runtime-mutations";

export interface BoardTaskDialogColumn {
  id: string;
  sectionId: string | null;
  name: string;
}

interface BoardTaskDialogProps {
  open: boolean;
  columns: readonly BoardTaskDialogColumn[];
  initialProjectId: string | null;
  initialSectionId: string | null | undefined;
  onSaveDraft: (args: { text: string; projectId: string }) => void;
  onClose: () => void;
}

const TODO_VALUE = "todo";
const CHIP_CLASS =
  "h-7 rounded-md px-2.5 text-xs data-[state=on]:bg-state-active data-[state=on]:text-foreground";

export function BoardTaskDialog({
  open,
  columns,
  initialProjectId,
  initialSectionId,
  onSaveDraft,
  onClose,
}: BoardTaskDialogProps) {
  const createThread = useCreateThread();
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const [sectionId, setSectionId] = useState<string | null>(
    initialSectionId === undefined
      ? (columns.find((column) => column.sectionId !== null)?.sectionId ?? null)
      : initialSectionId,
  );

  const handleSubmit = useCallback(
    async (request: NewThreadComposerSubmission) => {
      const { sendAt, ...requestFields } = request;
      await createThread.mutateAsync({
        ...requestFields,
        ...(sectionId === null ? {} : { sectionId }),
        ...(sendAt === undefined ? {} : { sendAt }),
      });
      onClose();
    },
    [createThread, onClose, sectionId],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            Same composer as a new thread: pick the repo, model, reasoning, and
            permissions, then send. The thread lands in the column you choose.
          </DialogDescription>
        </DialogHeader>
        <NewThreadComposer
          projectId={projectId}
          onProjectChange={setProjectId}
          draftStorage={{ kind: "plugin-new-thread", key: "board" }}
          selectionScope="component-local"
          resetKey="board"
          focusRequest={1}
          onSubmit={handleSubmit}
        >
          {({ renderPromptBox, promptDraft }) => (
            <div className="flex flex-col gap-3">
              {renderPromptBox({
                placeholder: "Describe the task for the agent.",
                allowNoProject: true,
                autoFocus: true,
              })}
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-muted-foreground">Column</span>
                <ToggleGroup
                  type="single"
                  value={sectionId ?? TODO_VALUE}
                  onValueChange={(value) => {
                    if (!value) return;
                    setSectionId(value === TODO_VALUE ? null : value);
                  }}
                  aria-label="Column"
                  className="flex flex-wrap gap-1"
                >
                  {columns.map((column) => (
                    <ToggleGroupItem
                      key={column.id}
                      value={column.sectionId ?? TODO_VALUE}
                      className={CHIP_CLASS}
                    >
                      {column.name}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => {
                    const draft = promptDraft.getCurrent();
                    if (draft.text.trim().length === 0) return;
                    onSaveDraft({
                      text: draft.text,
                      projectId: projectId ?? PERSONAL_PROJECT_ID,
                    });
                    promptDraft.setDraft({
                      text: "",
                      mentions: [],
                      attachments: [],
                    });
                    onClose();
                  }}
                >
                  Save as draft instead
                </Button>
              </div>
            </div>
          )}
        </NewThreadComposer>
      </DialogContent>
    </Dialog>
  );
}
