import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { authLimiters } from "@/lib/auth-limiters";
import { regenerateBackupCodes, verifyCurrentTotp } from "@/lib/mfa";
import { requestMeta } from "@/lib/request-meta";
import { recordAudit } from "../../../../../../server-shared/audit";

/** 重新產生一組備用碼（舊的全部作廢）。要完整 session 並再輸入一次目前的驗證碼。 */
export async function POST(request: NextRequest) {
  const session = await getAuthenticatedUser(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const mfaKey = `mfa:${session.userId}`;
  if (authLimiters.mfa.isLimited(mfaKey)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }
  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : "";
  if (!(await verifyCurrentTotp(session.userId, code))) {
    authLimiters.mfa.hit(mfaKey);
    return NextResponse.json({ error: "Current code is incorrect" }, { status: 403 });
  }

  const backupCodes = await regenerateBackupCodes(session.userId);
  await recordAudit({
    type: "backup_codes_regenerated",
    userId: session.userId,
    email: session.email,
    ...requestMeta(request),
  });
  return NextResponse.json({ ok: true, backupCodes });
}
