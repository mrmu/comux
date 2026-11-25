import { test } from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseSshArgs } = require("../server-shared/session-audit");

const p = (line: string) => parseSshArgs(line.split(" ").filter(Boolean));

test("interactive logins", () => {
  assert.deepEqual(p("myhost"), { target: "myhost", interactive: true });
  assert.deepEqual(p("root@myhost"), { target: "root@myhost", interactive: true });
  assert.deepEqual(p("-p 2222 deploy@myhost"), { target: "deploy@myhost:2222", interactive: true });
  assert.deepEqual(p("-p2222 -l deploy myhost"), { target: "deploy@myhost:2222", interactive: true });
  assert.deepEqual(p("-tt -o ConnectTimeout=5 -i /k/id myhost"), { target: "myhost", interactive: true });
  assert.deepEqual(p("-J jump myhost"), { target: "myhost", interactive: true });
  assert.deepEqual(p("ssh://deploy@myhost:2200"), { target: "deploy@myhost:2200", interactive: true });
  assert.deepEqual(p("-p 22 myhost"), { target: "myhost", interactive: true });
});

test("remote commands are non-interactive (command text is never returned)", () => {
  const r = p("myhost docker ps -a");
  assert.deepEqual(r, { target: "myhost", interactive: false });
  assert.deepEqual(p("-s myhost sftp"), { target: "myhost", interactive: false });
});

test("non-connections and git transport are ignored", () => {
  assert.equal(p("-O exit myhost"), null);
  assert.equal(p("-G myhost"), null);
  assert.equal(p("-V"), null);
  assert.equal(p("-v"), null);
  assert.equal(p("git@github.com git-upload-pack 'org/repo.git'"), null);
  assert.equal(p("-o SendEnv=GIT_PROTOCOL git@github.com git-receive-pack 'org/repo.git'"), null);
});
