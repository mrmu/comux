import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import {
  MIN_PASSWORD_LENGTH,
  COOKIE_NAME,
  getAuthenticatedUser,
  revokeUserSessions,
  issueToken,
} from "@/lib/auth";

export async function PUT(request: NextRequest) {
  const session = await getAuthenticatedUser(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.userId;

  const body = await request.json();
  const { currentPassword, newPassword } = body;

  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const valid = await bcrypt.compare(currentPassword || "", user.password);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { password: hash } });

  // 改密碼 → 這個帳號在其他裝置上的 session 全部失效；目前這台換發新 token 維持登入
  const updated = await revokeUserSessions(userId);
  if (!updated) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const isProduction = process.env.NODE_ENV === "production";
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, issueToken(updated), {
    maxAge: 7 * 86400,
    httpOnly: true,
    sameSite: "strict",
    secure: isProduction,
  });
  return response;
}
