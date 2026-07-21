import { prisma } from "./db";
import { getTailscaleNodes, osHostname } from "./tailscale";
import type { Machine } from "@/generated/prisma/client";

/** Upsert the Machine registry from the live tailnet. Machines that have
 *  disappeared from the tailnet are kept (hosts may still reference them)
 *  but flagged offline; `lastSeenAt` shows how stale they are. */
export async function syncMachinesFromTailscale(): Promise<Machine[]> {
  const nodes = await getTailscaleNodes();
  const now = new Date();
  const seen = new Set<string>();

  for (const n of nodes) {
    seen.add(n.hostname);
    await prisma.machine.upsert({
      where: { hostname: n.hostname },
      update: {
        displayName: n.displayName,
        dnsName: n.dnsName,
        tailscaleIp: n.ip,
        os: n.os,
        online: n.online,
        isSelf: n.isSelf,
        source: "tailscale",
        lastSeenAt: now,
      },
      create: {
        hostname: n.hostname,
        displayName: n.displayName,
        dnsName: n.dnsName,
        tailscaleIp: n.ip,
        os: n.os,
        online: n.online,
        isSelf: n.isSelf,
        source: "tailscale",
        lastSeenAt: now,
      },
    });
  }

  // Anything tailscale-sourced but absent from this sync: offline, and no
  // longer self (e.g. the DB was copied from another machine).
  await prisma.machine.updateMany({
    where: { source: "tailscale", hostname: { notIn: [...seen] } },
    data: { online: false, isSelf: false },
  });

  return prisma.machine.findMany({ orderBy: [{ isSelf: "desc" }, { hostname: "asc" }] });
}

export async function listMachines(): Promise<Machine[]> {
  return prisma.machine.findMany({ orderBy: [{ isSelf: "desc" }, { hostname: "asc" }] });
}

/** The machine comux runs on. Falls back to the OS hostname when the
 *  registry hasn't been synced yet (so the UI badge always shows something). */
export async function getSelfMachine(): Promise<{
  hostname: string;
  sshUser: string;
  source: "registry" | "os";
}> {
  const self = await prisma.machine.findFirst({ where: { isSelf: true } }).catch(() => null);
  if (self) return { hostname: self.hostname, sshUser: self.sshUser, source: "registry" };
  return { hostname: osHostname(), sshUser: "", source: "os" };
}

/** How to reach a machine over ssh: `user@hostname` or bare hostname. */
export function sshTargetOf(m: { hostname: string; sshUser: string }): string {
  return m.sshUser ? `${m.sshUser}@${m.hostname}` : m.hostname;
}
