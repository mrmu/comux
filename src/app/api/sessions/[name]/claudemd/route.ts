import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getProjectCwd } from "@/lib/project-cwd";
import fs from "fs";
import path from "path";

/** Keywords that indicate a deploy-related section in CLAUDE.md */
const DEPLOY_KEYWORDS = [
  "deploy", "部署", "staging", "production",
  "docker compose", "ssh", "rollback", "ci/cd",
];

function extractSections(content: string): { title: string; body: string }[] {
  const sections: { title: string; body: string }[] = [];
  const lines = content.split("\n");
  let currentTitle = "";
  let currentBody: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      if (currentTitle) {
        sections.push({ title: currentTitle, body: currentBody.join("\n").trim() });
      }
      currentTitle = headingMatch[1];
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  if (currentTitle) {
    sections.push({ title: currentTitle, body: currentBody.join("\n").trim() });
  }
  return sections;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const cwd = await getProjectCwd(name);
  if (!cwd) {
    return NextResponse.json({ exists: false, hasDeploy: false, sections: [] });
  }

  const claudePath = path.join(cwd, "CLAUDE.md");
  if (!fs.existsSync(claudePath)) {
    return NextResponse.json({ exists: false, hasDeploy: false, sections: [] });
  }

  let content: string;
  try {
    content = fs.readFileSync(claudePath, "utf-8");
  } catch {
    return NextResponse.json({ exists: false, hasDeploy: false, sections: [] });
  }

  const sections = extractSections(content);

  // Find deploy-related sections
  const deploySections = sections.filter((s) => {
    const text = (s.title + " " + s.body).toLowerCase();
    return DEPLOY_KEYWORDS.some((kw) => text.includes(kw));
  });

  return NextResponse.json({
    exists: true,
    hasDeploy: deploySections.length > 0,
    deploySections: deploySections.map((s) => ({
      title: s.title,
      body: s.body,
    })),
    allSections: sections.map((s) => s.title),
  });
}
