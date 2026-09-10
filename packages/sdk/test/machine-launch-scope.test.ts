import { expect, it } from "vitest";
import { createBbSdk } from "../src/core.js";
import { createHttpTransport } from "../src/transport-http.js";

it("distinguishes thread launch resolution from an exact consumed launch", async () => {
  const urls: URL[] = [];
  const sdk = createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://bb.test",
      runtime: "node",
      fetch: async (url) => {
        const requestUrl = new URL(String(url));
        urls.push(requestUrl);
        return Response.json({
          id:
            requestUrl.searchParams.get("scope") === "thread"
              ? "replacement-launch"
              : null,
        });
      },
    }),
  });
  expect(await sdk.hosts.experimental_launch({ id: "thread" })).toEqual({
    id: null,
  });
  expect(
    await sdk.hosts.experimental_launch({
      id: "thread",
      scope: "thread",
    }),
  ).toEqual({ id: "replacement-launch" });
  expect(urls.map((url) => url.pathname)).toEqual([
    "/api/v1/hosts/launches/thread",
    "/api/v1/hosts/launches/thread",
  ]);
  expect(urls.map((url) => url.search)).toEqual(["", "?scope=thread"]);
});
