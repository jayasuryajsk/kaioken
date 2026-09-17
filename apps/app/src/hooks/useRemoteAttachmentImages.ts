import { useEffect, useMemo, useState } from "react";
import { useRemoteServer } from "@/lib/federation/remote-server-context";
import { createRemoteFetch } from "@/lib/federation/remote-fetch";

const placeholder =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

export function useRemoteAttachmentImages<T extends { src: string }>(
  items: T[],
): T[] {
  const server = useRemoteServer();
  const origin = server ? new URL(server.url).origin : null;
  const sources = JSON.stringify([
    ...new Set(
      items
        .map((item) => item.src)
        .filter((src) => src.startsWith("/api/") && !src.startsWith("//")),
    ),
  ]);
  const [loaded, setLoaded] = useState<{
    origin: string;
    sources: string;
    urls: Map<string, string>;
  } | null>(null);
  useEffect(() => {
    if (origin === null) return;
    const controller = new AbortController();
    const urls = new Map<string, string>();
    const remoteFetch = createRemoteFetch();
    const paths: string[] = JSON.parse(sources);
    for (const path of paths) {
      void remoteFetch(new URL(path, origin), { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) return;
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          urls.set(path, URL.createObjectURL(blob));
          setLoaded({ origin, sources, urls: new Map(urls) });
        })
        .catch(() => undefined);
    }
    return () => {
      controller.abort();
      for (const url of urls.values()) URL.revokeObjectURL(url);
    };
  }, [origin, sources]);
  return useMemo(
    () =>
      origin === null
        ? items
        : items.map((item) => ({
            ...item,
            src: item.src.startsWith("/api/")
              ? ((loaded?.origin === origin && loaded.sources === sources
                  ? loaded.urls.get(item.src)
                  : undefined) ?? placeholder)
              : /^file:/i.test(item.src)
                ? placeholder
                : item.src,
          })),
    [items, loaded, origin, sources],
  );
}
