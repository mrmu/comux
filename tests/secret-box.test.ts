import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.COMUX_SECRET = crypto.randomBytes(32).toString("hex");

test("seal/open round-trip; tampering and key change are rejected", async () => {
  const { seal, open } = await import("../src/lib/secret-box");
  const sealed = seal("JBSWY3DPEHPK3PXP");
  assert.match(sealed, /^v1:/);
  assert.notEqual(seal("JBSWY3DPEHPK3PXP"), sealed, "random IV");
  assert.equal(open(sealed), "JBSWY3DPEHPK3PXP");

  const raw = Buffer.from(sealed.slice(3), "base64");
  raw[raw.length - 1] ^= 1;
  assert.equal(open(`v1:${raw.toString("base64")}`), null);
  assert.equal(open("garbage"), null);
  assert.equal(open(null), null);

  process.env.COMUX_SECRET = crypto.randomBytes(32).toString("hex");
  assert.equal(open(sealed), null);
});
