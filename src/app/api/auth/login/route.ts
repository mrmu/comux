import { NextRequest, NextResponse } from "next/server";
import { checkPassword, issuePartialToken, setSessionCookie } from "@/lib/auth";
import { authLimiters } from "@/lib/auth-limiters";
import { requestMeta } from "@/lib/request-meta";
import { recordAudit } from "../../../../../server-shared/audit";

/**
 * 第一關：帳號密碼。通過後只發 10 分鐘的暫時 session（JWT mfa=false），
 * 回傳下一步：
 *   - verify：已綁定第二道驗證 → 輸入驗證碼（POST /api/auth/mfa/verify）
 *   - enroll：還沒綁定 → 強制綁定（POST /api/auth/mfa/setup → /api/auth/mfa/enable）
 * 暫時 session 不能開任何頁面、API 或終端機。
 */
export async function POST(request: NextRequest) {
  const meta = requestMeta(request);
  if (authLimiters.ip.hit(`ip:${meta.ip}`)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const normalized = email.toLowerCase().trim();
  const accountKey = `acct:${normalized}`;

  if (authLimiters.account.isLimited(accountKey)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  const result = await checkPassword(email, password);

  if (!result) {
    authLimiters.account.hit(accountKey);
    await recordAudit({ type: "login_failed", email: normalized.slice(0, 320), ...meta });
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, next: result.mfaEnabled ? "verify" : "enroll" });
  setSessionCookie(response, issuePartialToken(result.user), true);
  return response;
}
