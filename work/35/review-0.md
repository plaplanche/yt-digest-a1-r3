# Review 0

- Reviewed commit: `21a2aa8f436209aab8e3ee6c2ccb663107684f95`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/src/mcp.ts:16`) Origin check throws when PUBLIC_URL is unset

  `new URL(base(env))` throws a TypeError when PUBLIC_URL is empty. Any request that carries an Origin header then gets a 500 instead of 403 or a pass. PUBLIC_URL is required configuration (section 5.2) and every stack sets it, so this is only a robustness gap.

- **minor** (`worker/src/mcp.ts:38`) mcp.tool.call duration_ms is always about 0 and logs the client's tool name as given

  The log line is written before the tool result is built, so `duration_ms` measures nothing. On an unknown tool, `tool` is whatever string the client sent. Today that client is an authenticated user, but nothing stops the string from holding an e-mail address, which section 12 forbids in logs. Building the result first and logging an unknown tool's name as a fixed value would avoid both problems.

- **minor** (`docs/decisions.md:98`) The -32600 answer for a non-string, non-number id is not recorded

  A message with `id: null` or an object id gets JSON-RPC -32600 in a 200. The new decision line lists -32601 and -32602 but not this case.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: no changed file matches `paths`.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: check e2e passes

  Replayed by Ariane: exit 0.

- met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  worker/src/mcp.ts covers 11.1 to 11.3. It implements POST /mcp with initialize (protocolVersion 2025-06-18), notifications answered 202 with no body, ping, tools/list returning only list_subscriptions with an empty-object schema, and tools/call returning the compact text {"subscriptions":[]} with isError false. Requests without a valid token get 401 invalid_token with `WWW-Authenticate: Bearer resource_metadata="BASE/.well-known/oauth-protected-resource"`. The Origin check runs first, before the method check and before checkAccessToken, so a foreign Origin gets 403 origin_rejected in the 4.2 error body. Request path in order: Origin check (log auth.origin.rejected), then method, then token check (database reads only, log auth.bearer.rejected with surface mcp), then body parse, then dispatch (log mcp.tool.call). The endpoint writes nothing but logs, and the body is not read before authentication. Access tokens are refused on /node/* because node auth is separate. No other tools, scopes or PATs were added.

- met: The change is covered by tests that fail without it.

  worker/tests/workers/mcp.test.ts covers every acceptance criterion: no token, expired, node, operator and revoked-invite tokens get 401 with the header; an access token gets 401 on /node/heartbeat; a foreign Origin gets 403 before auth with a log line; allowed and absent Origins pass; initialize, the 202 notification, tools/list and tools/call. Without mcp.ts, /mcp gives 404 and these tests fail. e2e/tests/mcp.api.spec.ts covers E2E-27, 33 and 37 and passed in the replay. I read E2E-28 in oauth.browser.spec.ts against e2e/mocks/server.ts: the mock serves a GET form at /google/authorize with input name=login_hint and a submit button, the flow redirects through /callback to the aborted 127.0.0.1:9/cb route, and page.waitForRequest captures that URL. The steps are the ones E2E-02 already uses plus the code exchange that mcpLogin uses in the passing api project, so the test can pass.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Two dated lines were added. They record: stateless with no Mcp-Session-Id, JSON-only answers, 404 for a non-POST after the Origin check, 400 for a body that is not a JSON object after auth, a message without id treated as a notification answered 202, -32601/-32602 errors, logging of unknown tools, and how ALLOWED_ORIGINS is normalized. Only the minor -32600 case is missing.

## Proposed learnings (not decided)

- For a browser e2e test that no replay ran, check its selectors and redirects against e2e/mocks/server.ts, and compare it with a sibling test that does run (E2E-02 here) to confirm the flow can complete.
- On /mcp, confirm the order of Origin check, then auth, then body parse: this endpoint's only side effects are log lines, so the order is the whole guarantee.
