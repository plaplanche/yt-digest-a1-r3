# Review 0

- Reviewed commit: `fecda50d979c49b5617f036a93c7c95f56ec37a6`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`worker/src/oauth.ts:486`) Rotation and reuse revocation are separate statements: a concurrent reuse can revoke the family before the new pair is inserted, and the new pair stays valid

  Rotation runs in two steps. Step R1 (refreshGrant, line ~486) is `UPDATE oauth_tokens SET used_at … WHERE … used_at IS NULL RETURNING *`, which marks refresh token T used. Step R2 (issuePair, line ~444) is a later, separate `DB.batch` that INSERTs the new access/refresh pair with `revoked_at` NULL. Reuse detection has its own two steps: U1, the conditional UPDATE, which fails because T is already used, then U2, the SELECT and `UPDATE … SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL` (line ~492). Two requests with the same T (for example the legitimate client and an attacker holding a stolen T) can run as R1 → U1 → U2 → R2. U2 revokes every row of the family that exists at that moment and logs `auth.refresh.reuse_detected`. Then R2 inserts a fresh pair in the same family that is not revoked, and the winner of the race gets back a working access token and a refresh token it can keep rotating. Section 10.5 says reuse 'revokes every token of its family (access tokens included)', so this breaks a security property: reuse detection can be escaped. Fix: make the decision atomic. One option is to put the mark-used and the inserts in one batch whose INSERTs are conditional (`INSERT … SELECT … WHERE NOT EXISTS (SELECT 1 FROM oauth_tokens WHERE family_id = ? AND revoked_at IS NOT NULL)`). Another is to check again after the insert and revoke if the family was revoked meanwhile. A third is a family-level revocation marker that 10.6 and the refresh grant check. Add a test that replays this interleaving.

- **minor** (`worker/src/oauth.ts:503`) Form-encoded detection is a bare prefix match

  `startsWith("application/x-www-form-urlencoded")` also accepts media types such as `application/x-www-form-urlencodedfoo`. Comparing the media type before any `;` would be stricter. No acceptance criterion covers this.

- **minor** (`worker/src/oauth.ts:490`) Reuse detection ignores a used refresh token presented by another client

  The lookup that triggers revocation filters on `client_id`, so another client replaying a used refresh token gets `invalid_grant` and the family is not revoked. docs/decisions.md records this choice and the spec allows it ('issued to another client: invalid_grant'). It is mentioned only because it narrows reuse detection.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  Most of 10.5 and 10.6 is implemented: form-only body, check order (grant type, client, parameters, resource, code), single-use codes that a failed exchange also uses up, S256, no-store, rotation, families, 10.6 check with the user read again, and the log events. But reuse revocation is not atomic with rotation: a pair inserted after a concurrent revocation stays valid, which contradicts 'revokes every token of its family'. See the blocking finding.

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

- **not met**: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  Most of 10.5 and 10.6 is implemented: form-only body, check order (grant type, client, parameters, resource, code), single-use codes that a failed exchange also uses up, S256, no-store, rotation, families, 10.6 check with the user read again, and the log events. But reuse revocation is not atomic with rotation: a pair inserted after a concurrent revocation stays valid, which contradicts 'revokes every token of its family'. See the blocking finding.

- met: The change is covered by tests that fail without it.

  worker/tests/workers/token.test.ts covers every 10.5 error the ticket lists, a code used up by a failed exchange, no-store, rotation with earlier access tokens still valid, reuse revoking the family (access tokens included) and its log, and the 10.6 cases (valid, expired, revoked, refresh token, node token, revoked invite, admin). The e2e test E2E-31 in e2e/tests/oauth.api.spec.ts logs in over HTTP through the consent form and login_hint. /token and checkAccessToken did not exist before, so all of these fail without the change. No test covers concurrent rotation and reuse.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Three dated lines record: family id at the code exchange, TTL defaults, no-store on errors, Content-Type detection, code reuse revoking nothing, other-client/unknown/expired/revoked refresh tokens not revoking, and the checkAccessToken reasons, with logging left to the caller.

## Proposed learnings (not decided)

- Rotation with reuse detection needs the 'mark used' and the 'insert the new pair' steps to be atomic with respect to family revocation. Otherwise a concurrent reuse can revoke the family between them, and the new pair escapes revocation.
- Check refresh-token code for the interleaving R1 (mark used) → U2 (revoke family) → R2 (insert new pair). Tests that run requests one after another never show it.
