import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import * as tmux from "@/lib/tmux";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const body = await request.json();
  const text = body.text || "";
  const specialKey = body.special_key || null;

  if (specialKey) {
    await tmux.sendSpecialKey(name, specialKey);
  } else if (text) {
    if (body.paste) {
      // Bracketed paste — lands in the TUI input without auto-submitting
      await tmux.pasteText(name, text);
    } else if (body.raw) {
      await tmux.sendRawKeys(name, text);
    } else {
      await tmux.sendKeys(name, text);
    }
  }

  return NextResponse.json({ ok: true });
}
