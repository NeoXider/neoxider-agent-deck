const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const {
  POWERSHELL_REPLACEMENT_HELPER,
  compareStableVersions,
  createUpdateService,
  expectedPortableAssetName,
  launchPowerShellReplacement,
  parseStableVersion,
  releaseVersion,
  resolvePortableInstallTarget,
  selectWindowsPortableAsset,
} = require("../src/update-service.cjs");

const REPOSITORY = "NeoXider/neoxider-agent-deck";

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function asset(version, body, overrides = {}) {
  const name = expectedPortableAssetName(version);
  return {
    name,
    state: "uploaded",
    size: body.length,
    digest: `sha256:${digest(body)}`,
    browser_download_url: `https://github.com/${REPOSITORY}/releases/download/v${version}/${name}`,
    ...overrides,
  };
}

function release(version, body = Buffer.from("update"), overrides = {}) {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: [asset(version, body)],
    ...overrides,
  };
}

function jsonResponse(value, { ok = true } = {}) {
  return { ok, json: async () => value };
}

function downloadResponse(chunks, contentLength = null) {
  const headers = new Map();
  if (contentLength !== null) headers.set("content-length", String(contentLength));
  return {
    ok: true,
    headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null },
    body: Readable.from(chunks),
  };
}

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-deck-update-test-"));
  return {
    directory,
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

function portableService({
  body = Buffer.from("new portable binary"),
  currentVersion = "1.0.0",
  latestVersion = "1.1.0",
  fetchImpl,
  onState,
  requestQuit = () => {},
  launchReplacement,
  maxBytes,
} = {}) {
  const temporary = temporaryDirectory();
  const target = path.join(temporary.directory, "NeoXider Agent Deck.exe");
  fs.writeFileSync(target, "old portable binary");
  const responses = [
    jsonResponse(release(latestVersion, body)),
    downloadResponse([body.subarray(0, 4), body.subarray(4)], body.length),
  ];
  const calls = [];
  const service = createUpdateService({
    currentVersion,
    repository: REPOSITORY,
    platform: "win32",
    arch: "x64",
    isPackaged: true,
    fetchImpl: fetchImpl || (async (url, options) => {
      calls.push({ url, options });
      return responses.shift();
    }),
    resolveInstallTarget: () => ({ target, reason: null }),
    randomId: () => "fixed-token",
    requestQuit,
    launchReplacement: launchReplacement || (async () => {}),
    onState,
    ...(maxBytes === undefined ? {} : { maxBytes }),
  });
  return { body, calls, service, target, temporary };
}

test("stable version parsing and comparison reject ambiguous or prerelease versions", () => {
  assert.deepEqual(parseStableVersion("0.4.3"), [0, 4, 3]);
  for (const value of ["v0.4.3", "1.2", "1.2.3-beta.1", "01.2.3", "1.2.3+build", "1.2.3.4", ""]) {
    assert.equal(parseStableVersion(value), null, value);
  }
  assert.equal(compareStableVersions("1.2.3", "1.2.3"), 0);
  assert.equal(compareStableVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareStableVersions("2.0.0", "10.0.0"), -1);
  assert.throws(() => compareStableVersions("1.0.0-beta", "1.0.0"), TypeError);
});

test("only a published stable v-tag is accepted", () => {
  assert.equal(releaseVersion(release("1.2.3")), "1.2.3");
  assert.equal(releaseVersion({ ...release("1.2.3"), draft: true }), null);
  assert.equal(releaseVersion({ ...release("1.2.3"), prerelease: true }), null);
  assert.equal(releaseVersion({ ...release("1.2.3"), tag_name: "1.2.3" }), null);
  assert.equal(releaseVersion({ ...release("1.2.3"), tag_name: "v1.2.3-rc.1" }), null);
});

test("asset selection requires the exact versioned Windows x64 portable name, URL, size, and digest", () => {
  const body = Buffer.from("verified");
  const valid = release("2.3.4", body);
  assert.deepEqual(selectWindowsPortableAsset(valid, "2.3.4"), {
    name: expectedPortableAssetName("2.3.4"),
    size: body.length,
    digest: digest(body),
    url: `https://github.com/${REPOSITORY}/releases/download/v2.3.4/${expectedPortableAssetName("2.3.4")}`,
  });
  assert.throws(
    () => selectWindowsPortableAsset({ ...valid, assets: [{ ...valid.assets[0], name: "setup.exe" }] }, "2.3.4"),
    { code: "UPDATE_ASSET_MISSING" },
  );
  assert.throws(
    () => selectWindowsPortableAsset({ ...valid, assets: [{ ...valid.assets[0], digest: "sha256:nope" }] }, "2.3.4"),
    { code: "UPDATE_DIGEST_MISSING" },
  );
  assert.throws(
    () => selectWindowsPortableAsset({ ...valid, assets: [{ ...valid.assets[0], state: "starter" }] }, "2.3.4"),
    { code: "UPDATE_ASSET_NOT_READY" },
  );
  assert.throws(
    () => selectWindowsPortableAsset({ ...valid, assets: [{ ...valid.assets[0], browser_download_url: "https://example.com/update.exe" }] }, "2.3.4"),
    { code: "UPDATE_URL_INVALID" },
  );
  assert.throws(() => selectWindowsPortableAsset(valid, "2.3.4", { maxBytes: body.length - 1 }), { code: "UPDATE_TOO_LARGE" });
});

test("portable replacement uses only PORTABLE_EXECUTABLE_FILE on packaged Windows x64", () => {
  const env = {
    PORTABLE_EXECUTABLE_FILE: "C:\\Apps\\Agent Deck.exe",
    PORTABLE_EXECUTABLE_DIR: "C:\\Wrong",
  };
  assert.deepEqual(resolvePortableInstallTarget({ platform: "win32", arch: "x64", env, isPackaged: true }), {
    target: "C:\\Apps\\Agent Deck.exe",
    reason: null,
  });
  assert.equal(resolvePortableInstallTarget({ platform: "win32", arch: "x64", env: {}, isPackaged: true }).reason, "not-portable");
  assert.equal(resolvePortableInstallTarget({ platform: "win32", arch: "arm64", env, isPackaged: true }).reason, "unsupported-architecture");
  assert.equal(resolvePortableInstallTarget({ platform: "linux", arch: "x64", env, isPackaged: true }).reason, "unsupported-platform");
  assert.equal(resolvePortableInstallTarget({ platform: "win32", arch: "x64", env, isPackaged: false }).reason, "development-build");
});

test("check never offers an equal version or downgrade", async (t) => {
  for (const latestVersion of ["1.2.3", "1.2.2", "0.99.99"]) {
    await t.test(latestVersion, async () => {
      const service = createUpdateService({
        currentVersion: "1.2.3",
        fetchImpl: async () => jsonResponse(release(latestVersion)),
      });
      const result = await service.check();
      assert.equal(result.status, "current");
      assert.equal(result.latestVersion, latestVersion);
      assert.equal(result.installMode, "none");
    });
  }
});

test("draft, prerelease, malformed, and failed GitHub responses become explicit errors", async (t) => {
  const cases = [
    ["draft", jsonResponse({ ...release("1.1.0"), draft: true }), "UPDATE_RELEASE_INVALID"],
    ["prerelease", jsonResponse({ ...release("1.1.0"), prerelease: true }), "UPDATE_RELEASE_INVALID"],
    ["malformed", jsonResponse({ tag_name: "latest", assets: [] }), "UPDATE_RELEASE_INVALID"],
    ["http", jsonResponse({}, { ok: false }), "UPDATE_CHECK_HTTP"],
  ];
  for (const [name, response, code] of cases) {
    await t.test(name, async () => {
      const service = createUpdateService({ currentVersion: "1.0.0", fetchImpl: async () => response });
      const result = await service.check();
      assert.equal(result.status, "error");
      assert.equal(result.error.code, code);
    });
  }
});

test("concurrent checks share one request and publish legal state transitions", async () => {
  let resolveFetch;
  let calls = 0;
  const states = [];
  const service = createUpdateService({
    currentVersion: "1.0.0",
    fetchImpl: async () => {
      calls += 1;
      return new Promise((resolve) => { resolveFetch = resolve; });
    },
    onState: (state) => states.push(state.status),
  });
  const first = service.check();
  const second = service.check();
  assert.strictEqual(first, second);
  resolveFetch(jsonResponse(release("1.1.0")));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.deepEqual(states, ["checking", "available"]);
});

test("verified download streams into the target directory and reports progress", async (t) => {
  const observed = [];
  const fixture = portableService({ onState: (state) => observed.push(state) });
  t.after(fixture.temporary.cleanup);
  assert.equal((await fixture.service.check()).status, "available");
  const result = await fixture.service.download();
  assert.equal(result.status, "ready");
  assert.equal(result.progress, 100);
  assert.equal(result.receivedBytes, fixture.body.length);
  assert.equal(fixture.calls.length, 2);
  const staged = fs.readdirSync(fixture.temporary.directory).find((name) => name.endsWith(".update"));
  assert.ok(staged, "the verified update should remain staged beside the portable target");
  assert.deepEqual(fs.readFileSync(path.join(fixture.temporary.directory, staged)), fixture.body);
  assert.ok(observed.some((state) => state.status === "downloading" && state.progress > 0));
});

test("concurrent downloads perform one transfer", async (t) => {
  const body = Buffer.from("concurrent body");
  const temporary = temporaryDirectory();
  t.after(temporary.cleanup);
  const target = path.join(temporary.directory, "Agent.exe");
  fs.writeFileSync(target, "old");
  let downloadCalls = 0;
  let releaseServed = false;
  let releaseDownload;
  const service = createUpdateService({
    currentVersion: "1.0.0",
    platform: "win32",
    arch: "x64",
    isPackaged: true,
    resolveInstallTarget: () => ({ target, reason: null }),
    requestQuit: () => {},
    randomId: () => "concurrent",
    fetchImpl: async () => {
      if (!releaseServed) {
        releaseServed = true;
        return jsonResponse(release("1.1.0", body));
      }
      downloadCalls += 1;
      return new Promise((resolve) => { releaseDownload = resolve; });
    },
  });
  await service.check();
  const first = service.download();
  const second = service.download();
  assert.strictEqual(first, second);
  while (!releaseDownload) await new Promise((resolve) => setImmediate(resolve));
  releaseDownload(downloadResponse([body], body.length));
  assert.equal((await first).status, "ready");
  assert.equal(downloadCalls, 1);
});

test("digest and size mismatches delete the staged file", async (t) => {
  const cases = [
    ["digest", Buffer.from("tampered update"), "UPDATE_DIGEST_MISMATCH"],
    ["short", Buffer.from("short"), "UPDATE_SIZE_MISMATCH"],
  ];
  for (const [name, downloaded, code] of cases) {
    await t.test(name, async (subtest) => {
      const expected = Buffer.from("expected update");
      const temporary = temporaryDirectory();
      subtest.after(temporary.cleanup);
      const target = path.join(temporary.directory, "Agent.exe");
      fs.writeFileSync(target, "old");
      let first = true;
      const service = createUpdateService({
        currentVersion: "1.0.0",
        platform: "win32",
        arch: "x64",
        isPackaged: true,
        resolveInstallTarget: () => ({ target, reason: null }),
        requestQuit: () => {},
        randomId: () => name,
        fetchImpl: async () => {
          if (first) {
            first = false;
            return jsonResponse(release("1.1.0", expected));
          }
          return downloadResponse([downloaded], downloaded.length);
        },
      });
      await service.check();
      const result = await service.download();
      assert.equal(result.status, "error");
      assert.equal(result.error.code, code);
      assert.equal(fs.readdirSync(temporary.directory).some((entry) => entry.endsWith(".update")), false);
    });
  }
});

test("streaming enforces the maximum even when the response header lies", async (t) => {
  const expected = Buffer.from("12345678");
  const fixture = portableService({ body: expected, maxBytes: expected.length });
  t.after(fixture.temporary.cleanup);
  await fixture.service.check();
  fixture.calls.length = 0;
  let fetches = 0;
  const oversized = createUpdateService({
    currentVersion: "1.0.0",
    platform: "win32",
    arch: "x64",
    isPackaged: true,
    maxBytes: expected.length,
    resolveInstallTarget: () => ({ target: fixture.target, reason: null }),
    requestQuit: () => {},
    randomId: () => "oversized",
    fetchImpl: async () => {
      fetches += 1;
      if (fetches === 1) return jsonResponse(release("1.1.0", expected));
      return downloadResponse([Buffer.from("123456789")], 1);
    },
  });
  await oversized.check();
  const result = await oversized.download();
  assert.equal(result.status, "error");
  assert.equal(result.error.code, "UPDATE_TOO_LARGE");
});

test("unsupported and unwritable installs remain manual and never download a binary", async (t) => {
  await t.test("unsupported", async () => {
    let calls = 0;
    let opened = "";
    const service = createUpdateService({
      currentVersion: "1.0.0",
      platform: "linux",
      arch: "x64",
      isPackaged: true,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(release("1.1.0"));
      },
      openExternal: async (url) => { opened = url; },
    });
    assert.equal((await service.check()).manualReason, "unsupported-platform");
    assert.equal((await service.download()).status, "available");
    const result = await service.install();
    assert.equal(result.manual, true);
    assert.equal(opened, `https://github.com/${REPOSITORY}/releases/tag/v1.1.0`);
    assert.equal(calls, 1);
  });

  await t.test("unwritable while staging", async () => {
    const temporary = temporaryDirectory();
    t.after(temporary.cleanup);
    const target = path.join(temporary.directory, "Agent.exe");
    fs.writeFileSync(target, "old");
    const realFileSystem = fs.promises;
    let first = true;
    const service = createUpdateService({
      currentVersion: "1.0.0",
      platform: "win32",
      arch: "x64",
      isPackaged: true,
      resolveInstallTarget: () => ({ target, reason: null }),
      requestQuit: () => {},
      fileSystem: {
        ...realFileSystem,
        open: async () => { const error = new Error("denied"); error.code = "EACCES"; throw error; },
      },
      fetchImpl: async () => {
        assert.equal(first, true, "manual fallback must not request the binary");
        first = false;
        return jsonResponse(release("1.1.0"));
      },
    });
    await service.check();
    const result = await service.download();
    assert.equal(result.status, "available");
    assert.equal(result.installMode, "manual");
    assert.equal(result.manualReason, "target-not-writable");
  });
});

test("install launches one detached replacement operation before requesting quit", async (t) => {
  let helperArgs;
  let helperCalls = 0;
  let quitCalls = 0;
  let releaseHelper;
  const fixture = portableService({
    launchReplacement: async (args) => {
      helperCalls += 1;
      helperArgs = args;
      await new Promise((resolve) => { releaseHelper = resolve; });
    },
    requestQuit: async (reason) => {
      assert.equal(reason, "update");
      quitCalls += 1;
    },
  });
  t.after(fixture.temporary.cleanup);
  await fixture.service.check();
  await fixture.service.download();
  const first = fixture.service.install();
  const second = fixture.service.install();
  assert.strictEqual(first, second);
  assert.equal(helperCalls, 1);
  assert.equal(quitCalls, 0);
  releaseHelper();
  const result = await first;
  assert.equal(result.status, "installing");
  assert.equal(quitCalls, 1);
  assert.equal(helperArgs.target, fixture.target);
  assert.equal(path.dirname(helperArgs.stagedPath), path.dirname(fixture.target));
  assert.equal(helperArgs.backupPath, `${fixture.target}.rollback`);
  assert.equal(helperArgs.helperPath, `${helperArgs.stagedPath}.ps1`);
});

test("install safely waits for an in-flight check and performs one download", async (t) => {
  const body = Buffer.from("race-safe update");
  const temporary = temporaryDirectory();
  t.after(temporary.cleanup);
  const target = path.join(temporary.directory, "Agent.exe");
  fs.writeFileSync(target, "old");
  let releaseCheck;
  let fetchCalls = 0;
  let helperCalls = 0;
  let quitCalls = 0;
  const service = createUpdateService({
    currentVersion: "1.0.0",
    platform: "win32",
    arch: "x64",
    isPackaged: true,
    resolveInstallTarget: () => ({ target, reason: null }),
    randomId: () => "race",
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) return new Promise((resolve) => { releaseCheck = resolve; });
      return downloadResponse([body], body.length);
    },
    launchReplacement: async () => { helperCalls += 1; },
    requestQuit: async () => { quitCalls += 1; },
  });
  service.check();
  const installing = service.install();
  releaseCheck(jsonResponse(release("1.1.0", body)));
  const result = await installing;
  assert.equal(result.status, "installing");
  assert.equal(fetchCalls, 2);
  assert.equal(helperCalls, 1);
  assert.equal(quitCalls, 1);
});

test("the replacement helper waits for unlock, replaces atomically, rolls back failed relaunch, and keeps a backup", () => {
  assert.match(POWERSHELL_REPLACEMENT_HELPER, /Wait-Process -Id \$ParentPid/);
  assert.match(POWERSHELL_REPLACEMENT_HELPER, /FileShare\]::None/);
  assert.match(POWERSHELL_REPLACEMENT_HELPER, /\[IO\.File\]::Replace\(\$Staged, \$Target, \$Backup/);
  assert.match(POWERSHELL_REPLACEMENT_HELPER, /MoveFileEx/);
  assert.match(POWERSHELL_REPLACEMENT_HELPER, /Start-Process -FilePath \$Target/);
  assert.match(POWERSHELL_REPLACEMENT_HELPER, /Move-FileReplace \$Backup \$Target/);
  assert.doesNotMatch(POWERSHELL_REPLACEMENT_HELPER, /Invoke-Expression|cmd\.exe/);
});

test("PowerShell helper launch uses separated arguments, detached execution, and cleans up spawn failures", async (t) => {
  const temporary = temporaryDirectory();
  t.after(temporary.cleanup);
  const target = path.join(temporary.directory, "Agent Deck.exe");
  const stagedPath = path.join(temporary.directory, ".Agent Deck.update");
  const backupPath = `${target}.rollback`;
  const helperPath = `${stagedPath}.ps1`;
  fs.writeFileSync(target, "old");
  fs.writeFileSync(stagedPath, "new");
  let invocation;
  let unreferenced = false;
  await launchPowerShellReplacement({
    target,
    stagedPath,
    backupPath,
    helperPath,
    parentPid: 42,
    env: { SystemRoot: "C:\\Windows" },
    spawnImpl: (executable, args, options) => {
      invocation = { executable, args, options };
      const child = new EventEmitter();
      child.unref = () => { unreferenced = true; };
      process.nextTick(() => child.emit("spawn"));
      return child;
    },
  });
  assert.equal(invocation.executable, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.deepEqual(invocation.options, { detached: true, windowsHide: true, stdio: "ignore" });
  assert.deepEqual(invocation.args.slice(-8), [
    "-Target", target,
    "-Staged", stagedPath,
    "-Backup", backupPath,
    "-ParentPid", "42",
  ]);
  assert.equal(unreferenced, true);
  assert.equal(fs.readFileSync(helperPath, "utf8"), POWERSHELL_REPLACEMENT_HELPER);

  const failedHelper = path.join(temporary.directory, "failed.ps1");
  await assert.rejects(
    launchPowerShellReplacement({
      target,
      stagedPath,
      backupPath,
      helperPath: failedHelper,
      spawnImpl: () => { throw new Error("spawn denied"); },
    }),
    { code: "UPDATE_HELPER_FAILED" },
  );
  assert.equal(fs.existsSync(failedHelper), false);
});
