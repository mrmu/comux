import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getCurrentUserEmail } from "@/lib/auth";
import { prisma } from "@/lib/db";

function issueSeverity(severity: string): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (severity === "CRITICAL" || severity === "HIGH" || severity === "MEDIUM") {
    return severity;
  }
  return "LOW";
}

function ruleShortName(ruleId: string): string {
  return ruleId.split(".").pop() || ruleId;
}

function buildIssueBody(finding: {
  ruleId: string;
  severity: string;
  cwe: string;
  owasp: string;
  cvss: number | null;
  filePath: string;
  line: number;
  endLine: number;
  message: string;
  fingerprint: string;
}) {
  const loc =
    finding.endLine && finding.endLine !== finding.line
      ? `${finding.filePath}:${finding.line}-${finding.endLine}`
      : `${finding.filePath}:${finding.line}`;

  return [
    "## 弱掃發現",
    "",
    `- 工具：Semgrep`,
    `- 規則：${finding.ruleId}`,
    `- 位置：${loc}`,
    `- 嚴重度：${finding.severity}`,
    finding.cwe ? `- CWE：${finding.cwe}` : "",
    finding.owasp ? `- OWASP：${finding.owasp}` : "",
    finding.cvss !== null ? `- CVSS：${finding.cvss}` : "",
    `- Fingerprint：${finding.fingerprint}`,
    "",
    "## 原始訊息",
    "",
    finding.message,
    "",
    "## 建議處理",
    "",
    "請先確認是否為有效風險，再依程式語意修正。修正後需重新執行測試與 Semgrep 掃描，確認 finding 不再出現。",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAuth(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const scanId = parseInt(id);
  if (!Number.isFinite(scanId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = await request.json();
  const rawFindingIds: number[] = Array.isArray(body.finding_ids)
    ? body.finding_ids
        .map((v: unknown) => Number(v))
        .filter((v: number) => Number.isFinite(v))
    : [];
  const findingIds = Array.from(new Set(rawFindingIds));

  if (findingIds.length === 0) {
    return NextResponse.json({ error: "finding_ids is required" }, { status: 400 });
  }

  const scan = await prisma.scanRun.findUnique({ where: { id: scanId } });
  if (!scan) {
    return NextResponse.json({ error: "scan not found" }, { status: 404 });
  }

  const actor = getCurrentUserEmail(request);
  const findings = await prisma.scanFinding.findMany({
    where: {
      id: { in: findingIds },
      scanRunId: scanId,
      fixed: false,
    },
  });

  const created: Array<{ finding_id: number; issue_id: number }> = [];
  const skipped: Array<{ finding_id: number; reason: string; issue_id?: number }> = [];
  const foundIds = new Set(findings.map((f) => f.id));

  for (const id of findingIds) {
    if (!foundIds.has(id)) skipped.push({ finding_id: id, reason: "not_found_or_fixed" });
  }

  for (const finding of findings) {
    if (finding.issueId) {
      skipped.push({
        finding_id: finding.id,
        reason: "already_promoted",
        issue_id: finding.issueId,
      });
      continue;
    }

    const loc = `${finding.filePath}:${finding.line}`;
    const title = `[Semgrep] ${ruleShortName(finding.ruleId)} at ${loc}`;
    const sourceRef = `semgrep:${finding.ruleId}:${finding.fingerprint}`;

    const issue = await prisma.$transaction(async (tx) => {
      const createdIssue = await tx.issue.create({
        data: {
          projectName: scan.projectName,
          title,
          body: buildIssueBody(finding),
          severity: issueSeverity(finding.severity),
          source: "SCAN",
          sourceRef,
          createdBy: actor,
          events: {
            create: {
              actor,
              action: "created",
              toValue: "OPEN",
              note: `Created from Semgrep finding ${finding.fingerprint}`,
            },
          },
        },
      });

      await tx.scanFinding.update({
        where: { id: finding.id },
        data: { issueId: createdIssue.id },
      });

      return createdIssue;
    });

    created.push({ finding_id: finding.id, issue_id: issue.id });
  }

  return NextResponse.json({ created, skipped });
}
