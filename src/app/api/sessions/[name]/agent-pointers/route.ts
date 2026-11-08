import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getProjectCwd } from "@/lib/project-cwd";
import {
  AGENT_POINTER_TARGETS,
  COMUX_POINTER_BLOCK,
  ensurePointer,
  readPointerStatus,
} from "@/lib/sync-comux-dir";

/** Report pointer status for every well-known agent-context file. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const cwd = await getProjectCwd(name);
  if (!cwd) {
    return NextResponse.json(
      { error: "Project working directory not set" },
      { status: 404 }
    );
  }

  const targets = AGENT_POINTER_TARGETS.map((t) => ({
    ...t,
    ...readPointerStatus(cwd, t.filename),
  }));
  // Include the pointer block itself so the UI can preview exactly what gets
  // appended when the user clicks "Add pointer" — no guessing, no drift.
  return NextResponse.json({ targets, pointer_block: COMUX_POINTER_BLOCK });
}

/** Add the pointer block to each target listed in `body.targets`.
 *  Filenames must be on the AGENT_POINTER_TARGETS allowlist — otherwise
 *  arbitrary paths under cwd could be written. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const body = await request.json().catch(() => ({}));
  const requested: string[] = Array.isArray(body?.targets) ? body.targets : [];

  const allowed = new Set<string>(AGENT_POINTER_TARGETS.map((t) => t.filename));
  const targets = requested.filter((f) => allowed.has(f));
  if (targets.length === 0) {
    return NextResponse.json(
      { error: "No valid targets supplied" },
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

  const results = targets.map((filename) => {
    try {
      return { filename, ...ensurePointer(cwd, filename) };
    } catch (e) {
      return { filename, ok: false, error: (e as Error).message };
    }
  });
  return NextResponse.json({ results });
}
