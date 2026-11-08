import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getProjectCwd } from "@/lib/project-cwd";
import { readFile, writeFile } from "@/lib/file-manager";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const filePath = request.nextUrl.searchParams.get("path") || "";

  if (!filePath) {
    return NextResponse.json(
      { error: "path parameter is required" },
      { status: 400 }
    );
  }

  const cwd = await getProjectCwd(name);
  if (!cwd) {
    return NextResponse.json(
      { error: "Project working directory not set" },
      { status: 404 }
    );
  }

  try {
    const result = readFile(cwd, filePath);
    return NextResponse.json(result);
  } catch (e) {
    const msg = (e as Error).message;
    const status = msg.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const body = await request.json();
  const filePath = body.path || "";
  const content = body.content || "";

  if (!filePath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const cwd = await getProjectCwd(name);
  if (!cwd) {
    return NextResponse.json(
      { error: "Project working directory not set" },
      { status: 404 }
    );
  }

  try {
    const result = writeFile(cwd, filePath, content);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 }
    );
  }
}
