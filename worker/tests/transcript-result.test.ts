import { expect, test } from "vitest";
import type { TranscriptResult } from "../src/contracts/transcript-result";

const valid: TranscriptResult = {
  video_id: "dQw4w9WgXcQ",
  status: "ok",
  lang: "en",
  source: "manual",
  word_count: 3,
  truncated: false,
  sponsor_ratio: 0.5,
  pages: ["a b c"],
};

// The TypeScript types are checked by `tsc --noEmit` (lint): each @ts-expect-error
// fails the lint check if the generated type stops rejecting the line below it.
// The pattern of video_id is not expressible in a type and is enforced by the node.
test("the generated type accepts a valid result and rejects bad ones", () => {
  expect(valid.status).toBe("ok");
  // @ts-expect-error extra field
  const extra: TranscriptResult = { ...valid, extra: 1 };
  // @ts-expect-error bad status
  const bad: TranscriptResult = { ...valid, status: "nope" };
  expect([extra, bad]).toHaveLength(2);
});
