import { errorResponse, json, notFound, type Env } from "./http";
import { log } from "./log";

// Every table of the schema (spec lot 2, section 6.3), emptied by POST /ops/reset.
const TABLES = [
  "nodes",
  "jobs",
  "leases",
  "node_events",
  "invites",
  "users",
  "oauth_clients",
  "oauth_requests",
  "oauth_codes",
  "oauth_tokens",
] as const;

const encoder = new TextEncoder();

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

// Compares the digests, so the time taken does not depend on where the strings differ or on their lengths.
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) {
    diff |= da[i]! ^ db[i]!;
  }
  return diff === 0;
}

async function authenticated(request: Request, token: string): Promise<boolean> {
  const header = request.headers.get("Authorization");
  const match = header === null ? null : /^Bearer (.+)$/.exec(header);
  if (match === null) {
    log("auth.bearer.rejected", { level: "warn", attrs: { surface: "ops", reason: "missing" } });
    return false;
  }
  if (!(await safeEqual(match[1]!, token))) {
    log("auth.bearer.rejected", { level: "warn", attrs: { surface: "ops", reason: "unknown" } });
    return false;
  }
  return true;
}

async function reset(env: Env): Promise<Response> {
  await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  let cursor: string | undefined;
  do {
    const listed = await env.TRANSCRIPTS.list({ prefix: "transcripts/", cursor });
    if (listed.objects.length > 0) {
      await env.TRANSCRIPTS.delete(listed.objects.map((object) => object.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor !== undefined);
  return json({ ok: true });
}

export async function handleOps(request: Request, env: Env, path: string): Promise<Response> {
  const token = env.OPS_TOKEN;
  if (token === undefined || token === "") {
    return notFound();
  }
  if (!(await authenticated(request, token))) {
    return errorResponse(401, "unauthorized", "Missing or invalid operator token");
  }
  if (request.method === "POST" && path === "/ops/reset") {
    return reset(env);
  }
  return notFound();
}
