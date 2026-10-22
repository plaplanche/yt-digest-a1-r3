import type { LogEvent, LogEventName, LogLevel } from "./contracts/log-event";

// Typed as a Record so that the compiler flags any event the catalogue gains or loses.
const EVENTS: Record<LogEventName, true> = {
  "service.started": true,
  "fetch.transcript": true,
  "sponsorblock.call": true,
  "node.enrolled": true,
  "node.revoked": true,
  "node.heartbeat": true,
  "job.enqueued": true,
  "job.claimed": true,
  "job.completed": true,
  "job.released": true,
  "job.lease_expired": true,
  "job.stale_result": true,
  "job.validation_failed": true,
  "auth.bearer.rejected": true,
  "auth.client.registered": true,
  "auth.oauth.completed": true,
  "auth.oauth.denied": true,
  "auth.token.issued": true,
  "auth.refresh.reuse_detected": true,
  "auth.origin.rejected": true,
  "mcp.tool.call": true,
  "worker.call": true,
};
const LEVELS: Record<LogLevel, true> = { debug: true, info: true, warn: true, error: true };
const FIELDS = ["level", "request_id", "video_id", "attrs"];

export type LogFields = Partial<Pick<LogEvent, "level" | "request_id" | "video_id" | "attrs">>;

export function log(event: LogEventName, fields: LogFields = {}): void {
  if (!Object.hasOwn(EVENTS, event)) {
    throw new Error(`unknown log event: ${String(event)}`);
  }
  for (const key of Object.keys(fields)) {
    if (!FIELDS.includes(key)) {
      throw new Error(`unknown log field: ${key}`);
    }
  }
  const level = fields.level ?? "info";
  if (!Object.hasOwn(LEVELS, level)) {
    throw new Error(`unknown log level: ${String(level)}`);
  }
  for (const key of ["request_id", "video_id"] as const) {
    if (fields[key] !== undefined && typeof fields[key] !== "string") {
      throw new Error(`log field ${key} must be a string`);
    }
  }
  const attrs = fields.attrs;
  if (attrs !== undefined && (typeof attrs !== "object" || attrs === null || Array.isArray(attrs))) {
    throw new Error("log field attrs must be an object");
  }
  const line: LogEvent = {
    ...fields,
    attrs: fields.attrs ?? {},
    ts: new Date().toISOString(),
    level,
    service: "worker",
    event,
  };
  console.error(JSON.stringify(line));
}
