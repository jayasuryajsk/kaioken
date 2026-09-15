// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";
import { createBrowserBbSdk } from "@kaioken/sdk/browser";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import {
  acknowledgeWorkspaceDraft,
  copyWorkspaceDraft,
  pendingWorkspaceDraft,
  queueWorkspaceDraft,
  receiveWorkspaceDraft,
} from "./workspace-drafts";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

it("copies attachment bytes into the selected computer and clears the source only after its receipt", async () => {
  const sourceFetch = vi.fn(
    async () =>
      new Response(new Uint8Array([255, 0, 13, 10]), {
        headers: { "content-type": "image/png" },
      }),
  );
  const destinationFetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        type: "localImage",
        path: "remote-image.png",
        name: "image.png",
        mimeType: "image/png",
        sizeBytes: 4,
      }),
  );
  const source = createBrowserBbSdk({
    baseUrl: "https://source.example",
    fetch: sourceFetch,
  });
  const destination = createBrowserBbSdk({
    baseUrl: "https://destination.example",
    fetch: destinationFetch,
  });
  const original = {
    text: "Use this screenshot",
    mentions: [],
    attachments: [
      {
        type: "localImage" as const,
        path: "local-image.png",
        name: "image.png",
        sizeBytes: 4,
      },
    ],
  };
  const draft = await copyWorkspaceDraft({
    source,
    destination,
    sourceProjectId: "source-project",
    destinationProjectId: "destination-project",
    draft: original,
  });
  expect(draft.attachments[0]?.path).toBe("remote-image.png");
  expect(original.attachments[0]?.path).toBe("local-image.png");
  const [uploadUrl, uploadInit] = destinationFetch.mock.calls[0]!;
  expect(uploadUrl).toBe(
    "https://destination.example/api/v1/projects/destination-project/attachments",
  );
  expect(uploadInit?.body).toBeInstanceOf(FormData);
  const accepted = vi.fn();
  const path = `/?connectionDraft=${draft.id}`;
  queueWorkspaceDraft("remote", "installation", draft, accepted);
  expect(pendingWorkspaceDraft("other", "installation", path)).toBeNull();
  acknowledgeWorkspaceDraft("other", "installation", draft.id);
  acknowledgeWorkspaceDraft("remote", "replacement", draft.id);
  expect(pendingWorkspaceDraft("remote", "replacement", path)).toBeNull();
  expect(accepted).not.toHaveBeenCalled();
  expect(pendingWorkspaceDraft("remote", "installation", path)).toEqual(draft);
  acknowledgeWorkspaceDraft("remote", "installation", draft.id);
  acknowledgeWorkspaceDraft("remote", "installation", draft.id);
  expect(accepted).toHaveBeenCalledTimes(1);
  expect(pendingWorkspaceDraft("remote", "installation", path)).toBeNull();
});

it("leaves the source draft intact when an attachment upload fails", async () => {
  const source = createBrowserBbSdk({
    baseUrl: "https://source.example",
    fetch: async () => new Response("file"),
  });
  const destination = createBrowserBbSdk({
    baseUrl: "https://destination.example",
    fetch: async () => Response.json({ error: "Offline" }, { status: 503 }),
  });
  const draft = {
    text: "Unsent text",
    mentions: [],
    attachments: [
      {
        type: "localFile" as const,
        path: "local.txt",
        name: "local.txt",
        sizeBytes: 4,
      },
    ],
  };
  await expect(
    copyWorkspaceDraft({
      source,
      destination,
      sourceProjectId: "source-project",
      destinationProjectId: "destination-project",
      draft,
    }),
  ).rejects.toThrow();
  expect(draft).toEqual({
    text: "Unsent text",
    mentions: [],
    attachments: [
      { type: "localFile", path: "local.txt", name: "local.txt", sizeBytes: 4 },
    ],
  });
});

it("preserves another remote draft and does not replace edits when navigation is delivered twice", () => {
  const existing = getPromptDraftAccessor({ kind: "new-thread" });
  existing.setDraft({
    text: "Already composing here",
    mentions: [],
    attachments: [],
  });
  const draft = {
    id: crypto.randomUUID(),
    text: "Incoming draft",
    attachments: [],
  };
  receiveWorkspaceDraft(draft);
  const transferred = getPromptDraftAccessor({
    kind: "connection-new-thread",
    transferId: draft.id,
  });
  expect(transferred.getCurrent().text).toBe("Incoming draft");
  transferred.setDraft({
    text: "Edited on the remote computer",
    mentions: [],
    attachments: [],
  });
  receiveWorkspaceDraft(draft);
  expect(transferred.getCurrent().text).toBe("Edited on the remote computer");
  expect(existing.getCurrent().text).toBe("Already composing here");
});
