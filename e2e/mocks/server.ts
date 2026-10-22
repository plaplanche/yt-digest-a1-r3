import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const port = Number(process.env.MOCKS_PORT ?? "8789");
const clientId = process.env.GOOGLE_CLIENT_ID ?? "yt-digest-local";
const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "local-google-secret";
const issuer = `http://127.0.0.1:${port}/google`;

const TOKEN_TTL_SECONDS = 3600;
const CODE_TTL_MS = 60_000;

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = randomBytes(8).toString("hex");
const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };

interface Grant {
  email: string;
  scope: string;
  nonce: string | undefined;
}
interface Code extends Grant {
  redirectUri: string;
  offline: boolean;
  expiresAt: number;
}

const codes = new Map<string, Code>();
const accessTokens = new Map<string, Grant>();
const refreshTokens = new Map<string, Grant>();

const randomToken = (): string => randomBytes(24).toString("base64url");

function send(res: ServerResponse, status: number, type: string, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": type, ...headers });
  res.end(body);
}

const sendJson = (res: ServerResponse, status: number, body: unknown): void =>
  send(res, status, "application/json", JSON.stringify(body));

const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const subject = (email: string): string => `g-${createHash("sha256").update(email).digest("hex").slice(0, 16)}`;

function idToken(grant: Grant): string {
  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iss: issuer,
    aud: clientId,
    sub: subject(grant.email),
    email: grant.email,
    email_verified: true,
    iat,
    exp: iat + TOKEN_TTL_SECONDS,
    ...(grant.nonce === undefined ? {} : { nonce: grant.nonce }),
  };
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signingInput = `${encode({ alg: "RS256", typ: "JWT", kid })}.${encode(claims)}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

function tokenResponse(grant: Grant, refreshToken?: string): Record<string, unknown> {
  const accessToken = randomToken();
  accessTokens.set(accessToken, grant);
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: TOKEN_TTL_SECONDS,
    scope: grant.scope,
    id_token: idToken(grant),
    ...(refreshToken === undefined ? {} : { refresh_token: refreshToken }),
  };
}

function authorize(res: ServerResponse, query: URLSearchParams): void {
  const redirectUri = query.get("redirect_uri");
  if (
    query.get("client_id") !== clientId ||
    !redirectUri ||
    query.get("response_type") !== "code" ||
    !(query.get("scope") ?? "").split(" ").includes("openid")
  ) {
    send(res, 400, "text/plain; charset=utf-8", "Bad Request");
    return;
  }
  const hint = query.get("login_hint");
  if (!hint) {
    const hidden = [...query].map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join("\n    ");
    send(
      res,
      200,
      "text/html; charset=utf-8",
      `<!doctype html>
<html><head><meta charset="utf-8"><title>Sign in</title></head>
<body>
  <form method="get" action="/google/authorize">
    ${hidden}
    <input type="text" name="login_hint" placeholder="E-mail">
    <button type="submit">Sign in</button>
  </form>
</body></html>`,
    );
    return;
  }
  const code = randomToken();
  codes.set(code, {
    email: hint.toLowerCase(),
    scope: query.get("scope")!,
    nonce: query.get("nonce") ?? undefined,
    redirectUri,
    offline: query.get("access_type") === "offline",
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  const target = new URL(redirectUri);
  target.searchParams.set("code", code);
  const state = query.get("state");
  if (state !== null) target.searchParams.set("state", state);
  send(res, 302, "text/plain; charset=utf-8", "Found", { location: target.toString() });
}

function clientAuthenticated(req: IncomingMessage, form: URLSearchParams): boolean {
  const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? "");
  let id = form.get("client_id");
  let secret = form.get("client_secret");
  if (basic !== null) {
    const decoded = Buffer.from(basic[1]!, "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    id = decodeURIComponent(decoded.slice(0, colon));
    secret = decodeURIComponent(decoded.slice(colon + 1));
  }
  return id === clientId && secret === clientSecret;
}

function token(req: IncomingMessage, res: ServerResponse, form: URLSearchParams): void {
  if (!clientAuthenticated(req, form)) {
    sendJson(res, 401, { error: "invalid_client" });
    return;
  }
  const grantType = form.get("grant_type");
  if (grantType === "authorization_code") {
    const code = codes.get(form.get("code") ?? "");
    if (code !== undefined) codes.delete(form.get("code")!);
    if (code !== undefined && code.expiresAt > Date.now() && code.redirectUri === form.get("redirect_uri")) {
      const refreshToken = code.offline ? randomToken() : undefined;
      if (refreshToken !== undefined) refreshTokens.set(refreshToken, code);
      sendJson(res, 200, tokenResponse(code, refreshToken));
      return;
    }
  } else if (grantType === "refresh_token") {
    const grant = refreshTokens.get(form.get("refresh_token") ?? "");
    if (grant !== undefined) {
      sendJson(res, 200, tokenResponse(grant));
      return;
    }
  }
  sendJson(res, 400, { error: "invalid_grant" });
}

function userinfo(req: IncomingMessage, res: ServerResponse): void {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
  const grant = match === null ? undefined : accessTokens.get(match[1]!);
  if (grant === undefined) {
    send(res, 401, "application/json", JSON.stringify({ error: "invalid_token" }), { "www-authenticate": "Bearer" });
    return;
  }
  sendJson(res, 200, { sub: subject(grant.email), email: grant.email, email_verified: true });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const route = `${req.method} ${url.pathname}`;
    if (route === "GET /health") {
      sendJson(res, 200, { status: "ok" });
    } else if (route === "GET /google/.well-known/openid-configuration") {
      sendJson(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        revocation_endpoint: `${issuer}/revoke`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    } else if (route === "GET /google/authorize") {
      authorize(res, url.searchParams);
    } else if (route === "POST /google/token") {
      token(req, res, new URLSearchParams(await readBody(req)));
    } else if (route === "GET /google/userinfo") {
      userinfo(req, res);
    } else if (route === "GET /google/jwks") {
      sendJson(res, 200, { keys: [jwk] });
    } else if (route === "POST /google/revoke") {
      await readBody(req);
      send(res, 200, "text/plain; charset=utf-8", "");
    } else {
      // Includes /sponsorblock/api/skipSegments: SponsorBlock answers 404 when a video has no segments.
      send(res, 404, "text/plain; charset=utf-8", "Not Found");
    }
    console.log(`${req.method} ${url.pathname} -> ${res.statusCode}`);
  })();
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mocks: listening on http://127.0.0.1:${port}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
