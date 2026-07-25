const test = require("node:test");
const assert = require("node:assert/strict");

const {
  initDeviceIdentity,
  getDeviceIdentity,
  applyClientIdHeader,
  resetDeviceIdentityForTest
} = require("../payload/extension/out/byok/runtime/device-identity");
const { buildDeviceLoginUrl } = require("../payload/extension/out/byok/runtime/lce/login");

test("device identity captures machineId and applies x-client-id header", () => {
  resetDeviceIdentityForTest();
  initDeviceIdentity({ env: { machineId: "  machine-123  " } });
  assert.equal(getDeviceIdentity().clientId, "machine-123");

  const headers = applyClientIdHeader({ authorization: "Bearer t" });
  assert.equal(headers["x-client-id"], "machine-123");
  assert.equal(headers.authorization, "Bearer t");
});

test("device identity does not overwrite an existing x-client-id header", () => {
  resetDeviceIdentityForTest();
  initDeviceIdentity({ env: { machineId: "machine-123" } });
  const headers = applyClientIdHeader({ "x-client-id": "pinned" });
  assert.equal(headers["x-client-id"], "pinned");
});

test("device identity is a no-op before init or without machineId", () => {
  resetDeviceIdentityForTest();
  assert.deepEqual(applyClientIdHeader({}), {});

  initDeviceIdentity({ env: {} });
  assert.equal(getDeviceIdentity().clientId, "");
  assert.deepEqual(applyClientIdHeader({}), {});
  assert.equal(applyClientIdHeader(null), null);
});

test("device login URL carries callback and device identity", () => {
  resetDeviceIdentityForTest();
  initDeviceIdentity({ env: { machineId: "machine-abc" } });
  const url = new URL(buildDeviceLoginUrl("http://127.0.0.1:45678/callback"));
  assert.equal(url.pathname, "/api/auth/device");
  assert.equal(url.searchParams.get("callback"), "http://127.0.0.1:45678/callback");
  assert.equal(url.searchParams.get("device_id"), "machine-abc");
});

test("device login URL omits device params for unknown identity", () => {
  resetDeviceIdentityForTest();
  const url = new URL(buildDeviceLoginUrl("http://127.0.0.1:1/callback"));
  assert.equal(url.searchParams.get("device_id"), null);
  assert.equal(url.searchParams.get("callback"), "http://127.0.0.1:1/callback");
});
