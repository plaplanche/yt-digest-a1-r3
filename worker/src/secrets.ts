const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

export function base64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  return fromBase64(text.replaceAll("-", "+").replaceAll("_", "/"));
}

// An opaque random value of `bytes` random bytes, as base64url.
export function randomToken(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function aesKey(keyBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromBase64(keyBase64), "AES-GCM", false, ["encrypt", "decrypt"]);
}

// AES-GCM with a random 12-byte IV, stored as `v1:` and the base64 of the IV followed by the ciphertext (spec lot 2, section 6.3).
export async function encryptSecret(plain: string, keyBase64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keyBase64), encoder.encode(plain)));
  return `v1:${toBase64(new Uint8Array([...iv, ...cipher]))}`;
}

export async function decryptSecret(stored: string, keyBase64: string): Promise<string> {
  const raw = fromBase64(stored.slice("v1:".length));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await aesKey(keyBase64), raw.slice(12));
  return new TextDecoder().decode(plain);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePart(part: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(part)));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export interface IdTokenExpectations {
  issuer: string;
  audience: string;
  nonce: string;
  keys: JsonWebKey[];
  nowSeconds: number;
}

// Verifies an RS256 ID token (signature, iss, aud, exp, nonce) and returns its claims, or undefined when any check fails.
export async function verifyIdToken(token: string, expected: IdTokenExpectations): Promise<Record<string, unknown> | undefined> {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const [headerPart, claimsPart, signaturePart] = parts as [string, string, string];
  const header = parsePart(headerPart);
  const claims = parsePart(claimsPart);
  if (header === undefined || claims === undefined || header.alg !== "RS256") return undefined;
  const jwk = expected.keys.find((key) => (key as { kid?: string }).kid === header.kid && key.kty === "RSA");
  if (jwk === undefined) return undefined;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      fromBase64Url(signaturePart),
      encoder.encode(`${headerPart}.${claimsPart}`) as Uint8Array<ArrayBuffer>,
    );
    if (!valid) return undefined;
  } catch {
    return undefined;
  }
  const audience = claims.aud;
  const audienceOk = Array.isArray(audience) ? audience.includes(expected.audience) : audience === expected.audience;
  if (
    claims.iss !== expected.issuer ||
    !audienceOk ||
    typeof claims.exp !== "number" ||
    claims.exp <= expected.nowSeconds ||
    claims.nonce !== expected.nonce
  ) {
    return undefined;
  }
  return claims;
}
