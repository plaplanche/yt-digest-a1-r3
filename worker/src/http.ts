import type { ErrorBody } from "./contracts/error";

export interface Env {
  DB: D1Database;
  TRANSCRIPTS: R2Bucket;
  OPS_TOKEN?: string;
  LEASE_SECONDS?: string;
  PUBLIC_URL?: string;
  ACCESS_TOKEN_TTL_SECONDS?: string;
  REFRESH_TOKEN_TTL_SECONDS?: string;
  AUTH_CODE_TTL_SECONDS?: string;
  AUTH_REQUEST_TTL_SECONDS?: string;
  GOOGLE_ISSUER?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ADMIN_EMAIL?: string;
  TOKEN_ENC_KEY?: string;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(status: number, code: string, message: string): Response {
  const body: ErrorBody = { error: { code, message } };
  return json(body, status);
}

export function notFound(): Response {
  return errorResponse(404, "not_found", "Not found");
}
