"use strict";

// BYOK 版本必须严格高于 Augment 市场版本：上游内置的 UpdateVersionNotificationWatcher
// 与 VS Code 更新检查都按 semver 比较，旧方案 `<upstream>-byok.<id>` 是 prerelease，
// 永远低于市场正式版，导致每天弹"有新版"。9 前缀方案（0.890.3 → 90.890.3）保留
// 上游版本可追溯、随上游单调递增，且永远高于市场。buildId 只进产物文件名和 lock。
function computeByokPackageVersion(upstreamVersion) {
  const base = String(upstreamVersion || "").trim();
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(base);
  if (!m) return "90.0.0";
  // 已经盖过章（major ≥ 90）就原样返回，保证重复应用幂等
  if (Number(m[1]) >= 90) return `${m[1]}.${m[2]}.${m[3]}`;
  return `9${m[1]}.${m[2]}.${m[3]}`;
}

module.exports = { computeByokPackageVersion };
