const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeConfig } = require("../payload/extension/out/byok/config/config");
const { RELAY_DISABLED_AUXILIARY_ENDPOINTS } = require("../payload/extension/out/byok/config/relay-disabled-endpoints");
const { state } = require("../payload/extension/out/byok/config/state");
const { maybeHandleCallApi } = require("../payload/extension/out/byok/runtime/shim/call-api");

async function captureAudit(fn) {
  const previous = console.log;
  const calls = [];
  console.log = (...args) => calls.push(args.map((value) => String(value)).join(" "));
  try {
    return { result: await fn(), calls };
  } finally {
    console.log = previous;
  }
}

test("Relay-disabled auxiliary endpoints return local no-op responses", async () => {
  const previousEnabled = state.runtimeEnabled;
  const previousConfigManager = state.configManager;
  const cfg = normalizeConfig({
    routing: {
      rules: Object.fromEntries(RELAY_DISABLED_AUXILIARY_ENDPOINTS.map((endpoint) => [endpoint, { mode: "official" }]))
    }
  });
  state.runtimeEnabled = true;
  state.configManager = { get: () => cfg };

  try {
    for (const endpoint of RELAY_DISABLED_AUXILIARY_ENDPOINTS) {
      const transformed = [];
      const expectedRaw =
        endpoint === "/agents/list-remote-tools"
          ? { tools: [] }
          : endpoint === "/notifications/read"
            ? { notifications: [] }
            : {};
      const { result, calls } = await captureAudit(() =>
        maybeHandleCallApi({
          endpoint,
          body: {},
          transform: (value) => {
            transformed.push(value);
            return { localNoop: value };
          },
          timeoutMs: 1000
        })
      );

      assert.deepEqual(result, { localNoop: expectedRaw }, endpoint);
      assert.deepEqual(transformed, [expectedRaw], endpoint);
      assert.equal(calls.length, 1, endpoint);
      assert.match(calls[0], /mode=disabled/, endpoint);
    }
  } finally {
    state.runtimeEnabled = previousEnabled;
    state.configManager = previousConfigManager;
  }
});

test("Relay-disabled list endpoints satisfy upstream array transforms", async () => {
  const previousEnabled = state.runtimeEnabled;
  const previousConfigManager = state.configManager;
  const cfg = normalizeConfig({});
  state.runtimeEnabled = true;
  state.configManager = { get: () => cfg };

  try {
    const remoteTools = await maybeHandleCallApi({
      endpoint: "/agents/list-remote-tools",
      body: {},
      transform: (value) => ({ tools: value.tools.map((tool) => tool) }),
      timeoutMs: 1000
    });
    const notifications = await maybeHandleCallApi({
      endpoint: "/notifications/read",
      body: {},
      transform: (value) => {
        if (!Array.isArray(value.notifications)) throw new Error("notifications is not an array");
        return { notifications: value.notifications.map((notification) => notification) };
      },
      timeoutMs: 1000
    });

    assert.deepEqual(remoteTools, { tools: [] });
    assert.deepEqual(notifications, { notifications: [] });
  } finally {
    state.runtimeEnabled = previousEnabled;
    state.configManager = previousConfigManager;
  }
});
