import { NextRequest, NextResponse } from "next/server";
import {
  getSessionAllowPartial,
  issueToken,
  revokeUserSessions,
  setSessionCookie,
} from "@/lib/auth";
import { authLimiters } from "@/lib/auth-limiters";
import { confirmEnrollment } from "@/lib/mfa";
import { requestMeta } from "@/lib/request-meta";
import { prisma } from "@/lib/db";
import { recordAudit } from "../../../../../../server-shared/audit";

/**
 * 確認綁定：輸入驗證器顯示的碼。正確就啟用，回傳一組一次性備用碼（只顯示這一次），
 * 並換發完整 session。換手機（原本已綁定）時，其他裝置的 session 一律失效。
 */
export async function POST(request: NextRequest) {
  const session = await getSessionAllowPartial(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meta = requestMeta(request);
  const mfaKey = `mfa:${session.userId}`;
  if (authLimiters.mfa.isLimited(mfaKey)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code.slice(0, 32) : "";

  // 已綁定的帳號只能用完整 session 重新綁定（setup 那一步已要求目前的驗證碼）
  const current = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { totpEnabledAt: true },
  });
  if (current?.totpEnabledAt && !session.mfa) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await confirmEnrollment(session.userId, code);
  if (!result) {
    authLimiters.mfa.hit(mfaKey);
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }
  authLimiters.mfa.reset(mfaKey);

  // 換手機：舊 session 全部失效；第一次綁定則沿用目前的 tokenVersion
  const user = result.wasEnabled
    ? await revokeUserSessions(session.userId)
    : await prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, email: true, tokenVersion: true },
      });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await recordAudit({
    type: "mfa_enabled",
    userId: user.id,
    email: user.email,
    ...meta,
    detail: { rebind: result.wasEnabled },
  });
  if (!session.mfa) {
    // 第一次綁定也算一次完整登入
    await recordAudit({
      type: "login_success",
      userId: user.id,
      email: user.email,
      ...meta,
      detail: { method: "totp", firstEnrollment: true },
    });
  }

  const response = NextResponse.json({ ok: true, backupCodes: result.backupCodes });
  setSessionCookie(response, issueToken(user), false);
  return response;
}
