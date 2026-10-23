# Review 0

- Reviewed commit: `7b1a8ad0c655e5137f6384a2f36c2251db5c1cf4`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/src/oauth.ts:391`) Invite check and the users/code batch are separate statements

  In callback the order of writes is: (1) UPDATE oauth_requests SET used_at … RETURNING (atomic, single use: correct), (2) Google token exchange, discovery and JWKS fetches, (3) SELECT from invites WHERE revoked = 0, (4) one batch: users upsert, invites accepted_user_sub, oauth_codes insert, (5) log auth.oauth.completed. A concurrent POST /ops/invites/revoke that commits between (3) and (4) still gets a users row and a code written for a user whose invite is now revoked. This is not blocking. The spec does not ask for login and revoke to be atomic, and 10.6 checks admission again on every request, so no token gets accepted wrongly and no data is lost. Putting the invite condition inside the INSERT (INSERT … SELECT … WHERE EXISTS a non-revoked invite) would close the gap.

- **minor** (`worker/src/oauth.ts:309`) aud check passes when GOOGLE_CLIENT_ID is unset and the token has no aud

  `aud !== env.GOOGLE_CLIENT_ID` is false when both are undefined. In the same way, an unset ADMIN_EMAIL makes '' the admin e-mail. The stack and the tests always set both values, so this is only a hardening issue. Failing closed when the configuration is missing would be safer.

- **minor** (`worker/tests/workers/oauth.test.ts:303`) Some documented failure paths have no test

  Four documented paths have no test: Google discovery failing at approve (the 302 server_error and the request being used up, per docs/decisions.md), a callback with a valid state but no `code`, an ID token whose alg is not RS256, and an unknown kid. The acceptance criteria do not list them, so this is minor.

- **minor** (`worker/src/oauth.ts:87`) Redirect URI check accepts forms other than `https://`

  `new URL('https:foo')` normalises to `https://foo/`, so a URI without the `//` passes as an absolute `https://` URL. client_name length is also counted in UTF-16 code units. Both are edge cases that no acceptance criterion covers.

- **minor** (`worker/vitest.config.ts:27`) Misindented TEST_MIGRATIONS line

  The line ` TEST_MIGRATIONS: …` has a one-space indent, unlike the lines around it. Only cosmetic: lint passes.

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

  oauth.ts covers each part of the ticket. 10.1: both protected-resource paths and the AS metadata with the exact fields. 10.2: redirect URI validation, invalid_redirect_uri first, then invalid_client_metadata, the 201 shape with fixed defaults, no secret. 10.3: 400 page for an unknown client or a non-exact redirect_uri, redirect errors in the order the spec gives, escaped consent page with the two decision buttons, deny/approve consumed through one UPDATE … RETURNING each, every Google parameter present. 10.4: state consumed atomically, error → access_denied, the exchange sends the secret in the body, RS256/iss/aud/exp/nonce checks, admin/invite/email_verified access control with the 403 page and no row, one batch for the users upsert, invite acceptance and the hashed code with TTL. 6.3: AES-GCM `v1:` with a random IV. Section 12: the three events, with no e-mails or secrets. No token endpoint, /mcp, PATs or rate limiting were added. Unlisted routes still return 404.

- met: The change is covered by tests that fail without it.

  worker/tests/workers/oauth.test.ts drives every new route against real D1, with Google answered by a stubbed fetch and real RSA signatures. It covers the 10.2 errors, the 10.3 order and the never-redirect cases, escaping, deny/approve parameters, a bad state, signature, aud, nonce, iss and exp, invited, admin, non-invited, revoked and unverified users, the encryption checks across all tables, and the log events. Every one of these routes returned 404 before the change. e2e/tests/oauth.api.spec.ts (E2E-29 and the consent → fake Google → code flow) and oauth.browser.spec.ts (E2E-02) also exercise it. I checked the browser test against the code: the consent page has a `Browser client` text and an `Approve` button, the mocks sign-in page has `input[name=login_hint]` and `<button type="submit">`, its 302 goes to BASE/callback, and the refusal page has the title `Access refused` and the sentence the test waits for. It can pass.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Seven dated lines added on 2026-10-23: a non-object register body, ignored extra metadata, scope and redirect_uri matched as exact strings, the consume/bind rules of consent and a discovery failure at approve, callback failure mapping and iss/aud tolerance, email_verified handling and the admin role winning over an invite, COALESCE of the refresh token and keeping created_at, and the test configuration.

## Proposed learnings (not decided)

- When access control reads a table (invites) and then writes in a later batch, check whether a concurrent revoke can interleave. Here 10.6's re-check on every request is what keeps it harmless.
- For untested browser specs, compare each selector with the mocks server HTML (e2e/mocks/server.ts) and with the Worker's HTML helpers. Titles and button labels come from the code, not the spec.
- An equality check against an optional env value (`x !== env.Y`) passes when both are undefined. Look for it in token validation code.
