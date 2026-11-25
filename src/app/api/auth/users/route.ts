import { NextRequest, NextResponse } from "next/server";
import { requireAuth, register } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, createdAt: true, totpEnabledAt: true },
    orderBy: { createdAt: "asc" },
  });
  // 只回傳「有沒有綁定」，不外流任何秘鑰相關欄位
  return NextResponse.json(
    users.map(({ totpEnabledAt, ...u }) => ({ ...u, mfaEnabled: totpEnabledAt !== null }))
  );
}

export async function POST(request: NextRequest) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const result = await register(body.email || "", body.password || "", body.name || "");

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
