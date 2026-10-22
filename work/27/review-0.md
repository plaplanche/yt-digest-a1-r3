# Review 0

- Reviewed commit: `2d586b40a3da9a1211dd83e6ed40668aabc1e5ee`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/src/oauth.ts:84`) Unparseable /register body gives invalid_client_metadata, while spec 6.1 says invalid_request

  Spec 6.1: "A request body the endpoint cannot parse as JSON, or that breaks its schema, gives 400 invalid_request." Section 10.2 only lists invalid_redirect_uri and invalid_client_metadata for invalid fields, and a non-JSON body is not a field. The change returns invalid_client_metadata for a non-JSON body and for a non-object body. docs/decisions.md line 87 treats this as an open choice, and oauth.test.ts locks it in. Decision line 54 picked invalid_request for the same case on /node and /ops. RFC 7591 supports the chosen code and no acceptance criterion covers this case, so it is minor. Still, it is better to follow 6.1, or at least make the decision line say why 10.2 takes precedence.

- **minor** (`worker/src/oauth.ts:317`) Invite check and users write are separate statements (revoke race)

  /callback reads the invite with a SELECT (step A), then fetches the encryption and runs the batch that upserts users and sets accepted_user_sub (step B). Interleaving: a POST /ops/invites/revoke that runs between A and B still lets the batch create the member row and an authorization code for a user whose invite was just revoked. The spec does not require this to be atomic, and 10.6 reads admission again on every token use, so that user's tokens are still refused. No data is lost and no security property breaks. You could put `WHERE EXISTS (SELECT 1 FROM invites ... revoked = 0)` on the inserts to close the window.

- **minor** (`worker/tests/workers/oauth.test.ts:487`) Some documented choices have no test

  No test covers: `aud` given as an array (decision line 90), a callback with no `code` (server_error), a non-RS256 `alg`, or a `kid` missing from the JWKS. The required refusals (bad state, bad signature, wrong aud, wrong nonce, wrong iss, expiry) are all tested.

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

  Discovery (10.1) matches field for field (oauth.ts protectedResource/authorizationServer). /register follows 10.2: 1–10 URIs, https or http on 127.0.0.1/localhost, no fragment, response 201. /authorize runs the step-1 checks without redirects, then the step-2 errors in the spec's order, and stores the pending row only after every check passes. Consent `deny` uses the request up with a conditional UPDATE…RETURNING; `approve` does a guarded SELECT, then discovery, then a conditional UPDATE that sets google_state/nonce, so two concurrent approves cannot both win. /callback first uses the pending row up atomically by google_state; the error parameter gives access_denied; the exchange is done with the secret in the body; the ID token checks are RS256/iss/aud/exp/nonce; access control covers admin, non-revoked invites and email_verified, and a refusal gives the 403 page with no row. The users/invite/code writes run in one D1 batch, the refresh token is AES-GCM `v1:` encrypted, and the code is stored as its SHA-256 hex. The three log events carry the spec's attrs and no e-mail. No token endpoint or /mcp was added. Only minor deviations remain (6.1 vs register error code).

- met: The change is covered by tests that fail without it.

  worker/tests/workers/oauth.test.ts covers: discovery; register success and every error code; the /authorize no-redirect cases and the ordered redirect errors; escaping and the two decision buttons on the consent page; deny → access_denied; approve with all 8 Google parameters; bad/expired/used state; Google error; wrong nonce/aud/iss/exp and a bad signature; invited, admin, non-invited and revoked users; unverified e-mail; refresh token never stored in clear in any table; log events. The e2e tests add E2E-29 (authorize.api.spec.ts), and the invited-login flow plus E2E-02 (login.browser.spec.ts) through the mocks sign-in page. test-worker and e2e passed.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Five dated 2026-10-22 lines (docs/decisions.md 87–91) cover: register error mapping and ignored fields; how scope and code_challenge are checked; consent edge cases (unknown decision, a second approve, provider unreachable); per-login discovery/JWKS fetch, aud as an array, missing code → server_error and log reasons; keeping the stored refresh token, unverified admin refused, refusal logs.

## Proposed learnings (not decided)

- When a spec has a general rule for bad bodies (6.1 invalid_request) and an endpoint section with its own error codes, check which one the change applies to a non-JSON body, and whether the decision log contradicts an earlier line (here line 54 vs line 87).
- For OAuth callbacks, check that the pending authorization is used up by one conditional UPDATE…RETURNING before any external call. Here it is, so retries and concurrent callbacks cannot mint two codes.
