import { atomWithStorage } from "jotai/utils";

export const SIDEBAR_PRIORITY_VIEW_STORAGE_KEY = "kaioken.sidebar.priorityView";

export const sidebarPriorityViewAtom = atomWithStorage<boolean>(
  SIDEBAR_PRIORITY_VIEW_STORAGE_KEY,
  false,
  undefined,
  { getOnInit: true },
);
