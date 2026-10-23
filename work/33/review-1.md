# Review 1

- Reviewed commit: `201e097b806a7ffea502f4ceb4da0321c79bb1b4`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/src/oauth.ts:523`) Refresh expiry is checked on the earlier SELECT, not in the conditional UPDATE

  refreshGrant compares `row.expires_at <= now` using the row it read first. The rotation UPDATE in issuePair only checks `used_at IS NULL AND revoked_at IS NULL`. A token that expires in the few milliseconds between the two statements can still be rotated once. Time only moves forward and the token was valid when it was read, so no data is lost and no security property breaks. Adding `AND expires_at > ?` to the UPDATE would close the gap.

- **minor** (`worker/src/oauth.ts:533`) A missing client_id gives 401 invalid_client, and docs/decisions.md does not say so

  10.5 lists client_id among the parameters whose absence gives 400 invalid_request. It also says the client is checked before missing parameters. The code takes the second reading (a missing client_id is an unknown client, 401), and token.test.ts asserts it. That is a fair reading of the check order, but docs/decisions.md does not record it.

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

  POST /token (oauth.ts token/codeGrant/refreshGrant) checks the body is form-encoded, then grant type, client, missing parameters, resource, then the code. A single `UPDATE ... WHERE used_at IS NULL RETURNING` uses up the code before the verifier, client and redirect checks, so a failed exchange also uses it. PKCE is S256 with base64url and no padding. Every answer, errors included, carries no-store. The 200 body has the fields of 10.5. Rotation keeps the family, and reuse revokes every token of the family and logs auth.refresh.reuse_detected with client_id and revoked. auth.token.issued is logged with client_id and grant_type, and no secrets go into log lines. checkAccessToken (10.6) checks kind 'access', the resource, revocation and expiry, then reads the user and invite again on every call. The token lifetimes default to the values of 5.2, and stack.sh already passes them. Nothing touches /mcp, the admin scope, PATs or web sessions.

- met: The change is covered by tests that fail without it.

  worker/tests/workers/token.test.ts covers every acceptance case. For 10.5: each error, a code used up by a failed exchange, no-store, rotation that keeps earlier access tokens valid, and reuse that revokes the family (access tokens included), with the log lines checked. It also has a race test: the family is revoked between marking the token and the insert, and the test asserts that no valid row is left; it would fail with the old separate statements. For 10.6: valid, expired, revoked, refresh, node and revoked-invite tokens, plus another resource and the admin. E2E-31 in e2e/tests/oauth.api.spec.ts logs in over HTTP through the consent form and login_hint, rotates, reuses the old token and shows the newest refresh token refused at /token. All of this is new code, so these tests fail without the change.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Four dated lines cover: the family id, the TTL defaults and no-store on errors; how a form-encoded body is detected; that a reused code revokes nothing; that other-client, unknown, expired or revoked refresh tokens revoke nothing; the shape and reasons of checkAccessToken, with logging left to the caller; and the conditional batch used for rotation. The one unrecorded reading (a missing client_id gives 401) follows from the check order in the spec and is reported as minor.

## Proposed learnings (not decided)

- For token rotation in D1, put the marking UPDATE and an `INSERT ... SELECT ... WHERE changes() = 1 AND NOT EXISTS (revoked row in family)` in one DB.batch. A concurrent family revocation then either stops the insert or also revokes the new pair.
- To test a race in D1 Worker tests, wrap env.DB.batch with vi.spyOn and run the competing write just before the real batch.

## Earlier findings

- 0.1: fixed
- 0.2: fixed
