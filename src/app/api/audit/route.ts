import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

const TYPES = new Set([
  "login_success",
  "login_failed",
  "mfa_failed",
  "mfa_enabled",
  "backup_codes_regenerated",
  "backup_code_used",
  "mfa_reset",
  "terminal",
  "ssh",
]);

// 篩選用的群組（前端的分頁標籤）
const GROUPS: Record<string, string[]> = {
  login: ["login_success", "login_failed", "mfa_failed", "backup_code_used"],
  security: ["mfa_enabled", "backup_codes_regenerated", "mfa_reset"],
  ssh: ["ssh"],
  terminal: ["terminal"],
};

/**
 * 稽核紀錄查詢（新到舊）。
 *   ?group=login|security|ssh|terminal  或  ?type=<單一類型>
 *   ?q=<email / 主機 / session 關鍵字>
 *   ?before=<id> 往前翻頁；?limit=1..200（預設 50）
 */
export async function GET(request: NextRequest) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const limit = Math.min(200, Math.max(1, parseInt(sp.get("limit") || "50", 10) || 50));
  const before = parseInt(sp.get("before") || "", 10);
  const type = sp.get("type") || "";
  const group = sp.get("group") || "";
  const q = (sp.get("q") || "").trim().slice(0, 100);

  const types = TYPES.has(type) ? [type] : GROUPS[group] || null;

  const rows = await prisma.auditEvent.findMany({
    where: {
      ...(types ? { type: { in: types } } : {}),
      ...(Number.isFinite(before) ? { id: { lt: before } } : {}),
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { target: { contains: q, mode: "insensitive" } },
              { sessionName: { contains: q, mode: "insensitive" } },
              { ip: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { id: "desc" },
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const events = rows.slice(0, limit);
  return NextResponse.json({
    events,
    nextBefore: hasMore ? events[events.length - 1].id : null,
  });
}
