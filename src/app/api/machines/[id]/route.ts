import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isValidSshUser } from "@/lib/validate";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  const sshUser = body.ssh_user !== undefined ? String(body.ssh_user).trim() : undefined;
  if (sshUser && !isValidSshUser(sshUser)) {
    return NextResponse.json({ error: "ssh user 格式不正確" }, { status: 400 });
  }

  const machine = await prisma.machine.update({
    where: { id: parseInt(id) },
    data: {
      ...(sshUser !== undefined && { sshUser }),
      ...(body.note !== undefined && { note: String(body.note) }),
    },
  });
  return NextResponse.json(machine);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const machineId = parseInt(id);

  const refs = await prisma.host.count({ where: { machineId } });
  if (refs > 0) {
    return NextResponse.json(
      { error: `還有 ${refs} 個專案部署主機指向這台機器，請先改掉再刪除。` },
      { status: 409 }
    );
  }

  await prisma.machine.delete({ where: { id: machineId } });
  return NextResponse.json({ ok: true });
}
