const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const tag = String(process.argv[2] || "");
if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
  throw new Error(`Release tag must be a stable vX.Y.Z tag, received ${JSON.stringify(tag)}`);
}

const version = tag.slice(1);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");

const checks = [
  [packageJson.version === version, `package.json is ${packageJson.version}`],
  [packageLock.version === version, `package-lock.json is ${packageLock.version}`],
  [packageLock.packages?.[""]?.version === version, `package-lock root is ${packageLock.packages?.[""]?.version}`],
  [readme.includes(`source-v${version}-`), "README source badge is stale"],
  [readme.includes(`changelog-${version}-`), "README changelog badge is stale"],
  [readme.includes(`NeoXider-Agent-Deck-${version}-windows-x64-portable.exe`), "README portable filename is stale"],
  [changelog.includes(`## [${version}] - `), "CHANGELOG has no release heading"],
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) throw new Error(`Release ${tag} is inconsistent: ${failures.join("; ")}`);
console.log(`Release version contract passed for ${tag}`);
