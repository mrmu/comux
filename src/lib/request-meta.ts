import { NextRequest } from "next/server";
import {
  CLIENT_IP_HEADER,
  isClientIpHeaderTrusted,
} from "../../server-shared/client-ip";

/**
 * 連線的實際來源位址。由自訂伺服器（prod-server.js / server.ts）依 socket 位址與
 * TRUSTED_PROXIES 決定後寫進內部 header；外部傳入的同名 header 已被刪掉。
 * 沒有自訂伺服器（next dev，只聽 127.0.0.1）時不信任任何標頭。
 */
export function clientIp(request: NextRequest): string {
  if (!isClientIpHeaderTrusted()) return "local-dev";
  return request.headers.get(CLIENT_IP_HEADER) || "unknown";
}

/** 稽核紀錄用的來源資訊 */
export function requestMeta(request: NextRequest): { ip: string; userAgent: string } {
  return {
    ip: clientIp(request),
    userAgent: (request.headers.get("user-agent") || "").slice(0, 500),
  };
}
