/**
 * 給 server-shared 模組（WebSocket 驗證、稽核紀錄、SSH 監看）用的 pg 連線池。
 *
 * 用 pg 直接查（而不是 Prisma client）：Prisma 產生的 client 是 TS，prod-server.js
 * 是不經編譯的純 JS 跑不了；這裡的查詢都很單純，直接寫 SQL 即可。
 */

/** @type {import("pg").Pool | null} */
let pool = null;

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL environment variable is not set");
  const { Pool } = require("pg");
  pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 30_000 });
  // 閒置連線斷掉時 pool 會 emit error，不處理會讓整個進程掛掉
  pool.on("error", (err) => console.error("[comux] pg pool error:", err.message));
  return pool;
}

module.exports = { getPool };
