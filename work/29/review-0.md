# Review 0

- Reviewed commit: `85fe694cc4b5e4c1fb5947b89fa54dec2e07fc10`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/src/oauth.ts:253`) Consent approve redirects with server_error when Google's discovery fails, a redirect 10.3 does not list

  Section 10.3 lists no redirect for `approve` other than the one to Google. When discovery fails, `failed()` uses up the pending authorization and sends the browser to the client with `error=server_error`. The redirect target is the exact registered URI checked at `/authorize`, so it is not an open redirect. The choice is written in docs/decisions.md. No acceptance criterion covers this case.

- **minor** (`worker/src/oauth.ts:353`) The invite check and the users/code batch are separate statements

  In `/callback`, the order is: (1) `SELECT ... FROM invites WHERE revoked = 0`, then (2) a `DB.batch` that upserts `users` and inserts `oauth_codes`. A concurrent `POST /ops/invites/revoke` can land between (1) and (2), so a just-revoked user still gets a `users` row and a code. Nothing loses data and no check passes wrongly: 10.6 reads admittance again on every token use, so the tokens are refused anyway. 10.4 does not ask for atomicity here. A guarded `INSERT ... SELECT ... WHERE EXISTS (invite)` would close the gap.

- **minor** (`e2e/tests/login.browser.spec.ts:11`) The browser fix cannot be confirmed from this replay

  The fix for PR #28's CI failure (`page.route` answering https://client.example/cb so Chromium never connects) looks right: the Fetch interception also catches the Worker's 302 navigation. But browser tests are skipped wherever Chromium cannot be installed. The replay's e2e pass therefore does not prove the browser project ran, so the CI e2e job has to be watched to confirm it.

- **minor** (`worker/src/oauth.ts:97`) client_name length counts UTF-16 code units

  `name.length > 200` counts code units, not characters, so a name of 200 astral-plane characters is refused. This is an edge case no criterion covers.

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

  oauth.ts covers each part of the ticket. Discovery (10.1) serves both PRM paths and the AS metadata. `/register` (10.2) checks the redirect_uris rules before invalid_client_metadata. `/authorize` (10.3) shows an HTML 400 for an unknown client or redirect_uri, then redirects for the other errors in the spec's order, then shows an escaped consent page with two buttons. `/authorize/consent` handles deny with an atomic UPDATE...RETURNING, and approve binds a state and nonce through a conditional UPDATE. `/callback` (10.4) uses up the pending authorization atomically first, then handles a Google error, then the code exchange with RS256/iss/aud/exp/nonce checks, then access control with the 403 page, then one batch writing users, the accepted invite and the hashed code. The Google refresh token is stored as AES-GCM `v1:` (6.3), and the three log events carry no secrets. Nothing from /token, /mcp, PATs or sessions was added.

- met: The change is covered by tests that fail without it.

  worker/tests/workers/oauth.test.ts uses a stubbed Google. It covers each error of 10.2 and 10.3 in order, checking where redirects happen and where they must not. It checks the escaped name and the two decision buttons, deny returning access_denied, and every Google parameter on approve. At the callback it checks a bad state, a bad signature, a wrong aud, iss or nonce, and an expired token. It checks member and admin rows, the 403 page with no row, and that no table holds the refresh token in clear (with a decrypt check). The E2E tests cover E2E-29 (api), and the invited login and E2E-02 (browser). All routes are new, so these tests fail without the change.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Six dated lines were added. They cover building by hand, register body and field handling, the exact scope match, an empty challenge, approve rebinding and discovery failure, the denied reasons and log levels, keeping the stored refresh token, the aud array, missing settings giving 500, and page.route in the browser tests.

## Proposed learnings (not decided)

- For browser OAuth tests whose client redirect URI has no listener, answer the URI with page.route instead of pointing it at an unreachable port.
- In callback flows, check that access control and the user/code writes run as one guarded statement, or record why a separate check is acceptable (for example, admittance being re-read on every token use).
