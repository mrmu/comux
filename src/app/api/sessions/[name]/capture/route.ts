import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import * as tmux from "@/lib/tmux";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const content = await tmux.capturePane(name, 32768);
  return NextResponse.json({ content });
}
