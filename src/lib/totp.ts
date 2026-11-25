/**
 * TOTP（RFC 6238：HMAC-SHA1、6 位數、30 秒一步）與一次性備用碼。
 * 自己實作而不引入套件：演算法很短，而且是登入流程的核心，少一個相依少一個供應鏈風險。
 */

import crypto from "crypto";

const STEP_SECONDS = 30;
const DIGITS = 6;
/** 允許前後各差一步（±30 秒），容忍手機時間誤差 */
const WINDOW = 1;

// ─── Base32（RFC 4648，無補位）────────────────────────────────────

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ─── TOTP ──────────────────────────────────────────────────────────

/** 新的 160-bit 秘鑰（RFC 4226 建議長度），回傳 base32 字串 */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function currentStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

/** 某個時間步的 6 位數驗證碼（RFC 4226 動態截斷） */
export function hotp(secretB32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac("sha1", base32Decode(secretB32)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * 驗證使用者輸入的碼。符合時回傳對應的時間步（呼叫端要拿去做防重放：
 * 只接受比上次用過的時間步更新的碼），不符回 null。
 */
export function verifyTotp(secretB32: string, code: string, nowMs = Date.now()): number | null {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const now = currentStep(nowMs);
  const given = Buffer.from(normalized);
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const expected = Buffer.from(hotp(secretB32, now + d));
    if (crypto.timingSafeEqual(expected, given)) return now + d;
  }
  return null;
}

/** 給驗證器 App 的 otpauth:// 連結（手機上點了會直接加進 App；桌機掃 QR code） */
export function otpauthUrl(secretB32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ─── 一次性備用碼 ────────────────────────────────────────────────

// 去掉容易看錯的字元（0/o、1/l/i）
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const BACKUP_CODE_COUNT = 10;

/** 10 組 xxxx-xxxx 格式的備用碼（每組約 39 bits，配合登入限流足夠） */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    let s = "";
    for (let j = 0; j < 8; j++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    codes.push(`${s.slice(0, 4)}-${s.slice(4)}`);
  }
  return codes;
}

export function normalizeBackupCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, "");
}

export function looksLikeBackupCode(code: string): boolean {
  return /^[a-z0-9]{8}$/.test(normalizeBackupCode(code));
}

/** DB 只存雜湊；碼本身只在產生當下顯示一次 */
export function hashBackupCode(code: string): string {
  return crypto.createHash("sha256").update(normalizeBackupCode(code)).digest("hex");
}
