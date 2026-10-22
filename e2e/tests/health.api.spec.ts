import { expect, test } from "@playwright/test";

const mocksUrl = `http://127.0.0.1:${process.env.MOCKS_PORT ?? "8789"}`;

test("the Worker answers /health", async ({ request }) => {
  const res = await request.get("/health");
  expect(res.status()).toBe(200);
});

test("the mocks server answers /health", async ({ request }) => {
  const res = await request.get(`${mocksUrl}/health`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

test("SponsorBlock has no segment for any video", async ({ request }) => {
  const res = await request.get(`${mocksUrl}/sponsorblock/api/skipSegments?videoID=abc`);
  expect(res.status()).toBe(404);
  expect(await res.text()).toBe("Not Found");
});
