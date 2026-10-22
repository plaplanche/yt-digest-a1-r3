import type { TranscriptResult } from "./contracts/transcript-result";
import { parseTranscriptResult } from "./transcript-result";

// Request body checks mirroring contracts/node-*-request.schema.json, including what a type cannot express.
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnly(r: Record<string, unknown>, required: string[], optional: string[]): boolean {
  return (
    required.every((key) => Object.hasOwn(r, key)) &&
    Object.keys(r).every((key) => required.includes(key) || optional.includes(key))
  );
}

function isInteger(value: unknown, min: number, max = Infinity): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isTimestampOrNull(value: unknown): boolean {
  return value === null || (typeof value === "string" && TIMESTAMP.test(value));
}

export function isHeartbeatRequest(value: unknown): value is {
  version: string;
  uptime_s: number;
  jobs_in_progress: number;
} {
  if (!isObject(value)) return false;
  const optional = ["last_success_at", "last_blocked_at", "disk_free_ratio", "cpu_temp_c"];
  if (!hasOnly(value, ["version", "uptime_s", "jobs_in_progress"], optional)) return false;
  const ratio = value.disk_free_ratio;
  return (
    typeof value.version === "string" &&
    value.version.length >= 1 &&
    value.version.length <= 64 &&
    isInteger(value.uptime_s, 0) &&
    isInteger(value.jobs_in_progress, 0) &&
    (value.last_success_at === undefined || isTimestampOrNull(value.last_success_at)) &&
    (value.last_blocked_at === undefined || isTimestampOrNull(value.last_blocked_at)) &&
    (ratio === undefined || (typeof ratio === "number" && ratio >= 0 && ratio <= 1)) &&
    (value.cpu_temp_c === undefined || typeof value.cpu_temp_c === "number")
  );
}

export function isClaimRequest(value: unknown): value is { max_jobs?: number } {
  return isObject(value) && hasOnly(value, [], ["max_jobs"]) && (value.max_jobs === undefined || isInteger(value.max_jobs, 1, 10));
}

const OUTCOMES = ["ok", "no_transcript", "unavailable", "blocked", "error"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export function isResultRequest(value: unknown): value is { lease_id: string; outcome: Outcome; transcript: TranscriptResult | null } {
  if (!isObject(value) || !hasOnly(value, ["lease_id", "outcome", "transcript"], [])) return false;
  if (typeof value.lease_id !== "string" || value.lease_id.length < 1) return false;
  if (!OUTCOMES.includes(value.outcome as Outcome)) return false;
  if (value.transcript === null) return true;
  try {
    parseTranscriptResult(value.transcript);
    return true;
  } catch {
    return false;
  }
}

export function isReleaseRequest(value: unknown): value is { lease_id: string } {
  return isObject(value) && hasOnly(value, ["lease_id"], []) && typeof value.lease_id === "string" && value.lease_id.length >= 1;
}

export function isEnrollRequest(value: unknown): value is { node_id: string; owner_label: string } {
  return (
    isObject(value) &&
    hasOnly(value, ["node_id", "owner_label"], []) &&
    typeof value.node_id === "string" &&
    /^[a-z0-9][a-z0-9-]{0,62}$/.test(value.node_id) &&
    typeof value.owner_label === "string" &&
    value.owner_label.length >= 1 &&
    value.owner_label.length <= 100
  );
}

export function isEmailRequest(value: unknown): value is { email: string } {
  return isObject(value) && hasOnly(value, ["email"], []) && typeof value.email === "string" && value.email.includes("@");
}

export function isEnqueueRequest(value: unknown): value is { video_ids: string[]; priority?: number } {
  return (
    isObject(value) &&
    hasOnly(value, ["video_ids"], ["priority"]) &&
    Array.isArray(value.video_ids) &&
    value.video_ids.length >= 1 &&
    value.video_ids.length <= 100 &&
    value.video_ids.every((id) => typeof id === "string" && VIDEO_ID.test(id)) &&
    (value.priority === undefined || isInteger(value.priority, 0))
  );
}
