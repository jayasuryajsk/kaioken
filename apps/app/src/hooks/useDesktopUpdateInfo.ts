import { useEffect, useState } from "react";
import type { KaiokenDesktopApi, KaiokenDesktopInfo } from "@kaioken/desktop-contract";
import { getBbDesktopInfo } from "@/lib/kaioken-desktop";

interface DesktopUpdateInfo {
  desktopApi: KaiokenDesktopApi | null;
  desktopInfo: KaiokenDesktopInfo | null;
  isDesktop: boolean;
}

export function useDesktopUpdateInfo(): DesktopUpdateInfo {
  const [desktopApi] = useState<KaiokenDesktopApi | null>(() => getBbDesktopInfo());
  const [desktopInfo, setDesktopInfo] = useState<KaiokenDesktopInfo | null>(null);

  useEffect(() => {
    const api = getBbDesktopInfo();
    if (api === null) {
      return;
    }

    let mounted = true;
    void api
      .getInfo()
      .then((info) => {
        if (mounted) {
          setDesktopInfo(info);
        }
      })
      .catch(() => undefined);
    const unsubscribe = api.onChange((info) => {
      setDesktopInfo(info);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return { desktopApi, desktopInfo, isDesktop: desktopApi !== null };
}
