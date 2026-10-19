import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MODE_LABELS,
  WINDOWS_EXECUTABLE,
  candidateLocations,
  detectRunning,
  launchDeck,
  originOf,
  readAsarVersion,
  readWidgetSettings,
  userDataDirectory,
  validHarnessUrl,
} from "../deck-app.mjs";
import { apply, harnessOrigin } from "../index.js";

function buildAsar(payload) {
  const body = Buffer.from(payload, "utf8");
  const header = Buffer.from(JSON.stringify({ files: { "package.json": { offset: "0", size: String(body.length) } } }), "utf8");
  const file = Buffer.alloc(16 + header.length + body.length);
  file.writeUInt32LE(body.length, 0);
  file.writeUInt32LE(header.length, 12);
  header.copy(file, 16);
  body.copy(file, 16 + header.length);
  return file;
}

test("windows candidates walk the default install roots", () => {
  const localAppData = "C:\\Users\\ada\\AppData\\Local";
  const expected = join(localAppData, "Programs", "NeoXider Agent Deck", WINDOWS_EXECUTABLE);
  const found = candidateLocations({
    platform: "win32",
    env: { LOCALAPPDATA: localAppData },
    home: "C:\\Users\\ada",
    fileExists: (file) => file === expected,
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].executable, expected);
  assert.ok(found[0].asarPath.endsWith(join("resources", "app.asar")));
});

test("the env override replaces discovery", () => {
  const override = "/opt/deck/neoxider-agent-deck";
  const found = candidateLocations({
    platform: "linux",
    env: { NEOXIDER_AGENT_DECK_PATH: override },
    home: "/home/ada",
    fileExists: () => false,
  });
  assert.deepEqual(found.map((entry) => entry.executable), [override]);
});

test("a macOS override stays a bundle", () => {
  const app = "/Applications/NeoXider Agent Deck.app";
  const found = candidateLocations({ platform: "darwin", env: { NEOXIDER_AGENT_DECK_PATH: app }, home: "/Users/ada", fileExists: () => false });
  assert.equal(found[0].launchKind, "bundle");
  assert.equal(found[0].installDir, app);
  assert.ok(found[0].asarPath.endsWith(join("Contents", "Resources", "app.asar")));
});

test("user data follows the platform convention", () => {
  assert.equal(
    userDataDirectory({ platform: "win32", env: { APPDATA: "C:\\Roaming" }, home: "C:\\Users\\ada" }),
    join("C:\\Roaming", "NeoXider", "AgentDeck"),
  );
  assert.equal(
    userDataDirectory({ platform: "linux", env: {}, home: "/home/ada" }),
    join("/home/ada", ".config", "NeoXider", "AgentDeck"),
  );
});

test("origin drops the launch token", () => {
  assert.equal(originOf("http://127.0.0.1:3080/?token=secret"), "http://127.0.0.1:3080");
  assert.equal(originOf("https://harness.example.com/base?token=secret"), "https://harness.example.com");
  assert.equal(originOf("file:///tmp/x"), null);
  assert.equal(originOf(""), null);
});

test("settings report the origin, never the token", () => {
  const home = mkdtempSync(join(tmpdir(), "deck-plugin-"));
  const file = join(home, ".config", "NeoXider", "AgentDeck", "widget-settings.json");
  const settings = readWidgetSettings({
    platform: "linux",
    env: {},
    home,
    fileExists: (path) => path === file,
    readFile: () => JSON.stringify({
      harnessLaunchUrl: "http://127.0.0.1:3080/?token=secret",
      deviceAccessEnabled: true,
      size: "compact",
      windowLayer: "above",
      windowState: { mode: "orb" },
    }),
  });
  assert.equal(settings.found, true);
  assert.equal(settings.harnessOrigin, "http://127.0.0.1:3080");
  assert.equal(settings.harnessLaunchUrlConfigured, true);
  assert.equal(settings.deviceAccessEnabled, true);
  assert.equal(settings.size, "compact");
  assert.equal(settings.windowMode, "orb");
  assert.equal(MODE_LABELS[settings.windowMode], "avatar");
  assert.ok(!JSON.stringify(settings).includes("secret"));
});

test("settings are read from disk, not only from an injected reader", () => {
  const home = mkdtempSync(join(tmpdir(), "deck-plugin-fs-"));
  const directory = join(home, ".config", "NeoXider", "AgentDeck");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "widget-settings.json"), JSON.stringify({ harnessLaunchUrl: "http://127.0.0.1:3080/?token=secret" }));
  const settings = readWidgetSettings({ platform: "linux", env: {}, home });
  assert.equal(settings.found, true);
  assert.equal(settings.harnessOrigin, "http://127.0.0.1:3080");
  assert.ok(!JSON.stringify(settings).includes("secret"));
});

test("the installed version comes out of the asar header", () => {
  const directory = mkdtempSync(join(tmpdir(), "deck-asar-"));
  const asar = join(directory, "app.asar");
  writeFileSync(asar, buildAsar(JSON.stringify({ name: "neoxider-agent-deck", version: "1.2.3" })));
  assert.equal(readAsarVersion(asar), "1.2.3");
  assert.equal(readAsarVersion(join(directory, "missing.asar")), null);
});

test("harness origin prefers the live web server", () => {
  assert.equal(harnessOrigin({ webServer: { host: "127.0.0.1", port: 3080 } }, {}), "http://127.0.0.1:3080");
  assert.equal(harnessOrigin({ webServer: { host: "::1", port: 4000 } }, {}), "http://[::1]:4000");
  assert.equal(harnessOrigin({ get: () => ({ host: "0.0.0.0", port: 3081 }) }, {}), "http://127.0.0.1:3081");
  assert.equal(harnessOrigin({}, { DSH_WIDGET_URL: "http://127.0.0.1:3090/?token=x" }), "http://127.0.0.1:3090");
  assert.equal(harnessOrigin({}, {}), null);
});

test("harness_url input is validated", () => {
  assert.equal(validHarnessUrl("http://127.0.0.1:3080/"), "http://127.0.0.1:3080");
  assert.equal(validHarnessUrl("https://user:pass@example.com"), null);
  assert.equal(validHarnessUrl("javascript:alert(1)"), null);
  assert.equal(validHarnessUrl("not a url"), null);
  assert.equal(validHarnessUrl(undefined), null);
});

test("a process probe failure reports unknown rather than closed", async () => {
  const result = await detectRunning({
    platform: "linux",
    execFileImpl: (_file, _args, _options, callback) => callback(new Error("no ps")),
  });
  assert.equal(result.running, null);
  assert.match(result.error, /no ps/);
});

test("launch hands the harness url to the new process", async () => {
  let seen = null;
  const spawnImpl = (_command, _args, options) => {
    seen = options;
    const child = new EventEmitter();
    child.pid = 7;
    child.unref = () => {};
    setImmediate(() => child.emit("spawn"));
    return child;
  };
  const result = await launchDeck({
    location: { executable: "deck.exe", launchKind: "binary" },
    harnessUrl: "http://127.0.0.1:3080",
    spawnImpl,
    env: { PATH: "/bin" },
  });
  assert.equal(result.command, "deck.exe");
  assert.equal(result.pid, 7);
  assert.equal(seen.detached, true);
  assert.equal(seen.env.DSH_WIDGET_URL, "http://127.0.0.1:3080");
  assert.equal(seen.env.PATH, "/bin");
});

test("a launch failure rejects instead of crashing the process", async () => {
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.pid = 8;
    child.unref = () => {};
    setImmediate(() => child.emit("error", new Error("spawn ENOENT")));
    return child;
  };
  await assert.rejects(
    launchDeck({ location: { executable: "missing.exe", launchKind: "binary" }, spawnImpl, env: {} }),
    /ENOENT/,
  );
});

test("apply registers both tools", () => {
  const registered = [];
  const ctx = {
    tools: {
      register(definition) {
        registered.push(definition);
        return () => {};
      },
    },
    effect(run) {
      return run();
    },
  };
  apply(ctx);
  assert.deepEqual(registered.map((definition) => definition.name), ["deck_status", "deck_open"]);
  for (const definition of registered) {
    assert.equal(definition.parameters.type, "object");
    assert.equal(definition.output.schema.type, "string");
    assert.ok(definition.description.length > 40);
  }
});
