/**
 * Cloudflare DNS management for the zone set by CF_ZONE_ID
 */

const CF_API = "https://api.cloudflare.com/client/v4";
const CF_TOKEN = process.env.CF_API_TOKEN || "";
const CF_ZONE_ID = process.env.CF_ZONE_ID || "";

interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
}

async function cfFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${CF_API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${CF_TOKEN}`,
      "Content-Type": "application/json",
      ...opts.headers,
    },
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(
      data.errors?.map((e: { message: string }) => e.message).join(", ") ||
        "Cloudflare API error"
    );
  }
  return data;
}

export async function listDnsRecords(): Promise<DnsRecord[]> {
  if (!CF_TOKEN || !CF_ZONE_ID) return [];
  const data = await cfFetch(
    `/zones/${CF_ZONE_ID}/dns_records?per_page=100`
  );
  return data.result.map((r: DnsRecord) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    content: r.content,
    ttl: r.ttl,
    proxied: r.proxied,
  }));
}

export async function createDnsRecord(
  subdomain: string,
  ip: string,
  type: "A" | "AAAA" | "CNAME" = "A",
  proxied = false
): Promise<DnsRecord> {
  if (!CF_TOKEN || !CF_ZONE_ID)
    throw new Error("CF_API_TOKEN and CF_ZONE_ID required");

  const data = await cfFetch(`/zones/${CF_ZONE_ID}/dns_records`, {
    method: "POST",
    body: JSON.stringify({
      type,
      name: subdomain,
      content: ip,
      ttl: 1, // auto
      proxied,
    }),
  });
  return data.result;
}

export async function deleteDnsRecord(recordId: string): Promise<void> {
  if (!CF_TOKEN || !CF_ZONE_ID)
    throw new Error("CF_API_TOKEN and CF_ZONE_ID required");

  await cfFetch(`/zones/${CF_ZONE_ID}/dns_records/${recordId}`, {
    method: "DELETE",
  });
}

export function isConfigured(): boolean {
  return Boolean(CF_TOKEN && CF_ZONE_ID);
}
