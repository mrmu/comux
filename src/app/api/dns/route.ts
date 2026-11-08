import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import * as cf from "@/lib/cloudflare";

export async function GET(request: NextRequest) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!cf.isConfigured()) {
    return NextResponse.json({
      configured: false,
      records: [],
    });
  }

  try {
    const records = await cf.listDnsRecords();
    return NextResponse.json({ configured: true, records });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!cf.isConfigured()) {
    return NextResponse.json(
      { error: "Cloudflare not configured (CF_API_TOKEN, CF_ZONE_ID)" },
      { status: 400 }
    );
  }

  const body = await request.json();
  const { subdomain, ip, type, proxied } = body;

  if (!subdomain || !ip) {
    return NextResponse.json(
      { error: "subdomain and ip are required" },
      { status: 400 }
    );
  }

  try {
    const record = await cf.createDnsRecord(
      subdomain,
      ip,
      type || "A",
      proxied || false
    );
    return NextResponse.json(record);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
