import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { syncMachinesFromTailscale, getSelfMachine } from "@/lib/machines";

export async function POST(request: NextRequest) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const machines = await syncMachinesFromTailscale();
    const self = await getSelfMachine();
    return NextResponse.json({
      ok: true,
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
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
