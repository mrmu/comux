import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getSelfMachine } from "@/lib/machines";

/** Lightweight "which machine am I on" for the header badge. */
export async function GET(request: NextRequest) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(await getSelfMachine());
}
