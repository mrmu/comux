import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getMfaStatus } from "@/lib/mfa";

export async function GET(request: NextRequest) {
  const session = await getAuthenticatedUser(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getMfaStatus(session.userId));
}
