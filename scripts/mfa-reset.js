#!/usr/bin/env node
/**
 * 重設某個帳號的第二道驗證（手機和備用碼都遺失時的最後手段）。
 *
 *   npm run mfa:reset -- user@example.com
 *
 * 會清掉 TOTP 秘鑰與備用碼、讓該帳號所有 session 失效；下次用密碼登入後會被要求重新綁定。
 * 只能在 comux 主機上執行（要讀得到 .env 的 DATABASE_URL）—— 能在這台主機下指令的人
 * 本來就等同有 comux 的全部權限，所以這不會比網頁登入更弱。動作會寫進稽核紀錄並通知。
 */

require("dotenv/config");
const os = require("os");
const { getPool } = require("../server-shared/db-pool");
const { recordAudit, flushNotifications } = require("../server-shared/audit");

async function main() {
  const email = (process.argv[2] || "").toLowerCase().trim();
  if (!email || !email.includes("@")) {
    console.error("usage: npm run mfa:reset -- <email>");
    process.exit(2);
  }
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE users
        SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled_at = NULL,
            totp_last_step = NULL, backup_codes = ARRAY[]::text[],
            token_version = token_version + 1
      WHERE email = $1
      RETURNING id, email`,
    [email]
  );
  if (rows.length === 0) {
    console.error(`no such user: ${email}`);
    process.exit(1);
  }
  await recordAudit({
    type: "mfa_reset",
    userId: rows[0].id,
    email: rows[0].email,
    detail: { via: `CLI by ${os.userInfo().username}` },
  });
  await flushNotifications();
  console.log(`MFA reset for ${rows[0].email}. They will be asked to enroll again at next login.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
