"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/** Header badge showing which dev machine this comux instance runs on —
 *  so a user juggling personal + company comux tabs always knows where
 *  they are. Cached in sessionStorage to avoid a fetch on every page. */
export default function MachineBadge() {
  const [hostname, setHostname] = useState("");
  const [fromRegistry, setFromRegistry] = useState(true);

  useEffect(() => {
    const cached = sessionStorage.getItem("comux-self-machine");
    if (cached) {
      try {
        const c = JSON.parse(cached);
        setHostname(c.hostname);
        setFromRegistry(c.source === "registry");
        return;
      } catch { /* refetch */ }
    }
    (async () => {
      try {
        const self = await api.get("/api/machines/self");
        setHostname(self.hostname);
        setFromRegistry(self.source === "registry");
        sessionStorage.setItem("comux-self-machine", JSON.stringify(self));
      } catch { /* not logged in / API missing — hide badge */ }
    })();
  }, []);

  if (!hostname) return null;
  return (
    <span
      className="machine-badge"
      title={
        fromRegistry
          ? "comux 主開發機（來自站點管理）"
          : "comux 主開發機（OS hostname — 到 Machines 頁同步 Tailscale 可校正）"
      }
    >
      @ {hostname}
    </span>
  );
}
