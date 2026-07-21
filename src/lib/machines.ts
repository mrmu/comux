import { prisma } from "./db";
import { getTailscaleNodes, osHostname, type TailscaleNode } from "./tailscale";
import type { Machine } from "@/generated/prisma/client";

function tailscaleFields(n: TailscaleNode, now: Date) {
  return {
    displayName: n.displayName,
    dnsName: n.dnsName,
    tailscaleIp: n.ip,
    os: n.os,
    online: n.online,
    isSelf: n.isSelf,
    tags: n.tags.join(","),
    source: "tailscale",
    lastSeenAt: now,
  };
}

/** Refresh the registry from the live tailnet — WITHOUT importing new
 *  machines. Only self and already-registered machines are persisted;
 *  everything else is returned as `discovered` for the user to opt in via
 *  importMachines(). Deliberate: a shared tailnet may contain machines
 *  that must never appear in this instance's DB (e.g. personal servers
 *  visible from a company comux). */
export async function syncMachinesFromTailscale(): Promise<{
  machines: Machine[];
  discovered: TailscaleNode[];
}> {
  const nodes = await getTailscaleNodes();
  const now = new Date();
  const registered = new Set(
    (await prisma.machine.findMany({ select: { hostname: true } })).map((m) => m.hostname)
  );

  const discovered: TailscaleNode[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    seen.add(n.hostname);
    if (n.isSelf) {
      // Self is always registered — the badge and hosts.md need it.
      await prisma.machine.upsert({
        where: { hostname: n.hostname },
        update: tailscaleFields(n, now),
        create: { hostname: n.hostname, ...tailscaleFields(n, now) },
      });
    } else if (registered.has(n.hostname)) {
      await prisma.machine.update({
        where: { hostname: n.hostname },
        data: tailscaleFields(n, now),
      });
    } else {
      discovered.push(n);
    }
  }

  // Anything tailscale-sourced but absent from this sync: offline, and no
  // longer self (e.g. the DB was copied from another machine).
  await prisma.machine.updateMany({
    where: { source: "tailscale", hostname: { notIn: [...seen] } },
    data: { online: false, isSelf: false },
  });

  const machines = await prisma.machine.findMany({
    orderBy: [{ isSelf: "desc" }, { hostname: "asc" }],
  });
  return { machines, discovered };
}

/** Opt-in import of discovered tailnet machines, by hostname. Returns how
 *  many were actually imported (hostnames not visible in the live tailnet
 *  are ignored — the client list may be stale). */
export async function importMachines(hostnames: string[]): Promise<number> {
  const wanted = new Set(hostnames);
  const nodes = await getTailscaleNodes();
  const now = new Date();
  let imported = 0;
  for (const n of nodes) {
    if (!wanted.has(n.hostname)) continue;
    await prisma.machine.upsert({
      where: { hostname: n.hostname },
      update: tailscaleFields(n, now),
      create: { hostname: n.hostname, ...tailscaleFields(n, now) },
    });
    imported++;
  }
  return imported;
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

/** Single wire format for Machine rows across all /api/machines responses. */
export function serializeMachine(m: Machine) {
  return {
    id: m.id,
    hostname: m.hostname,
    display_name: m.displayName,
    dns_name: m.dnsName,
    tailscale_ip: m.tailscaleIp,
    os: m.os,
    ssh_user: m.sshUser,
    tags: m.tags ? m.tags.split(",") : [],
    note: m.note,
    online: m.online,
    is_self: m.isSelf,
    source: m.source,
    last_seen_at: m.lastSeenAt,
  };
}
