import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { classifyRepoUrl, inspectCwd } from "@/lib/git";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const project = await prisma.project.findUnique({
    where: { name },
    select: { cwd: true, repoUrl: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const repoUrlKind = classifyRepoUrl(project.repoUrl);
  const cwd = project.cwd || "";
  const status = cwd
    ? await inspectCwd(cwd, project.repoUrl)
    : {
        cwdExists: false,
        isDirectory: false,
        isEmpty: false,
        isGitRepo: false,
        remoteUrl: "",
        remoteMatches: null as boolean | null,
      };

  return NextResponse.json({
    cwd,
    repoUrl: project.repoUrl,
    repoUrlKind,
    ...status,
  });
}
