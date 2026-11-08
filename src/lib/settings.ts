import os from "os";
import path from "path";
import { prisma } from "./db";

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  return row?.value || null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function getProjectsRoot(): Promise<string> {
  return (
    (await getSetting("projectsRoot")) ||
    process.env.PROJECTS_ROOT ||
    path.join(process.env.HOME || os.homedir(), "projects")
  );
}

/** Roots a project's cwd is allowed to live under: PROJECTS_ROOT plus the
 *  directory comux itself runs from (`process.cwd()`), so the comux
 *  self-managed project can sit in e.g. `/home/deploy/comux` while the
 *  shared projects root is `/home/deploy/projects`. */
export async function getAllowedCwdRoots(): Promise<string[]> {
  const projectsRoot = await getProjectsRoot();
  const selfRoot = process.cwd();
  return projectsRoot === selfRoot ? [projectsRoot] : [projectsRoot, selfRoot];
}

export async function isSetupComplete(): Promise<boolean> {
  const userCount = await prisma.user.count().catch(() => 0);
  const root = await getSetting("projectsRoot");
  return userCount > 0 && root !== null;
}
