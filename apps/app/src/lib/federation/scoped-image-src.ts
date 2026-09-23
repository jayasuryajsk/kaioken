import { useEffect, useState } from "react";
import { useContentTransport } from "./remote-server-context";

const objectUrls = new Map<string, Promise<string>>();

function loadObjectUrl(
  key: string,
  load: () => Promise<Response>,
): Promise<string> {
  const existing = objectUrls.get(key);
  if (existing !== undefined) return existing;
  const created = load().then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return URL.createObjectURL(await response.blob());
  });
  created.catch(() => objectUrls.delete(key));
  objectUrls.set(key, created);
  return created;
}

export function useScopedImageSrc(src: string): string | null {
  const transport = useContentTransport();
  const needsFetch = transport.usesObjectUrls && src.startsWith("/");
  const absolute = needsFetch ? transport.resolveUrl(src) : src;
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(
    null,
  );
  useEffect(() => {
    if (!needsFetch) return;
    let cancelled = false;
    void loadObjectUrl(absolute, () => transport.fetch(absolute)).then(
      (url) => {
        if (!cancelled) setLoaded({ key: absolute, url });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [absolute, needsFetch, transport]);
  if (!needsFetch) return src;
  return loaded?.key === absolute ? loaded.url : null;
}
