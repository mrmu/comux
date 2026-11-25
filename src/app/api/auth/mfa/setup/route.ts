import { NextRequest, NextResponse } from "next/server";
import { getSessionAllowPartial } from "@/lib/auth";
import { authLimiters } from "@/lib/auth-limiters";
import { getMfaStatus, startEnrollment, verifyCurrentTotp } from "@/lib/mfa";

/**
 * 開始綁定驗證器：產生新秘鑰（暫存，確認後才生效），回傳 otpauth 連結與 QR code。
 *   - 還沒綁定：第一關的暫時 session 即可（登入後強制綁定）
 *   - 已綁定、要換手機：要完整 session，並再輸入一次目前的驗證碼（currentCode）
 */
export async function POST(request: NextRequest) {
  const session = await getSessionAllowPartial(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = await getMfaStatus(session.userId);
  if (status.enabled) {
    if (!session.mfa) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const mfaKey = `mfa:${session.userId}`;
    if (authLimiters.mfa.isLimited(mfaKey)) {
      return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
    }
    const body = await request.json().catch(() => ({}));
    const currentCode = typeof body.currentCode === "string" ? body.currentCode : "";
    if (!(await verifyCurrentTotp(session.userId, currentCode))) {
      authLimiters.mfa.hit(mfaKey);
      return NextResponse.json({ error: "Current code is incorrect" }, { status: 403 });
    }
  }

  const info = await startEnrollment(session.userId, session.email);
  return NextResponse.json(info);
}
