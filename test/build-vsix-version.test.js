const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { defaultBuildId, sanitizeBuildId } = require("../tools/build/build-vsix");
const { computeByokPackageVersion } = require("../tools/lib/byok-version");
const { patchRebrand } = require("../tools/patch/patch-rebrand");

test("build-vsix version: defaultBuildId uses UTC timestamp shape", () => {
  const out = defaultBuildId(new Date("2026-03-06T09:08:07.000Z"));
  assert.equal(out, "20260306090807");
});

test("build-vsix version: sanitizeBuildId keeps semver-safe identifier", () => {
  assert.equal(sanitizeBuildId(" Feature Flags / DnIlfDUr "), "feature-flags-dnilfdur");
});

test("build-vsix version: computeByokPackageVersion stays semver-above the marketplace", () => {
  // 9 前缀方案：必须严格高于市场正式版（prerelease 后缀会低于正式版，禁止回退）
  assert.equal(computeByokPackageVersion("0.801.0"), "90.801.0");
  assert.equal(computeByokPackageVersion("0.890.3"), "90.890.3");
  assert.equal(computeByokPackageVersion("1.2.3"), "91.2.3");
  assert.equal(computeByokPackageVersion(""), "90.0.0");
  assert.equal(computeByokPackageVersion("not-a-version"), "90.0.0");
  // 重复应用幂等（contracts-check 与 build 会各自跑一遍补丁管线）
  assert.equal(computeByokPackageVersion("90.890.3"), "90.890.3");
});

test("build-vsix version: patchRebrand stamps the 9-prefix version into package.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "augment-byok-build-version-"));
  try {
    const pkgPath = path.join(dir, "package.json");
    fs.writeFileSync(pkgPath, JSON.stringify({ name: "vscode-augment", publisher: "Augment", version: "0.801.0" }, null, 2));
    patchRebrand(pkgPath);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    assert.equal(pkg.version, "90.801.0");
    assert.equal(pkg.name, "lce-coding-agent");
    assert.equal(pkg.publisher, "lce");
    assert.equal(pkg.displayName, "LCE Coding Agent");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
