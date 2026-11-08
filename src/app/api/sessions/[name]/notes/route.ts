import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

type NoteRow = {
  id: number;
  content: string;
  status: string;
  issueId: number | null;
  prUrl: string;
  createdAt: Date;
  updatedAt: Date;
  _count?: { exchanges: number };
};

function serialize(n: NoteRow) {
  return {
    id: n.id,
    content: n.content,
    status: n.status,
    issue_id: n.issueId,
    pr_url: n.prUrl,
    exchange_count: n._count?.exchanges ?? 0,
    created_at: Math.floor(n.createdAt.getTime() / 1000),
    updated_at: Math.floor(n.updatedAt.getTime() / 1000),
  };
}

export const VALID_NOTE_STATUSES = ["OPEN", "IN_PROGRESS", "AWAITING", "DONE"] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const notes = await prisma.note.findMany({
    where: { sessionName: name },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { exchanges: true } } },
  });
  return NextResponse.json(notes.map(serialize));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const body = await request.json();
  const content = (body.content || "").trim();

  if (!content) {
    return NextResponse.json(
      { error: "Note content is required" },
      { status: 400 }
    );
  }

  // Ensure project exists
  await prisma.project.upsert({
    where: { name },
    update: {},
    create: { name, displayName: name },
  });

  const note = await prisma.note.create({
    data: {
      sessionName: name,
      content,
      ...(typeof body.issue_id === "number" && { issueId: body.issue_id }),
    },
  });

  return NextResponse.json(serialize(note));
}
