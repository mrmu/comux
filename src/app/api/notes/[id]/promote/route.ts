import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getCurrentUserEmail } from "@/lib/auth";
import { prisma } from "@/lib/db";

/** Promote a Note into a tracked Issue. The note keeps its row (still a
 *  prompt-candidate) but now has `issueId` so multi-turn conversations can
 *  reference a stable `#N`. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const noteId = parseInt(id);
  const actor = getCurrentUserEmail(request);

  const note = await prisma.note.findUnique({ where: { id: noteId } });
  if (!note) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }
  if (note.issueId) {
    return NextResponse.json(
      { error: "Note is already linked to issue #" + note.issueId },
      { status: 409 }
    );
  }

  // Accept a caller-supplied title so the UI can show a short, editable
  // summary derived from the note's first few sentences. Fall back to
  // first-line-truncated if none was provided. Issue body defaults to
  // empty — the note itself is the content and is surfaced in the issue
  // page's Linked Notes section, so duplicating it here would be churn.
  const reqBody = await request.json().catch(() => ({}));
  const customTitle = typeof reqBody?.title === "string" ? reqBody.title.trim() : "";
  const customBody = typeof reqBody?.body === "string" ? reqBody.body : "";

  const lines = note.content.split("\n");
  const firstLine = lines.find((l) => l.trim()) || "(no title)";
  const title = (customTitle || firstLine.trim()).slice(0, 200);
  const body = customBody;

  const issue = await prisma.issue.create({
    data: {
      projectName: note.sessionName,
      title,
      body,
      severity: "MEDIUM",
      source: "MANUAL",
      createdBy: actor,
      events: {
        create: { actor, action: "created", toValue: "OPEN" },
      },
    },
  });

  await prisma.note.update({
    where: { id: noteId },
    data: { issueId: issue.id },
  });

  return NextResponse.json({ note_id: noteId, issue_id: issue.id });
}
