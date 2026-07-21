import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { importMachines, listMachines, serializeMachine } from "@/lib/machines";
import { isValidHostname } from "@/lib/validate";

/** Opt-in import of tailnet machines the user selected from the discover
 *  list. Only hostnames actually present in the live tailnet get created. */
export async function POST(request: NextRequest) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const hostnames: string[] = Array.isArray(body.hostnames) ? body.hostnames : [];
  if (hostnames.length === 0) {
    return NextResponse.json({ error: "hostnames is required" }, { status: 400 });
  }
  if (!hostnames.every((h) => typeof h === "string" && isValidHostname(h))) {
    return NextResponse.json({ error: "hostname 格式不正確" }, { status: 400 });
  }

  try {
    const imported = await importMachines(hostnames);
    const machines = await listMachines();
    return NextResponse.json({
      ok: true,
      imported,
      machines: machines.map(serializeMachine),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
