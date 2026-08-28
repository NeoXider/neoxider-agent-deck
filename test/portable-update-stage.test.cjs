const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { recoverStagedUpdate, verifyStagedUpdate } = require("../src/portable-update-stage.cjs");

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("portable stage recovery accepts only the exact version, size, and digest", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-deck-stage-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, "NeoXider Agent Deck.exe");
  const body = Buffer.from("verified update");
  const asset = { size: body.length, digest: digest(body) };
  const valid = path.join(directory, ".NeoXider Agent Deck.exe.1.1.0.valid-token.update");
  const wrongVersion = path.join(directory, ".NeoXider Agent Deck.exe.1.0.9.other-token.update");
  fs.writeFileSync(valid, body);
  fs.writeFileSync(wrongVersion, body);

  assert.equal(await recoverStagedUpdate(fs.promises, target, "1.1.0", asset, () => crypto.createHash("sha256")), valid);
  assert.equal(await verifyStagedUpdate(fs.promises, valid, { ...asset, size: asset.size + 1 }, () => crypto.createHash("sha256")), false);
  assert.equal(await verifyStagedUpdate(fs.promises, valid, { ...asset, digest: "0".repeat(64) }, () => crypto.createHash("sha256")), false);
});
