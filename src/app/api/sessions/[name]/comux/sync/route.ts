import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { syncComuxDir } from "@/lib/sync-comux-dir";

/** Regenerate auto files (README.md / project.md / hosts.md) from DB.
 *  deploy.md / test.md are user-owned and not touched — edit them via
 *  /api/sessions/[name]/comux/docs (or directly on disk). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  await syncComuxDir(name);
  return NextResponse.json({ ok: true });
}
