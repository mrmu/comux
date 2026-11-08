import { NextRequest, NextResponse } from "next/server";
import { registerFirstUser, COOKIE_NAME } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { setSetting } from "@/lib/settings";
import { verifySetupToken, clearSetupToken } from "@/lib/setup-token";

/**
 * 只在系統還沒有任何使用者時開放，用來建立第一個管理員。
 * 必須帶伺服器 log 印出的（或 COMUX_SETUP_TOKEN 指定的）setup token。
 * 之後的帳號一律由已登入的使用者在帳號頁建立（/api/auth/users）。
 */
export async function POST(request: NextRequest) {
  // DB 錯誤一律拒絕（以前 .catch(() => 0) 會讓 DB 掛掉時變成「沒有使用者」而開放註冊）
  let userCount: number;
  try {
    userCount = await prisma.user.count();
  } catch {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  if (userCount > 0) {
    return NextResponse.json(
      { error: "Registration disabled. Contact admin." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  if (!verifySetupToken(body.setupToken)) {
    return NextResponse.json(
      { error: "Invalid setup token (see server log)" },
      { status: 403 }
    );
  }

  let result: Awaited<ReturnType<typeof registerFirstUser>>;
  try {
    result = await registerFirstUser(
      body.email || "",
      body.password || "",
      body.name || ""
    );
  } catch {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // 第一個管理員已建立，token 立即作廢
  clearSetupToken();

  // Save projectsRoot from setup
  if (body.projectsRoot) {
    await setSetting("projectsRoot", body.projectsRoot);
  }

  const isProduction = process.env.NODE_ENV === "production";
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, result.token, {
    maxAge: 7 * 86400,
    httpOnly: true,
    sameSite: "strict",
    secure: isProduction,
  });
  return response;
}
