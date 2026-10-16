import type { LogEvent, LogEventName, LogLevel } from "./contracts/log-event";

// Typed as a Record so that the compiler flags any event the catalogue gains or loses.
const EVENTS: Record<LogEventName, true> = {
  "service.started": true,
  "fetch.transcript": true,
  "sponsorblock.call": true,
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
