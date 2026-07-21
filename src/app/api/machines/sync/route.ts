import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { syncMachinesFromTailscale, getSelfMachine, serializeMachine } from "@/lib/machines";

export async function POST(request: NextRequest) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { machines, discovered } = await syncMachinesFromTailscale();
    const self = await getSelfMachine();
    return NextResponse.json({
      ok: true,
      self,
      // Live tailnet nodes NOT in the registry — shown to the user for
      // opt-in import, never persisted here.
      discovered: discovered.map((d) => ({
        hostname: d.hostname,
        os: d.os,
        online: d.online,
        tailscale_ip: d.ip,
        tags: d.tags,
      })),
      machines: machines.map(serializeMachine),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
