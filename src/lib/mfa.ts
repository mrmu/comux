/**
 * 第二道驗證（TOTP＋一次性備用碼）的 DB 操作。
 * 防重放、備用碼用掉即失效都用單一條件式 UPDATE 完成，兩個請求同時用同一組碼只會有一個成功。
 */

import QRCode from "qrcode";
import { prisma } from "./db";
import { seal, open } from "./secret-box";
import {
  generateTotpSecret,
  verifyTotp,
  otpauthUrl,
  generateBackupCodes,
  hashBackupCode,
  looksLikeBackupCode,
} from "./totp";

const ISSUER = "comux";

export interface EnrollmentInfo {
  secret: string;
  otpauthUrl: string;
  qrSvg: string;
}

/** 開始（或重新）綁定：產生新秘鑰暫存在 totpPendingSecret，確認碼正確後才生效。 */
export async function startEnrollment(userId: number, email: string): Promise<EnrollmentInfo> {
  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: userId },
    data: { totpPendingSecret: seal(secret) },
  });
  const url = otpauthUrl(secret, email, ISSUER);
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { secret, otpauthUrl: url, qrSvg };
}

/**
 * 確認綁定：驗證碼要對得上暫存的秘鑰。成功時啟用、產生新的一組備用碼並回傳（只顯示這一次）。
 * 回傳 null 表示碼錯誤或沒有進行中的綁定。
 */
export async function confirmEnrollment(
  userId: number,
  code: string
): Promise<{ backupCodes: string[]; wasEnabled: boolean } | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpPendingSecret: true, totpEnabledAt: true },
  });
  const pending = open(user?.totpPendingSecret);
  if (!user || !pending) return null;
  const step = verifyTotp(pending, code);
  if (step === null) return null;

  const backupCodes = generateBackupCodes();
  // 條件式更新：暫存秘鑰在這段時間被換掉（另一個分頁重新開始綁定）就不算數
  const { count } = await prisma.user.updateMany({
    where: { id: userId, totpPendingSecret: user.totpPendingSecret },
    data: {
      totpSecret: user.totpPendingSecret,
      totpPendingSecret: null,
      totpEnabledAt: new Date(),
      totpLastStep: step,
      backupCodes: backupCodes.map(hashBackupCode),
    },
  });
  if (count !== 1) return null;
  return { backupCodes, wasEnabled: user.totpEnabledAt !== null };
}

export type SecondFactorResult =
  | { ok: true; method: "totp" }
  | { ok: true; method: "backup_code"; remaining: number }
  | { ok: false };

/** 只驗 TOTP（含防重放）。 */
async function checkTotp(userId: number, totpSecret: string | null, code: string): Promise<boolean> {
  const secret = open(totpSecret);
  if (!secret) return false;
  const step = verifyTotp(secret, code);
  if (step === null) return false;
  // 防重放：只接受比上次用過的時間步更新的碼
  const updated = await prisma.$executeRaw`
    UPDATE users SET totp_last_step = ${step}
     WHERE id = ${userId} AND (totp_last_step IS NULL OR totp_last_step < ${step})`;
  return updated === 1;
}

/** 驗證登入時輸入的碼：6 位數當 TOTP，xxxx-xxxx 當備用碼。 */
export async function verifySecondFactor(userId: number, code: string): Promise<SecondFactorResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecret: true, totpEnabledAt: true },
  });
  if (!user || !user.totpEnabledAt) return { ok: false };

  const trimmed = code.trim();
  if (/^\d{3}\s?\d{3}$/.test(trimmed)) {
    return (await checkTotp(userId, user.totpSecret, trimmed)) ? { ok: true, method: "totp" } : { ok: false };
  }

  if (looksLikeBackupCode(trimmed)) {
    const hash = hashBackupCode(trimmed);
    const rows = await prisma.$queryRaw<{ remaining: number }[]>`
      UPDATE users SET backup_codes = array_remove(backup_codes, ${hash})
       WHERE id = ${userId} AND ${hash} = ANY(backup_codes)
       RETURNING cardinality(backup_codes) AS remaining`;
    if (rows.length !== 1) return { ok: false };
    return { ok: true, method: "backup_code", remaining: Number(rows[0].remaining) };
  }

  return { ok: false };
}

/**
 * 只接受目前的 TOTP（不接受備用碼）。重新產生備用碼、重新綁定前要求再輸入一次，
 * 避免被偷走的 session 直接改第二道驗證的設定。
 */
export async function verifyCurrentTotp(userId: number, code: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecret: true, totpEnabledAt: true },
  });
  if (!user || !user.totpEnabledAt) return false;
  return checkTotp(userId, user.totpSecret, code.trim());
}

/** 重新產生一組備用碼（舊的全部作廢），回傳新碼（只顯示這一次）。 */
export async function regenerateBackupCodes(userId: number): Promise<string[]> {
  const codes = generateBackupCodes();
  await prisma.user.update({
    where: { id: userId },
    data: { backupCodes: codes.map(hashBackupCode) },
  });
  return codes;
}

export async function getMfaStatus(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpEnabledAt: true, backupCodes: true },
  });
  return {
    enabled: Boolean(user?.totpEnabledAt),
    enabledAt: user?.totpEnabledAt ?? null,
    backupCodesRemaining: user?.backupCodes.length ?? 0,
  };
}
