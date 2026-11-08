import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getProjectCwd } from "@/lib/project-cwd";
import { extractNoteExchanges } from "@/lib/extract-note-exchanges";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const noteId = parseInt(id);

  const note = await prisma.note.findUnique({ where: { id: noteId } });
  if (!note) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  // Fire a fresh extraction pass before returning — this is the "catch up"
  // path that covers everything that landed while no SSE stream was open.
  const cwd = await getProjectCwd(note.sessionName);
  if (cwd) {
    await extractNoteExchanges(cwd).catch(() => { /* non-fatal */ });
  }

  const rows = await prisma.noteExchange.findMany({
    where: { noteId },
    orderBy: { askedAt: "desc" },
  });

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      session_id: r.sessionId,
      asked_at: Math.floor(r.askedAt.getTime() / 1000),
      prompt: r.prompt,
      reply: r.reply,
    }))
  );
}
