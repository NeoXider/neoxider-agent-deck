const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createDeviceTrustStore } = require("../src/device-trust-store.cjs");

test("device trust store preserves valid hashes, removes expired records, and clears on revoke", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deck-device-trust-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "trusted-devices.json");
  const digest = "a".repeat(64);
  const store = createDeviceTrustStore({ filePath, now: () => 1000 });
  assert.deepEqual(store.save([{ digest, expiresAt: 2000 }, { digest: "raw-token", expiresAt: 2000 },
    { digest: "b".repeat(64), expiresAt: 999 }]), [{ digest, expiresAt: 2000 }]);
  assert.deepEqual(createDeviceTrustStore({ filePath, now: () => 1500 }).load(), [{ digest, expiresAt: 2000 }]);
  assert.doesNotMatch(fs.readFileSync(filePath, "utf8"), /raw-token/);
  store.clear();
  assert.equal(fs.existsSync(filePath), false);
});

test("device trust store reports a revocation write failure", () => {
  const error = Object.assign(new Error("locked"), { code: "EPERM" });
  const store = createDeviceTrustStore({ filePath: "C:\\data\\trusted-devices.json",
    fileSystem: { rmSync: () => { throw error; } } });
  assert.throws(() => store.clear(), candidate => candidate === error);
});
