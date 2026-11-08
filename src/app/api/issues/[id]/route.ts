import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getCurrentUserEmail } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  ISSUE_STATUSES,
  ISSUE_SEVERITIES,
  RESOLUTION_TYPES,
  isClosedStatus,
} from "@/lib/issues";

function toUnix(d: Date | null | undefined): number {
  return d ? Math.floor(d.getTime() / 1000) : 0;
}

type IssueRow = {
  id: number;
  projectName: string;
  title: string;
  body: string;
  status: string;
  severity: string;
  source: string;
  sourceRef: string;
  assignedTo: string;
  sessionName: string;
  resolutionType: string;
  resolutionRef: string;
  resolutionNote: string;
  resolvedBy: string;
  resolvedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

function serialize(issue: IssueRow) {
  return {
    id: issue.id,
    project_name: issue.projectName,
    title: issue.title,
    body: issue.body,
    status: issue.status,
    severity: issue.severity,
    source: issue.source,
    source_ref: issue.sourceRef,
    assigned_to: issue.assignedTo,
    session_name: issue.sessionName,
    resolution_type: issue.resolutionType,
    resolution_ref: issue.resolutionRef,
    resolution_note: issue.resolutionNote,
    resolved_by: issue.resolvedBy,
    resolved_at: toUnix(issue.resolvedAt),
    created_by: issue.createdBy,
    created_at: toUnix(issue.createdAt),
    updated_at: toUnix(issue.updatedAt),
    deleted_at: toUnix(issue.deletedAt),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const issueId = parseInt(id);
  if (!Number.isFinite(issueId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    include: { events: { orderBy: { createdAt: "asc" } } },
  });

  if (!issue) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...serialize(issue),
    events: issue.events.map((e) => ({
      id: e.id,
      actor: e.actor,
      action: e.action,
      from_value: e.fromValue,
      to_value: e.toValue,
      note: e.note,
      created_at: toUnix(e.createdAt),
    })),
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const issueId = parseInt(id);
  if (!Number.isFinite(issueId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const actor = getCurrentUserEmail(request);
  const body = await request.json();
  const existing = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!existing || existing.deletedAt) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Validate incoming enum-like fields if provided.
  if (body.status !== undefined && !(ISSUE_STATUSES as readonly string[]).includes(body.status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }
  if (body.severity !== undefined && !(ISSUE_SEVERITIES as readonly string[]).includes(body.severity)) {
    return NextResponse.json({ error: "invalid severity" }, { status: 400 });
  }
  if (body.resolution_type && !(RESOLUTION_TYPES as readonly string[]).includes(body.resolution_type)) {
    return NextResponse.json({ error: "invalid resolution_type" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  const events: {
    actor: string;
    action: string;
    fromValue?: string;
    toValue?: string;
    note?: string;
  }[] = [];

  if (body.title !== undefined && body.title !== existing.title) {
    data.title = body.title;
  }
  if (body.body !== undefined && body.body !== existing.body) {
    data.body = body.body;
  }
  if (body.severity !== undefined && body.severity !== existing.severity) {
    data.severity = body.severity;
    events.push({
      actor,
      action: "severity_changed",
      fromValue: existing.severity,
      toValue: body.severity,
    });
  }
  if (body.assigned_to !== undefined && body.assigned_to !== existing.assignedTo) {
    data.assignedTo = body.assigned_to;
    events.push({
      actor,
      action: "assigned",
      fromValue: existing.assignedTo,
      toValue: body.assigned_to,
    });
  }
  if (body.session_name !== undefined && body.session_name !== existing.sessionName) {
    data.sessionName = body.session_name;
  }

  // Status change — the interesting case. Closing requires a resolutionType,
  // and either a reference (commit/PR) or a written note. This is what gives
  // the audit trail real meaning: "why was this closed?"
  if (body.status !== undefined && body.status !== existing.status) {
    const nowClosing = isClosedStatus(body.status) && !isClosedStatus(existing.status);
    const reopening = !isClosedStatus(body.status) && isClosedStatus(existing.status);

    if (nowClosing) {
      const resolutionType = body.resolution_type || "";
      const resolutionRef = body.resolution_ref || "";
      const resolutionNote = body.resolution_note || "";
      if (!resolutionType) {
        return NextResponse.json(
          { error: "resolution_type is required when closing an issue" },
          { status: 400 }
        );
      }
      if (!resolutionRef && !resolutionNote) {
        return NextResponse.json(
          { error: "resolution_ref or resolution_note is required when closing" },
          { status: 400 }
        );
      }
      data.resolutionType = resolutionType;
      data.resolutionRef = resolutionRef;
      data.resolutionNote = resolutionNote;
      data.resolvedBy = actor;
      data.resolvedAt = new Date();
    }

    if (reopening) {
      data.resolutionType = "";
      data.resolutionRef = "";
      data.resolutionNote = "";
      data.resolvedBy = "";
      data.resolvedAt = null;
    }

    data.status = body.status;
    events.push({
      actor,
      action: reopening ? "reopened" : "status_changed",
      fromValue: existing.status,
      toValue: body.status,
      note: nowClosing
        ? `${body.resolution_type}${body.resolution_ref ? `: ${body.resolution_ref}` : ""}`
        : "",
    });
  }

  if (body.comment) {
    events.push({ actor, action: "commented", note: body.comment });
  }

  if (Object.keys(data).length === 0 && events.length === 0) {
    return NextResponse.json({ error: "no changes" }, { status: 400 });
  }

  const updated = await prisma.issue.update({
    where: { id: issueId },
    data: {
      ...data,
      events: events.length ? { create: events } : undefined,
    },
  });

  return NextResponse.json(serialize(updated));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const issueId = parseInt(id);
  if (!Number.isFinite(issueId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const actor = getCurrentUserEmail(request);
  await prisma.issue.update({
    where: { id: issueId },
    data: {
      deletedAt: new Date(),
      events: { create: { actor, action: "deleted" } },
    },
  });

  return NextResponse.json({ ok: true });
}
