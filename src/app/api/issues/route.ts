import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getCurrentUserEmail } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  ISSUE_SEVERITIES,
  ISSUE_SOURCES,
} from "@/lib/issues";

function toUnix(d: Date | null | undefined): number {
  return d ? Math.floor(d.getTime() / 1000) : 0;
}

function serialize(issue: {
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
}) {
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

export async function GET(request: NextRequest) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const project = searchParams.get("project") || undefined;
  const statuses = searchParams.getAll("status");
  const severities = searchParams.getAll("severity");
  const assignedTo = searchParams.get("assigned_to") || undefined;
  const includeDeleted = searchParams.get("include_deleted") === "1";

  const where: Record<string, unknown> = {};
  if (project) where.projectName = project;
  if (statuses.length) where.status = { in: statuses };
  if (severities.length) where.severity = { in: severities };
  if (assignedTo) where.assignedTo = assignedTo;
  if (!includeDeleted) where.deletedAt = null;

  const issues = await prisma.issue.findMany({
    where,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json(issues.map(serialize));
}

export async function POST(request: NextRequest) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const actor = getCurrentUserEmail(request);
  const body = await request.json();

  const projectName = (body.project_name || "").trim();
  const title = (body.title || "").trim();
  const content = body.body || "";
  const severity = body.severity || "MEDIUM";
  const source = body.source || "MANUAL";
  const assignedTo = body.assigned_to || "";
  const sessionName = body.session_name || "";
  const sourceRef = body.source_ref || "";

  if (!projectName) {
    return NextResponse.json({ error: "project_name is required" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!(ISSUE_SEVERITIES as readonly string[]).includes(severity)) {
    return NextResponse.json({ error: "invalid severity" }, { status: 400 });
  }
  if (!(ISSUE_SOURCES as readonly string[]).includes(source)) {
    return NextResponse.json({ error: "invalid source" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({ where: { name: projectName } });
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 400 });
  }

  const issue = await prisma.issue.create({
    data: {
      projectName,
      title,
      body: content,
      severity,
      source,
      sourceRef,
      assignedTo,
      sessionName,
      createdBy: actor,
      events: {
        create: {
          actor,
          action: "created",
          toValue: "OPEN",
        },
      },
    },
  });

  return NextResponse.json(serialize(issue));
}
