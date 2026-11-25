/**
 * 存在 DB 的小秘密（目前是 TOTP 秘鑰）以 AES-256-GCM 加密。
 * 金鑰由 COMUX_SECRET 以 HKDF 衍生：DB 備份或 SQL 注入外洩時拿不到可用的 TOTP 秘鑰。
 *
 * 注意：更換 COMUX_SECRET 後舊的密文就解不開 —— 所有人的第二道驗證要重新綁定
 * （用 `npm run mfa:reset -- <email>` 清掉，下次登入會強制重新綁定）。
 */

import crypto from "crypto";
import { getComuxSecret } from "../../server-shared/comux-secret";

const VERSION = "v1";

function key(): Buffer {
  return Buffer.from(
    crypto.hkdfSync("sha256", getComuxSecret(), "comux", "secret-box-v1", 32)
  );
}

export function seal(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, ct]).toString("base64")}`;
}

/** 解不開（格式錯、金鑰換了、被竄改）回 null */
export function open(sealed: string | null | undefined): string | null {
  if (!sealed || !sealed.startsWith(`${VERSION}:`)) return null;
  try {
    const raw = Buffer.from(sealed.slice(VERSION.length + 1), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
