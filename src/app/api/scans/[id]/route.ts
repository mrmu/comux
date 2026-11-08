import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

function toUnix(d: Date | null | undefined): number {
  return d ? Math.floor(d.getTime() / 1000) : 0;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const scanId = parseInt(id);
  if (!Number.isFinite(scanId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const scan = await prisma.scanRun.findUnique({
    where: { id: scanId },
  });
  if (!scan) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Findings with lastScanRunId === this run, plus those whose most recent
  // update was this run. We query the full open set for the project and
  // show those touched by this run highlighted — simpler: just return this
  // run's findings as "current" and let UI filter.
  const findings = await prisma.scanFinding.findMany({
    where: { scanRunId: scanId },
    orderBy: [{ severity: "asc" }, { filePath: "asc" }, { line: "asc" }],
  });

  return NextResponse.json({
    id: scan.id,
    project_name: scan.projectName,
    tool: scan.tool,
    tool_version: scan.toolVersion,
    ruleset_ref: scan.rulesetRef,
    commit_sha: scan.commitSha,
    status: scan.status,
    error_message: scan.errorMessage,
    started_at: toUnix(scan.startedAt),
    finished_at: toUnix(scan.finishedAt),
    sarif_path: scan.sarifPath,
    summary: scan.summary,
    findings: findings.map((f) => ({
      id: f.id,
      rule_id: f.ruleId,
      severity: f.severity,
      cwe: f.cwe,
      owasp: f.owasp,
      cvss: f.cvss,
      file_path: f.filePath,
      line: f.line,
      end_line: f.endLine,
      message: f.message,
      fingerprint: f.fingerprint,
      fixed: f.fixed,
      first_seen_at: toUnix(f.firstSeenAt),
      last_seen_at: toUnix(f.lastSeenAt),
      issue_id: f.issueId,
    })),
  });
}
