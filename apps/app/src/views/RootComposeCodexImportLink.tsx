import { Icon } from "@kaioken/shared-ui/icon";

interface RootComposeCodexImportLinkProps {
  onOpen: () => void;
}

export function RootComposeCodexImportLink({
  onOpen,
}: RootComposeCodexImportLinkProps) {
  return (
    <div className="flex justify-end pt-2">
      <button
        type="button"
        data-testid="root-compose-import-codex"
        onClick={onOpen}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-subtle-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Icon name="Terminal" className="size-3.5" aria-hidden="true" />
        Import from Codex
      </button>
    </div>
  );
}
