import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getSetting, setSetting } from "@/lib/settings";

export async function GET(request: NextRequest) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectsRoot = await getSetting("projectsRoot");
  const localHost = await getSetting("localHost");
  return NextResponse.json({ projectsRoot, localHost });
}

export async function PUT(request: NextRequest) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  if (body.projectsRoot !== undefined) {
    await setSetting("projectsRoot", body.projectsRoot);
  }
  if (body.localHost !== undefined) {
    await setSetting("localHost", body.localHost);
  }
  return NextResponse.json({ ok: true });
}
