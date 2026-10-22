import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { enqueue, enroll, job, ops, reset } from "./support";

const VIDEO = "sponsored01";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workerPort = process.env.WORKER_PORT ?? "8787";
const mocksPort = process.env.MOCKS_PORT ?? "8789";

test("the node daemon processes a queued video and its transcript is readable", async ({ request }) => {
  await reset(request);
  const token = await enroll(request, "node-daemon");
  await enqueue(request, [VIDEO]);

  const run = spawnSync("uv", ["run", "--project", "node", "yt-digest-node", "work", "--once"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      WORKER_URL: `http://127.0.0.1:${workerPort}`,
      NODE_TOKEN: token,
      FETCHER_FAKE_YTDLP: "1",
      FAKE_YTDLP_DIR: path.join(root, "node/tests/fixtures/fake_ytdlp"),
      SPONSORBLOCK_URL: `http://127.0.0.1:${mocksPort}/sponsorblock`,
      TRANSCRIPT_LANGS: "fr,en",
    },
  });
  expect(run.status, run.stderr).toBe(0);
  expect(run.stderr).not.toContain(token);

  expect(await job(request, VIDEO)).toMatchObject({ status: "done", last_outcome: "ok", tried_nodes: ["node-daemon"] });
  const res = await request.get(`/ops/transcripts/${VIDEO}`, { headers: ops });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { video_id: string; node_id: string; transcript: { status: string; video_id: string; pages: string[] } };
  expect(body).toMatchObject({ video_id: VIDEO, node_id: "node-daemon", transcript: { status: "ok", video_id: VIDEO } });
  expect(body.transcript.pages.length).toBeGreaterThan(0);
});
