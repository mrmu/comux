import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { syncComuxDir } from "@/lib/sync-comux-dir";
import { isValidRemotePath } from "@/lib/validate";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; id: string }> }
) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, id } = await params;
  const body = await request.json();

  if (body.deploy_type && !["ssh", "cloud-run"].includes(body.deploy_type)) {
    return NextResponse.json({ error: "deploy_type must be ssh or cloud-run" }, { status: 400 });
  }
  if (body.path && !isValidRemotePath(body.path)) {
    return NextResponse.json(
      { error: "path 必須是絕對路徑（/ 或 ~ 開頭），且不含 shell 特殊字元" },
      { status: 400 }
    );
  }
  if (body.machine_id) {
    const machine = await prisma.machine.findUnique({
      where: { id: parseInt(body.machine_id) },
    });
    if (!machine) {
      return NextResponse.json({ error: "machine not found" }, { status: 400 });
    }
  }

  const host = await prisma.host.update({
    where: { id: parseInt(id) },
    data: {
      ...(body.name && { name: body.name }),
      ...(body.ssh_target !== undefined && { sshTarget: body.ssh_target }),
      // machine_id: number sets, null clears, undefined leaves untouched
      ...(body.machine_id !== undefined && {
        machineId: body.machine_id === null ? null : parseInt(body.machine_id),
      }),
      ...(body.path !== undefined && { path: body.path }),
      ...(body.deploy_type && { deployType: body.deploy_type }),
      ...(body.env && { env: body.env }),
      ...(body.description !== undefined && { description: body.description }),
    },
  });

  await syncComuxDir(name);
  return NextResponse.json(host);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; id: string }> }
) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, id } = await params;
  await prisma.host.delete({ where: { id: parseInt(id) } });
  await syncComuxDir(name);
  return NextResponse.json({ ok: true });
}
