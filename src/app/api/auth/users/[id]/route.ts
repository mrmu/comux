import { NextRequest, NextResponse } from "next/server";
import { requireAuth, revokeUserSessions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const userId = parseInt(id);

  // Don't allow deleting the last user
  const count = await prisma.user.count();
  if (count <= 1) {
    return NextResponse.json({ error: "Cannot delete the only user" }, { status: 400 });
  }

  if (!Number.isInteger(userId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  // 先遞增 tokenVersion 再刪除：就算刪除失敗，該使用者的 token 也已失效；
  // 刪除成功後 requireAuth / WS 查不到使用者同樣會拒絕
  await revokeUserSessions(userId);
  await prisma.user.delete({ where: { id: userId } });
  return NextResponse.json({ ok: true });
}
