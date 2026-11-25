import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base32Encode,
  base32Decode,
  hotp,
  verifyTotp,
  otpauthUrl,
  generateTotpSecret,
  generateBackupCodes,
  hashBackupCode,
  looksLikeBackupCode,
  BACKUP_CODE_COUNT,
} from "../src/lib/totp";

// RFC 6238 附錄 B 的 SHA1 測試向量（秘鑰 "12345678901234567890"），取 8 位數結果的後 6 位
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));
const VECTORS: [number, string][] = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
];

test("hotp matches RFC 6238 SHA1 vectors", () => {
  for (const [t, code] of VECTORS) assert.equal(hotp(RFC_SECRET, Math.floor(t / 30)), code, `t=${t}`);
});

test("base32 round-trips and matches RFC 4648", () => {
  assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
  assert.equal(base32Decode("MZXW6YTBOI").toString(), "foobar");
  assert.equal(base32Decode("mzxw 6ytb-oi").toString(), "foobar");
  const s = generateTotpSecret();
  assert.equal(s.length, 32);
  assert.equal(base32Decode(s).length, 20);
});

test("verifyTotp accepts ±1 step and returns the step", () => {
  const now = 1111111111 * 1000;
  const step = Math.floor(1111111111 / 30);
  assert.equal(verifyTotp(RFC_SECRET, "050471", now), step);
  assert.equal(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), now), step - 1);
  assert.equal(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1), now), step + 1);
  assert.equal(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 2), now), null);
  assert.equal(verifyTotp(RFC_SECRET, "050 471", now), step);
  assert.equal(verifyTotp(RFC_SECRET, "12345", now), null);
  assert.equal(verifyTotp(RFC_SECRET, "abcdef", now), null);
});

test("otpauth URL carries issuer, account and secret", () => {
  const url = new URL(otpauthUrl("JBSWY3DPEHPK3PXP", "a@example.com", "comux"));
  assert.equal(url.protocol, "otpauth:");
  assert.equal(url.host, "totp");
  assert.equal(decodeURIComponent(url.pathname), "/comux:a@example.com");
  assert.equal(url.searchParams.get("secret"), "JBSWY3DPEHPK3PXP");
  assert.equal(url.searchParams.get("issuer"), "comux");
});

test("backup codes: format, uniqueness, hashing is normalization-insensitive", () => {
  const codes = generateBackupCodes();
  assert.equal(codes.length, BACKUP_CODE_COUNT);
  assert.equal(new Set(codes).size, codes.length);
  for (const c of codes) {
    assert.match(c, /^[a-z2-9]{4}-[a-z2-9]{4}$/);
    assert.ok(looksLikeBackupCode(c));
    assert.equal(hashBackupCode(c), hashBackupCode(c.toUpperCase().replace("-", " ")));
  }
  assert.ok(!looksLikeBackupCode("123456"));
});
