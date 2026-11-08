import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getProjectCwd } from "@/lib/project-cwd";
import * as tmux from "@/lib/tmux";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const windows = await tmux.listWindows(name);
  return NextResponse.json(windows);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const body = await request.json();
  // Default to the project's working directory
  const cwd = body.cwd || (await getProjectCwd(name)) || undefined;
  const window = await tmux.createWindow(name, body.name || "shell", cwd);
  return NextResponse.json(window);
}
