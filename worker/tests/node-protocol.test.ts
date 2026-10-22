import Ajv2020 from "ajv/dist/2020";
import { expect, test } from "vitest";
import errorSchema from "../../contracts/error.schema.json";
import claimRequest from "../../contracts/node-claim-request.schema.json";
import claimResponse from "../../contracts/node-claim-response.schema.json";
import heartbeatRequest from "../../contracts/node-heartbeat-request.schema.json";
import heartbeatResponse from "../../contracts/node-heartbeat-response.schema.json";
import jobAck from "../../contracts/node-job-ack.schema.json";
import releaseRequest from "../../contracts/node-release-request.schema.json";
import resultRequest from "../../contracts/node-result-request.schema.json";
import transcriptResult from "../../contracts/transcript-result.schema.json";
import type { NodeResultRequest } from "../src/contracts/node-result-request";
import type { TranscriptResult } from "../src/contracts/transcript-result";
import generatedResultRequest from "../src/contracts/node-result-request?raw";

const ajv = new Ajv2020({ strict: false });
ajv.addSchema(transcriptResult, "transcript-result.schema.json");
const validator = (schema: object) => ajv.compile(schema);

const TS = "2026-10-16T07:00:01.123Z";
const TRANSCRIPT: TranscriptResult = {
  video_id: "dQw4w9WgXcQ",
  status: "ok",
  lang: "en",
  source: "manual",
  word_count: 3,
  truncated: false,
  sponsor_ratio: 0.5,
  pages: ["a b c"],
};

const cases: Record<string, { schema: object; valid: object }> = {
  "node-heartbeat-request": {
    schema: heartbeatRequest,
    valid: { version: "1.0", uptime_s: 5, jobs_in_progress: 0, last_success_at: null, last_blocked_at: TS, disk_free_ratio: 0.4, cpu_temp_c: 51.5 },
  },
  "node-heartbeat-response": {
    schema: heartbeatResponse,
    valid: { node_id: "n1", state: "healthy", hourly_budget: 20, directive: "run" },
  },
  "node-claim-request": { schema: claimRequest, valid: { max_jobs: 3 } },
  "node-claim-response": {
    schema: claimResponse,
    valid: { jobs: [{ video_id: "dQw4w9WgXcQ", lease_id: "0123456789abcdef", lease_expires_at: TS }] },
  },
  "node-result-request": {
    schema: resultRequest,
    valid: { lease_id: "l", outcome: "ok", transcript: TRANSCRIPT },
  },
  "node-release-request": { schema: releaseRequest, valid: { lease_id: "l" } },
  "node-job-ack": { schema: jobAck, valid: { video_id: "dQw4w9WgXcQ", status: "done" } },
  error: { schema: errorSchema, valid: { error: { code: "bad_request", message: "nope" } } },
};

test.each(Object.entries(cases))("%s accepts a valid instance and rejects an extra field", (_name, { schema, valid }) => {
  const validate = validator(schema);
  expect(validate(valid)).toBe(true);
  expect(validate({ ...valid, extra: 1 })).toBe(false);
});

test("an empty claim request is valid", () => {
  expect(validator(claimRequest)({})).toBe(true);
});

test.each([0, 11])("max_jobs of %i is rejected", (max_jobs) => {
  expect(validator(claimRequest)({ max_jobs })).toBe(false);
});

test("an unknown outcome is rejected", () => {
  expect(validator(resultRequest)({ lease_id: "l", outcome: "maybe", transcript: null })).toBe(false);
});

test("a result with a null transcript is accepted, a missing transcript key is not", () => {
  const validate = validator(resultRequest);
  expect(validate({ lease_id: "l", outcome: "error", transcript: null })).toBe(true);
  expect(validate({ lease_id: "l", outcome: "error" })).toBe(false);
});

test("a transcript that breaks the transcript-result schema is rejected", () => {
  const validate = validator(resultRequest);
  expect(validate({ lease_id: "l", outcome: "ok", transcript: { ...TRANSCRIPT, video_id: "short" } })).toBe(false);
  expect(validate({ lease_id: "l", outcome: "ok", transcript: { ...TRANSCRIPT, extra: 1 } })).toBe(false);
});

test("a heartbeat without version is rejected", () => {
  expect(validator(heartbeatRequest)({ uptime_s: 1, jobs_in_progress: 0 })).toBe(false);
});

test("the generated result request uses the generated transcript-result type", () => {
  const request: NodeResultRequest = { lease_id: "l", outcome: "ok", transcript: TRANSCRIPT };
  expect(request.transcript).toBe(TRANSCRIPT);
  expect(generatedResultRequest).toContain('import type { TranscriptResult } from "./transcript-result";');
  expect(generatedResultRequest).not.toContain("export interface TranscriptResult");
});
