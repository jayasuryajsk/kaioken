export const SESSION_COOKIE_NAME = "__Secure-kaioken-connect.desktop_session";
export const API_SESSION_TTL_MS = 60 * 60 * 1000;
export const BROWSER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionSubject = "server" | `machine:${string}`;

function bytesToBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function stringToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToString(value: string): string | null {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return new TextDecoder().decode(
      Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
    );
  } catch {
    return null;
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function randomToken(prefix: string, bytes = 24): string {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return `${prefix}${bytesToBase64Url(raw)}`;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomPairingCode(): string {
  const raw = new Uint8Array(8);
  crypto.getRandomValues(raw);
  const chars = [...raw].map(
    (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length],
  );
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export function normalizePairingCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export async function createSessionCookie(
  subject: SessionSubject,
  secret: string,
  expiresAt: number,
): Promise<string> {
  const payload = stringToBase64Url(JSON.stringify({ expiresAt, subject }));
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifySessionCookie(
  cookieValue: string,
  secret: string,
  now: number = Date.now(),
): Promise<SessionSubject | null> {
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);
  if (!constantTimeEqual(signature, await sign(payload, secret))) return null;
  const decoded = base64UrlToString(payload);
  if (decoded === null) return null;
  try {
    const value: unknown = JSON.parse(decoded);
    if (
      typeof value !== "object" ||
      value === null ||
      !("subject" in value) ||
      typeof value.subject !== "string" ||
      !("expiresAt" in value) ||
      typeof value.expiresAt !== "number" ||
      value.expiresAt <= now
    ) {
      return null;
    }
    const subject = value.subject;
    if (subject === "server" || subject.startsWith("machine:")) {
      return subject as SessionSubject;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseCookie(
  header: string | null,
  name: string,
): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
