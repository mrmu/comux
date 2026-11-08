import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

const VALID_NOTE_STATUSES = new Set(["OPEN", "IN_PROGRESS", "AWAITING", "DONE"]);

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  const data: {
    content?: string;
    status?: string;
    issueId?: number | null;
    prUrl?: string;
  } = {};
  if (typeof body.content === "string") data.content = body.content;
  if (typeof body.status === "string" && VALID_NOTE_STATUSES.has(body.status))
    data.status = body.status;
  if (body.issue_id === null || typeof body.issue_id === "number")
    data.issueId = body.issue_id;
  if (typeof body.pr_url === "string") data.prUrl = body.pr_url;

  await prisma.note.update({ where: { id: parseInt(id) }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await prisma.note.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ ok: true });
}
