import type { TranscriptResult } from "./contracts/transcript-result";

const KEYS = ["video_id", "status", "lang", "source", "word_count", "truncated", "sponsor_ratio", "pages"];
const STATUSES = ["ok", "no_transcript", "unavailable", "blocked"];
const SOURCES = ["manual", "auto"];
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

// Mirrors contracts/transcript-result.schema.json, including the pattern a type cannot express.
export function parseTranscriptResult(value: unknown): TranscriptResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("transcript result must be an object");
  }
  const r = value as Record<string, unknown>;
  const extra = Object.keys(r).filter((k) => !KEYS.includes(k));
  const missing = KEYS.filter((k) => !Object.hasOwn(r, k));
  if (extra.length || missing.length) {
    throw new Error(`transcript result fields: extra [${extra}], missing [${missing}]`);
  }
  const ok =
    typeof r.video_id === "string" &&
    VIDEO_ID.test(r.video_id) &&
    STATUSES.includes(r.status as string) &&
    (r.lang === null || typeof r.lang === "string") &&
    (r.source === null || SOURCES.includes(r.source as string)) &&
    Number.isInteger(r.word_count) &&
    (r.word_count as number) >= 0 &&
    typeof r.truncated === "boolean" &&
    (r.sponsor_ratio === null ||
      (typeof r.sponsor_ratio === "number" && r.sponsor_ratio >= 0 && r.sponsor_ratio <= 1)) &&
    Array.isArray(r.pages) &&
    r.pages.every((p) => typeof p === "string");
  if (!ok) {
    throw new Error("invalid transcript result");
  }
  return r as unknown as TranscriptResult;
}
