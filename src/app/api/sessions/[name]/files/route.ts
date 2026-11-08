import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getProjectCwd } from "@/lib/project-cwd";
import { listDirectory } from "@/lib/file-manager";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const relPath = request.nextUrl.searchParams.get("path") || ".";

  const cwd = await getProjectCwd(name);
  if (!cwd) {
    return NextResponse.json(
      { error: "Project working directory not set" },
      { status: 404 }
    );
  }

  try {
    const entries = listDirectory(cwd, relPath);
    return NextResponse.json(entries);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 }
    );
  }
}
