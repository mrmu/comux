import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { syncComuxDir } from "@/lib/sync-comux-dir";
import { isValidRemotePath } from "@/lib/validate";

const DEPLOY_TYPES = ["ssh", "cloud-run"];

function serializeHost(h: {
  id: number; name: string; sshTarget: string; machineId: number | null;
  path: string; deployType: string; env: string; description: string;
  machine?: { id: number; hostname: string; sshUser: string; online: boolean; isSelf: boolean } | null;
}) {
  return {
    id: h.id,
    name: h.name,
    ssh_target: h.sshTarget,
    machine_id: h.machineId,
    path: h.path,
    deploy_type: h.deployType,
    env: h.env,
    description: h.description,
    machine: h.machine
      ? {
          id: h.machine.id,
          hostname: h.machine.hostname,
          ssh_user: h.machine.sshUser,
          online: h.machine.online,
          is_self: h.machine.isSelf,
        }
      : null,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const hosts = await prisma.host.findMany({
    where: { projectName: name },
    include: { machine: true },
    orderBy: { env: "asc" },
  });
  return NextResponse.json(hosts.map(serializeHost));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const body = await request.json();

  const machineId = body.machine_id ? parseInt(body.machine_id) : null;
  const deployType = body.deploy_type || "ssh";

  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!DEPLOY_TYPES.includes(deployType)) {
    return NextResponse.json({ error: "deploy_type must be ssh or cloud-run" }, { status: 400 });
  }
  // ssh hosts need a target: either a registry machine or a legacy free-text
  // ssh_target. cloud-run hosts deploy from the dev machine via gcloud.
  if (deployType === "ssh" && !machineId && !body.ssh_target) {
    return NextResponse.json(
      { error: "machine_id or ssh_target is required for ssh hosts" },
      { status: 400 }
    );
  }
  if (body.path && !isValidRemotePath(body.path)) {
    return NextResponse.json(
      { error: "path 必須是絕對路徑（/ 或 ~ 開頭），且不含 shell 特殊字元" },
      { status: 400 }
    );
  }
  if (machineId) {
    const machine = await prisma.machine.findUnique({ where: { id: machineId } });
    if (!machine) {
      return NextResponse.json({ error: "machine not found — 先到站點管理同步" }, { status: 400 });
    }
  }

  await prisma.project.upsert({
    where: { name },
    update: {},
    create: { name, displayName: name },
  });

  const host = await prisma.host.create({
    data: {
      projectName: name,
      name: body.name,
      sshTarget: body.ssh_target || "",
      machineId,
      path: body.path || "",
      deployType,
      env: body.env || "production",
      description: body.description || "",
    },
    include: { machine: true },
  });

  await syncComuxDir(name);

  return NextResponse.json(serializeHost(host));
}
