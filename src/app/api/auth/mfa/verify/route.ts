import { NextRequest, NextResponse } from "next/server";
import { getSessionAllowPartial, issueToken, setSessionCookie } from "@/lib/auth";
import { authLimiters } from "@/lib/auth-limiters";
import { verifySecondFactor } from "@/lib/mfa";
import { requestMeta } from "@/lib/request-meta";
import { prisma } from "@/lib/db";
import { recordAudit } from "../../../../../../server-shared/audit";

/**
 * 第二關：輸入驗證器 App 的 6 位數碼，或一組一次性備用碼（xxxx-xxxx）。
 * 要帶第一關發的暫時 session；正確就換發 7 天的完整 session。
 */
export async function POST(request: NextRequest) {
  const session = await getSessionAllowPartial(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.mfa) return NextResponse.json({ ok: true }); // 已經是完整 session

  const meta = requestMeta(request);
  const mfaKey = `mfa:${session.userId}`;
  if (authLimiters.ip.hit(`ip:${meta.ip}`) || authLimiters.mfa.isLimited(mfaKey)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code.slice(0, 32) : "";

  const result = await verifySecondFactor(session.userId, code);
  if (!result.ok) {
    authLimiters.mfa.hit(mfaKey);
    authLimiters.account.hit(`acct:${session.email.toLowerCase()}`);
    await recordAudit({ type: "mfa_failed", userId: session.userId, email: session.email, ...meta });
    return NextResponse.json({ error: "Invalid code" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, tokenVersion: true },
  });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  authLimiters.mfa.reset(mfaKey);
  authLimiters.account.reset(`acct:${user.email.toLowerCase()}`);

  const detail =
    result.method === "backup_code"
      ? { method: "backup_code", remaining: result.remaining }
      : { method: "totp" };
  if (result.method === "backup_code") {
    await recordAudit({ type: "backup_code_used", userId: user.id, email: user.email, ...meta, detail });
  }
  await recordAudit({ type: "login_success", userId: user.id, email: user.email, ...meta, detail });

  const response = NextResponse.json({
    ok: true,
    ...(result.method === "backup_code" ? { backupCodesRemaining: result.remaining } : {}),
  });
  setSessionCookie(response, issueToken(user), false);
  return response;
}
