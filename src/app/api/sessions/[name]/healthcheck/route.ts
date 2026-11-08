import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getProjectsRoot } from "@/lib/settings";
import { runHealthChecks } from "@/lib/healthcheck";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const project = await prisma.project.findUnique({
    where: { name },
    select: { name: true, cwd: true, repoUrl: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const projectsRoot = await getProjectsRoot();
  const checks = await runHealthChecks({
    projectName: project.name,
    cwd: project.cwd,
    repoUrl: project.repoUrl,
    projectsRoot,
  });

  return NextResponse.json({ checks });
}
