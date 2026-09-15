import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import {
  federatedSocketRequestSchema,
  federatedSocketSendSchema,
  federatedSocketCloseSchema,
} from "@kaioken/desktop-contract";
import { createFederatedSockets } from "./federated-sockets.js";
import {
  FEDERATED_SOCKET_OPEN_CHANNEL,
  FEDERATED_SOCKET_SEND_CHANNEL,
  FEDERATED_SOCKET_CLOSE_CHANNEL,
  FEDERATED_SOCKET_EVENT_CHANNEL,
} from "./desktop-federation-ipc.js";

function ownerId(event: IpcMainEvent | IpcMainInvokeEvent): string {
  return `${event.sender.id}:${event.senderFrame?.routingId}`;
}

export function registerFederatedSocketsIpc(
  args: Parameters<typeof createFederatedSockets>[0],
) {
  const connections = createFederatedSockets(args);
  const watchedOwners = new Set<string>();
  ipcMain.handle(
    FEDERATED_SOCKET_OPEN_CHANNEL,
    async (event, payload: unknown) => {
      const request = federatedSocketRequestSchema.parse(payload);
      const owner = ownerId(event);
      const frame = event.senderFrame;
      if (!frame) throw new Error("Connection window was closed");
      if (!watchedOwners.has(owner)) {
        watchedOwners.add(owner);
        event.sender.once("destroyed", () => {
          connections.closeOwner(owner);
          watchedOwners.delete(owner);
        });
        event.sender.on(
          "did-start-navigation",
          (_event, _url, isInPlace, _isMainFrame, _processId, routingId) => {
            if (!isInPlace && routingId === frame.routingId)
              connections.closeOwner(owner);
          },
        );
      }
      await connections.open(owner, request.id, request.url, (message) => {
        if (!frame.isDestroyed())
          frame.send(FEDERATED_SOCKET_EVENT_CHANNEL, message);
      });
    },
  );
  ipcMain.on(FEDERATED_SOCKET_SEND_CHANNEL, (event, payload: unknown) => {
    const request = federatedSocketSendSchema.safeParse(payload);
    if (request.success)
      connections.send(ownerId(event), request.data.id, request.data.data);
  });
  ipcMain.on(FEDERATED_SOCKET_CLOSE_CHANNEL, (event, payload: unknown) => {
    const request = federatedSocketCloseSchema.safeParse(payload);
    if (request.success) connections.close(ownerId(event), request.data.id);
  });
}
