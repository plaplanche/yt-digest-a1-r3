import { errorResponse, json, notFound, type Env } from "./http";
import { log } from "./log";
import { checkAccessToken } from "./oauth";

const PROTOCOL_VERSION = "2025-06-18";
const TOOL = {
  name: "list_subscriptions",
  description: "List the subscriptions of the signed-in user.",
  inputSchema: { type: "object", properties: {} },
};

const base = (env: Env): string => (env.PUBLIC_URL ?? "").replace(/\/+$/, "");

function originAllowed(origin: string, env: Env): boolean {
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim().replace(/\/+$/, "")).filter((value) => value !== "");
  return origin === new URL(base(env)).origin || allowed.includes(origin);
}

function unauthorized(env: Env): Response {
  return new Response(JSON.stringify({ error: "invalid_token" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${base(env)}/.well-known/oauth-protected-resource"`,
    },
  });
}

type Id = string | number | null;

const rpcResult = (id: Id, result: unknown): Response => json({ jsonrpc: "2.0", id, result });
const rpcError = (id: Id, code: number, message: string): Response => json({ jsonrpc: "2.0", id, error: { code, message } });

function callTool(id: Id, params: unknown): Response {
  const started = Date.now();
  const name = typeof params === "object" && params !== null ? (params as { name?: unknown }).name : undefined;
  const known = name === TOOL.name;
  log("mcp.tool.call", {
    attrs: { tool: typeof name === "string" ? name : "", outcome: known ? "ok" : "error", duration_ms: Date.now() - started },
  });
  if (!known) return rpcError(id, -32602, "Unknown tool");
  return rpcResult(id, { content: [{ type: "text", text: JSON.stringify({ subscriptions: [] }) }], isError: false });
}

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (origin !== null && !originAllowed(origin, env)) {
    log("auth.origin.rejected", { level: "warn", attrs: { origin } });
    return errorResponse(403, "origin_rejected", "Origin not allowed");
  }
  if (request.method !== "POST") return notFound();
  const access = await checkAccessToken(request, env);
  if (!access.ok) {
    log("auth.bearer.rejected", { level: "warn", attrs: { surface: "mcp", reason: access.reason } });
    return unauthorized(env);
  }
  let message: unknown;
  try {
    message = await request.json();
  } catch {
    message = undefined;
  }
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return errorResponse(400, "invalid_request", "Invalid request body");
  }
  const { id, method, params } = message as { id?: unknown; method?: unknown; params?: unknown };
  if (typeof method !== "string" || id === undefined) {
    // A notification, or a response from the client: nothing to answer.
    return new Response(null, { status: 202 });
  }
  if (typeof id !== "string" && typeof id !== "number") return rpcError(null, -32600, "Invalid request");
  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "yt-digest", version: "0.0.0" },
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: [TOOL] });
    case "tools/call":
      return callTool(id, params);
    default:
      return rpcError(id, -32601, "Method not found");
  }
}
