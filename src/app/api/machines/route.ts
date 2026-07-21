import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listMachines, getSelfMachine } from "@/lib/machines";
import { isValidHostname, isValidSshUser } from "@/lib/validate";

export async function GET(request: NextRequest) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [machines, self] = await Promise.all([listMachines(), getSelfMachine()]);
  return NextResponse.json({
    self,
    machines: machines.map((m) => ({
      id: m.id,
      hostname: m.hostname,
      display_name: m.displayName,
      dns_name: m.dnsName,
      tailscale_ip: m.tailscaleIp,
      os: m.os,
      ssh_user: m.sshUser,
      note: m.note,
      online: m.online,
      is_self: m.isSelf,
      source: m.source,
      last_seen_at: m.lastSeenAt,
    })),
  });
}

/** Manual add — for machines outside the tailnet (rare, but keeps the
 *  registry complete when e.g. a legacy VM is reached via plain ssh). */
export async function POST(request: NextRequest) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const hostname = (body.hostname || "").trim();
  const sshUser = (body.ssh_user || "").trim();

  if (!isValidHostname(hostname)) {
    return NextResponse.json(
      { error: "hostname 格式不正確（僅限字母、數字、點、連字號）" },
      { status: 400 }
    );
  }
  if (sshUser && !isValidSshUser(sshUser)) {
    return NextResponse.json({ error: "ssh user 格式不正確" }, { status: 400 });
  }

  const existing = await prisma.machine.findUnique({ where: { hostname } });
  if (existing) {
    return NextResponse.json({ error: "這個 hostname 已存在" }, { status: 409 });
  }

  const machine = await prisma.machine.create({
    data: {
      hostname,
      displayName: hostname,
      sshUser,
      note: body.note || "",
      source: "manual",
    },
  });
  return NextResponse.json(machine);
}
