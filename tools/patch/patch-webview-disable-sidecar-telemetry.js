#!/usr/bin/env node
"use strict";

const path = require("path");

const { replaceOnceRegex } = require("../lib/patch");
const { loadPatchText, savePatchText } = require("./patch-target");
const { SIDECAR_TELEMETRY_PATCH_MARKER, listSidecarTelemetryAssets } = require("./webview-assets");

const MARKER = SIDECAR_TELEMETRY_PATCH_MARKER;
const PATCH_LABEL = "webview sidecar telemetry sender no-op";

// BYOK 的遥测策略是全关：HTTP 遥测端点（/client-metrics、/record-session-events 等）
// 已按路由规则 disabled。但 webview 的 track/trackExperimentViewed 走的是
// webview→sidecar 的异步消息通道，路由规则覆盖不到；在上游 broker 尚未注册的
// 启动/登录窗口，应答会丢失，每个事件白等 5s 超时并产生 uncaught rejection。
// 应答链路的竞态属于上游内部管线，宿主侧加速 ack 无法消除丢应答窗口；
// 与遥测策略一致的做法是把 sender 在构建期置空——不发请求就没有超时。

function assertTelemetrySilenced(src, filePath) {
  const s = String(src || "");
  const label = `${PATCH_LABEL}: ${filePath}`;
  if (!s.includes(MARKER)) throw new Error(`${label}: marker missing after patch`);
  if (/\.sendToSidecar\(\{type:[A-Za-z_$][0-9A-Za-z_$]*\.trackAnalyticsEvent,/.test(s)) {
    throw new Error(`${label}: analytics sender still posts to sidecar`);
  }
  if (/\.sendToSidecar\(\{type:[A-Za-z_$][0-9A-Za-z_$]*\.trackExperimentViewedEvent,/.test(s)) {
    throw new Error(`${label}: experiment sender still posts to sidecar`);
  }
}

function patchTelemetryAsset(filePath) {
  const { original, alreadyPatched } = loadPatchText(filePath, { marker: MARKER });
  if (alreadyPatched) {
    assertTelemetrySilenced(original, filePath);
    return { changed: false, reason: "already_patched" };
  }

  let out = original;

  const analyticsRe =
    /track=\((\w+),(\w+)\)=>\{this\._asyncMsgSender\.sendToSidecar\(\{type:(\w+)\.trackAnalyticsEvent,data:\{eventName:\w+,properties:\w+\}\},\d+(?:e\d+)?\)\}/g;
  out = replaceOnceRegex(
    out,
    analyticsRe,
    (m) => `track=(${m[1]},${m[2]})=>{}`,
    `${PATCH_LABEL} (analytics)`
  );

  const experimentRe =
    /trackExperimentViewed=\((\w+),(\w+),(\w+)\)=>\{this\._asyncMsgSender\.sendToSidecar\(\{type:(\w+)\.trackExperimentViewedEvent,data:\{experimentName:\w+,treatment:\w+,properties:\w+\}\},\d+(?:e\d+)?\)\}/g;
  out = replaceOnceRegex(
    out,
    experimentRe,
    (m) => `trackExperimentViewed=(${m[1]},${m[2]},${m[3]})=>{}`,
    `${PATCH_LABEL} (experiment)`
  );

  const saved = savePatchText(filePath, out, { marker: MARKER });
  assertTelemetrySilenced(saved, filePath);
  return { changed: true, reason: "patched" };
}

function patchWebviewDisableSidecarTelemetry(extensionDir) {
  const candidates = listSidecarTelemetryAssets(extensionDir, "patchWebviewDisableSidecarTelemetry");
  const results = [];
  for (const filePath of candidates) results.push({ filePath, ...patchTelemetryAsset(filePath) });
  return { changed: results.some((r) => r.changed), results };
}

module.exports = { patchWebviewDisableSidecarTelemetry };

if (require.main === module) {
  const extensionDir = process.argv[2];
  if (!extensionDir) {
    console.error(`usage: ${path.basename(process.argv[1])} <extensionDir>`);
    process.exit(2);
  }
  patchWebviewDisableSidecarTelemetry(extensionDir);
}
