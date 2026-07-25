const test = require("node:test");
const assert = require("node:assert/strict");

const {
  UPSTREAM_SESSION_SECRET_KEY,
  connectionFromSession,
  parseUpstreamSession
} = require("../payload/extension/out/byok/runtime/lce/session");
const { startLceRuntime } = require("../payload/extension/out/byok/runtime/lce/runtime");

test("LCE session parser rejects missing or malformed login state", () => {
  assert.equal(parseUpstreamSession(""), null);
  assert.equal(parseUpstreamSession("{"), null);
  assert.equal(parseUpstreamSession(JSON.stringify({ accessToken: " " })), null);
});

test("LCE session connection uses the login token", () => {
  const session = parseUpstreamSession(JSON.stringify({
    accessToken: "session-token",
    tenantURL: "https://relay.example/relay",
    scopes: ["email"]
  }));
  const connection = connectionFromSession(session);
  assert.equal(connection.apiToken, "session-token");
  assert.equal(connection.completionURL.endsWith("/"), true);
});

test("LCE runtime stays disabled without upstream login even if BYOK config has a token", async () => {
  const calls = [];
  const indexCalls = [];
  let onSecretChange = null;
  const mcpRuntime = {
    setConnection: async (connection) => calls.push(["set", connection]),
    dispose: async () => calls.push(["dispose"])
  };
  const ctx = {
    secrets: {
      get: async () => undefined,
      onDidChange: (handler) => {
        onSecretChange = handler;
        return { dispose() {} };
      }
    }
  };

  const indexRuntime = {
    startWatching: () => indexCalls.push("start"),
    stopWatching: () => indexCalls.push("stop")
  };
  const runtime = await startLceRuntime({ vscode: {}, ctx, mcpRuntime, indexRuntime });
  assert.deepEqual(calls, []);
  assert.deepEqual(indexCalls, []);
  assert.equal(typeof onSecretChange, "function");
  await runtime.dispose();
  assert.deepEqual(calls, [["dispose"]]);
});

test("LCE runtime enables on login and disables on logout", async () => {
  let secret = null;
  let onSecretChange = null;
  const calls = [];
  const indexCalls = [];
  const mcpRuntime = {
    setConnection: async (connection) => calls.push(connection ? connection.apiToken : null),
    dispose: async () => calls.push("disposed")
  };
  const ctx = {
    secrets: {
      get: async () => secret,
      onDidChange: (handler) => {
        onSecretChange = handler;
        return { dispose() {} };
      }
    }
  };

  const indexRuntime = {
    startWatching: () => indexCalls.push("start"),
    stopWatching: () => indexCalls.push("stop")
  };
  const runtime = await startLceRuntime({ vscode: {}, ctx, mcpRuntime, indexRuntime });
  secret = JSON.stringify({ accessToken: "logged-in-token", tenantURL: "https://relay.example/relay/" });
  onSecretChange({ key: UPSTREAM_SESSION_SECRET_KEY });
  await runtime.reconcile();
  assert.equal(calls.includes("logged-in-token"), true);
  assert.equal(indexCalls.includes("start"), true);

  secret = null;
  onSecretChange({ key: UPSTREAM_SESSION_SECRET_KEY });
  await runtime.reconcile();
  assert.equal(calls.includes(null), true);
  assert.equal(indexCalls.includes("stop"), true);
  await runtime.dispose();
});
