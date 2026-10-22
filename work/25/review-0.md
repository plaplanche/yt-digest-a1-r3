# Review 0

- Reviewed commit: `30c546b17365cd6ad4ba76deadd3570f86f5ac37`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`e2e/mocks/server.ts:131`) Malformed input can crash the mocks server (unhandled rejection)

  Each request runs inside `void (async () => { ... })()` and nothing catches errors. `decodeURIComponent` on a Basic credential with a bad percent escape (e.g. `%zz`) throws a URIError, and `new URL(redirectUri)` in `authorize` throws when `redirect_uri` is not an absolute URL. Under Node 22's default `--unhandled-rejections=throw`, either one stops the whole mocks server, so every later e2e test fails in a confusing way. A Basic value without a colon is also split strangely (`slice(0, -1)`). No acceptance criterion covers malformed input, so this is minor. A try/catch that answers 400 (`invalid_client` / plain text) would make it robust.

- **minor** (`e2e/tests/google.api.spec.ts:118`) Code expiry (60 s) is not tested

  Spec 5.3 says the code is valid for 60 s. The code checks `expiresAt`, but no test exercises it. The acceptance criteria don't ask for this test (only single use), so it is minor.

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

  The mocks server implements every 5.3 Google route. Discovery has the exact fields. authorize checks client_id, redirect_uri, response_type=code and the openid scope (400 plain text otherwise), shows an HTML form whose hidden inputs repeat every parameter, and with login_hint returns a 302 with code and state. The token endpoint accepts body or Basic client auth (401 invalid_client), both grants, refresh_token only with access_type=offline, and 400 invalid_grant otherwise. The ID token is RS256 with the JWKS kid and the 5.3 claims; sub follows the subject rule on the lowercased e-mail. userinfo returns 401 for any token it did not issue, and revoke returns 200. In the Worker, POST /ops/invites (lowercased, single upsert that re-activates a revoked invite), POST /ops/invites/revoke (single UPDATE ... RETURNING, 404 not_found when unknown) and GET /ops/users (ORDER BY email) sit behind the existing auth-before-body check. Order of writes: token checks client auth before touching the code, and the code is deleted before validation, so it is single use. Each invite operation is one SQL statement, so concurrent requests cannot interleave. Nothing out of scope (the Worker's OAuth routes, /mcp) was added.

- met: The change is covered by tests that fail without it.

  e2e/tests/google.api.spec.ts (api project, matched by `.api.spec.ts`) covers discovery, 400 for a wrong client_id or a missing openid scope, the form repeating parameters, the 302 with code and state, signature verification with the JWKS key, the claims including the sub rule, lowercased email and nonce, single use, 401 invalid_client, refresh, and userinfo for its own token only. worker/tests/workers/invites.test.ts covers lowercased storage, re-activation, the 404 not_found on revoke, the 400 validation and the users sort order. All these routes answered 404 before the change, so the tests would fail without it. The e2e and test-worker checks pass.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Three dated lines were added: client auth is checked before the grant, Basic credentials are percent-decoded and revoke ignores its body; refresh tokens are not rotated and access tokens live as long as the server; invites emit no log event and extra body fields are rejected with 400. Other details (code deleted on any presentation, codes lowercased via login_hint) follow directly from the spec.

## Proposed learnings (not decided)

- In Node mock servers that wrap handlers in `void (async () => ...)()`, check whether a throwing parser (decodeURIComponent, new URL, JSON.parse) on client input can crash the whole process.
- For single-use codes, check that the code is consumed only after client authentication (so an unauthenticated caller cannot burn it) and before validation (so a failed attempt cannot be retried).
