import { expect, test } from "vitest";
import { name } from "../src/index";

test("module loads", () => {
  expect(name).toBe("yt-digest-worker");
});
