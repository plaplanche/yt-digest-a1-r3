import { afterEach, expect, test, vi } from "vitest";
import { log } from "../src/log";
import type { LogEventName } from "../src/contracts/log-event";

afterEach(() => vi.restoreAllMocks());

test("a catalogued event is written as one JSON line", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  log("service.started", { attrs: { version: "1" }, request_id: "r1" });
  expect(spy).toHaveBeenCalledTimes(1);
  const line = JSON.parse(String(spy.mock.calls[0]?.[0])) as Record<string, unknown>;
  expect(line).toMatchObject({
    event: "service.started",
    service: "worker",
    level: "info",
    request_id: "r1",
    attrs: { version: "1" },
  });
  expect(String(line.ts)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("an event outside the catalogue throws", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => log("not.catalogued" as LogEventName)).toThrow(/unknown log event/);
  expect(spy).not.toHaveBeenCalled();
});

test("an unknown field or level throws", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => log("service.started", { color: "red" } as never)).toThrow(/unknown log field/);
  expect(() => log("service.started", { level: "loud" as never })).toThrow(/unknown log level/);
});
