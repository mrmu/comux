import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getProjectCwd } from "@/lib/project-cwd";
import { listSessionJsonls, getSessionPreview } from "@/lib/jsonl-parser";
import { detectTmuxJsonl } from "@/lib/tmux-jsonl";

/** List all Claude Code JSONL sessions for this project, enriched with the
 *  info the picker UI needs: preview, tmux-active flag, and pin state. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const cwd = await getProjectCwd(name);
  if (!cwd) {
    return NextResponse.json({
      sessions: [],
      pinned: false,
      activeSessionId: "",
      tmuxSessionId: "",
    });
  }

  const project = await prisma.project
    .findUnique({
      where: { name },
      select: { jsonlSessionId: true, jsonlSessionPinned: true },
    })
    .catch(() => null);

  const tmuxSessionId = await detectTmuxJsonl(name, cwd);

  const sessions = listSessionJsonls(cwd).map((s) => ({
    sessionId: s.sessionId,
    mtime: s.mtime,
    preview: getSessionPreview(s.path),
    active: s.sessionId === project?.jsonlSessionId,
    tmuxActive: s.sessionId === tmuxSessionId,
  }));

  return NextResponse.json({
    sessions,
    pinned: project?.jsonlSessionPinned || false,
    activeSessionId: project?.jsonlSessionId || "",
    tmuxSessionId: tmuxSessionId || "",
  });
}

/** Pin a specific session (body: { sessionId }) or unpin (body: { unpin: true }). */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const body = await request.json();

  if (body.unpin) {
    await prisma.project.update({
      where: { name },
      data: { jsonlSessionPinned: false },
    });
    return NextResponse.json({ ok: true, pinned: false });
  }

  const sessionId = body.sessionId || "";
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  await prisma.project.update({
    where: { name },
    data: { jsonlSessionId: sessionId, jsonlSessionPinned: true },
  });
  return NextResponse.json({ ok: true, pinned: true, sessionId });
}
