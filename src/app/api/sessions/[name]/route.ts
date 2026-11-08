import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import * as tmux from "@/lib/tmux";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const keepData = new URL(request.url).searchParams.get("keep") === "true";

  // Kill tmux session
  await tmux.killSession(name).catch(() => {});

  // Also remove from DB unless ?keep=true
  if (!keepData) {
    await prisma.project.delete({ where: { name } }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
