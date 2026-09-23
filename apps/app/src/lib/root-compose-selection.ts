import { atom, useAtom, useSetAtom, type PrimitiveAtom } from "jotai";
import { useCallback } from "react";
import { useRemoteServer } from "./federation/remote-server-context";
import { atomWithStorage } from "jotai/utils";
import { PERSONAL_PROJECT_ID } from "@kaioken/domain";
import { createLocalStorageSyncStorage } from "./browser-storage";

const ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY = "bb.root-compose.project-id";
const ROOT_COMPOSE_COMPUTER_STORAGE_KEY = "kaioken.root-compose.computer";

function parseStoredProjectId(
  storedValue: string | null,
  initialValue: string,
): string {
  return storedValue && storedValue.length > 0 ? storedValue : initialValue;
}

const rootComposeProjectIdStorage = createLocalStorageSyncStorage<string>({
  parse: parseStoredProjectId,
  serialize: (value) => value,
});

const rootComposeProjectIdAtom = atomWithStorage<string>(
  ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY,
  PERSONAL_PROJECT_ID,
  rootComposeProjectIdStorage,
  { getOnInit: true },
);

const rootComposeReuseEnvironmentAtom = atom<string | null>(null);

const rootComposeComputerStorage = createLocalStorageSyncStorage<string | null>(
  {
    parse: (storedValue) =>
      storedValue && storedValue.length > 0 ? storedValue : null,
    serialize: (value) => value ?? "",
  },
);

const rootComposeComputerAtom = atomWithStorage<string | null>(
  ROOT_COMPOSE_COMPUTER_STORAGE_KEY,
  null,
  rootComposeComputerStorage,
  { getOnInit: true },
);

const remoteProjectIdAtoms = new Map<string, PrimitiveAtom<string>>();

function remoteRootComposeProjectIdAtom(handle: string): PrimitiveAtom<string> {
  const existing = remoteProjectIdAtoms.get(handle);
  if (existing !== undefined) return existing;
  const created = atomWithStorage<string>(
    `${ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY}.${handle}`,
    PERSONAL_PROJECT_ID,
    rootComposeProjectIdStorage,
    { getOnInit: true },
  ) as PrimitiveAtom<string>;
  remoteProjectIdAtoms.set(handle, created);
  return created;
}

export function useRootComposeComputer() {
  return useAtom(rootComposeComputerAtom);
}

export function useRootComposeProjectId() {
  const remote = useRemoteServer();
  return useAtom(
    remote === null
      ? rootComposeProjectIdAtom
      : remoteRootComposeProjectIdAtom(remote.handle),
  );
}

export function useSetRootComposeProjectId(): (projectId: string) => void {
  const remote = useRemoteServer();
  const setLocalProjectId = useSetAtom(rootComposeProjectIdAtom);
  const setComputer = useSetAtom(rootComposeComputerAtom);
  const setRemoteProjectId = useSetAtom(
    remoteRootComposeProjectIdAtom(remote?.handle ?? ""),
  );
  return useCallback(
    (projectId: string) => {
      if (remote === null) {
        setComputer(null);
        setLocalProjectId(projectId);
        return;
      }
      setRemoteProjectId(projectId);
    },
    [remote, setComputer, setLocalProjectId, setRemoteProjectId],
  );
}

export function useOpenRemoteRootCompose(): (args: {
  handle: string;
  projectId: string;
}) => void {
  const setComputer = useSetAtom(rootComposeComputerAtom);
  const store = useSetAtom(remoteProjectWriterAtom);
  return useCallback(
    ({ handle, projectId }) => {
      store({ handle, projectId });
      setComputer(handle);
    },
    [setComputer, store],
  );
}

const remoteProjectWriterAtom = atom(
  null,
  (_get, set, args: { handle: string; projectId: string }) => {
    set(remoteRootComposeProjectIdAtom(args.handle), args.projectId);
  },
);

export function useRootComposeReuseEnvironment() {
  return useAtom(rootComposeReuseEnvironmentAtom);
}
