import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";

export const composeBackdropAtom =
  createSyncedPreferenceAtom("compose.backdrop");
