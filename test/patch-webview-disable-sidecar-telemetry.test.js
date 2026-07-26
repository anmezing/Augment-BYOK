const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { patchWebviewDisableSidecarTelemetry } = require("../tools/patch/patch-webview-disable-sidecar-telemetry");

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeUtf8(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

// 与上游 Store 资产同构的最小片段（0.871.0 实测形态）
const STORE_FIXTURE = [
  `Zf=(e=>(e.trackAnalyticsEvent="track-analytics-event",e.trackExperimentViewedEvent="track-experiment-viewed-event",e))(Zf||{});`,
  `class S{track=(t,n)=>{this._asyncMsgSender.sendToSidecar({type:Zf.trackAnalyticsEvent,data:{eventName:t,properties:n}},5e3)};trackExperimentViewed=(t,n,a)=>{this._asyncMsgSender.sendToSidecar({type:Zf.trackExperimentViewedEvent,data:{experimentName:t,treatment:n,properties:a}},5e3)};reportAgentSessionEvent=t=>{this._asyncMsgSender.send({type:tt.reportAgentSessionEvent,data:t})}}`
].join("\n");

test("patchWebviewDisableSidecarTelemetry: no-ops both sidecar telemetry senders", () => {
  withTempDir("augment-byok-webview-telemetry-", (dir) => {
    const extDir = path.join(dir, "extension");
    const filePath = path.join(extDir, "common-webviews", "assets", "Store-test.js");
    writeUtf8(filePath, STORE_FIXTURE + "\n");

    const result = patchWebviewDisableSidecarTelemetry(extDir);
    assert.equal(result.changed, true);

    const out = readUtf8(filePath);
    assert.ok(out.includes("track=(t,n)=>{}"), "analytics sender not silenced");
    assert.ok(out.includes("trackExperimentViewed=(t,n,a)=>{}"), "experiment sender not silenced");
    assert.ok(!/\.sendToSidecar\(\{type:\w+\.trackAnalyticsEvent,/.test(out), "analytics send site survived");
    assert.ok(!/\.sendToSidecar\(\{type:\w+\.trackExperimentViewedEvent,/.test(out), "experiment send site survived");
    assert.ok(out.includes("__augment_byok_webview_sidecar_telemetry_off_v1"), "marker missing");
    assert.ok(out.includes("reportAgentSessionEvent=t=>{this._asyncMsgSender.send("), "non-telemetry sender must stay intact");
  });
});

test("patchWebviewDisableSidecarTelemetry: idempotent on already patched asset", () => {
  withTempDir("augment-byok-webview-telemetry-", (dir) => {
    const extDir = path.join(dir, "extension");
    const filePath = path.join(extDir, "common-webviews", "assets", "Store-test.js");
    writeUtf8(filePath, STORE_FIXTURE + "\n");

    patchWebviewDisableSidecarTelemetry(extDir);
    const once = readUtf8(filePath);
    const second = patchWebviewDisableSidecarTelemetry(extDir);
    assert.equal(second.changed, false);
    assert.equal(readUtf8(filePath), once);
  });
});

test("patchWebviewDisableSidecarTelemetry: refuses when sender shape drifted", () => {
  withTempDir("augment-byok-webview-telemetry-", (dir) => {
    const extDir = path.join(dir, "extension");
    const filePath = path.join(extDir, "common-webviews", "assets", "Store-test.js");
    // 触发资产发现（含 sender 站点串），但 track 形态与预期不同
    writeUtf8(
      filePath,
      `class S{track=(t,n,x)=>{this._asyncMsgSender.sendToSidecar({type:Zf.trackAnalyticsEvent,data:{eventName:t,properties:n},extra:x},5e3)}}` + "\n"
    );

    assert.throws(
      () => patchWebviewDisableSidecarTelemetry(extDir),
      /needle not found/
    );
  });
});
