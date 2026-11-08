import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import * as tmux from "@/lib/tmux";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; index: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, index } = await params;
  await tmux.killWindow(name, parseInt(index));
  return NextResponse.json({ ok: true });
}
