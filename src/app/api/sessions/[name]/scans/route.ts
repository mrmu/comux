import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getProjectCwd } from "@/lib/project-cwd";
import { runSemgrep, getCurrentCommitSha, SEMGREP_CONFIG } from "@/lib/semgrep";

function toUnix(d: Date | null | undefined): number {
  return d ? Math.floor(d.getTime() / 1000) : 0;
}

// Run the scan in the background after responding — semgrep takes 1–5 min
// and we don't want the UI to block. On completion, dedup findings by
// fingerprint: existing ones get their lastSeenAt bumped, new ones inserted,
// and findings not present this run are marked fixed.
async function executeScanBackground(scanRunId: number, projectName: string, cwd: string) {
  try {
    const result = await runSemgrep(cwd, scanRunId);

    if (!result.success) {
      await prisma.scanRun.update({
        where: { id: scanRunId },
        data: {
          status: "FAILED",
          errorMessage: result.errorMessage,
          finishedAt: new Date(),
          sarifPath: result.sarifPath,
          toolVersion: result.toolVersion,
        },
      });
      return;
    }

    const existing = await prisma.scanFinding.findMany({
      where: { projectName, fixed: false },
      select: { id: true, fingerprint: true },
    });
    const existingByFp = new Map(existing.map((e) => [e.fingerprint, e.id]));
    const seenFp = new Set<string>();

    for (const f of result.findings) {
      // Semgrep occasionally emits the same rule+file+line twice; our
      // fingerprint collapses those to one, so skip the repeat within a run.
      if (seenFp.has(f.fingerprint)) continue;
      seenFp.add(f.fingerprint);
      const existingId = existingByFp.get(f.fingerprint);
      if (existingId) {
        await prisma.scanFinding.update({
          where: { id: existingId },
          data: {
            scanRunId,
            lastSeenAt: new Date(),
            severity: f.severity,
            message: f.message,
            line: f.line,
            endLine: f.endLine,
            filePath: f.filePath,
            cwe: f.cwe,
            owasp: f.owasp,
            cvss: f.cvss,
          },
        });
      } else {
        await prisma.scanFinding.create({
          data: {
            scanRunId,
            projectName,
            ruleId: f.ruleId,
            severity: f.severity,
            cwe: f.cwe,
            owasp: f.owasp,
            cvss: f.cvss,
            filePath: f.filePath,
            line: f.line,
            endLine: f.endLine,
            message: f.message,
            fingerprint: f.fingerprint,
          },
        });
      }
    }

    // Mark previously-open findings that didn't appear this run as fixed.
    for (const e of existing) {
      if (!seenFp.has(e.fingerprint)) {
        await prisma.scanFinding.update({
          where: { id: e.id },
          data: { fixed: true },
        });
      }
    }

    await prisma.scanRun.update({
      where: { id: scanRunId },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        sarifPath: result.sarifPath,
        toolVersion: result.toolVersion,
        summary: result.summary,
      },
    });
  } catch (err) {
    await prisma.scanRun.update({
      where: { id: scanRunId },
      data: {
        status: "FAILED",
        errorMessage: (err as Error).message.slice(0, 500),
        finishedAt: new Date(),
      },
    });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const runs = await prisma.scanRun.findMany({
    where: { projectName: name },
    orderBy: { startedAt: "desc" },
    take: 30,
  });

  return NextResponse.json(
    runs.map((r) => ({
      id: r.id,
      tool: r.tool,
      tool_version: r.toolVersion,
      ruleset_ref: r.rulesetRef,
      commit_sha: r.commitSha,
      status: r.status,
      error_message: r.errorMessage,
      started_at: toUnix(r.startedAt),
      finished_at: toUnix(r.finishedAt),
      summary: r.summary,
    }))
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const cwd = await getProjectCwd(name);
  if (!cwd) {
    return NextResponse.json({ error: "project cwd not set" }, { status: 400 });
  }

  const commitSha = await getCurrentCommitSha(cwd);

  const scanRun = await prisma.scanRun.create({
    data: {
      projectName: name,
      tool: "semgrep",
      rulesetRef: SEMGREP_CONFIG,
      commitSha,
      status: "RUNNING",
    },
  });

  // Fire-and-forget — the background task will write status=SUCCESS|FAILED
  // when done. The client polls GET to see progress.
  executeScanBackground(scanRun.id, name, cwd).catch(() => {
    /* already logs to DB */
  });

  return NextResponse.json({ id: scanRun.id, status: "RUNNING" });
}
