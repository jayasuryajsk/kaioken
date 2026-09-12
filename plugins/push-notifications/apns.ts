import { createPrivateKey, sign as signBytes } from "node:crypto";
import { connect, constants as http2Constants } from "node:http2";

export const APNS_HOSTS = {
  sandbox: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
} as const;
export type ApnsEnvironment = keyof typeof APNS_HOSTS;

const TOKEN_TTL_MS = 50 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

export interface ApnsCredentials {
  keyId: string;
  teamId: string;
  privateKeyPem: string;
  topic: string;
  environment: ApnsEnvironment;
}

export interface ApnsAlert {
  title: string;
  body: string;
  category: string | null;
  threadId: string;
  data: Record<string, unknown>;
}

export type ApnsSendOutcome =
  | { status: "sent" }
  | { status: "unregistered" }
  | { status: "failed"; reason: string };

export interface ApnsTransport {
  send(deviceToken: string, alert: ApnsAlert): Promise<ApnsSendOutcome>;
  close(): Promise<void>;
}

function base64Url(bytes: Buffer): string {
  return bytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createProviderToken(
  credentials: Pick<ApnsCredentials, "keyId" | "teamId" | "privateKeyPem">,
  issuedAt: number,
): string {
  const header = base64Url(
    Buffer.from(JSON.stringify({ alg: "ES256", kid: credentials.keyId })),
  );
  const claims = base64Url(
    Buffer.from(
      JSON.stringify({
        iss: credentials.teamId,
        iat: Math.floor(issuedAt / 1000),
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  const key = createPrivateKey(credentials.privateKeyPem);
  const signature = signBytes("sha256", Buffer.from(signingInput), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${base64Url(signature)}`;
}

export function buildApnsPayload(alert: ApnsAlert): Record<string, unknown> {
  return {
    aps: {
      alert: { title: alert.title, body: alert.body },
      sound: "default",
      "thread-id": alert.threadId,
      "interruption-level": "time-sensitive",
      ...(alert.category === null ? {} : { category: alert.category }),
    },
    ...alert.data,
  };
}

export function isValidDeviceToken(token: string): boolean {
  return /^[0-9a-f]{64,}$/iu.test(token);
}

interface ApnsResponse {
  status: number;
  reason: string | null;
}

export type ApnsRequest = (args: {
  url: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<ApnsResponse>;

function createHttp2Request(): {
  request: ApnsRequest;
  close(): Promise<void>;
} {
  let session: ReturnType<typeof connect> | null = null;
  let sessionOrigin: string | null = null;

  function sessionFor(origin: string): ReturnType<typeof connect> {
    if (
      session !== null &&
      !session.closed &&
      !session.destroyed &&
      sessionOrigin === origin
    ) {
      return session;
    }
    session?.close();
    session = connect(origin);
    sessionOrigin = origin;
    session.on("error", () => {
      session?.destroy();
      session = null;
    });
    return session;
  }

  return {
    request({ url, headers, body }) {
      const parsed = new URL(url);
      const client = sessionFor(parsed.origin);
      return new Promise<ApnsResponse>((resolve, reject) => {
        const stream = client.request({
          [http2Constants.HTTP2_HEADER_METHOD]: "POST",
          [http2Constants.HTTP2_HEADER_PATH]: parsed.pathname,
          ...headers,
        });
        let status = 0;
        const chunks: Buffer[] = [];
        const timer = setTimeout(() => {
          stream.close(http2Constants.NGHTTP2_CANCEL);
          reject(new Error("APNs request timed out"));
        }, REQUEST_TIMEOUT_MS);
        stream.on("response", (responseHeaders) => {
          status = Number(
            responseHeaders[http2Constants.HTTP2_HEADER_STATUS] ?? 0,
          );
        });
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          clearTimeout(timer);
          const text = Buffer.concat(chunks).toString("utf8");
          let reason: string | null = null;
          try {
            const parsedBody: unknown = JSON.parse(text);
            if (
              typeof parsedBody === "object" &&
              parsedBody !== null &&
              "reason" in parsedBody &&
              typeof parsedBody.reason === "string"
            ) {
              reason = parsedBody.reason;
            }
          } catch {}
          resolve({ status, reason });
        });
        stream.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        stream.end(body);
      });
    },
    close() {
      return new Promise<void>((resolve) => {
        if (session === null) {
          resolve();
          return;
        }
        session.close(() => resolve());
        session = null;
      });
    },
  };
}

export function createApnsTransport(
  getCredentials: () => Promise<ApnsCredentials>,
  options: { request?: ApnsRequest; now?: () => number } = {},
): ApnsTransport {
  const now = options.now ?? Date.now;
  const http2 = options.request === undefined ? createHttp2Request() : null;
  const request = options.request ?? http2!.request;
  let cachedToken: { value: string; issuedAt: number; keyId: string } | null =
    null;

  function providerToken(credentials: ApnsCredentials): string {
    const at = now();
    if (
      cachedToken !== null &&
      cachedToken.keyId === credentials.keyId &&
      at - cachedToken.issuedAt < TOKEN_TTL_MS
    ) {
      return cachedToken.value;
    }
    cachedToken = {
      value: createProviderToken(credentials, at),
      issuedAt: at,
      keyId: credentials.keyId,
    };
    return cachedToken.value;
  }

  return {
    async send(deviceToken, alert) {
      const credentials = await getCredentials();
      if (!isValidDeviceToken(deviceToken)) {
        return { status: "failed", reason: "device token is not APNs hex" };
      }
      const host = APNS_HOSTS[credentials.environment];
      let response: ApnsResponse;
      try {
        response = await request({
          url: `${host}/3/device/${deviceToken}`,
          headers: {
            authorization: `bearer ${providerToken(credentials)}`,
            "apns-topic": credentials.topic,
            "apns-push-type": "alert",
            "apns-priority": "10",
            "content-type": "application/json",
          },
          body: JSON.stringify(buildApnsPayload(alert)),
        });
      } catch (error) {
        return {
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      if (response.status === 200) return { status: "sent" };
      if (
        response.status === 410 ||
        response.reason === "Unregistered" ||
        response.reason === "BadDeviceToken"
      ) {
        return { status: "unregistered" };
      }
      if (response.reason === "ExpiredProviderToken") cachedToken = null;
      return {
        status: "failed",
        reason: `APNs ${response.status}${response.reason ? ` ${response.reason}` : ""}`,
      };
    },
    close() {
      return http2?.close() ?? Promise.resolve();
    },
  };
}
