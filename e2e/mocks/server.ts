import { createServer } from "node:http";

const port = Number(process.env.MOCKS_PORT ?? "8789");

function send(res: import("node:http").ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (req.method === "GET" && url.pathname === "/health") {
    send(res, 200, "application/json", JSON.stringify({ status: "ok" }));
  } else if (req.method === "GET" && url.pathname === "/sponsorblock/api/skipSegments") {
    send(res, 404, "text/plain; charset=utf-8", "Not Found");
  } else {
    send(res, 404, "text/plain; charset=utf-8", "Not Found");
  }
  console.log(`${req.method} ${url.pathname} -> ${res.statusCode}`);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mocks: listening on http://127.0.0.1:${port}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
