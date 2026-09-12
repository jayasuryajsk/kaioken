import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  APNS_HOSTS,
  buildApnsPayload,
  createApnsTransport,
  createProviderToken,
  isValidDeviceToken,
  type ApnsRequest,
} from "./apns.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const privateKeyPem = privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const credentials = {
  keyId: "ABC1234567",
  teamId: "TEAM123456",
  privateKeyPem,
  topic: "app.kaioken.mobile",
  environment: "sandbox" as const,
};
const DEVICE_TOKEN = "ab".repeat(32);

function decodeSegment(segment: string): unknown {
  return JSON.parse(
    Buffer.from(
      segment.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8"),
  );
}

describe("createProviderToken", () => {
  it("produces an ES256 JWT that verifies with the key's public half", () => {
    const token = createProviderToken(credentials, 1_700_000_000_000);
    const [header, claims, signature] = token.split(".");
    expect(decodeSegment(header!)).toEqual({ alg: "ES256", kid: "ABC1234567" });
    expect(decodeSegment(claims!)).toEqual({
      iss: "TEAM123456",
      iat: 1_700_000_000,
    });
    const valid = verify(
      "sha256",
      Buffer.from(`${header}.${claims}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature!.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
    );
    expect(valid).toBe(true);
  });
});

describe("buildApnsPayload", () => {
  it("puts the alert under aps and the routing data at the top level", () => {
    expect(
      buildApnsPayload({
        title: "Fix the tests",
        body: "Approve command: pnpm test",
        category: "approval",
        threadId: "thr_1",
        data: { kind: "pending-interaction", threadId: "thr_1" },
      }),
    ).toEqual({
      aps: {
        alert: { title: "Fix the tests", body: "Approve command: pnpm test" },
        sound: "default",
        "thread-id": "thr_1",
        "interruption-level": "time-sensitive",
        category: "approval",
      },
      kind: "pending-interaction",
      threadId: "thr_1",
    });
  });

  it("accepts only hex device tokens", () => {
    expect(isValidDeviceToken(DEVICE_TOKEN)).toBe(true);
    expect(isValidDeviceToken("ExponentPushToken[abc]")).toBe(false);
  });
});

describe("createApnsTransport", () => {
  function transportWith(
    respond: (args: Parameters<ApnsRequest>[0]) => ReturnType<ApnsRequest>,
  ) {
    const calls: Parameters<ApnsRequest>[0][] = [];
    let now = 1_700_000_000_000;
    const transport = createApnsTransport(async () => credentials, {
      request: (args) => {
        calls.push(args);
        return respond(args);
      },
      now: () => now,
    });
    return { transport, calls, advance: (ms: number) => (now += ms) };
  }

  const alert = {
    title: "t",
    body: "b",
    category: null,
    threadId: "thr_1",
    data: {},
  };

  it("posts to the sandbox host with the provider token and topic, reusing the token", async () => {
    const { transport, calls, advance } = transportWith(async () => ({
      status: 200,
      reason: null,
    }));
    expect(await transport.send(DEVICE_TOKEN, alert)).toEqual({
      status: "sent",
    });
    advance(10 * 60 * 1000);
    await transport.send(DEVICE_TOKEN, alert);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe(
      `${APNS_HOSTS.sandbox}/3/device/${DEVICE_TOKEN}`,
    );
    expect(calls[0]!.headers["apns-topic"]).toBe("app.kaioken.mobile");
    expect(calls[0]!.headers["apns-push-type"]).toBe("alert");
    expect(calls[0]!.headers.authorization).toBe(
      calls[1]!.headers.authorization,
    );
    advance(60 * 60 * 1000);
    await transport.send(DEVICE_TOKEN, alert);
    expect(calls[2]!.headers.authorization).not.toBe(
      calls[0]!.headers.authorization,
    );
  });

  it("reports unregistered devices and other failures distinctly", async () => {
    const gone = transportWith(async () => ({
      status: 410,
      reason: "Unregistered",
    }));
    expect(await gone.transport.send(DEVICE_TOKEN, alert)).toEqual({
      status: "unregistered",
    });
    const rejected = transportWith(async () => ({
      status: 403,
      reason: "InvalidProviderToken",
    }));
    expect(await rejected.transport.send(DEVICE_TOKEN, alert)).toEqual({
      status: "failed",
      reason: "APNs 403 InvalidProviderToken",
    });
    const offline = transportWith(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await offline.transport.send(DEVICE_TOKEN, alert)).toEqual({
      status: "failed",
      reason: "ECONNRESET",
    });
    expect(await offline.transport.send("ExponentPushToken[x]", alert)).toEqual(
      { status: "failed", reason: "device token is not APNs hex" },
    );
  });
});
