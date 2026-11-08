import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, getAuthenticatedUser, revokeUserSessions } from "@/lib/auth";

export async function POST(request: NextRequest) {
  // 遞增 tokenVersion：這顆 token（以及同帳號其他裝置的 token）立即失效，
  // 不再只是請瀏覽器刪 cookie —— 被偷走的 token 也會一起作廢
  const session = await getAuthenticatedUser(request);
  if (session) await revokeUserSessions(session.userId);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, "", { maxAge: 0 });
  return response;
}
