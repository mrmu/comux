import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getProjectCwd } from "@/lib/project-cwd";
import { extractNoteExchanges } from "@/lib/extract-note-exchanges";

/** Notes linked to this issue, each with its captured AI exchanges so the
 *  issue page can show the full Q&A history at a glance. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const issueId = parseInt(id);

  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue) return NextResponse.json([], { status: 200 });

  // Refresh exchanges for this project before reading so the response is
  // up-to-date (cheap; extraction is upsert/idempotent).
  const cwd = await getProjectCwd(issue.projectName);
  if (cwd) await extractNoteExchanges(cwd).catch(() => {});

  const notes = await prisma.note.findMany({
    where: { issueId },
    include: { exchanges: { orderBy: { askedAt: "asc" } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(
    notes.map((n) => ({
      id: n.id,
      content: n.content,
      status: n.status,
      pr_url: n.prUrl,
      created_at: Math.floor(n.createdAt.getTime() / 1000),
      updated_at: Math.floor(n.updatedAt.getTime() / 1000),
      exchanges: n.exchanges.map((e) => ({
        id: e.id,
        session_id: e.sessionId,
        asked_at: Math.floor(e.askedAt.getTime() / 1000),
        prompt: e.prompt,
        reply: e.reply,
      })),
    }))
  );
}
