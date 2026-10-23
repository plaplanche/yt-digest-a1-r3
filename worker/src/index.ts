import pkg from "../package.json";
import { json, notFound, type Env } from "./http";
import { handleNode } from "./node";
import { handleOAuth } from "./oauth";
import { handleOps } from "./ops";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/ops" || path.startsWith("/ops/")) {
      return handleOps(request, env, path);
    }
    if (path.startsWith("/node/")) {
      return handleNode(request, env, path);
    }
    const oauth = await handleOAuth(request, env, path);
    if (oauth !== null) return oauth;
    if (request.method === "GET" && path === "/health") {
      return json({ status: "ok", version: pkg.version });
    }
    return notFound();
  },
} satisfies ExportedHandler<Env>;
