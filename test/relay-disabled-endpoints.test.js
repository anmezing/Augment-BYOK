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

      assert.deepEqual(result, { localNoop: {} }, endpoint);
      assert.deepEqual(transformed, [{}], endpoint);
      assert.equal(calls.length, 1, endpoint);
      assert.match(calls[0], /mode=disabled/, endpoint);
    }
  } finally {
    state.runtimeEnabled = previousEnabled;
    state.configManager = previousConfigManager;
  }
});
