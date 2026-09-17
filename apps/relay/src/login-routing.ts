import { loginIdSchema, loginInputSchema } from "./login-do.js";
import { randomToken } from "./auth.js";
import type { Env } from "./tunnel-do.js";

export async function routeLogin(
  request: Request,
  env: Env,
  origin: string,
): Promise<Response> {
  if (
    !env.GITHUB_CLIENT_ID ||
    !env.GITHUB_CLIENT_SECRET ||
    !/^\d+$/u.test(env.GITHUB_ALLOWED_USER_ID ?? "")
  )
    return Response.json(
      { error: "GitHub sign-in is not configured on this relay yet." },
      { status: 503 },
    );
  const url = new URL(request.url);
  let id: string;
  let action: string;
  if (url.pathname === "/api/connect/login") {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const input = loginInputSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!input.success)
      return Response.json(
        { error: "Invalid sign-in request" },
        { status: 400 },
      );
    id = randomToken("");
    return env.LOGIN_DO.get(env.LOGIN_DO.idFromName(id)).fetch(
      "https://login/start",
      { method: "POST", body: JSON.stringify({ ...input.data, id, origin }) },
    );
  }
  if (
    url.pathname === "/auth/github" ||
    url.pathname === "/auth/github/callback"
  ) {
    id = url.pathname.endsWith("/callback")
      ? (url.searchParams.get("state") ?? "").split(".")[0]!
      : (url.searchParams.get("login") ?? "");
    action = url.pathname.endsWith("/callback") ? "callback" : "browser";
  } else {
    const match =
      /^\/api\/connect\/login\/([A-Za-z0-9_-]+)\/(events|complete|cancel)$/u.exec(
        url.pathname,
      );
    if (!match) return new Response(null, { status: 404 });
    id = match[1]!;
    action = match[2]!;
  }
  if (!loginIdSchema.safeParse(id).success)
    return Response.json({ error: "Invalid sign-in session" }, { status: 400 });
  const target = new URL(request.url);
  target.pathname = `/${action}`;
  return env.LOGIN_DO.get(env.LOGIN_DO.idFromName(id)).fetch(
    new Request(target, request),
  );
}
