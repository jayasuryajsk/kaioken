import type { Hono } from "hono";
import type { AppDeps } from "../../types.js";
import { registerThreadActionRoutes } from "./actions.js";
import { registerThreadBaseRoutes } from "./base.js";
import { registerThreadDataRoutes } from "./data.js";
import { registerThreadInteractionRoutes } from "./interactions.js";
import { registerThreadTabRoutes } from "./tabs.js";
import { withThreadHandoffMutationGuard } from "../../services/connections/handoff-store.js";

export function registerThreadRoutes(app: Hono, deps: AppDeps): void {
  for (const path of ["/threads/:id", "/threads/:id/*"]) {
    app.use(path, async (context, next) => {
      if (["GET", "HEAD", "OPTIONS"].includes(context.req.method))
        return next();
      return withThreadHandoffMutationGuard(
        deps.db,
        context.req.param("id")!,
        next,
      );
    });
  }
  registerThreadBaseRoutes(app, deps);
  registerThreadActionRoutes(app, deps);
  registerThreadDataRoutes(app, deps);
  registerThreadInteractionRoutes(app, deps);
  registerThreadTabRoutes(app, deps);
}
